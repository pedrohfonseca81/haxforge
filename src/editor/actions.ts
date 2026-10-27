// Editor actions, shared by keyboard shortcuts, menus and the command palette.
import { exportText, LIST_KEYS, type ListKey } from "../doc/model";
import { addItems, copyRefs, deleteRefs, findItem, movableRefs, moveItems, obj, parseRef, pasteClip, refOf, setField, translateRefs, updateItems, type Clip, type MoveTarget, type Ref } from "../doc/ops";
import { budget, LIMIT } from "../doc/resolve";
import { compileStadium } from "../vendor/haxball/shared/stadium";
import { toJson } from "../doc/model";
import { isObject, jsonEqual, type Json, type JsonObject } from "../doc/json";
import { traitsOf } from "../doc/fields";
import { roundFor } from "./geom";
import { commit, ed, patch, prefs, redo, requestDraw, saveNow, select, undo, view, type ToolId } from "./state";
import { fitView, setTool, zoomAt } from "./tools";
import { playMode, playgroundTool } from "../play/mode";

export { toast, toasts, type Toast } from "./toast";
import { Store } from "../vendor/haxball/client/store";
import { shareUrl } from "../persist/share";
import { toggleLang, tr } from "../i18n";
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

const CLIPBOARD_STORAGE_KEY = "haxforge.clipboard";

export function clipCenter(clip: Clip): [number, number] | null {
  let count = 0;
  let sx = 0;
  let sy = 0;
  if (clip.vertexes) {
    for (const v of clip.vertexes) {
      const o = obj(v);
      if (typeof o.x === "number" && typeof o.y === "number") {
        sx += o.x;
        sy += o.y;
        count++;
      }
    }
  }
  if (clip.discs) {
    for (const d of clip.discs) {
      const o = obj(d);
      if (Array.isArray(o.pos) && typeof o.pos[0] === "number" && typeof o.pos[1] === "number") {
        sx += o.pos[0];
        sy += o.pos[1];
        count++;
      }
    }
  }
  if (clip.goals) {
    for (const g of clip.goals) {
      const o = obj(g);
      if (
        Array.isArray(o.p0) &&
        Array.isArray(o.p1) &&
        typeof o.p0[0] === "number" &&
        typeof o.p0[1] === "number" &&
        typeof o.p1[0] === "number" &&
        typeof o.p1[1] === "number"
      ) {
        sx += (o.p0[0] + o.p1[0]) / 2;
        sy += (o.p0[1] + o.p1[1]) / 2;
        count++;
      }
    }
  }
  return count > 0 ? [sx / count, sy / count] : null;
}

let clipboard: Clip | null = null;

export function getClipboard(): Clip | null {
  if (clipboard) return clipboard;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CLIPBOARD_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.type === "haxforge_clip" && parsed.clip) return parsed.clip as Clip;
      if (parsed && typeof parsed === "object") return parsed as Clip;
    }
  } catch {}
  return null;
}

export function hasClipboard(): boolean {
  return getClipboard() !== null;
}

// Sync clipboard across tabs via storage event
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === CLIPBOARD_STORAGE_KEY && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed?.type === "haxforge_clip" && parsed.clip) {
          clipboard = parsed.clip as Clip;
        }
      } catch {}
    }
  });
}

export function copySelection(): void {
  const s = ed();
  if (!s.selection.length) return;
  clipboard = copyRefs(s.doc, s.selection);
  try {
    const payload = JSON.stringify({ type: "haxforge_clip", version: 1, clip: clipboard, timestamp: Date.now() });
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, payload);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(payload);
    }
  } catch {}
  toast(tr("Copiado", "Copied"));
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

export function paste(offset = true, targetPos?: [number, number]): void {
  const clip = getClipboard();
  if (!clip) {
    toast(tr("Área de transferência vazia", "Clipboard is empty"), "info");
    return;
  }
  let dx = offset ? prefs.get().grid * 2 : 0;
  let dy = offset ? prefs.get().grid * 2 : 0;

  if (targetPos) {
    const center = clipCenter(clip);
    if (center) {
      dx = targetPos[0] - center[0];
      dy = targetPos[1] - center[1];
    }
  }

  const r = pasteClip(ed().doc, clip, dx, dy, roundFor(view.cam.zoom));
  commit(r.doc, r.refs);
  toast(tr("Colado", "Pasted"));
}

export function insertVertexAt(pos: [number, number]): void {
  const round = roundFor(view.cam.zoom);
  const x = round(pos[0]);
  const y = round(pos[1]);
  const r = addItems(ed().doc, "vertexes", [{ x, y }]);
  commit(r.doc, r.ids.map((id) => refOf("vertexes", id)));
  toast(tr("Vértice inserido", "Vertex inserted"));
}

