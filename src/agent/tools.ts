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
import { compileStadium } from "../vendor/kickr/shared/stadium";
import { listProjects } from "../persist/db";
import { ensureFont, GOOGLE_FONTS, STROKE_FONTS } from "../smart/fonts";
import { createBlank, createField, importAsProject, openProject } from "../app";

export interface AgentTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  readOnly?: boolean;
  run: (input: JsonObject) => Promise<Json> | Json;
}

class ToolError extends Error {}

function open() {
  const s = editor.get();
  if (!s) throw new ToolError("Nenhum mapa aberto. Use list_projects + open_project, new_map ou import_hbs.");
  return s;
}

const LIST_ENUM = [...LIST_KEYS];
const listOf = (v: Json): ListKey => {
  if (typeof v !== "string" || !(LIST_KEYS as readonly string[]).includes(v)) throw new ToolError(`"list" deve ser um de: ${LIST_KEYS.join(", ")}`);
  return v as ListKey;
};
const refsAt = (list: ListKey, indices: Json): Ref[] => {
  if (!Array.isArray(indices)) throw new ToolError('"indices" deve ser uma lista de números');
  const items = ed().doc.lists[list];
  return indices.map((i) => {
    const it = items[i as number];
    if (!it) throw new ToolError(`${list}[${String(i)}] não existe (há ${items.length})`);
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
      params: sm.kind === "shape" ? { ...sm.params, svg: `(${String(sm.params.svg ?? "").length} caracteres)` } : sm.params,
      cost: smartCost(sm),
    })),
    problems: { errors: issues.filter((i) => i.level === "error").length, warnings: issues.filter((i) => i.level === "warn").length, info: issues.filter((i) => i.level === "info").length },
    coordinates: "Origem no centro do campo; x para a direita, y para BAIXO (como na tela). Ângulos de curva em graus; positivo curva para a esquerda de quem vai de v0 para v1.",
  };
}

const PROPS_SCHEMA = { type: "object", description: "Propriedades do .hbs (ex.: color \"FFFFFF\", cMask [\"ball\"], bCoef, vis, trait, curve, bias). null remove a propriedade.", additionalProperties: true };
const point = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 3 };

