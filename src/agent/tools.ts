// What AI agents can do with the editor (exposed through WebMCP, see
// webmcp.ts). Tools work on the open map through the same operations as the
// UI: every edit is one undo step and is listed in the agent activity log.
import type { Json, JsonObject } from "../doc/json";
import { lint } from "../doc/lint";
import { exportText, LIST_KEYS, toJson, type ListKey } from "../doc/model";
import { addItems, deleteRefs, obj, refOf, setField, updateItems, type Ref } from "../doc/ops";
import { budget, LIMIT } from "../doc/resolve";
import { commit, ed, editor, redo, undo } from "../editor/state";
import { Playground } from "../play/engine";
import { TEMPLATES } from "../smart/field";
import { optimize, OPTIMIZE_DEFAULTS } from "../smart/optimize";
import { createArray, createMirror, createSmart, refsOf, smartCost, updateSmart, type Axis } from "../smart/smart";
import { Builder, type Pt } from "../smart/builder";
import { compileStadium } from "../vendor/haxball/shared/stadium";
import { listProjects } from "../persist/db";
import { ensureFont, GOOGLE_FONTS, STROKE_FONTS } from "../smart/fonts";
import { createBlank, createField, importAsProject, openProject } from "../app";
import { tr } from "../i18n";

export interface AgentTool {
  name: string;
  readonly title: string;
  readonly description: string;
  inputSchema: JsonObject;
  readOnly?: boolean;
  run: (input: JsonObject) => Promise<Json> | Json;
}

class ToolError extends Error {}

function open() {
  const s = editor.get();
  if (!s) throw new ToolError(tr("Nenhum mapa aberto. Use list_projects + open_project, new_map ou import_hbs.", "No map open. Use list_projects + open_project, new_map, or import_hbs."));
  return s;
}

const LIST_ENUM = [...LIST_KEYS];
const listOf = (v: Json): ListKey => {
  if (typeof v !== "string" || !(LIST_KEYS as readonly string[]).includes(v)) throw new ToolError(tr(`"list" deve ser um de: ${LIST_KEYS.join(", ")}`, `"list" must be one of: ${LIST_KEYS.join(", ")}`));
  return v as ListKey;
};
const refsAt = (list: ListKey, indices: Json): Ref[] => {
  if (!Array.isArray(indices)) throw new ToolError(tr('"indices" deve ser uma lista de números', '"indices" must be an array of numbers'));
  const items = ed().doc.lists[list];
  return indices.map((i) => {
    const it = items[i as number];
    if (!it) throw new ToolError(tr(`${list}[${String(i)}] não existe (há ${items.length})`, `${list}[${String(i)}] does not exist (there are ${items.length})`));
    return refOf(list, it.id);
  });
};
// Where each new item ended up, as list indices.
const indicesOf = (refs: Ref[]): JsonObject => {
  const doc = ed().doc;
  const out: JsonObject = {};
  for (const list of LIST_KEYS) {
    const pos = new Map(doc.lists[list].map((it, i) => [it.id, i]));
    const idx = refs.filter((r) => r.startsWith(`${list}:`)).map((r) => pos.get(Number(r.split(":")[1])) ?? -1);
    if (idx.length) out[list] = idx;
  }
  return out;
};

function summary(): JsonObject {
  const s = open();
  const doc = s.doc;
  const issues = lint(doc);
  return {
    name: doc.fields.name ?? null,
    width: doc.fields.width ?? null,
    height: doc.fields.height ?? null,
    spawnDistance: doc.fields.spawnDistance ?? null,
    bg: doc.fields.bg ?? null,
    ballPhysics: doc.fields.ballPhysics ?? null,
    playerPhysics: doc.fields.playerPhysics ?? null,
    traits: doc.fields.traits ?? {},
    counts: Object.fromEntries(LIST_KEYS.map((l) => [l, doc.lists[l].length])),
    budget: Object.fromEntries(budget(doc).map((b) => [b.key, `${b.used}/${LIMIT}`])),
    smartObjects: doc.smart.map((sm) => ({
      id: sm.id,
      kind: sm.kind,
      params: sm.kind === "shape" ? { ...sm.params, svg: `(${String(sm.params.svg ?? "").length} ${tr("caracteres", "chars")})` } : sm.params,
      cost: smartCost(sm),
    })),
    problems: { errors: issues.filter((i) => i.level === "error").length, warnings: issues.filter((i) => i.level === "warn").length, info: issues.filter((i) => i.level === "info").length },
    coordinates: tr(
      "Origem no centro do campo; x para a direita, y para BAIXO (como na tela). Ângulos de curva em graus; positivo curva para a esquerda de quem vai de v0 para v1.",
      "Origin at the center of the field; x to the right, y DOWN (screen coordinates). Curve angles in degrees; positive curves to the left when going from v0 to v1.",
    ),
  };
}

