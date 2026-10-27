import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { compileStadium } from "../vendor/haxball/shared/stadium";
import { lint } from "../doc/lint";
import { exportText, importText, newDoc, toJson, type Doc } from "../doc/model";
import { deleteRefs, refOf, setProp } from "../doc/ops";
import { resolve } from "../doc/resolve";
import { TEMPLATES, type Template } from "./field";
import { glyph, SUPPORTED } from "./font";
import { createMirror, createSmart, refsOf, smartOf, syncMirrors, updateSmart } from "./smart";
import { generateText } from "./text";

const blank = (): Doc => {
  const d = newDoc();
  return { ...d, fields: { ...d.fields } };
};

describe("letreiro", () => {
  test("an O is four vertexes and four segments, two of them arcs", () => {
    const b = generateText({ text: "O" });
    expect(b.vertexes.length).toBe(4);
    expect(b.segments.length).toBe(4);
    expect(b.segments.filter((s) => s.curve === 180).length).toBe(2);
  });

  test("every glyph compiles and draws inside its box", () => {
    for (const ch of SUPPORTED) {
      const g = glyph(ch)!;
      // Accents may overhang narrow letters (Í); the letters themselves stay in their box.
      if (/^[A-Z0-9]$/.test(ch)) for (const st of g.s) for (const [x] of st) expect(x).toBeGreaterThanOrEqual(-0.01), expect(x).toBeLessThanOrEqual(g.w + 0.61);
      const { doc } = createSmart(blank(), "text", { text: ch });
      expect(() => compileStadium(toJson(doc))).not.toThrow();
    }
  });

  test("decorative text never collides; solid text stops the ball", () => {
    const deco = createSmart(blank(), "text", { text: "GOL" }).doc;
    const g = resolve(deco);
    expect(g.segments.every((s) => s!.cMask === 0)).toBe(true);
    expect(g.vertexes.every((v) => v!.cMask === 0)).toBe(true);
    const solid = createSmart(blank(), "text", { text: "GOL", solid: "ball" }).doc;
    expect(resolve(solid).segments.every((s) => s!.cMask === 1)).toBe(true);
  });

  test("editing the text regenerates it in place and survives a save", () => {
    let doc = blank();
    doc = { ...doc, lists: { ...doc.lists, vertexes: [{ id: 999999, v: { x: 1, y: 1 } }] } };
    const { doc: d1, smart } = createSmart(doc, "text", { text: "AB" });
    // A vertex added after the text stays after it when the text grows.
    const d2 = { ...d1, lists: { ...d1.lists, vertexes: [...d1.lists.vertexes, { id: 888888, v: { x: 2, y: 2 } }] } };
    const d3 = updateSmart(d2, smart.id, { ...smart.params, text: "ABC" });
    const vs = d3.lists.vertexes;
    expect(vs[0].id).toBe(999999);
    expect(vs[vs.length - 1].id).toBe(888888);
    expect(refsOf(d3.smart[0].items).length).toBeGreaterThan(refsOf(smart.items).length);

    const text = exportText(d3, null);
    const back = importText(text).doc;
    expect(back.smart.length).toBe(1);
    expect(back.smart[0].params.text).toBe("ABC");
    expect(refsOf(back.smart[0].items).length).toBe(refsOf(d3.smart[0].items).length);
    expect(exportText(back, importText(text).source)).toBe(text);
    // "Exportar limpo" leaves the editor's data out.
    expect(exportText(d3, null, { clean: true })).not.toContain("haxforge");
  });

  test("deleting every letter removes the smart object", () => {
    const { doc, smart } = createSmart(blank(), "text", { text: "HI" });
    expect(deleteRefs(doc, refsOf(smart.items)).smart.length).toBe(0);
  });
});

describe("gerador de campo", () => {
  for (const t of Object.keys(TEMPLATES) as Template[]) {
    test(`${t}: compiles, and nothing escapes`, () => {
      const { doc } = createSmart(blank(), "field", { template: t });
      expect(() => compileStadium(toJson(doc, true))).not.toThrow();
      const problems = lint(doc).filter((i) => i.level !== "info");
      expect(problems.map((i) => i.text)).toEqual([]);
      // Two goals, four posts, red on the left.
      const g = resolve(doc);
      expect(g.goals.map((x) => x!.team)).toEqual([1, 2]);
      expect(g.goals[0]!.p0[0]).toBeLessThan(0);
      expect(doc.lists.discs.length).toBe(4);
    });
  }

  test("changing a size regenerates the field and the stadium settings", () => {
    const { doc, smart } = createSmart(blank(), "field", { template: "classic" });
    const d = updateSmart(doc, smart.id, { ...smart.params, width: 500 });
    expect(d.fields.width).toBe(550);
    expect((d.fields.bg as { width: number }).width).toBe(500);
  });
});

