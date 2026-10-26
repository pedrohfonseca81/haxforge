// Editor actions, shared by keyboard shortcuts, menus and the command palette.
import { exportText, LIST_KEYS, type ListKey } from "../doc/model";
import { copyRefs, deleteRefs, findItem, movableRefs, moveItems, obj, parseRef, pasteClip, refOf, setField, translateRefs, updateItems, type Clip, type MoveTarget, type Ref } from "../doc/ops";
import { budget, LIMIT } from "../doc/resolve";
import { compileStadium } from "../vendor/kickr/shared/stadium";
import { toJson } from "../doc/model";
import { isObject, jsonEqual, type Json, type JsonObject } from "../doc/json";
import { traitsOf } from "../doc/fields";
import { roundFor } from "./geom";
import { commit, ed, patch, prefs, redo, requestDraw, saveNow, select, undo, view, type ToolId } from "./state";
import { fitView, setTool, zoomAt } from "./tools";
import { playMode } from "../play/mode";

export { toast, toasts, type Toast } from "./toast";
import { Store } from "../vendor/kickr/client/store";
import { shareUrl } from "../persist/share";
import { snapshot, versionsOpen } from "./versions";
import { createArray, createMirror, createSmart, explodeSmart, mirrorable, refsOf, smartOf, smartSelected, type Axis } from "../smart/smart";
import { resolve } from "../doc/resolve";
import { toast } from "./toast";

// ---- Selection ---------------------------------------------------------------------

export function selectAll(): void {
  const s = ed();
  const refs: Ref[] = [];
  for (const list of LIST_KEYS) for (const it of s.doc.lists[list]) refs.push(refOf(list, it.id));
  select(refs.filter((r) => !s.hidden.has(r) && !s.locked.has(r)));
}

export function deleteSelection(): void {
  const s = ed();
  if (!s.selection.length) return;
  commit(deleteRefs(s.doc, s.selection), []);
}

let clipboard: Clip | null = null;

export function copySelection(): void {
  const s = ed();
  if (!s.selection.length) return;
  clipboard = copyRefs(s.doc, s.selection);
  toast("Copiado");
}
export function cutSelection(): void {
  copySelection();
  deleteSelection();
}
export function paste(offset = true): void {
  if (!clipboard) return;
  const g = offset ? prefs.get().grid * 2 : 0;
  const r = pasteClip(ed().doc, clipboard, g, g, roundFor(view.cam.zoom));
  commit(r.doc, r.refs);
}
export function duplicate(): void {
  const s = ed();
  if (!s.selection.length) return;
  // A smart text is duplicated as a smart text, a bit lower.
  const sm = smartSelected(s.doc, s.selection);
  if (sm?.kind === "text") {
    const g = prefs.get().grid * 2;
    const made = createSmart(s.doc, "text", { ...sm.params, x: ((sm.params.x as number) ?? 0) + g, y: ((sm.params.y as number) ?? 0) + g });
    commit(made.doc, refsOf(made.smart.items));
    return;
  }
  const g = prefs.get().grid * 2;
  const r = pasteClip(s.doc, copyRefs(s.doc, s.selection), g, g, roundFor(view.cam.zoom));
  commit(r.doc, r.refs);
}

export function nudge(dx: number, dy: number): void {
  const s = ed();
  if (!s.selection.length) return;
  commit(translateRefs(s.doc, movableRefs(s.doc, s.selection), dx, dy, roundFor(view.cam.zoom)));
}

export function moveSelection(target: MoveTarget): void {
  const s = ed();
  let doc = s.doc;
  const byList = new Map<ListKey, number[]>();
  for (const r of s.selection) {
    const p = parseRef(r);
    if (p) byList.set(p.list, [...(byList.get(p.list) ?? []), p.id]);
  }
  for (const [list, ids] of byList) doc = moveItems(doc, list, ids, target);
  commit(doc);
}

export function toggleHidden(refs: Ref[]): void {
  const s = ed();
  const hidden = new Set(s.hidden);
  const hide = refs.some((r) => !hidden.has(r));
  for (const r of refs) hide ? hidden.add(r) : hidden.delete(r);
  patch({ hidden, selection: hide ? s.selection.filter((r) => !hidden.has(r)) : s.selection });
  requestDraw();
}
export function toggleLocked(refs: Ref[]): void {
  const s = ed();
  const locked = new Set(s.locked);
  const lock = refs.some((r) => !locked.has(r));
  for (const r of refs) lock ? locked.add(r) : locked.delete(r);
  patch({ locked, selection: lock ? s.selection.filter((r) => !locked.has(r)) : s.selection });
}

