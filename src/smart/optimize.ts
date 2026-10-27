// Saves objects without changing how the map looks or plays: shared
// vertexes, no leftovers, collinear runs merged, and polylines that trace a
// circle replaced by curved segments. Items owned by smart objects are left
// alone (they are regenerated anyway).
import { compileSegment, type Vertex } from "../vendor/haxball/shared/stadium";
import { jsonEqual, type JsonObject } from "../doc/json";
import type { Doc } from "../doc/model";
import { deleteRefs, obj, refOf, updateItems, type Ref } from "../doc/ops";
import { resolve } from "../doc/resolve";
import { segmentMid } from "../editor/geom";
import { tr } from "../i18n";
import { refsOf } from "./smart";

export interface OptimizeOptions {
  mergeVertexes: boolean;
  dropLoose: boolean;
  dropDuplicates: boolean;
  mergeCollinear: boolean;
  fitArcs: boolean;
  // How far (map units) a fitted arc may stray from the original points.
  tolerance: number;
}

export const OPTIMIZE_DEFAULTS: OptimizeOptions = { mergeVertexes: true, dropLoose: true, dropDuplicates: true, mergeCollinear: true, fitArcs: true, tolerance: 0.6 };

export interface OptimizeResult {
  doc: Doc;
  saved: { vertexes: number; segments: number };
  steps: string[];
}

const without = (o: JsonObject, ...keys: string[]) => {
  const c = { ...o };
  for (const k of keys) delete c[k];
  return c;
};

export function optimize(input: Doc, opts: OptimizeOptions): OptimizeResult {
  let doc = input;
  const steps: string[] = [];
  const owned = new Set(input.smart.flatMap((s) => refsOf(s.items)));
  const free = (list: "vertexes" | "segments", id: number) => !owned.has(refOf(list, id));
  const before = { v: doc.lists.vertexes.length, s: doc.lists.segments.length };

  if (opts.mergeVertexes) {
    // Same place, same properties: one vertex.
    const keep = new Map<string, number>();
    const target = new Map<number, number>();
    doc.lists.vertexes.forEach((it, i) => {
      if (!free("vertexes", it.id)) return;
      const o = obj(it.v);
      if (typeof o.x !== "number" || typeof o.y !== "number") return;
      const key = `${o.x.toFixed(6)},${o.y.toFixed(6)},${JSON.stringify(without(o, "x", "y"))}`;
      const k = keep.get(key);
      if (k === undefined) keep.set(key, i);
      else target.set(i, k);
    });
    if (target.size) {
      const ids = doc.lists.segments.map((s) => s.id);
      doc = updateItems(doc, "segments", ids, (v) => {
        const o = obj(v);
        const v0 = target.get(o.v0 as number) ?? o.v0;
        const v1 = target.get(o.v1 as number) ?? o.v1;
        return v0 === o.v0 && v1 === o.v1 ? v : { ...o, v0, v1 };
      });
      doc = deleteRefs(doc, [...target.keys()].map((i) => refOf("vertexes", doc.lists.vertexes[i].id)));
      steps.push(tr(`${target.size} vértice(s) repetido(s) unificado(s)`, `${target.size} duplicate vertex(es) merged`));
    }
  }

  if (opts.dropDuplicates) {
    const seen = new Set<string>();
    const dups: Ref[] = [];
    for (const it of doc.lists.segments) {
      if (!free("segments", it.id)) continue;
      const o = obj(it.v);
      const flip = (o.v0 as number) > (o.v1 as number);
      const neg = (x: unknown) => (typeof x === "number" ? -x : x);
      const key = JSON.stringify({ ...o, v0: flip ? o.v1 : o.v0, v1: flip ? o.v0 : o.v1, curve: flip ? neg(o.curve) : o.curve, bias: flip ? neg(o.bias) : o.bias });
      if (seen.has(key)) dups.push(refOf("segments", it.id));
      else seen.add(key);
    }
    if (dups.length) {
      doc = deleteRefs(doc, dups);
      steps.push(tr(`${dups.length} segmento(s) repetido(s) removido(s)`, `${dups.length} duplicate segment(s) removed`));
    }
  }

  if (opts.mergeCollinear) {
    let merged = 0;
    for (let guard = 0; guard < 10000; guard++) {
      const m = findCollinear(doc, free);
      if (!m) break;
      doc = m;
      merged++;
    }
    if (merged) steps.push(tr(`${merged} par(es) de segmentos colineares fundido(s)`, `${merged} collinear segment pair(s) merged`));
  }

  if (opts.fitArcs) {
    const r = fitArcs(doc, free, opts.tolerance);
    if (r.count) {
      doc = r.doc;
      steps.push(tr(`${r.count} trecho(s) de polilinha trocado(s) por arcos`, `${r.count} polyline run(s) replaced with arcs`));
    }
  }

  if (opts.dropLoose) {
    // Vertexes no segment uses and that collide with nothing.
    const used = new Set<number>();
    for (const it of doc.lists.segments) {
      const o = obj(it.v);
      used.add(o.v0 as number).add(o.v1 as number);
    }
    const geo = resolve(doc);
    const loose = doc.lists.vertexes.flatMap((it, i) => {
      const v = geo.vertexes[i];
      return free("vertexes", it.id) && !used.has(i) && v && (v.cMask === 0 || v.cGroup === 0) ? [refOf("vertexes", it.id)] : [];
    });
    if (loose.length) {
      doc = deleteRefs(doc, loose);
      steps.push(tr(`${loose.length} vértice(s) solto(s) sem colisão removido(s)`, `${loose.length} non-colliding loose vertex(es) removed`));
    }
  }

  return { doc, saved: { vertexes: before.v - doc.lists.vertexes.length, segments: before.s - doc.lists.segments.length }, steps };
}

