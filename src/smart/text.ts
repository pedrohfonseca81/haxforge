// The letreiro: text turned into segments with the stroke font, laid out in
// lines, optionally bent along an arc, rotated and placed.
import type { JsonObject } from "../doc/json";
import { Builder, type Pt } from "./builder";
import { CAP_HEIGHT, glyph } from "./font";
import { getFont, strokeGlyphs } from "./fonts";
import { arcPieces } from "./optimize";
import { douglasPeucker, pathToPolylines } from "./svg";

export interface TextParams {
  text: string;
  x: number;
  y: number;
  // Capital letter height, in map units.
  size: number;
  angle: number;
  // Total arc (degrees) the baseline bends through; positive arches up.
  bend: number;
  spacing: number;
  lineHeight: number;
  align: "left" | "center" | "right";
  color: string;
  // What the letters stop: nothing (decoration), the ball, or everything.
  solid: "none" | "ball" | "all";
  bounce: number;
  bold: boolean;
  // "" = Haxforge Sans (strokes); otherwise an uploaded font (outlines).
  font: string;
  // Other fonts: how far the drawing may stray from the letters (map units).
  tolerance: number;
}

export const TEXT_DEFAULTS: TextParams = {
  text: "HAXFORGE",
  x: 0,
  y: 0,
  size: 40,
  angle: 0,
  bend: 0,
  spacing: 1.6,
  lineHeight: 13,
  align: "center",
  color: "FFFFFF",
  solid: "none",
  bounce: 0.5,
  bold: false,
  font: "",
  tolerance: 0.8,
};

export function textParams(p: JsonObject): TextParams {
  return { ...TEXT_DEFAULTS, ...(p as Partial<TextParams>) };
}

export function generateText(params: JsonObject): Builder {
  const p = textParams(params);
  const b = new Builder();
  const lines = p.text.split("\n");
  const laid = lines.map((line) => {
    const gs = [...line].map((ch) => glyph(ch)).filter((g) => g !== null);
    const width = gs.reduce((w, g) => w + g.w + p.spacing, 0) - (gs.length ? p.spacing : 0);
    return { gs, width };
  });
  const maxWidth = Math.max(0, ...laid.map((l) => l.width));
  const blockHeight = (lines.length - 1) * p.lineHeight + CAP_HEIGHT;
  const k = p.size / CAP_HEIGHT;

  // Bending: the baseline becomes an arc of `bend` degrees over the widest line.
  const bendRad = (p.bend * Math.PI) / 180;
  const R = Math.abs(bendRad) > 1e-6 ? (maxWidth * k) / bendRad : Infinity;
  const cos = Math.cos((p.angle * Math.PI) / 180);
  const sin = Math.sin((p.angle * Math.PI) / 180);
  const place = (x: number, y: number): Pt => {
    let px = x * k;
    let py = y * k;
    if (Number.isFinite(R)) {
      const r = R - py;
      const a = px / R;
      [px, py] = [r * Math.sin(a), R - r * Math.cos(a)];
    }
    // Screen rotation: positive angles turn counterclockwise, like on paper.
    return [p.x + px * cos + py * sin, p.y - px * sin + py * cos];
  };

  const vertex: JsonObject = p.solid === "none" ? { cMask: [] } : p.solid === "ball" ? { bCoef: p.bounce, cMask: ["ball"] } : { bCoef: p.bounce };
  const seg: JsonObject = { color: p.color, ...vertex };
  if (p.font.startsWith("stroke:")) return strokeText(p, b, place, seg, vertex);
  if (p.font) return outlineText(p, b, place, seg, vertex);

  laid.forEach((line, i) => {
    const baseline = i * p.lineHeight - blockHeight / 2 + CAP_HEIGHT;
    let x = p.align === "center" ? -line.width / 2 : p.align === "left" ? -maxWidth / 2 : maxWidth / 2 - line.width;
    for (const g of line.gs) {
      for (const offset of p.bold ? [0, 0.45] : [0]) {
        for (const stroke of g.s) {
          for (let j = 1; j < stroke.length; j++) {
            const a = stroke[j - 1];
            const c = stroke[j];
            b.segment(place(x + a[0] + offset, baseline + a[1]), place(x + c[0] + offset, baseline + c[1]), c[2] ?? 0, seg, vertex);
          }
        }
      }
      x += g.w + p.spacing;
    }
  });
  return b;
}