// ---- Traits -----------------------------------------------------------------------------

// Keys that place an object rather than style it; never moved into a trait.
const PLACEMENT = new Set(["x", "y", "v0", "v1", "pos", "p0", "p1", "normal", "dist", "d0", "d1", "trait", "speed"]);

export function uniqueTraitName(base: string, traits: Record<string, unknown>): string {
  if (!(base in traits)) return base;
  for (let i = 2; ; i++) if (!(`${base}${i}` in traits)) return `${base}${i}`;
}

// Moves the properties all selected objects share into a new trait.
export function extractTrait(): string | null {
  const s = ed();
  const items = s.selection.map((r) => findItem(s.doc, r)).filter((f) => f !== null);
  if (!items.length) return null;
  const first = obj(items[0].item.v);
  const common: JsonObject = {};
  for (const k of Object.keys(first)) {
    if (PLACEMENT.has(k)) continue;
    if (items.every((f) => jsonEqual(obj(f.item.v)[k], first[k]))) common[k] = first[k];
  }
  if (!Object.keys(common).length) {
    toast("Os objetos selecionados não têm propriedades em comum para extrair.", "error");
    return null;
  }
  const traits = isObject(s.doc.fields.traits) ? (s.doc.fields.traits as JsonObject) : {};
  const name = uniqueTraitName(items[0].list === "segments" ? "linha" : items[0].list === "vertexes" ? "ponto" : "estilo", traits);
  let doc = setField(s.doc, "traits", { ...traits, [name]: common });
  const byList = new Map<ListKey, number[]>();
  for (const f of items) byList.set(f.list, [...(byList.get(f.list) ?? []), f.item.id]);
  for (const [list, ids] of byList) {
    doc = updateItems(doc, list, ids, (v) => {
      const o: JsonObject = { ...obj(v) };
      for (const k of Object.keys(common)) delete o[k];
      o.trait = name;
      return o;
    });
  }
  commit(doc);
  patch({ panel: "traits" });
  toast(`Trait "${name}" criado com ${Object.keys(common).length} propriedade(s).`);
  return name;
}

export function traitUsage(): Map<string, number> {
  const s = ed();
  const out = new Map<string, number>();
  for (const name of Object.keys(traitsOf(s.doc.fields))) out.set(name, 0);
  for (const list of LIST_KEYS) {
    for (const it of s.doc.lists[list]) {
      const t = obj(it.v).trait;
      if (typeof t === "string") out.set(t, (out.get(t) ?? 0) + 1);
    }
  }
  const bp = s.doc.fields.ballPhysics;
  if (isObject(bp) && typeof bp.trait === "string") out.set(bp.trait, (out.get(bp.trait) ?? 0) + 1);
  return out;
}

export function renameTrait(from: string, to: string): void {
  const s = ed();
  const traits = isObject(s.doc.fields.traits) ? (s.doc.fields.traits as JsonObject) : {};
  if (!to || to === from || to in traits) return;
  const next: JsonObject = {};
  for (const k of Object.keys(traits)) next[k === from ? to : k] = traits[k];
  let doc = setField(s.doc, "traits", next);
  for (const list of LIST_KEYS) {
    const ids = doc.lists[list].filter((it) => obj(it.v).trait === from).map((it) => it.id);
    if (ids.length) doc = updateItems(doc, list, ids, (v) => ({ ...obj(v), trait: to }));
  }
  const bp = doc.fields.ballPhysics;
  if (isObject(bp) && bp.trait === from) doc = setField(doc, "ballPhysics", { ...bp, trait: to });
  if (s.drawTrait === from) patch({ drawTrait: to });
  commit(doc);
}

export function deleteTrait(name: string): void {
  const s = ed();
  const traits = { ...(isObject(s.doc.fields.traits) ? (s.doc.fields.traits as JsonObject) : {}) };
  delete traits[name];
  let doc = setField(s.doc, "traits", traits);
  for (const list of LIST_KEYS) {
    const ids = doc.lists[list].filter((it) => obj(it.v).trait === name).map((it) => it.id);
    if (ids.length) {
      doc = updateItems(doc, list, ids, (v) => {
        const o = { ...obj(v) };
        delete o.trait;
        return o;
      });
    }
  }
  if (s.drawTrait === name) patch({ drawTrait: null });
  commit(doc);
}

