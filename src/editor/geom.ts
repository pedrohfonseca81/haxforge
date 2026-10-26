// Geometry for the canvas: hit testing, marquee selection, curve handles and
// snapping (points, alignment guides, grid, 15° angles).
import type { Doc, ListKey } from "../doc/model";
import { refOf, type Ref } from "../doc/ops";
import type { Geo, GeoSegment } from "../doc/resolve";
import type { Prefs } from "./state";

export type Vec = [number, number];

const TAU = Math.PI * 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;

export function distToLine(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Arcs run clockwise on screen from (x0, y0) to (x1, y1), like HaxBall draws them.
export const arcAngles = (s: GeoSegment) => {
  const a0 = Math.atan2(s.y0 - s.cy, s.x0 - s.cx);
  const a1 = Math.atan2(s.y1 - s.cy, s.x1 - s.cx);
  return { a0, span: mod(a1 - a0, TAU) };
};

export function distToSegment(p: Vec, s: GeoSegment): number {
  if (!s.curved) return distToLine(p, [s.x0, s.y0], [s.x1, s.y1]);
  const { a0, span } = arcAngles(s);
  const a = Math.atan2(p[1] - s.cy, p[0] - s.cx);
  if (mod(a - a0, TAU) <= span) return Math.abs(Math.hypot(p[0] - s.cx, p[1] - s.cy) - s.radius);
  return Math.min(Math.hypot(p[0] - s.x0, p[1] - s.y0), Math.hypot(p[0] - s.x1, p[1] - s.y1));
}

// The point halfway along a segment (on the arc when curved).
export function segmentMid(s: GeoSegment): Vec {
  if (!s.curved) return [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2];
  const { a0, span } = arcAngles(s);
  const a = a0 + span / 2;
  return [s.cx + Math.cos(a) * s.radius, s.cy + Math.sin(a) * s.radius];
}

// Curve angle (degrees, the .hbs "curve") of the arc from a to b passing
// through the point at p's distance from the chord. Arcs bulge to the left of
// a->b on screen for positive angles.
export function curveThrough(a: Vec, b: Vec, p: Vec): number {
  const hx = (b[0] - a[0]) / 2;
  const hy = (b[1] - a[1]) / 2;
  const h = Math.hypot(hx, hy);
  if (!h) return 0;
  const nx = -hy / h;
  const ny = hx / h;
  const s = -((p[0] - a[0] - hx) * nx + (p[1] - a[1] - hy) * ny);
  return (4 * Math.atan(s / h) * 180) / Math.PI;
}

// Plane line endpoints far outside any view.
export function planeLine(p: { nx: number; ny: number; dist: number }, reach = 1e5): [Vec, Vec] {
  const cx = p.nx * p.dist;
  const cy = p.ny * p.dist;
  return [
    [cx - p.ny * reach, cy + p.nx * reach],
    [cx + p.ny * reach, cy - p.nx * reach],
  ];
}

// ---- Hit testing ---------------------------------------------------------------

export interface HitOpts {
  // World units that count as "on" a line or point.
  tol: number;
  skip: (ref: Ref) => boolean;
}

export function hitTest(doc: Doc, geo: Geo, p: Vec, o: HitOpts): Ref | null {
  const ids = (list: ListKey) => doc.lists[list];
  const near = (q: Vec | null, r: number) => q && Math.hypot(p[0] - q[0], p[1] - q[1]) <= r;
  // Topmost first: what is drawn last wins inside each kind.
  const pick = <T>(list: ListKey, arr: (T | null)[], test: (g: T) => boolean): Ref | null => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const g = arr[i];
      const ref = refOf(list, ids(list)[i].id);
      if (g && !o.skip(ref) && test(g)) return ref;
    }
    return null;
  };
  return (
    pick("vertexes", geo.vertexes, (v) => !!near([v.x, v.y], o.tol)) ??
    pick("redSpawnPoints", geo.redSpawnPoints, (s) => !!near(s, geo.playerRadius)) ??
    pick("blueSpawnPoints", geo.blueSpawnPoints, (s) => !!near(s, geo.playerRadius)) ??
    pick("discs", geo.discs, (d) => !!near([d.x, d.y], Math.max(Math.abs(d.radius), o.tol))) ??
    (geo.ball && !o.skip("ball") && near([geo.ball.x, geo.ball.y], Math.max(geo.ball.radius, o.tol)) ? "ball" : null) ??
    pick("goals", geo.goals, (g) => distToLine(p, g.p0, g.p1) <= o.tol) ??
    pick("joints", geo.joints, (j) => distToLine(p, j.a, j.b) <= o.tol) ??
    pick("segments", geo.segments, (s) => distToSegment(p, s) <= o.tol) ??
    pick("planes", geo.planes, (pl) => Math.abs(p[0] * pl.nx + p[1] * pl.ny - pl.dist) <= o.tol)
  );
}