const PROPS_SCHEMA = { type: "object", description: "Propriedades do .hbs (ex.: color \"FFFFFF\", cMask [\"ball\"], bCoef, vis, trait, curve, bias). null remove a propriedade.", additionalProperties: true };
const point = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 3 };

const t = (
  name: string,
  title: [string, string],
  description: [string, string],
  inputSchema: JsonObject,
  run: (input: JsonObject) => Promise<Json> | Json,
  readOnly?: boolean,
): AgentTool => ({
  name,
  get title() {
    return tr(title[0], title[1]);
  },
  get description() {
    return tr(description[0], description[1]);
  },
  inputSchema,
  readOnly,
  run,
});

export const TOOLS: AgentTool[] = [
  // ---- Reading ----
  t(
    "get_map",
    ["Resumo do mapa", "Map summary"],
    [
      "Resumo do mapa aberto: nome, tamanho, fundo, físicas, traits, quantidade de cada tipo de objeto e orçamento (limite de 255 por tipo do HaxBall), objetos inteligentes com seus parâmetros e contagem de problemas. Comece por aqui.",
      "Summary of the open map: name, size, background, physics, traits, count of each object type and budget (HaxBall's 255 limit per type), smart objects with parameters, and issue counts. Start here.",
    ],
    { type: "object", properties: {} },
    () => summary(),
    true,
  ),
  t(
    "get_objects",
    ["Listar objetos", "List objects"],
    [
      "Lista os objetos de um tipo (vertexes, segments, goals, discs, planes, joints, redSpawnPoints, blueSpawnPoints) com seu índice e valor exatamente como no .hbs. Segmentos referenciam vértices por índice (v0, v1); joints referenciam discos (d0, d1; o índice 0 é a bola quando ballPhysics não é \"disc0\").",
      "Lists objects of a given type (vertexes, segments, goals, discs, planes, joints, redSpawnPoints, blueSpawnPoints) with their index and exact .hbs value. Segments reference vertices by index (v0, v1); joints reference discs (d0, d1; index 0 is the ball when ballPhysics is not \"disc0\").",
    ],
    { type: "object", properties: { list: { type: "string", enum: LIST_ENUM }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 255 } }, required: ["list"] },
    (i) => {
      const list = listOf(i.list);
      const items = open().doc.lists[list];
      const offset = (i.offset as number) ?? 0;
      const limit = (i.limit as number) ?? 100;
      return { total: items.length, items: items.slice(offset, offset + limit).map((it, k) => ({ index: offset + k, value: it.v })) };
    },
    true,
  ),
  t(
    "get_hbs",
    ["Texto do .hbs", ".hbs text"],
    [
      "O arquivo .hbs completo do mapa aberto (JSON5), como seria exportado. clean=true tira os metadados do editor.",
      "Full .hbs file of the open map (JSON5), as it would be exported. clean=true strips editor metadata.",
    ],
    { type: "object", properties: { clean: { type: "boolean" } } },
    (i) => {
      const s = open();
      return exportText(s.doc, s.source, { clean: !!i.clean });
    },
    true,
  ),
  t(
    "lint_map",
    ["Problemas do mapa", "Map issues"],
    [
      "Problemas encontrados no mapa: vãos por onde a bola ou os jogadores escapam (com o caminho), corpos dentro de paredes, objetos quebrados, limite de 255, segmentos repetidos ou inúteis, traits sem uso.",
      "Issues found in the map: gaps where the ball or players can escape (with escape path), bodies inside walls, broken objects, 255 limit exceeded, duplicate or no-op segments, unused traits.",
    ],
    { type: "object", properties: {} },
    () => {
      const doc = open().doc;
      return lint(doc).map((is) => ({
        level: is.level,
        text: is.text,
        at: is.at ?? null,
        objects: indicesOfDoc(is.refs),
        fixable: !!is.fix,
        ...(is.path && { path: is.path.filter((_, k, a) => k % Math.max(1, Math.floor(a.length / 12)) === 0) }),
      }));
    },
    true,
  ),
  t(
    "simulate_shot",
    ["Simular chute", "Simulate shot"],
    [
      "Simula a bola com a física real do HaxBall (sem jogadores se mexendo): coloca a bola em (x, y) com velocidade (vx, vy) por até N frames (60 por segundo) e diz por onde passou, onde parou e se entrou em algum gol. Bom para testar quiques, traves e cantos.",
      "Simulates the ball with real HaxBall physics (without moving players): places the ball at (x, y) with velocity (vx, vy) for up to N frames (60 per second) and returns its path, where it stopped, and whether it scored. Useful for testing bounces, posts, and corners.",
    ],
    {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, vx: { type: "number" }, vy: { type: "number" }, frames: { type: "integer", minimum: 1, maximum: 1200 } },
      required: ["x", "y", "vx", "vy"],
    },
    (i) => {
      const doc = open().doc;
      let stadium;
      try {
        stadium = compileStadium(toJson(doc, true));
      } catch (e) {
        throw new ToolError(tr(`O mapa não carrega no HaxBall: ${(e as Error).message}`, `Map cannot load in HaxBall: ${(e as Error).message}`));
      }
      const pg = new Playground(stadium, false);
      pg.speed = 0;
      // Players stay out of the way.
      for (const p of pg.game.players) if (p.disc >= 0) Object.assign(pg.game.discs[p.disc], { x: 1e6, y: 1e6 });
      pg.launch(i.x as number, i.y as number, i.vx as number, i.vy as number);
      const frames = (i.frames as number) ?? 300;
      const path: number[][] = [];
      let goal: string | null = null;
      let frame = 0;
      for (; frame < frames; frame++) {
        const before = [pg.game.red, pg.game.blue];
        pg.stepFrame();
        const b = pg.game.discs[0];
        if (frame % 10 === 0) path.push([Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10]);
        if (pg.game.red > before[0]) goal = tr("gol para o red (bola no gol blue)", "goal for red (ball in blue goal)");
        if (pg.game.blue > before[1]) goal = tr("gol para o blue (bola no gol red)", "goal for blue (ball in red goal)");
        if (goal) break;
      }
      const b = pg.game.discs[0];
      return { goal, frames: frame + 1, end: { x: b.x, y: b.y, vx: b.vx, vy: b.vy }, path };
    },
    true,
  ),
  t(
    "render_map",
    ["Imagem do mapa", "Render map image"],
    [
      "Uma imagem PNG do mapa (como o HaxBall desenha), em data URL base64.",
      "A PNG image of the map (as drawn by HaxBall), as a base64 data URL.",
    ],
    { type: "object", properties: { width: { type: "integer", minimum: 200, maximum: 1600 } } },
    async (i) => {
      const doc = open().doc;
      const { drawThumb } = await import("../editor/thumb");
      const c = document.createElement("canvas");
      c.width = (i.width as number) ?? 960;
      c.height = Math.round(c.width * 0.5625);
      drawThumb(c, doc);
      return { image: c.toDataURL("image/png") };
    },
    true,
  ),
  t(
    "list_projects",
    ["Projetos salvos", "Saved projects"],
    ["Os mapas salvos neste navegador.", "Maps saved in this browser."],
    { type: "object", properties: {} },
    async () => (await listProjects()).map((p) => ({ id: p.id, name: p.name, updatedAt: new Date(p.updatedAt).toISOString() })),
    true,
  ),

  // ---- Projects ----
  t(
    "open_project",
    ["Abrir projeto", "Open project"],
    ["Abre um projeto salvo no editor (veja list_projects).", "Opens a saved project in the editor (see list_projects)."],
    { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async (i) => {
      await openProject(String(i.id));
      return summary();
    },
  ),
  t(
    "new_map",
    ["Novo mapa", "New map"],
    [
      "Cria um projeto novo e abre no editor: em branco, ou com o gerador de campo (template classic, big, futsal, real ou hockey).",
      "Creates a new project and opens it in the editor: blank, or with the field generator (template classic, big, futsal, real, or hockey).",
    ],
    { type: "object", properties: { template: { type: "string", enum: ["blank", ...Object.keys(TEMPLATES)] }, name: { type: "string" } } },
    (i) => {
      const t = (i.template as string) ?? "blank";
      if (t === "blank") createBlank();
      else {
        createField();
        const s = ed();
        const f = s.doc.smart.find((x) => x.kind === "field");
        if (f && t !== "classic") commit(updateSmart(s.doc, f.id, { template: t }));
      }
      if (typeof i.name === "string") commit(setField(ed().doc, "name", i.name));
      return summary();
    },
  ),
  t(
    "import_hbs",
    ["Importar .hbs", "Import .hbs"],
    ["Abre o texto de um .hbs (JSON5) como um projeto novo.", "Opens .hbs text (JSON5) as a new project."],
    { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    (i) => {
      if (!importAsProject(String(i.text), tr("texto", "text"))) throw new ToolError(tr("Não consegui ler esse .hbs.", "Could not parse that .hbs."));
      return summary();
    },
  ),

  // ---- Editing ----
  t(
    "set_map_properties",
    ["Propriedades do mapa", "Set map properties"],
    [
      "Altera campos do estádio: name, width, height, spawnDistance, maxViewWidth, cameraFollow, kickOffReset, canBeStored, bg (objeto, mesclado), playerPhysics (objeto, mesclado), ballPhysics (objeto mesclado ou \"disc0\"), traits (objeto, mesclado por nome). null remove o campo.",
      "Updates stadium fields: name, width, height, spawnDistance, maxViewWidth, cameraFollow, kickOffReset, canBeStored, bg (merged object), playerPhysics (merged object), ballPhysics (merged object or \"disc0\"), traits (merged by name). null removes the field.",
    ],
    { type: "object", properties: { properties: { type: "object", additionalProperties: true } }, required: ["properties"] },
    (i) => {
      let doc = open().doc;
      for (const [k, v] of Object.entries(obj(i.properties))) {
        const cur = doc.fields[k];
        const merge = (k === "bg" || k === "playerPhysics" || k === "traits" || (k === "ballPhysics" && v !== "disc0")) && v !== null && typeof v === "object" && !Array.isArray(v);
        doc = setField(doc, k, v === null ? undefined : merge ? { ...obj(cur ?? {}), ...obj(v) } : v);
      }
      commit(doc);
      return summary();
    },
  ),
  t(
    "draw_path",
    ["Desenhar linha", "Draw path"],
    [
      "Desenha uma sequência de segmentos ligados pelos pontos dados ([x, y] ou [x, y, curva] onde a curva em graus vale para o trecho que chega naquele ponto). closed=true fecha o contorno. properties vai em cada segmento (ex.: { color: \"FFFFFF\", cMask: [] } para linha decorativa; { cMask: [\"ball\"], vis: false } para parede invisível só da bola). vertexProperties vai nos vértices (vértices também colidem como pontos; use cMask: [] em decoração).",
      "Draws a sequence of connected segments through the given points ([x, y] or [x, y, curve] where curve in degrees applies to the segment reaching that point). closed=true closes the loop. properties are applied to each segment (e.g. { color: \"FFFFFF\", cMask: [] } for decorative lines; { cMask: [\"ball\"], vis: false } for invisible ball-only walls). vertexProperties are applied to vertices (vertices also collide as points; use cMask: [] for decoration).",
    ],
    {
      type: "object",
      properties: { points: { type: "array", items: point, minItems: 2 }, closed: { type: "boolean" }, properties: PROPS_SCHEMA, vertexProperties: PROPS_SCHEMA },
      required: ["points"],
    },
    (i) => {
      const pts = (i.points as number[][]).map((p) => p as [number, number, number?]);
      const b = new Builder();
      const props = obj(i.properties ?? {});
      const vprops = obj(i.vertexProperties ?? (Array.isArray(props.cMask) ? { cMask: props.cMask } : {}));
      const seq = i.closed ? [...pts, pts[0]] : pts;
      for (let k = 1; k < seq.length; k++) b.segment(seq[k - 1] as Pt, seq[k] as Pt, seq[k][2] ?? 0, props, vprops);
      return insertClip(b);
    },
  ),
  t(
    "add_objects",
    ["Adicionar objetos", "Add objects"],
    [
      "Adiciona objetos no formato do .hbs. vertexes [{x, y, ...}], segments [{v0, v1, ...}] com índices de vértices JÁ existentes no mapa (os vértices adicionados nesta mesma chamada vêm depois dos atuais), discs [{pos:[x,y], radius, color, invMass, ...}], goals [{p0, p1, team: \"red\"|\"blue\"}], planes [{normal:[x,y], dist}], joints [{d0, d1, ...}], redSpawnPoints/blueSpawnPoints [[x,y]]. Retorna os índices criados.",
      "Adds objects in .hbs format. vertexes [{x, y, ...}], segments [{v0, v1, ...}] using existing vertex indices (vertices added in the same call are appended after current ones), discs [{pos:[x,y], radius, color, invMass, ...}], goals [{p0, p1, team: \"red\"|\"blue\"}], planes [{normal:[x,y], dist}], joints [{d0, d1, ...}], redSpawnPoints/blueSpawnPoints [[x,y]]. Returns created indices.",
    ],
    { type: "object", properties: Object.fromEntries(LIST_KEYS.map((l) => [l, { type: "array" }])) },
    (i) => {
      let doc = open().doc;
      const refs: Ref[] = [];
      for (const list of LIST_KEYS) {
        const vals = i[list];
        if (!Array.isArray(vals) || !vals.length) continue;
        const r = addItems(doc, list, vals);
        doc = r.doc;
        refs.push(...r.ids.map((id) => refOf(list, id)));
      }
      commit(doc, refs);
      return { created: indicesOf(refs), problems: lint(ed().doc).filter((x) => x.level === "error").map((x) => x.text) };
    },
  ),
  t(
    "update_objects",
    ["Alterar objetos", "Update objects"],
    [
      "Altera propriedades de objetos de um tipo pelos índices (null remove a propriedade, voltando ao trait ou ao padrão do HaxBall). Ex.: { list: \"segments\", indices: [3, 4], properties: { curve: 60, color: \"FF0000\" } }.",
      "Updates properties of objects of a given type by index (null removes the property, falling back to its trait or HaxBall's default). E.g.: { list: \"segments\", indices: [3, 4], properties: { curve: 60, color: \"FF0000\" } }.",
    ],
    { type: "object", properties: { list: { type: "string", enum: LIST_ENUM }, indices: { type: "array", items: { type: "integer" } }, properties: PROPS_SCHEMA }, required: ["list", "indices", "properties"] },
    (i) => {
      const list = listOf(i.list);
      const refs = refsAt(list, i.indices);
      const ids = refs.map((r) => Number(r.split(":")[1]));
      const props = obj(i.properties);
      commit(
        updateItems(open().doc, list, ids, (v) => {
          if (Array.isArray(v)) return Array.isArray(props.value) ? (props.value as Json) : v;
          const o: JsonObject = { ...obj(v) };
          for (const [k, val] of Object.entries(props)) {
            if (val === null) delete o[k];
            else o[k] = val;
          }
          return o;
        }),
        refs,
      );
      return { updated: refs.length };
    },
  ),
  t(
    "delete_objects",
    ["Apagar objetos", "Delete objects"],
    [
      "Apaga objetos de um tipo pelos índices. Os índices dos outros são renumerados (segmentos e joints continuam ligados); apagar um vértice apaga os segmentos dele.",
      "Deletes objects of a given type by index. Remaining indices are remapped automatically (segments and joints stay connected); deleting a vertex also deletes its segments.",
    ],
    { type: "object", properties: { list: { type: "string", enum: LIST_ENUM }, indices: { type: "array", items: { type: "integer" } } }, required: ["list", "indices"] },
    (i) => {
      const list = listOf(i.list);
      const before = LIST_KEYS.map((l) => open().doc.lists[l].length);
      commit(deleteRefs(open().doc, refsAt(list, i.indices)), []);
      const after = LIST_KEYS.map((l) => ed().doc.lists[l].length);
      return { removed: Object.fromEntries(LIST_KEYS.map((l, k) => [l, before[k] - after[k]]).filter(([, n]) => n)) };
    },
  ),
  t(
    "add_text",
    ["Letreiro", "Add banner text"],
    [
      `Escreve um texto no mapa com segmentos (objeto inteligente, reeditável). Parâmetros: text (\\n quebra linha), x, y (centro), size (altura das maiúsculas), angle (graus, anti-horário), bend (curvatura em graus), spacing, lineHeight, align (left|center|right), color, bold, solid (none = decorativo, ball, all), font: vazio = Haxforge Sans (traço, a mais barata); "stroke:<id>" = traço único (${STROKE_FONTS.map(([id]) => id).join(", ")}); "google:<id>" = contorno do Google Fonts (${GOOGLE_FONTS.map(([id]) => id).join(", ")}), mais caro.`,
      `Writes banner text on the map using segments (re-editable smart object). Parameters: text (\\n breaks lines), x, y (center), size (capital height), angle (degrees, counter-clockwise), bend (arc curvature in degrees), spacing, lineHeight, align (left|center|right), color, bold, solid (none = decorative, ball, all), font: empty = Haxforge Sans (stroke, cheapest); "stroke:<id>" = single-stroke (${STROKE_FONTS.map(([id]) => id).join(", ")}); "google:<id>" = Google Fonts outline (${GOOGLE_FONTS.map(([id]) => id).join(", ")}), more expensive.`,
    ],
    {
      type: "object",
      properties: {
        text: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        size: { type: "number" },
        angle: { type: "number" },
        bend: { type: "number" },
        color: { type: "string" },
        align: { type: "string", enum: ["left", "center", "right"] },
        solid: { type: "string", enum: ["none", "ball", "all"] },
        bold: { type: "boolean" },
        spacing: { type: "number" },
        lineHeight: { type: "number" },
        font: { type: "string" },
      },
      required: ["text"],
    },
    async (i) => {
      if (typeof i.font === "string") await ensureFont(i.font);
      const made = createSmart(open().doc, "text", i);
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  ),
  t(
    "generate_field",
    ["Gerar campo", "Generate field"],
    [
      `Cria (ou ajusta, se já existir) o campo gerado: paredes da bola, gols, traves, redes, barreira do kickoff, planos dos jogadores, áreas e linhas, e também largura, altura, spawn e fundo do mapa. template: ${Object.keys(TEMPLATES).join(", ")}. Outros parâmetros (todos opcionais): width, height (metades do campo), goal (metade da boca do gol), depth, post, net (curve|box), corner, kickoff, spawn, inset (gols para dentro, hockey), marginX, marginY, bg (grass|hockey|none), lines (bg|segments), lineColor, netColor, area (none|futsal|real), areaDepth, areaWidth, smallDepth, smallWidth, spot, arc, bounce.`,
      `Creates (or updates if already present) the generated field: ball walls, goals, posts, nets, kickoff barrier, player planes, penalty areas and markings, plus map width, height, spawn, and background. template: ${Object.keys(TEMPLATES).join(", ")}. Optional parameters: width, height (field half-sizes), goal (half goal mouth), depth, post, net (curve|box), corner, kickoff, spawn, inset (inset goals, hockey), marginX, marginY, bg (grass|hockey|none), lines (bg|segments), lineColor, netColor, area (none|futsal|real), areaDepth, areaWidth, smallDepth, smallWidth, spot, arc, bounce.`,
    ],
    { type: "object", properties: { template: { type: "string", enum: Object.keys(TEMPLATES) } }, additionalProperties: true },
    (i): Json => {
      const doc = open().doc;
      const existing = doc.smart.find((x) => x.kind === "field");
      if (existing) {
        const params = i.template && i.template !== existing.params.template ? { ...i } : { ...existing.params, ...i };
        commit(updateSmart(doc, existing.id, params));
        return { id: existing.id, updated: true, problems: lint(ed().doc).filter((x) => x.level !== "info").map((x) => x.text) };
      }
      const made = createSmart(doc, "field", { template: "classic", ...i });
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, created: true, problems: lint(ed().doc).filter((x) => x.level !== "info").map((x) => x.text) };
    },
  ),
  t(
    "update_smart_object",
    ["Ajustar objeto inteligente", "Update smart object"],
    [
      "Muda parâmetros de um objeto inteligente (veja smartObjects em get_map): letreiro, campo, padrão, desenho, espelho ou repetição. Os parâmetros são mesclados e o objeto é refeito no lugar.",
      "Updates parameters of a smart object (see smartObjects in get_map): banner text, field, pattern, shape, mirror, or repeat. Parameters are merged and the object is regenerated in place.",
    ],
    { type: "object", properties: { id: { type: "string" }, params: { type: "object", additionalProperties: true } }, required: ["id", "params"] },
    async (i) => {
      const doc = open().doc;
      const sm = doc.smart.find((x) => x.id === i.id);
      if (!sm) throw new ToolError(tr(`Não existe objeto inteligente "${String(i.id)}"`, `Smart object "${String(i.id)}" does not exist`));
      const font = obj(i.params).font;
      if (typeof font === "string") await ensureFont(font);
      commit(updateSmart(doc, sm.id, { ...sm.params, ...obj(i.params) }));
      const now = ed().doc.smart.find((x) => x.id === sm.id)!;
      return { id: sm.id, cost: smartCost(now) };
    },
  ),
  t(
    "add_pattern",
    ["Padrão decorativo", "Decorative pattern"],
    [
      "Adiciona um padrão decorativo (objeto inteligente): type stripes (grama listrada: x, y, width, height = metades, bands, direction vertical|horizontal, spacing = distância entre as linhas, 3 = sólido e caro), grid (cell) ou dots (pontos em arco: x, y, radius, from, to em graus, count, dot). color em hex.",
      "Adds a decorative pattern (smart object): type stripes (striped grass: x, y, width, height = half-sizes, bands, direction vertical|horizontal, spacing = line distance, 3 = solid and expensive), grid (cell), or dots (arc dots: x, y, radius, from, to in degrees, count, dot). color in hex.",
    ],
    { type: "object", properties: { type: { type: "string", enum: ["stripes", "grid", "dots"] } }, required: ["type"], additionalProperties: true },
    (i) => {
      const made = createSmart(open().doc, "pattern", i);
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  ),
  t(
    "add_svg",
    ["Desenho SVG", "SVG drawing"],
    [
      "Desenha um SVG no mapa com segmentos (objeto inteligente): svg (o texto do SVG), x, y (centro), size (largura no mapa), angle, tolerance (simplificação; maior = menos segmentos), color (vazio = cores do SVG), solid (none|ball|all).",
      "Draws an SVG on the map using segments (smart object): svg (SVG markup), x, y (center), size (width on map), angle, tolerance (simplification; higher = fewer segments), color (empty = SVG colors), solid (none|ball|all).",
    ],
    { type: "object", properties: { svg: { type: "string" }, x: { type: "number" }, y: { type: "number" }, size: { type: "number" }, angle: { type: "number" }, tolerance: { type: "number" }, color: { type: "string" }, solid: { type: "string", enum: ["none", "ball", "all"] } }, required: ["svg"] },
    (i) => {
      const made = createSmart(open().doc, "shape", i);
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  ),
  t(
    "mirror_objects",
    ["Espelhar", "Mirror objects"],
    [
      "Cria cópias espelhadas de objetos que acompanham o original a cada edição. axis: x (esquerda ↔ direita; gols e spawns trocam de time), y (cima ↕ baixo) ou xy (quatro quadrantes). objects: { segments: [índices], vertexes: [...], discs: [...], ... }.",
      "Creates mirrored copies of objects that follow the original on every edit. axis: x (left ↔ right; goals and spawns swap teams), y (top ↕ bottom), or xy (four quadrants). objects: { segments: [indices], vertexes: [...], discs: [...], ... }.",
    ],
    { type: "object", properties: { axis: { type: "string", enum: ["x", "y", "xy"] }, objects: { type: "object", additionalProperties: { type: "array", items: { type: "integer" } } } }, required: ["axis", "objects"] },
    (i) => {
      const refs = Object.entries(obj(i.objects)).flatMap(([l, idx]) => refsAt(listOf(l), idx));
      const made = createMirror(open().doc, refs, i.axis as Axis);
      if (!made) throw new ToolError(tr("Nada para espelhar.", "Nothing to mirror."));
      commit(made.doc, refs);
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  ),
  t(
    "repeat_objects",
    ["Repetir", "Repeat objects"],
    [
      "Cria cópias de objetos que acompanham o original: mode linear (count cópias, cada uma deslocada dx, dy da anterior) ou polar (count cópias giradas step graus em torno de cx, cy). objects como em mirror_objects.",
      "Creates copies of objects that follow the original: mode linear (count copies, each offset by dx, dy from the previous) or polar (count copies rotated by step degrees around cx, cy). objects as in mirror_objects.",
    ],
    {
      type: "object",
      properties: { mode: { type: "string", enum: ["linear", "polar"] }, count: { type: "integer" }, dx: { type: "number" }, dy: { type: "number" }, step: { type: "number" }, cx: { type: "number" }, cy: { type: "number" }, objects: { type: "object" } },
      required: ["mode", "objects"],
    },
    (i) => {
      const { objects, ...params } = i;
      const refs = Object.entries(obj(objects)).flatMap(([l, idx]) => refsAt(listOf(l), idx));
      const made = createArray(open().doc, refs, params);
      if (!made) throw new ToolError(tr("Nada para repetir.", "Nothing to repeat."));
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  ),
  t(
    "optimize_map",
    ["Otimizar", "Optimize map"],
    [
      "Economiza objetos sem mudar o mapa: unifica vértices repetidos, remove segmentos repetidos e vértices soltos sem colisão, funde segmentos colineares e troca polilinhas circulares por arcos. tolerance = quanto um arco pode se afastar (padrão 0.6).",
      "Saves objects without changing the map: merges duplicate vertices, removes duplicate segments and non-colliding loose vertices, merges collinear segments, and replaces circular polylines with arcs. tolerance = max arc deviation (default 0.6).",
    ],
    { type: "object", properties: { tolerance: { type: "number" } } },
    (i) => {
      const r = optimize(open().doc, { ...OPTIMIZE_DEFAULTS, ...(typeof i.tolerance === "number" && { tolerance: i.tolerance }) });
      if (r.steps.length) commit(r.doc, []);
      return { saved: r.saved, steps: r.steps };
    },
  ),
  t(
    "undo",
    ["Desfazer", "Undo"],
    ["Desfaz a última edição (do agente ou do usuário).", "Undoes the last edit (by the agent or user)."],
    { type: "object", properties: {} },
    () => {
      undo();
      return { ok: true };
    },
  ),
  t(
    "redo",
    ["Refazer", "Redo"],
    ["Refaz a última edição desfeita.", "Redoes the last undone edit."],
    { type: "object", properties: {} },
    () => {
      redo();
      return { ok: true };
    },
  ),
];

function indicesOfDoc(refs: Ref[]): JsonObject {
  return editor.get() ? indicesOf(refs) : {};
}

function insertClip(b: Builder): Json {
  const clip = b.clip();
  let doc = open().doc;
  const refs: Ref[] = [];
  const vBase = doc.lists.vertexes.length;
  for (const list of LIST_KEYS) {
    const vals = clip[list];
    if (!vals?.length) continue;
    const shifted = list === "segments" ? vals.map((v) => ({ ...obj(v), v0: (obj(v).v0 as number) + vBase, v1: (obj(v).v1 as number) + vBase })) : vals;
    const r = addItems(doc, list, shifted);
    doc = r.doc;
    refs.push(...r.ids.map((id) => refOf(list, id)));
  }
  commit(doc, refs);
  return { created: indicesOf(refs) };
}

export const isToolError = (e: unknown): e is Error => e instanceof ToolError;