// Text in an uploaded font: each glyph's outline, simplified and refitted
// with arcs. `place` maps glyph space (cap height = CAP_HEIGHT) to the map.
function outlineText(p: TextParams, b: Builder, place: (x: number, y: number) => Pt, seg: JsonObject, vertex: JsonObject): Builder {
  const font = getFont(p.font);
  const capUnits = (font.tables.os2 as { sCapHeight?: number } | undefined)?.sCapHeight || font.unitsPerEm * 0.7;
  // Work in glyph space: capitals CAP_HEIGHT tall, like the stroke font.
  const fontSize = (CAP_HEIGHT * font.unitsPerEm) / capUnits;
  const unit = fontSize / font.unitsPerEm;
  const extra = p.spacing - TEXT_DEFAULTS.spacing;
  const lines = p.text.split("\n").map((line) => {
    const glyphs = [...line].map((ch) => font.charToGlyph(ch));
    const width = glyphs.reduce((w, g) => w + (g.advanceWidth ?? 0) * unit + extra, 0) - (glyphs.length ? extra : 0);
    return { glyphs, width };
  });
  const maxWidth = Math.max(0, ...lines.map((l) => l.width));
  const blockHeight = (lines.length - 1) * p.lineHeight + CAP_HEIGHT;
  const tol = Math.max(0.05, p.tolerance);
  lines.forEach((line, i) => {
    const baseline = i * p.lineHeight - blockHeight / 2 + CAP_HEIGHT;
    let x = p.align === "center" ? -line.width / 2 : p.align === "left" ? -maxWidth / 2 : maxWidth / 2 - line.width;
    for (const g of line.glyphs) {
      const d = g.getPath(x, baseline, fontSize).toPathData(4);
      for (const poly of pathToPolylines(d)) {
        emit(b, poly.map(([gx, gy]) => place(gx, gy)), tol, seg, vertex);
      }
      x += (g.advanceWidth ?? 0) * unit + extra;
    }
  });
  return b;
}

// A polyline (map coordinates) as segments: simplified, with arcs where it
// follows a circle.
function emit(b: Builder, raw: Pt[], tol: number, seg: JsonObject, vertex: JsonObject): void {
  const pts = douglasPeucker(raw, tol / 2);
  if (pts.length < 2) return;
  let j = 0;
  for (const [from, to, curve] of arcPieces(pts.map(([x, y]) => ({ x, y })), tol)) {
    for (; j < from; j++) b.segment(pts[j], pts[j + 1], 0, seg, vertex);
    b.segment(pts[from], pts[to], curve, seg, vertex);
    j = to;
  }
  for (; j < pts.length - 1; j++) b.segment(pts[j], pts[j + 1], 0, seg, vertex);
}

// Text in a single-stroke font (Hershey/EMS): already in glyph space, laid
// out with each glyph's own advance. Fonts' advances include their side
// bearings, so the spacing parameter only adds to them beyond its default.
function strokeText(p: TextParams, b: Builder, place: (x: number, y: number) => Pt, seg: JsonObject, vertex: JsonObject): Builder {
  const glyphs = strokeGlyphs(p.font.slice(7));
  const extra = p.spacing - TEXT_DEFAULTS.spacing;
  const space = glyphs[" "]?.w ?? 3;
  // Ç is not in these fonts: a C with a cedilla.
  const get = (ch: string) => {
    if (glyphs[ch]) return glyphs[ch];
    const base = ch === "Ç" ? glyphs.C : ch === "ç" ? glyphs.c : undefined;
    if (!base) return undefined;
    const cx = base.w / 2;
    return { w: base.w, p: [...base.p, [cx, 0, cx, 0.9, cx - 0.9, 1.9]] };
  };
  const lines = p.text.split("\n").map((line) => {
    const gs = [...line].map((ch) => get(ch) ?? { w: space, p: [] });
    const width = gs.reduce((w, g) => w + g.w + extra, 0) - (gs.length ? extra : 0);
    return { gs, width };
  });
  const maxWidth = Math.max(0, ...lines.map((l) => l.width));
  const blockHeight = (lines.length - 1) * p.lineHeight + CAP_HEIGHT;
  const tol = Math.max(0.05, p.tolerance);
  lines.forEach((line, i) => {
    const baseline = i * p.lineHeight - blockHeight / 2 + CAP_HEIGHT;
    let x = p.align === "center" ? -line.width / 2 : p.align === "left" ? -maxWidth / 2 : maxWidth / 2 - line.width;
    for (const g of line.gs) {
      for (const offset of p.bold ? [0, 0.45] : [0]) {
        for (const poly of g.p) {
          const pts: Pt[] = [];
          for (let k = 0; k + 1 < poly.length; k += 2) pts.push(place(x + poly[k] + offset, baseline + poly[k + 1]));
          emit(b, pts, tol, seg, vertex);
        }
      }
      x += g.w + extra;
    }
  });
  return b;
}