export function insertDiscAt(pos: [number, number]): void {
  const round = roundFor(view.cam.zoom);
  const x = round(pos[0]);
  const y = round(pos[1]);
  const r = addItems(ed().doc, "discs", [{ pos: [x, y], radius: 10, color: "FFFFFF" }]);
  commit(r.doc, r.ids.map((id) => refOf("discs", id)));
  toast(tr("Disco inserido", "Disc inserted"));
}

export function insertTextAt(pos: [number, number]): void {
  const round = roundFor(view.cam.zoom);
  const x = round(pos[0]);
  const y = round(pos[1]);
  const made = createSmart(ed().doc, "text", { text: "HAXFORGE", x, y, size: 50 });
  commit(made.doc, refsOf(made.smart.items));
  toast(tr("Letreiro inserido", "Banner text inserted"));
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
    toast(tr("Os objetos selecionados não têm propriedades em comum para extrair.", "Selected objects have no shared properties to extract."), "error");
    return null;
  }
  const traits = isObject(s.doc.fields.traits) ? (s.doc.fields.traits as JsonObject) : {};
  const name = uniqueTraitName(items[0].list === "segments" ? tr("linha", "line") : items[0].list === "vertexes" ? tr("ponto", "point") : tr("estilo", "style"), traits);
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
  toast(tr(`Trait "${name}" criado com ${Object.keys(common).length} propriedade(s).`, `Trait "${name}" created with ${Object.keys(common).length} propert${Object.keys(common).length === 1 ? "y" : "ies"}.`));
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
  for (const b of budget(doc)) if (b.used > LIMIT) out.push(tr(`${b.label}: ${b.used} de ${LIMIT}`, `${b.label}: ${b.used} of ${LIMIT}`));
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
  return `${(typeof name === "string" && name.trim() ? name.trim() : tr("mapa", "map")).replace(/[\\/:*?"<>|]+/g, "_")}.hbs`;
};