// Objects entirely inside the rectangle (planes are never boxed: they are infinite).
export function marquee(doc: Doc, geo: Geo, a: Vec, b: Vec, skip: (ref: Ref) => boolean): Ref[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  const out: Ref[] = [];
  const add = <T>(list: ListKey, arr: (T | null)[], test: (g: T) => boolean) =>
    arr.forEach((g, i) => {
      const ref = refOf(list, doc.lists[list][i].id);
      if (g && !skip(ref) && test(g)) out.push(ref);
    });
  add("vertexes", geo.vertexes, (v) => inside(v.x, v.y));
  add("segments", geo.segments, (s) => inside(s.x0, s.y0) && inside(s.x1, s.y1) && (!s.curved || inside(...segmentMid(s))));
  add("discs", geo.discs, (d) => inside(d.x, d.y));
  add("goals", geo.goals, (g) => inside(...g.p0) && inside(...g.p1));
  add("joints", geo.joints, (j) => inside(...j.a) && inside(...j.b));
  add("redSpawnPoints", geo.redSpawnPoints, (s) => inside(...s));
  add("blueSpawnPoints", geo.blueSpawnPoints, (s) => inside(...s));
  return out;
}

// ---- Snapping -------------------------------------------------------------------

export type SnapKind = "vertex" | "mid" | "intersection" | "disc" | "point" | "origin" | "grid" | "angle" | "free";

interface Candidate {
  x: number;
  y: number;
  kind: SnapKind;
  ref?: Ref;
}

export interface Snap {
  p: Vec;
  kind: SnapKind;
  // The vertex snapped to, so tools can reuse it.
  ref?: Ref;
  // Alignment guides: a vertical line at x, a horizontal line at y.
  gx?: number;
  gy?: number;
}

const candCache = new WeakMap<Geo, Candidate[]>();

function candidates(doc: Doc, geo: Geo): Candidate[] {
  const hit = candCache.get(geo);
  if (hit) return hit;
  const out: Candidate[] = [{ x: 0, y: 0, kind: "origin" }];
  geo.vertexes.forEach((v, i) => v && out.push({ x: v.x, y: v.y, kind: "vertex", ref: refOf("vertexes", doc.lists.vertexes[i].id) }));
  geo.discs.forEach((d, i) => d && out.push({ x: d.x, y: d.y, kind: "disc", ref: refOf("discs", doc.lists.discs[i].id) }));
  geo.goals.forEach((g, i) => {
    if (!g) return;
    const ref = refOf("goals", doc.lists.goals[i].id);
    out.push({ x: g.p0[0], y: g.p0[1], kind: "point", ref }, { x: g.p1[0], y: g.p1[1], kind: "point", ref });
  });
  for (const list of ["redSpawnPoints", "blueSpawnPoints"] as const) {
    geo[list].forEach((s, i) => s && out.push({ x: s[0], y: s[1], kind: "point", ref: refOf(list, doc.lists[list][i].id) }));
  }
  const segs = geo.segments.map((s, i) => (s ? { s, ref: refOf("segments", doc.lists.segments[i].id) } : null)).filter((x) => x !== null);
  for (const { s, ref } of segs) {
    const [x, y] = segmentMid(s);
    out.push({ x, y, kind: "mid", ref });
  }
  // Intersections between straight segments.
  const straight = segs.filter(({ s }) => !s.curved);
  for (let i = 0; i < straight.length; i++) {
    for (let j = i + 1; j < straight.length; j++) {
      const p = intersect(straight[i].s, straight[j].s);
      if (p) out.push({ x: p[0], y: p[1], kind: "intersection" });
    }
  }
  candCache.set(geo, out);
  return out;
}