// ---- Collinear merge ----------------------------------------------------------------------

// Segments touching each vertex.
function incidence(doc: Doc): Map<number, number[]> {
  const out = new Map<number, number[]>();
  doc.lists.segments.forEach((it, i) => {
    const o = obj(it.v);
    for (const k of ["v0", "v1"]) {
      const v = o[k] as number;
      if (!out.has(v)) out.set(v, []);
      out.get(v)!.push(i);
    }
  });
  return out;
}

const plain = (o: JsonObject) => o.curve == null && o.curveF == null;

// One merge of a — v — b into a — b, or null when there is none.
function findCollinear(doc: Doc, free: (list: "vertexes" | "segments", id: number) => boolean): Doc | null {
  const inc = incidence(doc);
  const geo = resolve(doc);
  for (const [v, segs] of inc) {
    if (segs.length !== 2) continue;
    const [i, j] = segs;
    const A = doc.lists.segments[i];
    const B = doc.lists.segments[j];
    const vert = doc.lists.vertexes[v];
    if (!A || !B || !vert || !free("segments", A.id) || !free("segments", B.id) || !free("vertexes", vert.id)) continue;
    const a = obj(A.v);
    const b = obj(B.v);
    if (!plain(a) || !plain(b) || !jsonEqual(without(a, "v0", "v1"), without(b, "v0", "v1"))) continue;
    // Travel a -> v -> b in both segments' own directions (keeps bias sides).
    let first: JsonObject;
    let second: JsonObject;
    if (a.v1 === v && b.v0 === v) [first, second] = [a, b];
    else if (b.v1 === v && a.v0 === v) [first, second] = [b, a];
    else if (a.bias == null || a.bias === 0) {
      // Opposite directions: fine when there is no bias.
      first = a.v1 === v ? a : { ...a, v0: a.v1, v1: a.v0 };
      second = b.v0 === v ? b : { ...b, v0: b.v1, v1: b.v0 };
    } else continue;
    const p = geo.vertexes[first.v0 as number];
    const q = geo.vertexes[v];
    const r = geo.vertexes[second.v1 as number];
    if (!p || !q || !r || first.v0 === second.v1) continue;
    const cross = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const len = Math.hypot(r.x - p.x, r.y - p.y);
    if (!len || Math.abs(cross) / len > 1e-6) continue;
    if ((q.x - p.x) * (r.x - q.x) + (q.y - p.y) * (r.y - q.y) <= 0) continue;
    // a keeps the merged run; b and the middle vertex go.
    let d = updateItems(doc, "segments", [A.id], () => ({ ...first, v0: first.v0, v1: second.v1 }));
    d = deleteRefs(d, [refOf("segments", B.id)]);
    d = deleteRefs(d, [refOf("vertexes", vert.id)]);
    return d;
  }
  return null;
}