export const TOOLS: AgentTool[] = [
  // ---- Reading ----
  {
    name: "get_map",
    title: "Resumo do mapa",
    description: "Resumo do mapa aberto: nome, tamanho, fundo, físicas, traits, quantidade de cada tipo de objeto e orçamento (limite de 255 por tipo do HaxBall), objetos inteligentes com seus parâmetros e contagem de problemas. Comece por aqui.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: () => summary(),
  },
  {
    name: "get_objects",
    title: "Listar objetos",
    description: "Lista os objetos de um tipo (vertexes, segments, goals, discs, planes, joints, redSpawnPoints, blueSpawnPoints) com seu índice e valor exatamente como no .hbs. Segmentos referenciam vértices por índice (v0, v1); joints referenciam discos (d0, d1; o índice 0 é a bola quando ballPhysics não é \"disc0\").",
    inputSchema: { type: "object", properties: { list: { type: "string", enum: LIST_ENUM }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 255 } }, required: ["list"] },
    readOnly: true,
    run: (i) => {
      const list = listOf(i.list);
      const items = open().doc.lists[list];
      const offset = (i.offset as number) ?? 0;
      const limit = (i.limit as number) ?? 100;
      return { total: items.length, items: items.slice(offset, offset + limit).map((it, k) => ({ index: offset + k, value: it.v })) };
    },
  },
  {
    name: "get_hbs",
    title: "Texto do .hbs",
    description: "O arquivo .hbs completo do mapa aberto (JSON5), como seria exportado. clean=true tira os metadados do editor.",
    inputSchema: { type: "object", properties: { clean: { type: "boolean" } } },
    readOnly: true,
    run: (i) => {
      const s = open();
      return exportText(s.doc, s.source, { clean: !!i.clean });
    },
  },
  {
    name: "lint_map",
    title: "Problemas do mapa",
    description: "Problemas encontrados no mapa: vãos por onde a bola ou os jogadores escapam (com o caminho), corpos dentro de paredes, objetos quebrados, limite de 255, segmentos repetidos ou inúteis, traits sem uso.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: () => {
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
  },
  {
    name: "simulate_shot",
    title: "Simular chute",
    description: "Simula a bola com a física real do HaxBall (sem jogadores se mexendo): coloca a bola em (x, y) com velocidade (vx, vy) por até N frames (60 por segundo) e diz por onde passou, onde parou e se entrou em algum gol. Bom para testar quiques, traves e cantos.",
    inputSchema: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, vx: { type: "number" }, vy: { type: "number" }, frames: { type: "integer", minimum: 1, maximum: 1200 } },
      required: ["x", "y", "vx", "vy"],
    },
    readOnly: true,
    run: (i) => {
      const doc = open().doc;
      let stadium;
      try {
        stadium = compileStadium(toJson(doc, true));
      } catch (e) {
        throw new ToolError(`O mapa não carrega no HaxBall: ${(e as Error).message}`);
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
        if (pg.game.red > before[0]) goal = "gol para o red (bola no gol blue)";
        if (pg.game.blue > before[1]) goal = "gol para o blue (bola no gol red)";
        if (goal) break;
      }
      const b = pg.game.discs[0];
      return { goal, frames: frame + 1, end: { x: b.x, y: b.y, vx: b.vx, vy: b.vy }, path };
    },
  },
  {
    name: "render_map",
    title: "Imagem do mapa",
    description: "Uma imagem PNG do mapa (como o HaxBall desenha), em data URL base64.",
    inputSchema: { type: "object", properties: { width: { type: "integer", minimum: 200, maximum: 1600 } } },
    readOnly: true,
    run: async (i) => {
      const doc = open().doc;
      const { drawThumb } = await import("../editor/thumb");
      const c = document.createElement("canvas");
      c.width = (i.width as number) ?? 960;
      c.height = Math.round(c.width * 0.5625);
      drawThumb(c, doc);
      return { image: c.toDataURL("image/png") };
    },
  },
  {
    name: "list_projects",
    title: "Projetos salvos",
    description: "Os mapas salvos neste navegador.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run: async () => (await listProjects()).map((p) => ({ id: p.id, name: p.name, updatedAt: new Date(p.updatedAt).toISOString() })),
  },

  // ---- Projects ----
  {
    name: "open_project",
    title: "Abrir projeto",
    description: "Abre um projeto salvo no editor (veja list_projects).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (i) => {
      await openProject(String(i.id));
      return summary();
    },
  },
  {
    name: "new_map",
    title: "Novo mapa",
    description: "Cria um projeto novo e abre no editor: em branco, ou com o gerador de campo (template classic, big, futsal, real ou hockey).",
    inputSchema: { type: "object", properties: { template: { type: "string", enum: ["blank", ...Object.keys(TEMPLATES)] }, name: { type: "string" } } },
    run: (i) => {
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
  },
  {
    name: "import_hbs",
    title: "Importar .hbs",
    description: "Abre o texto de um .hbs (JSON5) como um projeto novo.",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: (i) => {
      if (!importAsProject(String(i.text), "texto")) throw new ToolError("Não consegui ler esse .hbs.");
      return summary();
    },
  },

  // ---- Editing ----
  {
    name: "set_map_properties",
    title: "Propriedades do mapa",
    description: "Altera campos do estádio: name, width, height, spawnDistance, maxViewWidth, cameraFollow, kickOffReset, canBeStored, bg (objeto, mesclado), playerPhysics (objeto, mesclado), ballPhysics (objeto mesclado ou \"disc0\"), traits (objeto, mesclado por nome). null remove o campo.",
    inputSchema: { type: "object", properties: { properties: { type: "object", additionalProperties: true } }, required: ["properties"] },
    run: (i) => {
      let doc = open().doc;
      for (const [k, v] of Object.entries(obj(i.properties))) {
        const cur = doc.fields[k];
        const merge = (k === "bg" || k === "playerPhysics" || k === "traits" || (k === "ballPhysics" && v !== "disc0")) && v !== null && typeof v === "object" && !Array.isArray(v);
        doc = setField(doc, k, v === null ? undefined : merge ? { ...obj(cur ?? {}), ...obj(v) } : v);
      }
      commit(doc);
      return summary();
    },
  },
  {
    name: "draw_path",
    title: "Desenhar linha",
    description: "Desenha uma sequência de segmentos ligados pelos pontos dados ([x, y] ou [x, y, curva] onde a curva em graus vale para o trecho que chega naquele ponto). closed=true fecha o contorno. properties vai em cada segmento (ex.: { color: \"FFFFFF\", cMask: [] } para linha decorativa; { cMask: [\"ball\"], vis: false } para parede invisível só da bola). vertexProperties vai nos vértices (vértices também colidem como pontos; use cMask: [] em decoração).",
    inputSchema: {
      type: "object",
      properties: { points: { type: "array", items: point, minItems: 2 }, closed: { type: "boolean" }, properties: PROPS_SCHEMA, vertexProperties: PROPS_SCHEMA },
      required: ["points"],
    },
    run: (i) => {
      const pts = (i.points as number[][]).map((p) => p as [number, number, number?]);
      const b = new Builder();
      const props = obj(i.properties ?? {});
      const vprops = obj(i.vertexProperties ?? (Array.isArray(props.cMask) ? { cMask: props.cMask } : {}));
      const seq = i.closed ? [...pts, pts[0]] : pts;
      for (let k = 1; k < seq.length; k++) b.segment(seq[k - 1] as Pt, seq[k] as Pt, seq[k][2] ?? 0, props, vprops);
      return insertClip(b);
    },
  },
  {
    name: "add_objects",
    title: "Adicionar objetos",
    description: "Adiciona objetos no formato do .hbs. vertexes [{x, y, ...}], segments [{v0, v1, ...}] com índices de vértices JÁ existentes no mapa (os vértices adicionados nesta mesma chamada vêm depois dos atuais), discs [{pos:[x,y], radius, color, invMass, ...}], goals [{p0, p1, team: \"red\"|\"blue\"}], planes [{normal:[x,y], dist}], joints [{d0, d1, ...}], redSpawnPoints/blueSpawnPoints [[x,y]]. Retorna os índices criados.",
    inputSchema: { type: "object", properties: Object.fromEntries(LIST_KEYS.map((l) => [l, { type: "array" }])) },
    run: (i) => {
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
  },
  {
    name: "update_objects",
    title: "Alterar objetos",
    description: "Altera propriedades de objetos de um tipo pelos índices (null remove a propriedade, voltando ao trait ou ao padrão do HaxBall). Ex.: { list: \"segments\", indices: [3, 4], properties: { curve: 60, color: \"FF0000\" } }.",
    inputSchema: { type: "object", properties: { list: { type: "string", enum: LIST_ENUM }, indices: { type: "array", items: { type: "integer" } }, properties: PROPS_SCHEMA }, required: ["list", "indices", "properties"] },
    run: (i) => {
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
  },
  {
    name: "delete_objects",
    title: "Apagar objetos",
    description: "Apaga objetos de um tipo pelos índices. Os índices dos outros são renumerados (segmentos e joints continuam ligados); apagar um vértice apaga os segmentos dele.",
    inputSchema: { type: "object", properties: { list: { type: "string", enum: LIST_ENUM }, indices: { type: "array", items: { type: "integer" } } }, required: ["list", "indices"] },
    run: (i) => {
      const list = listOf(i.list);
      const before = LIST_KEYS.map((l) => open().doc.lists[l].length);
      commit(deleteRefs(open().doc, refsAt(list, i.indices)), []);
      const after = LIST_KEYS.map((l) => ed().doc.lists[l].length);
      return { removed: Object.fromEntries(LIST_KEYS.map((l, k) => [l, before[k] - after[k]]).filter(([, n]) => n)) };
    },
  },
  {
    name: "add_text",
    title: "Letreiro",
    description: `Escreve um texto no mapa com segmentos (objeto inteligente, reeditável). Parâmetros: text (\\n quebra linha), x, y (centro), size (altura das maiúsculas), angle (graus, anti-horário), bend (curvatura em graus), spacing, lineHeight, align (left|center|right), color, bold, solid (none = decorativo, ball, all), font: vazio = Haxforge Sans (traço, a mais barata); "stroke:<id>" = traço único (${STROKE_FONTS.map(([id]) => id).join(", ")}); "google:<id>" = contorno do Google Fonts (${GOOGLE_FONTS.map(([id]) => id).join(", ")}), mais caro.`,
    inputSchema: {
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
    run: async (i) => {
      if (typeof i.font === "string") await ensureFont(i.font);
      const made = createSmart(open().doc, "text", i);
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  },
  {
    name: "generate_field",
    title: "Gerar campo",
    description: `Cria (ou ajusta, se já existir) o campo gerado: paredes da bola, gols, traves, redes, barreira do kickoff, planos dos jogadores, áreas e linhas, e também largura, altura, spawn e fundo do mapa. template: ${Object.keys(TEMPLATES).join(", ")}. Outros parâmetros (todos opcionais): width, height (metades do campo), goal (metade da boca do gol), depth, post, net (curve|box), corner, kickoff, spawn, inset (gols para dentro, hockey), marginX, marginY, bg (grass|hockey|none), lines (bg|segments), lineColor, netColor, area (none|futsal|real), areaDepth, areaWidth, smallDepth, smallWidth, spot, arc, bounce.`,
    inputSchema: { type: "object", properties: { template: { type: "string", enum: Object.keys(TEMPLATES) } }, additionalProperties: true },
    run: (i): Json => {
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
  },
  {
    name: "update_smart_object",
    title: "Ajustar objeto inteligente",
    description: "Muda parâmetros de um objeto inteligente (veja smartObjects em get_map): letreiro, campo, padrão, desenho, espelho ou repetição. Os parâmetros são mesclados e o objeto é refeito no lugar.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, params: { type: "object", additionalProperties: true } }, required: ["id", "params"] },
    run: async (i) => {
      const doc = open().doc;
      const sm = doc.smart.find((x) => x.id === i.id);
      if (!sm) throw new ToolError(`Não existe objeto inteligente "${String(i.id)}"`);
      const font = obj(i.params).font;
      if (typeof font === "string") await ensureFont(font);
      commit(updateSmart(doc, sm.id, { ...sm.params, ...obj(i.params) }));
      const now = ed().doc.smart.find((x) => x.id === sm.id)!;
      return { id: sm.id, cost: smartCost(now) };
    },
  },
  {
    name: "add_pattern",
    title: "Padrão decorativo",
    description: "Adiciona um padrão decorativo (objeto inteligente): type stripes (grama listrada: x, y, width, height = metades, bands, direction vertical|horizontal, spacing = distância entre as linhas, 3 = sólido e caro), grid (cell) ou dots (pontos em arco: x, y, radius, from, to em graus, count, dot). color em hex.",
    inputSchema: { type: "object", properties: { type: { type: "string", enum: ["stripes", "grid", "dots"] } }, required: ["type"], additionalProperties: true },
    run: (i) => {
      const made = createSmart(open().doc, "pattern", i);
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  },
  {
    name: "add_svg",
    title: "Desenho SVG",
    description: "Desenha um SVG no mapa com segmentos (objeto inteligente): svg (o texto do SVG), x, y (centro), size (largura no mapa), angle, tolerance (simplificação; maior = menos segmentos), color (vazio = cores do SVG), solid (none|ball|all).",
    inputSchema: { type: "object", properties: { svg: { type: "string" }, x: { type: "number" }, y: { type: "number" }, size: { type: "number" }, angle: { type: "number" }, tolerance: { type: "number" }, color: { type: "string" }, solid: { type: "string", enum: ["none", "ball", "all"] } }, required: ["svg"] },
    run: (i) => {
      const made = createSmart(open().doc, "shape", i);
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  },
  {
    name: "mirror_objects",
    title: "Espelhar",
    description: "Cria cópias espelhadas de objetos que acompanham o original a cada edição. axis: x (esquerda ↔ direita; gols e spawns trocam de time), y (cima ↕ baixo) ou xy (quatro quadrantes). objects: { segments: [índices], vertexes: [...], discs: [...], ... }.",
    inputSchema: { type: "object", properties: { axis: { type: "string", enum: ["x", "y", "xy"] }, objects: { type: "object", additionalProperties: { type: "array", items: { type: "integer" } } } }, required: ["axis", "objects"] },
    run: (i) => {
      const refs = Object.entries(obj(i.objects)).flatMap(([l, idx]) => refsAt(listOf(l), idx));
      const made = createMirror(open().doc, refs, i.axis as Axis);
      if (!made) throw new ToolError("Nada para espelhar.");
      commit(made.doc, refs);
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  },
  {
    name: "repeat_objects",
    title: "Repetir",
    description: "Cria cópias de objetos que acompanham o original: mode linear (count cópias, cada uma deslocada dx, dy da anterior) ou polar (count cópias giradas step graus em torno de cx, cy). objects como em mirror_objects.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["linear", "polar"] }, count: { type: "integer" }, dx: { type: "number" }, dy: { type: "number" }, step: { type: "number" }, cx: { type: "number" }, cy: { type: "number" }, objects: { type: "object" } },
      required: ["mode", "objects"],
    },
    run: (i) => {
      const { objects, ...params } = i;
      const refs = Object.entries(obj(objects)).flatMap(([l, idx]) => refsAt(listOf(l), idx));
      const made = createArray(open().doc, refs, params);
      if (!made) throw new ToolError("Nada para repetir.");
      commit(made.doc, refsOf(made.smart.items));
      return { id: made.smart.id, cost: smartCost(made.smart) };
    },
  },
  {
    name: "optimize_map",
    title: "Otimizar",
    description: "Economiza objetos sem mudar o mapa: unifica vértices repetidos, remove segmentos repetidos e vértices soltos sem colisão, funde segmentos colineares e troca polilinhas circulares por arcos. tolerance = quanto um arco pode se afastar (padrão 0.6).",
    inputSchema: { type: "object", properties: { tolerance: { type: "number" } } },
    run: (i) => {
      const r = optimize(open().doc, { ...OPTIMIZE_DEFAULTS, ...(typeof i.tolerance === "number" && { tolerance: i.tolerance }) });
      if (r.steps.length) commit(r.doc, []);
      return { saved: r.saved, steps: r.steps };
    },
  },
  {
    name: "undo",
    title: "Desfazer",
    description: "Desfaz a última edição (do agente ou do usuário).",
    inputSchema: { type: "object", properties: {} },
    run: () => {
      undo();
      return { ok: true };
    },
  },
  {
    name: "redo",
    title: "Refazer",
    description: "Refaz a última edição desfeita.",
    inputSchema: { type: "object", properties: {} },
    run: () => {
      redo();
      return { ok: true };
    },
  },
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
