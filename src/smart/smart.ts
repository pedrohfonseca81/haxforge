// Smart objects: creating, regenerating, exploding, and keeping mirror copies
// in sync with what they copy.
import { isObject, jsonEqual, type Json, type JsonObject } from "../doc/json";
import { LIST_KEYS, type Doc, type IdSets, type ListKey, type Smart, type SmartKind } from "../doc/model";
import { ballOffset, copyRefs, obj, parseRef, refOf, replaceItems, setField, type Clip, type Ref } from "../doc/ops";
import { generateField } from "./field";
import { generateText } from "./text";
import { generatePattern } from "./pattern";
import { generateShape } from "./svg";

export type Axis = "x" | "y" | "xy";

// Kinds made of copies of other items, kept in sync with them.
export const isLinked = (s: Smart | null | undefined) => s?.kind === "mirror" || s?.kind === "array";

const count = (s: IdSets | undefined) => LIST_KEYS.reduce((n, l) => n + (s?.[l]?.length ?? 0), 0);

export const refsOf = (sets: IdSets | undefined): Ref[] => LIST_KEYS.flatMap((l) => (sets?.[l] ?? []).map((id) => refOf(l, id)));

// The smart object an item belongs to (as generated content).
export function smartOf(doc: Doc, ref: Ref): Smart | null {
  const p = parseRef(ref);
  if (!p) return null;
  return doc.smart.find((s) => s.items[p.list]?.includes(p.id)) ?? null;
}

// The smart object whose items are exactly this selection, if any.
export function smartSelected(doc: Doc, sel: Ref[]): Smart | null {
  if (!sel.length) return null;
  const s = smartOf(doc, sel[0]);
  if (!s) return null;
  const refs = refsOf(s.items);
  return refs.length === sel.length && sel.every((r) => refs.includes(r)) ? s : null;
}

function newSmartId(doc: Doc): string {
  let n = doc.smart.length + 1;
  while (doc.smart.some((s) => s.id === `s${n}`)) n++;
  return `s${n}`;
}

// What a smart object generates now.
function generate(doc: Doc, s: Smart): { clip: Clip; fields?: JsonObject } {
  if (s.kind === "text") return { clip: generateText(s.params).clip() };
  if (s.kind === "field") {
    const g = generateField(s.params);
    return { clip: g.builder.clip(), fields: g.fields };
  }
  if (s.kind === "pattern") return { clip: generatePattern(s.params).clip() };
  if (s.kind === "shape") return { clip: generateShape(s.params).clip() };
  return { clip: linkedClip(doc, s) };
}

function regenerate(doc: Doc, s: Smart): Doc {
  const { clip, fields } = generate(doc, s);
  const r = replaceItems(doc, s.items, clip);
  let d = r.doc;
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      const cur = d.fields[k];
      d = setField(d, k, isObject(v) && isObject(cur) ? { ...cur, ...v } : v);
    }
  }
  return { ...d, smart: d.smart.map((x) => (x.id === s.id ? { ...s, items: r.ids } : x)) };
}

export function createSmart(doc: Doc, kind: SmartKind, params: JsonObject, source?: IdSets): { doc: Doc; smart: Smart } {
  const smart: Smart = { id: newSmartId(doc), kind, params, items: {}, ...(source && { source }) };
  const d = regenerate({ ...doc, smart: [...doc.smart, smart] }, smart);
  return { doc: d, smart: d.smart.find((s) => s.id === smart.id)! };
}

export function updateSmart(doc: Doc, id: string, params: JsonObject): Doc {
  const s = doc.smart.find((x) => x.id === id);
  if (!s) return doc;
  return regenerate(doc, { ...s, params });
}

// Keeps the items, forgets that they were generated.
export function explodeSmart(doc: Doc, id: string): Doc {
  return { ...doc, smart: doc.smart.filter((s) => s.id !== id) };
}

// Moves the anchors of smart objects that were dragged as a whole, so that
// regenerating them later keeps them where they are now.
export function shiftSmart(doc: Doc, sel: Ref[], dx: number, dy: number): Doc {
  const set = new Set(sel);
  let changed = false;
  const smart = doc.smart.map((s) => {
    if (s.kind !== "text" && s.kind !== "pattern" && s.kind !== "shape") return s;
    const refs = refsOf(s.items);
    if (!refs.length || !refs.every((r) => set.has(r))) return s;
    changed = true;
    const p = s.params;
    return { ...s, params: { ...p, x: Math.round(((p.x as number) ?? 0) + dx), y: Math.round(((p.y as number) ?? 0) + dy) } };
  });
  return changed ? { ...doc, smart } : doc;
}