// ---- Arc fitting --------------------------------------------------------------------------------

export type P = { x: number; y: number };

function circle(a: P, b: P, c: P): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) };
}

// The .hbs curve (degrees) of an arc from a to c that passes through m, or
// null when the points do not make a usable arc.
function curveFor(a: P, m: P, c: P): number | null {
  const circ = circle(a, m, c);
  if (!circ) return null;
  const ang = (p: P) => Math.atan2(p.y - circ.cy, p.x - circ.cx);
  const TAU = Math.PI * 2;
  const mod = (x: number) => ((x % TAU) + TAU) % TAU;
  // Sweep from a to c through m, clockwise on screen (increasing angle) or not.
  const cw = mod(ang(m) - ang(a)) < mod(ang(c) - ang(a));
  const sweep = cw ? mod(ang(c) - ang(a)) : mod(ang(a) - ang(c));
  const deg = (sweep * 180) / Math.PI;
  if (deg < 10 || deg > 340) return null;
  // Try both signs, keep the one whose arc passes through m.
  const vs: Vertex[] = [
    { x: a.x, y: a.y, bCoef: 1, cMask: 0, cGroup: 0 },
    { x: c.x, y: c.y, bCoef: 1, cMask: 0, cGroup: 0 },
  ];
  // Both signs give arcs on the same chord, one on each side: keep the one on m's side.
  const midX = (a.x + c.x) / 2;
  const midY = (a.y + c.y) / 2;
  let best: number | null = null;
  for (const curve of [deg, -deg]) {
    const s = compileSegment({ v0: 0, v1: 1, curve }, vs);
    const [ax, ay] = segmentMid({ ...s, v0: 0, v1: 1 });
    if ((ax - midX) * (m.x - midX) + (ay - midY) * (m.y - midY) > 0) best = curve;
  }
  return best === null ? null : Math.round(best * 1000) / 1000;
}

// Splits a polyline into the fewest pieces: each piece is one original
// segment, or one arc over 3+ segments whose points stay within `tol` of a
// circle (dynamic programming). Returns the arcs as [from, to, curve].
export function arcPieces(Q: P[], tol: number): [number, number, number][] {
  const n = Q.length - 1;
  const fit = (i: number, j: number): number | null => {
    const m = Math.floor((i + j) / 2);
    const curve = curveFor(Q[i], Q[m], Q[j]);
    if (curve === null) return null;
    const c = circle(Q[i], Q[m], Q[j])!;
    const off = (x: number, y: number) => Math.abs(Math.hypot(x - c.cx, y - c.cy) - c.r) > tol;
    // The points and the middles of the lines between them must hug the circle
    // (a rectangle's corners are on a circle too, its sides are not).
    for (let k = i; k <= j; k++) if (off(Q[k].x, Q[k].y)) return null;
    for (let k = i; k < j; k++) if (off((Q[k].x + Q[k + 1].x) / 2, (Q[k].y + Q[k + 1].y) / 2)) return null;
    return curve;
  };
  // Fewest pieces first; among those, the most even ones (sum of squared
  // lengths), so a circle becomes two half circles rather than 335° + 25°.
  const cost = new Array<number>(n + 1).fill(Infinity);
  const even = new Array<number>(n + 1).fill(Infinity);
  const from = new Array<[number, number | null]>(n + 1);
  cost[0] = 0;
  even[0] = 0;
  for (let j = 1; j <= n; j++) {
    cost[j] = cost[j - 1] + 1;
    even[j] = even[j - 1] + 1;
    from[j] = [j - 1, null];
    for (let i = j - 3; i >= 0; i--) {
      const c = cost[i] + 1;
      const e = even[i] + (j - i) * (j - i);
      if (c > cost[j] || (c === cost[j] && e >= even[j])) continue;
      const curve = fit(i, j);
      if (curve !== null) {
        cost[j] = c;
        even[j] = e;
        from[j] = [i, curve];
      }
    }
  }
  const pieces: [number, number, number][] = [];
  for (let j = n; j > 0; j = from[j][0]) if (from[j][1] !== null) pieces.unshift([from[j][0], j, from[j][1]!]);
  return pieces;
}