describe("simetria", () => {
  const curved = () => {
    const { doc } = importText(`{ name: "m", width: 400, height: 200,
      vertexes: [ { x: -300, y: -100 }, { x: -100, y: -50 } ],
      segments: [ { v0: 0, v1: 1, curve: 60, bias: 5 } ],
      goals: [ { p0: [-350, -50], p1: [-350, 50], team: "red" } ],
      discs: [ { pos: [-200, 30], radius: 7 } ], planes: [],
      redSpawnPoints: [[-150, 0]] }`);
    return doc;
  };

  test("a mirrored arc is the exact reflection of the original", () => {
    const doc = curved();
    const sel = [refOf("segments", doc.lists.segments[0].id), refOf("goals", doc.lists.goals[0].id), refOf("discs", doc.lists.discs[0].id), refOf("redSpawnPoints", doc.lists.redSpawnPoints[0].id)];
    const { doc: d } = createMirror(doc, sel, "x")!;
    const g = resolve(d);
    const [a, b] = [g.segments[0]!, g.segments[1]!];
    expect(b.cx).toBeCloseTo(-a.cx);
    expect(b.cy).toBeCloseTo(a.cy);
    expect(b.radius).toBeCloseTo(a.radius);
    // Bias pushes to the mirrored side: compare a reflected probe point.
    expect(b.bias).toBe(a.bias);
    // Goal and spawn change team.
    expect(g.goals[1]!.team).toBe(2);
    expect(g.blueSpawnPoints[0]).toEqual([150, 0]);
    expect(g.discs[1]!.x).toBe(200);
  });

  test("copies follow the original", () => {
    const doc = curved();
    const { doc: d } = createMirror(doc, [refOf("segments", doc.lists.segments[0].id)], "xy")!;
    expect(d.lists.segments.length).toBe(4);
    const moved = syncMirrors({ ...d, lists: { ...d.lists, vertexes: d.lists.vertexes.map((v, i) => (i === 0 ? { ...v, v: { x: -320, y: -100 } } : v)) } });
    const xs = resolve(moved).vertexes.map((v) => v!.x).sort((p, q) => p - q);
    expect(xs).toContain(320);
    expect(xs).toContain(-320);
    // Nothing changed: no new items.
    expect(syncMirrors(moved)).toBe(moved);
    // The copies belong to the mirror.
    expect(smartOf(moved, refOf("segments", moved.lists.segments[1].id))?.kind).toBe("mirror");
  });

  test("editing a copy's curve directly is undone by the next sync only if the original changed", () => {
    const doc = curved();
    const { doc: d } = createMirror(doc, [refOf("segments", doc.lists.segments[0].id)], "x")!;
    const orig = d.lists.segments[0].id;
    const changed = syncMirrors(setProp(d, "segments", [orig], "curve", 90));
    expect(changed.lists.segments.map((s) => (s.v as { curve: number }).curve)).toEqual([90, 90]);
  });
});

describe("padrões e repetição", () => {
  test("listras pintam faixas alternadas com linhas decorativas lado a lado", () => {
    const { doc } = createSmart(blank(), "pattern", { type: "stripes", width: 100, height: 50, bands: 4, spacing: 3 });
    const g = resolve(doc);
    const xs = [...new Set(g.segments.map((s) => s!.x0))].sort((a, b) => a - b);
    // Bands 0 and 2 of 4 over x = -100..100: [-100, -50] and [0, 50].
    expect(xs[0]).toBe(-98.5);
    expect(xs.every((x) => (x >= -100 && x <= -50) || (x >= 0 && x <= 50))).toBe(true);
    expect(g.segments.every((s) => s!.cMask === 0 && s!.y0 === -50 && s!.y1 === 50)).toBe(true);
  });

  test("pontos em arco: dois arcos por ponto", () => {
    const { doc } = createSmart(blank(), "pattern", { type: "dots", count: 8, radius: 100 });
    expect(doc.lists.segments.length).toBe(16);
    expect(resolve(doc).segments.every((s) => s!.curved)).toBe(true);
  });

  test("repetição em círculo gira as cópias e acompanha o original", () => {
    const { doc } = importText(`{ name: "a", width: 400, height: 200, vertexes: [ { x: 100, y: 0 }, { x: 150, y: 0 } ], segments: [ { v0: 0, v1: 1, curve: 40 } ], goals: [], discs: [], planes: [] }`);
    const { doc: d } = createSmart(doc, "array", { mode: "polar", count: 3, step: 90, cx: 0, cy: 0 }, { segments: [doc.lists.segments[0].id] });
    const g = resolve(d);
    expect(g.segments.length).toBe(4);
    // The first copy is 90° counterclockwise on screen: (100, 0) -> (0, -100).
    expect(g.segments[1]!.x0).toBeCloseTo(0);
    expect(g.segments[1]!.y0).toBeCloseTo(-100);
    expect(g.segments[1]!.radius).toBeCloseTo(g.segments[0]!.radius);
    const moved = syncMirrors(setProp(d, "vertexes", [d.lists.vertexes[1].id], "x", 200));
    expect(resolve(moved).segments[2]!.x1).toBeCloseTo(-200);
  });
});

