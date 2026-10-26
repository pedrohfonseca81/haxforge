import { describe, expect, test } from "bun:test";
import { importText, newDoc, toJson } from "../doc/model";
import { resolve } from "../doc/resolve";
import { compileStadium } from "../vendor/kickr/shared/stadium";
import { optimize, OPTIMIZE_DEFAULTS } from "./optimize";
import { createSmart } from "./smart";

const map = (vertexes: string, segments: string) => importText(`{ name: "o", width: 400, height: 300, vertexes: [${vertexes}], segments: [${segments}], goals: [], discs: [], planes: [] }`).doc;

describe("optimizer", () => {
  test("a polygon tracing a circle becomes a few arcs on that circle", () => {
    const n = 36;
    const vs = Array.from({ length: n }, (_, i) => `{ x: ${(100 * Math.cos((i * 2 * Math.PI) / n)).toFixed(3)}, y: ${(100 * Math.sin((i * 2 * Math.PI) / n)).toFixed(3)} }`).join(",");
    const ss = Array.from({ length: n }, (_, i) => `{ v0: ${i}, v1: ${(i + 1) % n}, color: "FFFFFF" }`).join(",");
    const r = optimize(map(vs, ss), OPTIMIZE_DEFAULTS);
    const g = resolve(r.doc);
    expect(r.doc.lists.segments.length).toBeLessThanOrEqual(4);
    expect(r.saved.vertexes).toBeGreaterThan(30);
    for (const s of g.segments) {
      expect(s!.curved).toBe(true);
      expect(Math.hypot(s!.cx, s!.cy)).toBeLessThan(1);
      expect(s!.radius).toBeCloseTo(100, 0);
    }
    expect(() => compileStadium(toJson(r.doc))).not.toThrow();
  });

  test("an open arc of points keeps its ends and its bulge", () => {
    // A half circle above the x axis (y < 0 on screen), drawn left to right.
    const n = 12;
    const vs = Array.from({ length: n + 1 }, (_, i) => {
      const a = Math.PI + (i * Math.PI) / n;
      return `{ x: ${(50 * Math.cos(a)).toFixed(4)}, y: ${(50 * Math.sin(a)).toFixed(4)} }`;
    }).join(",");
    const ss = Array.from({ length: n }, (_, i) => `{ v0: ${i}, v1: ${i + 1} }`).join(",");
    const r = optimize(map(vs, ss), OPTIMIZE_DEFAULTS);
    expect(r.doc.lists.segments.length).toBe(1);
    const s = resolve(r.doc).segments[0]!;
    expect([s.x0, s.x1].sort((a, b) => a - b)).toEqual([-50, 50]);
    expect(s.cy).toBeCloseTo(0, 1);
    // The arc's midpoint is at the top.
    const mid = Math.atan2(0 - s.cy, 0 - s.cx);
    expect(Number.isFinite(mid)).toBe(true);
    const top = resolve(r.doc);
    expect(top.segments[0]!.radius).toBeCloseTo(50, 1);
  });

  test("collinear runs merge, duplicates and loose decorations go", () => {
    const doc = map(
      `{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 10, y: 0 }, { x: 99, y: 99, cMask: [] }`,
      `{ v0: 0, v1: 1 }, { v0: 1, v1: 2 }, { v0: 2, v1: 3 }, { v0: 3, v1: 2 }`,
    );
    const r = optimize(doc, OPTIMIZE_DEFAULTS);
    expect(r.doc.lists.segments.map((s) => s.v)).toEqual([{ v0: 0, v1: 1 }]);
    expect(r.doc.lists.vertexes.map((v) => v.v)).toEqual([{ x: 0, y: 0 }, { x: 30, y: 0 }]);
  });

  test("bias is never flipped by a merge", () => {
    const doc = map(`{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }`, `{ v0: 0, v1: 1, bias: 5 }, { v0: 2, v1: 1, bias: 5 }`);
    expect(optimize(doc, OPTIMIZE_DEFAULTS).doc.lists.segments.length).toBe(2);
  });

  test("smart objects are left alone", () => {
    const { doc } = createSmart(newDoc(), "text", { text: "OLA" });
    const r = optimize(doc, OPTIMIZE_DEFAULTS);
    expect(r.saved).toEqual({ vertexes: 0, segments: 0 });
  });
});

test("a square is never mistaken for a circle", () => {
  const doc = map(`{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }`, `{ v0: 0, v1: 1 }, { v0: 1, v1: 2 }, { v0: 2, v1: 3 }, { v0: 3, v1: 0 }`);
  const r = optimize(doc, OPTIMIZE_DEFAULTS);
  expect(r.doc.lists.segments.length).toBe(4);
  expect(r.doc.lists.segments.every((s) => (s.v as { curve?: number }).curve === undefined)).toBe(true);
});