function fitArcs(doc: Doc, free: (list: "vertexes" | "segments", id: number) => boolean, tol: number): { doc: Doc; count: number } {
  const geo = resolve(doc);
  const inc = incidence(doc);
  const segs = doc.lists.segments;
  const eligible = (i: number) => {
    const o = obj(segs[i].v);
    return free("segments", segs[i].id) && plain(o) && (o.bias == null || o.bias === 0);
  };
  const style = (i: number) => JSON.stringify(without(obj(segs[i].v), "v0", "v1"));
  const used = new Set<number>();
  const chains: number[][] = [];
  // Interior vertexes: exactly two eligible segments with the same style.
  const interior = (v: number) => {
    const s = inc.get(v);
    return !!s && s.length === 2 && eligible(s[0]) && eligible(s[1]) && style(s[0]) === style(s[1]) && free("vertexes", doc.lists.vertexes[v].id);
  };
  const other = (seg: number, v: number) => {
    const o = obj(segs[seg].v);
    return (o.v0 === v ? o.v1 : o.v0) as number;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i) || !eligible(i)) continue;
    // Walk back to the chain's start, then forward collecting vertexes.
    const o = obj(segs[i].v);
    let start = o.v0 as number;
    let seg = i;
    const seenBack = new Set<number>([i]);
    while (interior(start)) {
      const next = inc.get(start)!.find((s) => s !== seg)!;
      if (seenBack.has(next)) break;
      seenBack.add(next);
      seg = next;
      start = other(seg, start);
    }
    const pts = [start];
    let cur = start;
    let s2 = seg;
    const chainSegs: number[] = [];
    for (;;) {
      chainSegs.push(s2);
      used.add(s2);
      cur = other(s2, cur);
      pts.push(cur);
      if (!interior(cur)) break;
      const next = inc.get(cur)!.find((x) => x !== s2)!;
      if (used.has(next)) break;
      s2 = next;
    }
    if (chainSegs.length >= 3) chains.push(pts);
  }

  // Updates use the original indices; all deletions happen at the end.
  let d = doc;
  let count = 0;
  const drop: Ref[] = [];
  for (const pts of chains) {
    const P = pts.map((v) => geo.vertexes[v]);
    if (P.some((p) => !p)) continue;
    const Q = P as P[];
    const pieces = arcPieces(Q, tol);
    for (const [a, b, curve] of pieces) {
      // The segments between consecutive points of the piece.
      const run: number[] = [];
      for (let k = a; k < b; k++) {
        const s = (inc.get(pts[k]) ?? []).find((x) => (inc.get(pts[k + 1]) ?? []).includes(x));
        if (s !== undefined) run.push(s);
      }
      if (run.length !== b - a) continue;
      const style = without(obj(segs[run[0]].v), "v0", "v1");
      d = updateItems(d, "segments", [segs[run[0]].id], () => ({ ...style, v0: pts[a], v1: pts[b], curve }));
      drop.push(...run.slice(1).map((s) => refOf("segments", segs[s].id)));
      for (let k = a + 1; k < b; k++) drop.push(refOf("vertexes", doc.lists.vertexes[pts[k]].id));
      count++;
    }
  }
  if (drop.length) d = deleteRefs(d, drop);
  return { doc: d, count };
}
