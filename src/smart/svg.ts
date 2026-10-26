// SVG drawings as segments. The SVG is flattened to polylines (paths with
// lines, curves and arcs, plus rect, circle, ellipse, line, polyline,
// polygon, with group transforms and colors), then simplified
// (Douglas-Peucker) and refitted with HaxBall's curved segments, so a circle
// costs two arcs instead of dozens of lines.
import type { JsonObject } from "../doc/json";
import { Builder, type Pt } from "./builder";
import { arcPieces } from "./optimize";

type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface Stroke {
  points: Pt[];
  color: string;
}

function parseTransform(t: string | undefined): M {
  let m = ID;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let n: M = ID;
    if (fn === "matrix" && a.length === 6) n = a as M;
    else if (fn === "translate") n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180;
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      n = mul(mul([1, 0, 0, 1, cx, cy], [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (fn === "skewX") n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

const NAMED: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", orange: "FFA500", gray: "808080", grey: "808080" };

function parseColor(v: string | undefined): string | null {
  if (!v || v === "none" || v === "transparent") return null;
  const s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return m[1].split("").map((c) => c + c).join("").toUpperCase();
  m = /^#([0-9a-f]{6})/.exec(s);
  if (m) return m[1].toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  return null;
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3];
  if (out.style) for (const [, k, v] of out.style.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) out[k] = v.trim();
  return out;
}

// ---- Paths ------------------------------------------------------------------------------

const CURVE_STEPS = 24;

function arcPoints(x0: number, y0: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x1: number, y1: number): Pt[] {
  // SVG arc endpoint parameterization -> center form (SVG spec, appendix F.6).
  if (rx === 0 || ry === 0) return [[x1, y1]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const k = sign * Math.sqrt(Math.max(0, num / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (k * rx * yp) / ry;
  const cyp = (-k * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 36)));
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = t1 + (dt * i) / n;
    out.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return out;
}

export function pathToPolylines(d: string): Pt[][] {
  const out: Pt[][] = [];
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let line: Pt[] = [];
  let lastCtrl: Pt | null = null;
  let lastCmd = "";
  const num = () => Number(tokens[i++]);
  const flush = () => {
    if (line.length > 1) out.push(line);
    line = [];
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cur[0] : 0;
    const oy = rel ? cur[1] : 0;
    if (C === "Z") {
      if (line.length) line.push([...start] as Pt);
      flush();
      cur = [...start] as Pt;
      lastCmd = "Z";
      continue;
    }
    if (i >= tokens.length || /[a-zA-Z]/.test(tokens[i])) {
      i++;
      continue;
    }
    let ctrl: Pt | null = null;
    if (C === "M") {
      flush();
      cur = [ox + num(), oy + num()];
      start = cur;
      line = [cur];
      // Further pairs after a moveto are linetos.
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      cur = [ox + num(), oy + num()];
      line.push(cur);
    } else if (C === "H") {
      cur = [ox + num(), cur[1]];
      line.push(cur);
    } else if (C === "V") {
      cur = [cur[0], oy + num()];
      line.push(cur);
    } else if (C === "C" || C === "S") {
      const c1: Pt = C === "C" ? [ox + num(), oy + num()] : lastCtrl && (lastCmd === "C" || lastCmd === "S") ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
      const c2: Pt = [ox + num(), oy + num()];
      const p: Pt = [ox + num(), oy + num()];
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS;
        const u = 1 - t;
        line.push([u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p[0], u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p[1]]);
      }
      ctrl = c2;
      cur = p;
    } else if (C === "Q" || C === "T") {
      const c1: Pt = C === "Q" ? [ox + num(), oy + num()] : lastCtrl && (lastCmd === "Q" || lastCmd === "T") ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
      const p: Pt = [ox + num(), oy + num()];
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS;
        const u = 1 - t;
        line.push([u * u * cur[0] + 2 * u * t * c1[0] + t * t * p[0], u * u * cur[1] + 2 * u * t * c1[1] + t * t * p[1]]);
      }
      ctrl = c1;
      cur = p;
    } else if (C === "A") {
      const rx = num();
      const ry = num();
      const rot = (num() * Math.PI) / 180;
      const large = num() !== 0;
      const sweep = num() !== 0;
      const p: Pt = [ox + num(), oy + num()];
      line.push(...arcPoints(cur[0], cur[1], rx, ry, rot, large, sweep, p[0], p[1]));
      cur = p;
    } else {
      i++;
      continue;
    }
    if (!line.length) line = [cur];
    lastCtrl = ctrl;
    lastCmd = C;
  }
  flush();
  return out;
}

const ellipse = (cx: number, cy: number, rx: number, ry: number): Pt[] =>
  Array.from({ length: 73 }, (_, i) => [cx + rx * Math.cos((i * Math.PI) / 36), cy + ry * Math.sin((i * Math.PI) / 36)] as Pt);

// Every drawn outline in the SVG, in its own coordinates.
export function parseSvg(svg: string): Stroke[] {
  const out: Stroke[] = [];
  const stack: { m: M; stroke?: string; fill?: string }[] = [{ m: ID }];
  for (const tag of svg.matchAll(/<(\/?)([\w:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, nameRaw, rest, selfClose] = tag;
    const name = nameRaw.toLowerCase();
    if (closing) {
      if (name === "g" || name === "svg" || name === "a") stack.pop();
      continue;
    }
    if (name === "defs" || name === "clippath" || name === "mask" || name === "style") continue;
    const a = attrs(rest);
    const top = stack[stack.length - 1];
    const ctx = { m: mul(top.m, parseTransform(a.transform)), stroke: a.stroke ?? top.stroke, fill: a.fill ?? top.fill };
    if ((name === "g" || name === "svg" || name === "a") && !selfClose) {
      stack.push(ctx);
      continue;
    }
    const n = (k: string) => Number(a[k] ?? 0);
    let lines: Pt[][] = [];
    if (name === "path" && a.d) lines = pathToPolylines(a.d);
    else if (name === "rect") {
      const [x, y, w, h] = [n("x"), n("y"), n("width"), n("height")];
      lines = [
        [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
          [x, y],
        ],
      ];
    } else if (name === "circle") lines = [ellipse(n("cx"), n("cy"), n("r"), n("r"))];
    else if (name === "ellipse") lines = [ellipse(n("cx"), n("cy"), n("rx"), n("ry"))];
    else if (name === "line")
      lines = [
        [
          [n("x1"), n("y1")],
          [n("x2"), n("y2")],
        ],
      ];
    else if ((name === "polyline" || name === "polygon") && a.points) {
      const v = a.points.split(/[\s,]+/).filter(Boolean).map(Number);
      const pts: Pt[] = [];
      for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
      if (name === "polygon" && pts.length) pts.push([...pts[0]] as Pt);
      lines = [pts];
    }
    const color = parseColor(ctx.stroke) ?? parseColor(ctx.fill) ?? "000000";
    for (const l of lines) out.push({ points: l.map(([x, y]) => apply(ctx.m, x, y)), color });
  }
  return out;
}

// ---- Simplification -------------------------------------------------------------------------

export function douglasPeucker(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let farD = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > farD) [far, farD] = [i, d];
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---- The smart object ------------------------------------------------------------------------

export interface ShapeParams {
  svg: string;
  x: number;
  y: number;
  // Width of the drawing on the map.
  size: number;
  angle: number;
  // Detail: how far (map units) the result may stray from the drawing.
  tolerance: number;
  arcs: boolean;
  // Empty: the SVG's own colors.
  color: string;
  solid: "none" | "ball" | "all";
  bounce: number;
}

export const SHAPE_DEFAULTS: ShapeParams = { svg: "", x: 0, y: 0, size: 200, angle: 0, tolerance: 1, arcs: true, color: "", solid: "none", bounce: 0.5 };
export const shapeParams = (p: JsonObject): ShapeParams => ({ ...SHAPE_DEFAULTS, ...(p as Partial<ShapeParams>) });

const parsed = new Map<string, Stroke[]>();

export function generateShape(params: JsonObject): Builder {
  const p = shapeParams(params);
  const b = new Builder();
  let strokes = parsed.get(p.svg);
  if (!strokes) {
    strokes = parseSvg(p.svg);
    parsed.set(p.svg, strokes);
    if (parsed.size > 8) parsed.delete(parsed.keys().next().value!);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s.points) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  if (!Number.isFinite(x0)) return b;
  const k = p.size / Math.max(1e-9, x1 - x0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const a = (p.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const place = ([x, y]: Pt): Pt => {
    const px = (x - cx) * k;
    const py = (y - cy) * k;
    return [p.x + px * cos + py * sin, p.y - px * sin + py * cos];
  };
  const vertex: JsonObject = p.solid === "none" ? { cMask: [] } : p.solid === "ball" ? { bCoef: p.bounce, cMask: ["ball"] } : { bCoef: p.bounce };
  const tol = Math.max(0.05, p.tolerance);
  for (const s of strokes) {
    const pts = douglasPeucker(s.points.map(place), tol / 2);
    if (pts.length < 2) continue;
    const seg = { color: p.color || s.color, ...vertex };
    const pieces = p.arcs ? arcPieces(pts.map(([x, y]) => ({ x, y })), tol) : [];
    let i = 0;
    for (const [from, to, curve] of pieces) {
      for (; i < from; i++) b.segment(pts[i], pts[i + 1], 0, seg, vertex);
      b.segment(pts[from], pts[to], curve, seg, vertex);
      i = to;
    }
    for (; i < pts.length - 1; i++) b.segment(pts[i], pts[i + 1], 0, seg, vertex);
  }
  return b;
}
