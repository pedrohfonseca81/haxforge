// Decorative patterns. HaxBall cannot fill areas, so "painted" surfaces are
// lines 3 units wide laid side by side: the density is the cost dial.
import type { JsonObject } from "../doc/json";
import { Builder } from "./builder";

export interface PatternParams {
  type: "stripes" | "grid" | "dots";
  x: number;
  y: number;
  // Stripes and grid: the rectangle's half sizes.
  width: number;
  height: number;
  // Stripes: how many bands (every other one is painted), their direction and
  // the gap between the lines that paint a band (3 = solid).
  bands: number;
  direction: "vertical" | "horizontal";
  spacing: number;
  // Grid: cell size.
  cell: number;
  // Dots: along an arc around (x, y).
  radius: number;
  from: number;
  to: number;
  count: number;
  dot: number;
  color: string;
}

export const PATTERN_DEFAULTS: PatternParams = {
  type: "stripes",
  x: 0,
  y: 0,
  width: 370,
  height: 170,
  bands: 10,
  direction: "vertical",
  spacing: 6,
  cell: 40,
  radius: 120,
  from: 0,
  to: 360,
  count: 24,
  dot: 3,
  color: "6E9A55",
};

export const patternParams = (p: JsonObject): PatternParams => ({ ...PATTERN_DEFAULTS, ...(p as Partial<PatternParams>) });

export function generatePattern(params: JsonObject): Builder {
  const p = patternParams(params);
  const b = new Builder();
  const seg = { color: p.color, cMask: [] };
  const vert = { cMask: [] };
  const x0 = p.x - p.width;
  const x1 = p.x + p.width;
  const y0 = p.y - p.height;
  const y1 = p.y + p.height;

  if (p.type === "stripes") {
    const vertical = p.direction === "vertical";
    const [a0, a1] = vertical ? [x0, x1] : [y0, y1];
    const band = (a1 - a0) / Math.max(1, Math.round(p.bands));
    const step = Math.max(1, p.spacing);
    for (let i = 0; i < Math.round(p.bands); i += 2) {
      const start = a0 + i * band;
      // Lines are 3 wide: keep them inside the band.
      for (let a = start + 1.5; a <= start + band - 1.5 + 1e-9; a += step) {
        if (vertical) b.segment([a, y0], [a, y1], 0, seg, vert);
        else b.segment([x0, a], [x1, a], 0, seg, vert);
      }
    }
  } else if (p.type === "grid") {
    const cell = Math.max(5, p.cell);
    for (let x = x0; x <= x1 + 1e-9; x += cell) b.segment([x, y0], [x, y1], 0, seg, vert);
    for (let y = y0; y <= y1 + 1e-9; y += cell) b.segment([x0, y], [x1, y], 0, seg, vert);
  } else {
    const n = Math.max(1, Math.round(p.count));
    const full = Math.abs(p.to - p.from) >= 360;
    const span = p.to - p.from;
    const r = Math.max(0.5, p.dot);
    for (let i = 0; i < n; i++) {
      const t = full ? i / n : n === 1 ? 0.5 : i / (n - 1);
      // Angles as on paper: 0° to the right, 90° up.
      const a = ((p.from + span * t) * Math.PI) / 180;
      const cx = p.x + Math.cos(a) * p.radius;
      const cy = p.y - Math.sin(a) * p.radius;
      // A dot is a tiny circle: two half-circle arcs.
      b.segment([cx, cy - r], [cx, cy + r], 180, seg, vert);
      b.segment([cx, cy + r], [cx, cy - r], 180, seg, vert);
    }
  }
  return b;
}