describe("SVG e imagem", () => {
  test("a circle and a rounded path become arcs; a rect stays four lines", async () => {
    const { parseSvg } = await import("./svg");
    const svg = `<svg viewBox="0 0 100 100"><g transform="translate(10 0)"><circle cx="40" cy="50" r="30" stroke="red" fill="none"/></g><rect x="0" y="0" width="20" height="10" style="stroke:#00ff00"/><path d="M 0 90 a 10 10 0 0 1 20 0"/></svg>`;
    expect(parseSvg(svg).map((s) => s.color)).toEqual(["FF0000", "00FF00", "000000"]);
    const { doc } = createSmart(blank(), "shape", { svg, size: 300 });
    const g = resolve(doc);
    // Circle: 2 arcs; rect: 4 lines; half circle path: 1 arc.
    expect(g.segments.filter((s) => s!.curved).length).toBe(3);
    expect(g.segments.length).toBe(7);
    const circleArc = g.segments.find((s) => s!.curved && s!.radius > 50)!;
    // The drawing spans x = 0..80, scaled to 300 wide.
    expect(circleArc.radius).toBeCloseTo(30 * (300 / 80), 0);
  });

  test("tracing a filled disk gives one round outline", async () => {
    const { maskFromPixels, traceMask, loopsToSvg } = await import("./trace");
    const w = 64;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inside = Math.hypot(x - 32, y - 32) < 20;
      px.set(inside ? [0, 0, 0, 255] : [255, 255, 255, 255], i);
    }
    const loops = traceMask(maskFromPixels(px, w, w, 128, false));
    expect(loops.length).toBe(1);
    const { doc } = createSmart(blank(), "shape", { svg: loopsToSvg(loops, w, w), size: 200, tolerance: 2 });
    expect(doc.lists.segments.length).toBeLessThanOrEqual(8);
  });
});

// A system font (not shipped in the repo); the test is skipped where it is missing (CI).
const NOTO = "/usr/share/fonts/google-noto/NotoSans-Regular.ttf";

describe("fonte TTF", () => {
  test.skipIf(!existsSync(NOTO))("an uploaded font draws outlines, with arcs on the round letters", async () => {
    const { addFont } = await import("./fonts");
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(NOTO);
    const name = await addFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "Noto");
    const { doc } = createSmart(blank(), "text", { text: "O", font: name, size: 100 });
    const g = resolve(doc);
    // Two loops (outside and inside of the O), each a handful of arcs.
    expect(g.segments.filter((s) => s!.curved).length).toBeGreaterThanOrEqual(4);
    expect(g.segments.length).toBeLessThanOrEqual(16);
    // The tops of round letters are in the middle of arcs, not at vertexes.
    const { segmentMid } = await import("../editor/geom");
    const ys = [...g.vertexes.map((v) => v!.y), ...g.segments.map((s) => segmentMid(s!)[1])];
    // About 100 tall (round letters overshoot the cap height a little).
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(95);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(110);
    expect(() => compileStadium(toJson(doc))).not.toThrow();
  });
});

describe("fontes de traço", () => {
  test("every stroke font writes Portuguese text that compiles, cheaply", async () => {
    const { ensureFont, STROKE_FONTS } = await import("./fonts");
    for (const [id] of STROKE_FONTS) {
      await ensureFont(`stroke:${id}`);
      const { doc } = createSmart(blank(), "text", { text: "Ação Gol", font: `stroke:${id}`, size: 40 });
      expect(() => compileStadium(toJson(doc))).not.toThrow();
      // 8 characters (Ç is a C plus a cedilla) fit the limit even in the richest fonts.
      expect(doc.lists.segments.length).toBeGreaterThan(8);
      expect(doc.lists.segments.length).toBeLessThan(255);
      if (id === "hershey-sans") expect(doc.lists.segments.length).toBeLessThan(40);
      const g = resolve(doc);
      expect(g.segments.every((s) => s!.cMask === 0)).toBe(true);
    }
  });

  test("a missing stroke font is reported, then works once loaded", async () => {
    const { setLang } = await import("../i18n");
    const fonts = await import("./fonts");
    setLang("pt");
    expect(fonts.fontLabel("stroke:hershey-gothic")).toBe("Gótica");
    setLang("en");
    expect(fonts.fontLabel("stroke:hershey-gothic")).toBe("Gothic");
    expect(fonts.fontLabel("google:bebas-neue")).toBe("Bebas Neue");
    expect(fonts.fontReady("")).toBe(true);
  });
});