export const smartCost = (s: Smart) => ({
  vertexes: s.items.vertexes?.length ?? 0,
  segments: s.items.segments?.length ?? 0,
  discs: s.items.discs?.length ?? 0,
  total: count(s.items),
});

// ---- Mirror copies --------------------------------------------------------------------

const SCALES: Record<Axis, [1 | -1, 1 | -1][]> = {
  x: [[-1, 1]],
  y: [[1, -1]],
  xy: [
    [-1, 1],
    [1, -1],
    [-1, -1],
  ],
};

const scaled = (v: Json, sx: number, sy: number): Json =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? [v[0] * sx + 0, v[1] * sy + 0] : v;

// One reflected (or, for x and y together, rotated) copy of a clip. A single
// reflection draws segments backwards, which keeps curves and bias on the
// right side; crossing x = 0 swaps red and blue.
function reflectClip(clip: Clip, sx: 1 | -1, sy: 1 | -1): Clip {
  const flip = sx * sy < 0;
  const teams = sx < 0;
  const out: Clip = {};
  const put = (list: ListKey, v: Json) => (out[list] ??= []).push(v);
  for (const v of clip.vertexes ?? []) {
    const o = obj(v);
    put("vertexes", { ...o, x: (o.x as number) * sx + 0, y: (o.y as number) * sy + 0 });
  }
  for (const v of clip.segments ?? []) {
    const o = obj(v);
    put("segments", flip ? { ...o, v0: o.v1, v1: o.v0 } : o);
  }
  for (const v of clip.discs ?? []) {
    const o = { ...obj(v) };
    for (const k of ["pos", "speed", "gravity"]) if (k in o) o[k] = scaled(o[k], sx, sy);
    put("discs", o);
  }
  for (const v of clip.joints ?? []) put("joints", v);
  for (const v of clip.goals ?? []) {
    const o = obj(v);
    const team = teams ? (o.team === "red" ? "blue" : o.team === "blue" ? "red" : o.team) : o.team;
    put("goals", { ...o, p0: scaled(o.p0, sx, sy), p1: scaled(o.p1, sx, sy), team: team ?? null });
  }
  for (const v of clip.planes ?? []) {
    const o = obj(v);
    put("planes", { ...o, normal: scaled(o.normal, sx, sy) });
  }
  for (const list of ["redSpawnPoints", "blueSpawnPoints"] as const) {
    const to = teams ? (list === "redSpawnPoints" ? "blueSpawnPoints" : "redSpawnPoints") : list;
    for (const v of clip[list] ?? []) put(to, scaled(v, sx, sy));
  }
  return out;
}

// Concatenates clips, shifting segment and joint indices.
function concat(clips: Clip[]): Clip {
  const out: Clip = {};
  for (const c of clips) {
    const vBase = out.vertexes?.length ?? 0;
    const dBase = out.discs?.length ?? 0;
    for (const list of LIST_KEYS) {
      for (const v of c[list] ?? []) {
        const o = obj(v);
        const val = list === "segments" ? { ...o, v0: (o.v0 as number) + vBase, v1: (o.v1 as number) + vBase } : list === "joints" ? { ...o, d0: (o.d0 as number) + dBase, d1: (o.d1 as number) + dBase } : v;
        (out[list] ??= []).push(val);
      }
    }
  }
  return out;
}