function intersect(a: GeoSegment, b: GeoSegment): Vec | null {
  const d1x = a.x1 - a.x0;
  const d1y = a.y1 - a.y0;
  const d2x = b.x1 - b.x0;
  const d2y = b.y1 - b.y0;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.x0 - a.x0) * d2y - (b.y0 - a.y0) * d2x) / den;
  const u = ((b.x0 - a.x0) * d1y - (b.y0 - a.y0) * d1x) / den;
  // Strictly inside both, so shared endpoints are not repeated.
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return [a.x0 + t * d1x, a.y0 + t * d1y];
}

// Rounds free coordinates to what the zoom level lets you aim at.
export const roundFor = (zoom: number) => {
  const digits = zoom >= 8 ? 2 : zoom >= 2 ? 1 : 0;
  // "+ 0" turns -0 into 0.
  return (n: number) => Number(n.toFixed(digits)) + 0;
};

export interface SnapOpts {
  zoom: number;
  prefs: Prefs;
  // Point the new position is measured from (Shift locks the angle from it).
  anchor?: Vec;
  angleLock?: boolean;
  skip?: (ref: Ref) => boolean;
  // Alt disables snapping.
  free?: boolean;
}

export function snap(doc: Doc, geo: Geo, p: Vec, o: SnapOpts): Snap {
  const round = roundFor(o.zoom);
  if (o.free) return { p: [round(p[0]), round(p[1])], kind: "free" };
  const tol = 9 / o.zoom;
  const skip = o.skip ?? (() => false);

  if (o.angleLock && o.anchor) {
    const [ax, ay] = o.anchor;
    const dx = p[0] - ax;
    const dy = p[1] - ay;
    const step = Math.PI / 12;
    const a = Math.round(Math.atan2(dy, dx) / step) * step;
    let len = dx * Math.cos(a) + dy * Math.sin(a);
    if (o.prefs.snapGrid) len = Math.round(len / o.prefs.grid) * o.prefs.grid;
    return { p: [round(ax + Math.cos(a) * len), round(ay + Math.sin(a) * len)], kind: "angle" };
  }

  const cands = o.prefs.snapPoints ? candidates(doc, geo).filter((c) => !c.ref || !skip(c.ref)) : [];
  let best: Candidate | null = null;
  let bestD = tol;
  for (const c of cands) {
    const d = Math.hypot(c.x - p[0], c.y - p[1]);
    // Vertexes win ties so segments connect.
    if (d < bestD || (best && d === bestD && c.kind === "vertex")) {
      best = c;
      bestD = d;
    }
  }
  if (best) return { p: [best.x, best.y], kind: best.kind, ref: best.kind === "vertex" ? best.ref : undefined };

  let x = p[0];
  let y = p[1];
  let gx: number | undefined;
  let gy: number | undefined;
  const guideTol = 6 / o.zoom;
  let dxBest = guideTol;
  let dyBest = guideTol;
  for (const c of cands) {
    if (c.kind === "mid" || c.kind === "intersection") continue;
    const dx = Math.abs(c.x - p[0]);
    const dy = Math.abs(c.y - p[1]);
    if (dx < dxBest) [dxBest, gx] = [dx, c.x];
    if (dy < dyBest) [dyBest, gy] = [dy, c.y];
  }
  if (o.anchor) {
    // Align with the anchor too (horizontal and vertical lines from it).
    if (Math.abs(o.anchor[0] - p[0]) < dxBest) gx = o.anchor[0];
    if (Math.abs(o.anchor[1] - p[1]) < dyBest) gy = o.anchor[1];
  }
  const g = o.prefs.grid;
  if (gx !== undefined) x = gx;
  else x = o.prefs.snapGrid ? Math.round(x / g) * g : round(x);
  if (gy !== undefined) y = gy;
  else y = o.prefs.snapGrid ? Math.round(y / g) * g : round(y);
  return { p: [x + 0, y + 0], kind: gx !== undefined || gy !== undefined ? "point" : o.prefs.snapGrid ? "grid" : "free", gx, gy };
}