export function exportHbs(clean: boolean): void {
  const problems = exportProblems();
  if (problems.length) {
    toast(tr(`Não dá pra exportar: ${problems.join("; ")}`, `Cannot export: ${problems.join("; ")}`), "error");
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
  if (problems.length) toast(tr(`Atenção: ${problems.join("; ")}`, `Warning: ${problems.join("; ")}`), "error");
  const s = ed();
  try {
    await navigator.clipboard.writeText(exportText(s.doc, s.source));
    toast(tr("Texto do .hbs copiado", ".hbs text copied"));
  } catch {
    toast(tr("O navegador não deixou copiar.", "Browser blocked copying."), "error");
  }
}

export async function copyShareLink(): Promise<void> {
  const s = ed();
  const url = await shareUrl(exportText(s.doc, s.source));
  try {
    await navigator.clipboard.writeText(url);
    toast(tr(`Link copiado (${Math.round(url.length / 1024)} KB). Quem abrir recebe uma cópia do mapa.`, `Link copied (${Math.round(url.length / 1024)} KB). Anyone opening it gets a copy of the map.`));
  } catch {
    toast(tr("O navegador não deixou copiar o link.", "Browser blocked copying the link."), "error");
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

const toolDef = (id: ToolId, pt: string, en: string, key: string) => ({
  id,
  key,
  get label() {
    return tr(pt, en);
  },
});

export const TOOLS: { id: ToolId; readonly label: string; key: string }[] = [
  toolDef("select", "Selecionar", "Select", "V"),
  toolDef("hand", "Mover a vista", "Pan view", "H"),
  toolDef("segment", "Segmento", "Segment", "S"),
  toolDef("vertex", "Vértice", "Vertex", "X"),
  toolDef("disc", "Disco", "Disc", "D"),
  toolDef("goal", "Gol", "Goal", "G"),
  toolDef("plane", "Plano", "Plane", "P"),
  toolDef("joint", "Joint", "Joint", "J"),
  toolDef("redSpawn", "Spawn red", "Red spawn", "R"),
  toolDef("blueSpawn", "Spawn blue", "Blue spawn", "B"),
  toolDef("text", "Letreiro", "Banner text", "T"),
];

// ---- Smart objects -----------------------------------------------------------------------

export const optimizerOpen = new Store<boolean>(false);

export function insertText(): void {
  const made = createSmart(ed().doc, "text", { text: tr("TEXTO", "TEXT"), x: Math.round(view.cam.x), y: Math.round(view.cam.y) });
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
  toast(tr("Campo gerado. Ajuste os parâmetros no painel à direita.", "Field generated. Adjust its parameters in the right panel."));
}

export function mirrorSelection(axis: Axis): void {
  const s = ed();
  const refs = mirrorable(s.doc, s.selection);
  if (!refs.length) return toast(tr("Selecione o que espelhar (cópias espelhadas não entram).", "Select what to mirror (mirror copies are excluded)."), "error");
  const made = createMirror(s.doc, refs, axis);
  if (!made) return;
  commit(made.doc, refs);
  toast(
    axis === "xy"
      ? tr("3 cópias criadas: elas acompanham o original.", "3 copies created: they follow the original.")
      : tr("Cópia espelhada criada: ela acompanha o original.", "Mirrored copy created: it follows the original."),
  );
}

// Repeats the selection: a row of copies to the right, or copies around the origin.
export function arraySelection(mode: "linear" | "polar"): void {
  const s = ed();
  const refs = mirrorable(s.doc, s.selection);
  if (!refs.length) return toast(tr("Selecione o que repetir.", "Select what to repeat."), "error");
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
  toast(tr("Cópias criadas: elas acompanham o original. Ajuste quantidade e distância no painel.", "Copies created: they follow the original. Adjust count and offset in the panel."));
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
  if (!sm) return toast(tr("Selecione um objeto inteligente.", "Select a smart object."), "error");
  commit(explodeSmart(s.doc, sm.id));
  toast(tr("Desvinculado: os itens agora são primitivas comuns.", "Unlinked: items are now regular primitives."));
}

const togglePref = (k: "showGrid" | "snapGrid" | "snapPoints" | "showInvisible" | "showVertices") => () => prefs.update({ [k]: !prefs.get()[k] });

export function commands(goHome: () => void): Command[] {
  const gTools = tr("Ferramentas", "Tools");
  const gEdit = tr("Editar", "Edit");
  const gOrder = tr("Ordem", "Order");
  const gTraits = tr("Traits", "Traits");
  const gCreate = tr("Criar", "Create");
  const gSym = tr("Simetria", "Symmetry");
  const gView = tr("Vista", "View");
  const gPlay = tr("Jogar", "Play");
  const gFile = tr("Arquivo", "File");
  return [
    ...TOOLS.map((t) => ({ id: `tool.${t.id}`, label: `${tr("Ferramenta", "Tool")}: ${t.label}`, group: gTools, keys: t.key, run: () => setTool(t.id) })),
    { id: "undo", label: tr("Desfazer", "Undo"), group: gEdit, keys: "Ctrl+Z", run: undo },
    { id: "redo", label: tr("Refazer", "Redo"), group: gEdit, keys: "Ctrl+Shift+Z", run: redo },
    { id: "delete", label: tr("Apagar seleção", "Delete selection"), group: gEdit, keys: "Del", run: deleteSelection },
    { id: "duplicate", label: tr("Duplicar seleção", "Duplicate selection"), group: gEdit, keys: "Ctrl+D", run: duplicate },
    { id: "copy", label: tr("Copiar", "Copy"), group: gEdit, keys: "Ctrl+C", run: copySelection },
    { id: "cut", label: tr("Recortar", "Cut"), group: gEdit, keys: "Ctrl+X", run: cutSelection },
    { id: "paste", label: tr("Colar", "Paste"), group: gEdit, keys: "Ctrl+V", run: () => paste() },
    { id: "selectAll", label: tr("Selecionar tudo", "Select all"), group: gEdit, keys: "Ctrl+A", run: selectAll },
    { id: "deselect", label: tr("Limpar seleção", "Clear selection"), group: gEdit, keys: "Esc", run: () => select([]) },
    { id: "front", label: tr("Trazer para a frente", "Bring to front"), group: gOrder, keys: "Ctrl+Shift+]", run: () => moveSelection("front") },
    { id: "forward", label: tr("Avançar uma posição", "Bring forward"), group: gOrder, keys: "Ctrl+]", run: () => moveSelection("forward") },
    { id: "backward", label: tr("Recuar uma posição", "Send backward"), group: gOrder, keys: "Ctrl+[", run: () => moveSelection("backward") },
    { id: "back", label: tr("Mandar para trás", "Send to back"), group: gOrder, keys: "Ctrl+Shift+[", run: () => moveSelection("back") },
    { id: "extractTrait", label: tr("Extrair trait da seleção", "Extract trait from selection"), group: gTraits, run: extractTrait },
    { id: "text", label: tr("Inserir letreiro", "Insert banner text"), group: gCreate, keys: "T", run: insertText },
    { id: "field", label: tr("Gerar campo (Classic, Futsal, Real Soccer, Hockey…)", "Generate field (Classic, Futsal, Real Soccer, Hockey…)"), group: gCreate, run: () => insertField() },
    { id: "mirrorX", label: tr("Espelhar seleção (esquerda ↔ direita)", "Mirror selection (left ↔ right)"), group: gSym, run: () => mirrorSelection("x") },
    { id: "mirrorY", label: tr("Espelhar seleção (cima ↕ baixo)", "Mirror selection (top ↕ bottom)"), group: gSym, run: () => mirrorSelection("y") },
    { id: "mirrorXY", label: tr("Espelhar seleção nos 4 quadrantes", "Mirror selection across 4 quadrants"), group: gSym, run: () => mirrorSelection("xy") },
    { id: "explode", label: tr("Desvincular objeto inteligente", "Unlink smart object"), group: gCreate, run: explodeSelection },
    { id: "image", label: tr("Importar SVG ou imagem…", "Import SVG or image…"), group: gCreate, run: () => document.querySelector<HTMLInputElement>("nav.toolbar input[type=file]")?.click() },
    { id: "stripes", label: tr("Inserir padrão: grama listrada", "Insert pattern: striped grass"), group: gCreate, run: () => insertPattern("stripes") },
    { id: "grid", label: tr("Inserir padrão: grade", "Insert pattern: grid"), group: gCreate, run: () => insertPattern("grid") },
    { id: "dots", label: tr("Inserir padrão: pontos em arco", "Insert pattern: arc dots"), group: gCreate, run: () => insertPattern("dots") },
    { id: "arrayLinear", label: tr("Repetir seleção em linha", "Repeat selection in a line"), group: gSym, run: () => arraySelection("linear") },
    { id: "arrayPolar", label: tr("Repetir seleção em círculo", "Repeat selection in a circle"), group: gSym, run: () => arraySelection("polar") },
    { id: "optimize", label: tr("Otimizar mapa (economizar vértices e segmentos)", "Optimize map (save vertices and segments)"), group: gTools, run: () => optimizerOpen.set(true) },
    { id: "traits", label: tr("Abrir painel de traits", "Open traits panel"), group: gTraits, run: () => patch({ panel: "traits" }) },
    { id: "fit", label: tr("Enquadrar o mapa", "Fit map in view"), group: gView, keys: "Shift+1", run: fitView },
    { id: "zoom100", label: tr("Zoom 100%", "Zoom 100%"), group: gView, keys: "Shift+0", run: () => zoomAt(view.width / 2, view.height / 2, 1 / view.cam.zoom) },
    { id: "grid", label: tr("Mostrar/ocultar grid", "Show/hide grid"), group: gView, keys: "Ctrl+'", run: togglePref("showGrid") },
    { id: "snapGrid", label: tr("Snap no grid", "Snap to grid"), group: gView, run: togglePref("snapGrid") },
    { id: "snapPoints", label: tr("Ímã em pontos e guias", "Snap to points and guides"), group: gView, run: togglePref("snapPoints") },
    { id: "invisible", label: tr("Mostrar/ocultar objetos invisíveis", "Show/hide invisible objects"), group: gView, run: togglePref("showInvisible") },
    { id: "vertices", label: tr("Mostrar/ocultar vértices", "Show/hide vertices"), group: gView, run: togglePref("showVertices") },
    { id: "lang", label: tr("Mudar idioma para Inglês (EN)", "Switch language to Portuguese (PT-BR)"), group: gView, run: toggleLang },
    { id: "play", label: tr("Jogar no mapa", "Play on map"), group: gPlay, keys: "Ctrl+Enter", run: () => playMode.set("full") },
    { id: "playSplit", label: tr("Jogar lado a lado (recarrega a cada edição)", "Play side-by-side (reloads on every edit)"), group: gPlay, keys: "Ctrl+Shift+Enter", run: () => playMode.set("split") },
    { id: "wallStresser", label: tr("Stresser de Parede (verificar se a bola vara)", "Wall Stresser (test if ball tunnels walls)"), group: gPlay, run: () => { playgroundTool.set("stresser"); playMode.set(playMode.get() ?? "split"); } },
    { id: "export", label: tr("Exportar .hbs", "Export .hbs"), group: gFile, keys: "Ctrl+E", run: () => exportHbs(false) },
    { id: "exportClean", label: tr("Exportar .hbs limpo (sem metadados do editor)", "Export clean .hbs (without editor metadata)"), group: gFile, run: () => exportHbs(true) },
    { id: "copyHbs", label: tr("Copiar texto do .hbs", "Copy .hbs text"), group: gFile, run: () => void copyHbs() },
    { id: "share", label: tr("Copiar link do mapa", "Copy map share link"), group: gFile, run: () => void copyShareLink() },
    { id: "versions", label: tr("Versões (histórico e restaurar)", "Versions (history and restore)"), group: gFile, run: () => versionsOpen.set(true) },
    { id: "saveVersion", label: tr("Salvar versão agora", "Save version now"), group: gFile, run: () => void snapshot(tr("Versão salva", "Saved version")).then(() => toast(tr("Versão salva", "Version saved"))) },
    { id: "save", label: tr("Salvar agora", "Save now"), group: gFile, keys: "Ctrl+S", run: () => void saveNow().then(() => toast(tr("Salvo", "Saved"))) },
    { id: "home", label: tr("Voltar para os projetos", "Back to projects"), group: gFile, run: goHome },
  ];
}