// Rotated (around c, by `deg`, counterclockwise on screen) and moved copy of a clip.
function moveClip(clip: Clip, dx: number, dy: number, deg: number, c: [number, number]): Clip {
  const a = (-deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
  const pt = (x: number, y: number): [number, number] => {
    const px = x - c[0];
    const py = y - c[1];
    return [r2(c[0] + px * cos - py * sin + dx), r2(c[1] + px * sin + py * cos + dy)];
  };
  const dir = (v: Json): Json => (Array.isArray(v) && typeof v[0] === "number" ? [r2((v[0] as number) * cos - (v[1] as number) * sin), r2((v[0] as number) * sin + (v[1] as number) * cos)] : v);
  const at = (v: Json): Json => (Array.isArray(v) && typeof v[0] === "number" ? pt(v[0] as number, v[1] as number) : v);
  const out: Clip = {};
  const put = (list: ListKey, v: Json) => (out[list] ??= []).push(v);
  for (const v of clip.vertexes ?? []) {
    const o = obj(v);
    const [x, y] = pt(o.x as number, o.y as number);
    put("vertexes", { ...o, x, y });
  }
  for (const v of clip.segments ?? []) put("segments", v);
  for (const v of clip.joints ?? []) put("joints", v);
  for (const v of clip.discs ?? []) {
    const o = { ...obj(v) };
    o.pos = at(o.pos ?? [0, 0]);
    for (const k of ["speed", "gravity"]) if (k in o) o[k] = dir(o[k]);
    put("discs", o);
  }
  for (const v of clip.goals ?? []) {
    const o = obj(v);
    put("goals", { ...o, p0: at(o.p0), p1: at(o.p1) });
  }
  for (const v of clip.planes ?? []) {
    const o = obj(v);
    const n = o.normal as number[];
    const len = Math.hypot(n[0], n[1]) || 1;
    const foot = pt((n[0] / len) * (o.dist as number), (n[1] / len) * (o.dist as number));
    const nn = dir([n[0] / len, n[1] / len]) as number[];
    put("planes", { ...o, normal: nn, dist: r2(nn[0] * foot[0] + nn[1] * foot[1]) });
  }
  for (const list of ["redSpawnPoints", "blueSpawnPoints"] as const) for (const v of clip[list] ?? []) put(list, at(v));
  return out;
}

function linkedClip(doc: Doc, s: Smart): Clip {
  const src = copyRefs(doc, refsOf(s.source));
  if (s.kind === "mirror") return concat(SCALES[(s.params.axis as Axis) ?? "x"].map(([sx, sy]) => reflectClip(src, sx, sy)));
  const p = s.params as { mode?: string; count?: number; dx?: number; dy?: number; cx?: number; cy?: number; step?: number };
  const n = Math.max(1, Math.min(60, Math.round(p.count ?? 3)));
  const copies: Clip[] = [];
  for (let i = 1; i <= n; i++) {
    if (p.mode === "polar") copies.push(moveClip(src, 0, 0, (p.step ?? 90) * i, [p.cx ?? 0, p.cy ?? 0]));
    else copies.push(moveClip(src, (p.dx ?? 50) * i, (p.dy ?? 0) * i, 0, [0, 0]));
  }
  return concat(copies);
}

// The mirror's current items in clip form (indices relative to its own items).
function currentClip(doc: Doc, s: Smart): Clip {
  const out: Clip = {};
  const vIdx = new Map((s.items.vertexes ?? []).map((id, i) => [id, i]));
  const dIdx = new Map((s.items.discs ?? []).map((id, i) => [id, i]));
  const off = ballOffset(doc);
  for (const list of LIST_KEYS) {
    const ids = s.items[list];
    if (!ids?.length) continue;
    const byId = new Map(doc.lists[list].map((it, i) => [it.id, i]));
    out[list] = ids.map((id) => {
      const v = doc.lists[list][byId.get(id) ?? -1]?.v ?? null;
      const o = obj(v);
      if (list === "segments") return { ...o, v0: vIdx.get(doc.lists.vertexes[o.v0 as number]?.id) ?? -1, v1: vIdx.get(doc.lists.vertexes[o.v1 as number]?.id) ?? -1 };
      if (list === "joints") return { ...o, d0: dIdx.get(doc.lists.discs[(o.d0 as number) - off]?.id) ?? -1, d1: dIdx.get(doc.lists.discs[(o.d1 as number) - off]?.id) ?? -1 };
      return v;
    });
  }
  return out;
}

// Regenerates mirror and array copies whose originals changed.
export function syncMirrors(doc: Doc): Doc {
  let d = doc;
  for (const s of doc.smart) {
    if (!isLinked(s)) continue;
    const cur = d.smart.find((x) => x.id === s.id);
    if (!cur) continue;
    const want = linkedClip(d, cur);
    if (jsonEqual(want as unknown as Json, currentClip(d, cur) as unknown as Json)) continue;
    d = regenerate(d, cur);
  }
  return d;
}

// Items that can be copied by a mirror or array: anything but other copies.
export function mirrorable(doc: Doc, sel: Ref[]): Ref[] {
  return sel.filter((r) => r !== "ball" && !isLinked(smartOf(doc, r)));
}

function linked(doc: Doc, sel: Ref[], kind: "mirror" | "array", params: JsonObject): { doc: Doc; smart: Smart } | null {
  const refs = mirrorable(doc, sel);
  if (!refs.length) return null;
  const source: IdSets = {};
  for (const r of refs) {
    const p = parseRef(r)!;
    (source[p.list] ??= []).push(p.id);
  }
  return createSmart(doc, kind, params, source);
}

export const createMirror = (doc: Doc, sel: Ref[], axis: Axis) => linked(doc, sel, "mirror", { axis });

// Repeats the selection: in a row (each copy moved by dx, dy) or around a center.
export const createArray = (doc: Doc, sel: Ref[], params: JsonObject) => linked(doc, sel, "array", params);