export function setTrait(name: string, value: Json): void {
  const s = ed();
  const traits = isObject(s.doc.fields.traits) ? (s.doc.fields.traits as JsonObject) : {};
  commit(setField(s.doc, "traits", { ...traits, [name]: value }));
}

// ---- Export -------------------------------------------------------------------------

// Problems that would make HaxBall refuse the map.
export function exportProblems(): string[] {
  const doc = ed().doc;
  const out: string[] = [];
  for (const b of budget(doc)) if (b.used > LIMIT) out.push(`${b.label}: ${b.used} de ${LIMIT}`);
  if (out.length) return out;
  try {
    compileStadium(toJson(doc, true));
  } catch (e) {
    out.push((e as Error).message);
  }
  return out;
}

const fileName = () => {
  const name = ed().doc.fields.name;
  return `${(typeof name === "string" && name.trim() ? name.trim() : "mapa").replace(/[\\/:*?"<>|]+/g, "_")}.hbs`;
};

export function exportHbs(clean: boolean): void {
  const problems = exportProblems();
  if (problems.length) {
    toast(`Não dá pra exportar: ${problems.join("; ")}`, "error");
    return;
  }
  const s = ed();
  const blob = new Blob([exportText(s.doc, s.source, { clean })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function copyHbs(): Promise<void> {
  const problems = exportProblems();
  if (problems.length) toast(`Atenção: ${problems.join("; ")}`, "error");
  const s = ed();
  try {
    await navigator.clipboard.writeText(exportText(s.doc, s.source));
    toast("Texto do .hbs copiado");
  } catch {
    toast("O navegador não deixou copiar.", "error");
  }
}

export async function copyShareLink(): Promise<void> {
  const s = ed();
  const url = await shareUrl(exportText(s.doc, s.source));
  try {
    await navigator.clipboard.writeText(url);
    toast(`Link copiado (${Math.round(url.length / 1024)} KB). Quem abrir recebe uma cópia do mapa.`);
  } catch {
    toast("O navegador não deixou copiar o link.", "error");
  }
}

// ---- Commands ----------------------------------------------------------------------

export interface Command {
  id: string;
  label: string;
  group: string;
  keys?: string;
  run: () => void;
}

export const TOOLS: { id: ToolId; label: string; key: string }[] = [
  { id: "select", label: "Selecionar", key: "V" },
  { id: "hand", label: "Mover a vista", key: "H" },
  { id: "segment", label: "Segmento", key: "S" },
  { id: "vertex", label: "Vértice", key: "X" },
  { id: "disc", label: "Disco", key: "D" },
  { id: "goal", label: "Gol", key: "G" },
  { id: "plane", label: "Plano", key: "P" },
  { id: "joint", label: "Joint", key: "J" },
  { id: "redSpawn", label: "Spawn red", key: "R" },
  { id: "blueSpawn", label: "Spawn blue", key: "B" },
  { id: "text", label: "Letreiro", key: "T" },
];

// ---- Smart objects -----------------------------------------------------------------------

export const optimizerOpen = new Store<boolean>(false);

export function insertText(): void {
  const made = createSmart(ed().doc, "text", { text: "TEXTO", x: Math.round(view.cam.x), y: Math.round(view.cam.y) });
  commit(made.doc, refsOf(made.smart.items));
}

// Adds the field generator (or selects the one already there).
export function insertField(template = "classic"): void {
  const s = ed();
  const existing = s.doc.smart.find((x) => x.kind === "field");
  if (existing) {
    select(refsOf(existing.items));
    return;
  }
  const made = createSmart(s.doc, "field", { template });
  commit(made.doc, refsOf(made.smart.items));
  fitView();
  toast("Campo gerado. Ajuste os parâmetros no painel à direita.");
}

export function mirrorSelection(axis: Axis): void {
  const s = ed();
  const refs = mirrorable(s.doc, s.selection);
  if (!refs.length) return toast("Selecione o que espelhar (cópias espelhadas não entram).", "error");
  const made = createMirror(s.doc, refs, axis);
  if (!made) return;
  commit(made.doc, refs);
  toast(axis === "xy" ? "3 cópias criadas: elas acompanham o original." : "Cópia espelhada criada: ela acompanha o original.");
}

// Repeats the selection: a row of copies to the right, or copies around the origin.
export function arraySelection(mode: "linear" | "polar"): void {
  const s = ed();
  const refs = mirrorable(s.doc, s.selection);
  if (!refs.length) return toast("Selecione o que repetir.", "error");
  const geo = resolve(s.doc);
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const r of refs) {
    const f = findItem(s.doc, r);
    if (f?.list === "vertexes") {
      const v = geo.vertexes[f.index];
      if (v) [x0, x1] = [Math.min(x0, v.x), Math.max(x1, v.x)];
    } else if (f?.list === "segments") {
      const g = geo.segments[f.index];
      if (g) [x0, x1] = [Math.min(x0, g.x0, g.x1), Math.max(x1, g.x0, g.x1)];
    }
  }
  const width = Number.isFinite(x0) ? x1 - x0 : 40;
  const params: JsonObject = mode === "polar" ? { mode, count: 3, step: 90, cx: 0, cy: 0 } : { mode, count: 3, dx: Math.round(width + 20), dy: 0 };
  const made = createArray(s.doc, refs, params);
  if (!made) return;
  commit(made.doc, refsOf(made.smart.items));
  toast("Cópias criadas: elas acompanham o original. Ajuste quantidade e distância no painel.");
}

export function insertPattern(type: "stripes" | "grid" | "dots"): void {
  const s = ed();
  const bg = (s.doc.fields.bg ?? {}) as { width?: number; height?: number };
  const w = bg.width || (s.doc.fields.width as number) || 370;
  const h = bg.height || (s.doc.fields.height as number) || 170;
  const params: JsonObject = type === "dots" ? { type, radius: Math.round(Math.min(w, h) * 0.6), color: "FFFFFF" } : { type, width: w, height: h, ...(type === "grid" && { color: "8FB36F" }) };
  const made = createSmart(s.doc, "pattern", params);
  let doc = made.doc;
  // Painted surfaces go under everything else.
  if (type !== "dots") {
    doc = moveItems(doc, "segments", made.smart.items.segments ?? [], "back");
    doc = moveItems(doc, "vertexes", made.smart.items.vertexes ?? [], "back");
  }
  commit(doc, refsOf(made.smart.items));
}

export function explodeSelection(): void {
  const s = ed();
  const sm = smartSelected(s.doc, s.selection) ?? (s.selection[0] ? smartOf(s.doc, s.selection[0]) : null);
  if (!sm) return toast("Selecione um objeto inteligente.", "error");
  commit(explodeSmart(s.doc, sm.id));
  toast("Desvinculado: os itens agora são primitivas comuns.");
}

const togglePref = (k: "showGrid" | "snapGrid" | "snapPoints" | "showInvisible" | "showVertices") => () => prefs.update({ [k]: !prefs.get()[k] });

export function commands(goHome: () => void): Command[] {
  return [
    ...TOOLS.map((t) => ({ id: `tool.${t.id}`, label: `Ferramenta: ${t.label}`, group: "Ferramentas", keys: t.key, run: () => setTool(t.id) })),
    { id: "undo", label: "Desfazer", group: "Editar", keys: "Ctrl+Z", run: undo },
    { id: "redo", label: "Refazer", group: "Editar", keys: "Ctrl+Shift+Z", run: redo },
    { id: "delete", label: "Apagar seleção", group: "Editar", keys: "Del", run: deleteSelection },
    { id: "duplicate", label: "Duplicar seleção", group: "Editar", keys: "Ctrl+D", run: duplicate },
    { id: "copy", label: "Copiar", group: "Editar", keys: "Ctrl+C", run: copySelection },
    { id: "cut", label: "Recortar", group: "Editar", keys: "Ctrl+X", run: cutSelection },
    { id: "paste", label: "Colar", group: "Editar", keys: "Ctrl+V", run: () => paste() },
    { id: "selectAll", label: "Selecionar tudo", group: "Editar", keys: "Ctrl+A", run: selectAll },
    { id: "deselect", label: "Limpar seleção", group: "Editar", keys: "Esc", run: () => select([]) },
    { id: "front", label: "Trazer para a frente", group: "Ordem", keys: "Ctrl+Shift+]", run: () => moveSelection("front") },
    { id: "forward", label: "Avançar uma posição", group: "Ordem", keys: "Ctrl+]", run: () => moveSelection("forward") },
    { id: "backward", label: "Recuar uma posição", group: "Ordem", keys: "Ctrl+[", run: () => moveSelection("backward") },
    { id: "back", label: "Mandar para trás", group: "Ordem", keys: "Ctrl+Shift+[", run: () => moveSelection("back") },
    { id: "extractTrait", label: "Extrair trait da seleção", group: "Traits", run: extractTrait },
    { id: "text", label: "Inserir letreiro", group: "Criar", keys: "T", run: insertText },
    { id: "field", label: "Gerar campo (Classic, Futsal, Real Soccer, Hockey…)", group: "Criar", run: () => insertField() },
    { id: "mirrorX", label: "Espelhar seleção (esquerda ↔ direita)", group: "Simetria", run: () => mirrorSelection("x") },
    { id: "mirrorY", label: "Espelhar seleção (cima ↕ baixo)", group: "Simetria", run: () => mirrorSelection("y") },
    { id: "mirrorXY", label: "Espelhar seleção nos 4 quadrantes", group: "Simetria", run: () => mirrorSelection("xy") },
    { id: "explode", label: "Desvincular objeto inteligente", group: "Criar", run: explodeSelection },
    { id: "image", label: "Importar SVG ou imagem…", group: "Criar", run: () => document.querySelector<HTMLInputElement>("nav.toolbar input[type=file]")?.click() },
    { id: "stripes", label: "Inserir padrão: grama listrada", group: "Criar", run: () => insertPattern("stripes") },
    { id: "grid", label: "Inserir padrão: grade", group: "Criar", run: () => insertPattern("grid") },
    { id: "dots", label: "Inserir padrão: pontos em arco", group: "Criar", run: () => insertPattern("dots") },
    { id: "arrayLinear", label: "Repetir seleção em linha", group: "Simetria", run: () => arraySelection("linear") },
    { id: "arrayPolar", label: "Repetir seleção em círculo", group: "Simetria", run: () => arraySelection("polar") },
    { id: "optimize", label: "Otimizar mapa (economizar vértices e segmentos)", group: "Ferramentas", run: () => optimizerOpen.set(true) },
    { id: "traits", label: "Abrir painel de traits", group: "Traits", run: () => patch({ panel: "traits" }) },
    { id: "fit", label: "Enquadrar o mapa", group: "Vista", keys: "Shift+1", run: fitView },
    { id: "zoom100", label: "Zoom 100%", group: "Vista", keys: "Shift+0", run: () => zoomAt(view.width / 2, view.height / 2, 1 / view.cam.zoom) },
    { id: "grid", label: "Mostrar/ocultar grid", group: "Vista", keys: "Ctrl+'", run: togglePref("showGrid") },
    { id: "snapGrid", label: "Snap no grid", group: "Vista", run: togglePref("snapGrid") },
    { id: "snapPoints", label: "Ímã em pontos e guias", group: "Vista", run: togglePref("snapPoints") },
    { id: "invisible", label: "Mostrar/ocultar objetos invisíveis", group: "Vista", run: togglePref("showInvisible") },
    { id: "vertices", label: "Mostrar/ocultar vértices", group: "Vista", run: togglePref("showVertices") },
    { id: "play", label: "Jogar no mapa", group: "Jogar", keys: "Ctrl+Enter", run: () => playMode.set("full") },
    { id: "playSplit", label: "Jogar lado a lado (recarrega a cada edição)", group: "Jogar", keys: "Ctrl+Shift+Enter", run: () => playMode.set("split") },
    { id: "export", label: "Exportar .hbs", group: "Arquivo", keys: "Ctrl+E", run: () => exportHbs(false) },
    { id: "exportClean", label: "Exportar .hbs limpo (sem metadados do editor)", group: "Arquivo", run: () => exportHbs(true) },
    { id: "copyHbs", label: "Copiar texto do .hbs", group: "Arquivo", run: () => void copyHbs() },
    { id: "share", label: "Copiar link do mapa", group: "Arquivo", run: () => void copyShareLink() },
    { id: "versions", label: "Versões (histórico e restaurar)", group: "Arquivo", run: () => versionsOpen.set(true) },
    { id: "saveVersion", label: "Salvar versão agora", group: "Arquivo", run: () => void snapshot("Versão salva").then(() => toast("Versão salva")) },
    { id: "save", label: "Salvar agora", group: "Arquivo", keys: "Ctrl+S", run: () => void saveNow().then(() => toast("Salvo")) },
    { id: "home", label: "Voltar para os projetos", group: "Arquivo", run: goHome },
  ];
}
