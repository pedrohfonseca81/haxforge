import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import JSON5 from "json5";
import { compileStadium } from "../vendor/kickr/shared/stadium";
import { exportText, importText, newDoc, newId, toJson, type Doc } from "./model";

const STADIUMS = join(import.meta.dir, "../vendor/kickr/shared/stadiums");
const corpus: [string, string][] = [
  ...readdirSync(STADIUMS).map((f): [string, string] => [f, readFileSync(join(STADIUMS, f), "utf8")]),
  ["stress.hbs", readFileSync(join(import.meta.dir, "../test-fixtures/stress.hbs"), "utf8")],
];

const withVertexX = (doc: Doc, i: number, x: number): Doc => ({
  ...doc,
  lists: { ...doc.lists, vertexes: doc.lists.vertexes.map((it, j) => (j === i ? { ...it, v: { ...(it.v as object), x } } : it)) },
});

// Lines that differ between two texts (same line count assumed).
const changedLines = (a: string, b: string) => {
  const la = a.split("\n");
  const lb = b.split("\n");
  return lb.filter((l, i) => l !== la[i]);
};

describe("round trip", () => {
  for (const [name, text] of corpus) {
    test(`${name} prints back byte for byte`, () => {
      const { doc, source } = importText(text);
      expect(exportText(doc, source)).toBe(text);
    });
    test(`${name} parses like JSON5`, () => {
      const { doc } = importText(text);
      expect(toJson(doc)).toEqual(JSON5.parse(text));
    });
  }

  test("odd JSON5 syntax survives", () => {
    const text = `// head\n{ name: 'x', /* c */ width: +0x10, height: .5e1, 'bg': {}, vertexes: [ {x:1,y:2,}, ], segments: [], goals: [], discs: [], planes: [], } // tail\n`;
    const { doc, source } = importText(text);
    expect(exportText(doc, source)).toBe(text);
    expect(doc.fields.width).toBe(16);
  });
});

describe("edits", () => {
  test("changing one vertex only touches its number (expanded file)", () => {
    const text = corpus.find(([n]) => n === "classic.hbs")![1];
    const { doc, source } = importText(text);
    const out = exportText(withVertexX(doc, 0, 379), source);
    expect(changedLines(text, out)).toEqual(['      "x": 379,']);
  });

  test("changing one vertex keeps a minified file minified", () => {
    const text = corpus.find(([n]) => n === "futsal-bazinga.hbs")![1];
    const { doc, source } = importText(text);
    const out = exportText(withVertexX(doc, 0, 551), source);
    expect(out.length).toBe(text.length);
    expect(out.replace('{"x":551', '{"x":550')).toBe(text);
  });

  test("new items copy the layout of their siblings", () => {
    const text = `{\n  "name": "t",\n  "vertexes": [\n    { "x" : 1, "y" : 2 },\n    { "x" : 3, "y" : 4 }\n  ]\n}\n`;
    const { doc, source } = importText(text);
    doc.lists.vertexes = [...doc.lists.vertexes, { id: newId(), v: { x: 5, y: 6, cMask: ["ball"] } }];
    expect(exportText(doc, source)).toBe(`{\n  "name": "t",\n  "vertexes": [\n    { "x" : 1, "y" : 2 },\n    { "x" : 3, "y" : 4 },\n    { "x" : 5, "y" : 6, "cMask" : ["ball"] }\n  ]\n}\n`);
  });

  test("new items in an expanded file are expanded", () => {
    const text = `{\n\t"name": "t",\n\t"discs": [\n\t\t{\n\t\t\t"radius": 5\n\t\t}\n\t]\n}`;
    const { doc, source } = importText(text);
    doc.lists.discs = [...doc.lists.discs, { id: newId(), v: { pos: [1, 2] } }];
    expect(exportText(doc, source)).toBe(`{\n\t"name": "t",\n\t"discs": [\n\t\t{\n\t\t\t"radius": 5\n\t\t},\n\t\t{\n\t\t\t"pos": [\n\t\t\t\t1,\n\t\t\t\t2\n\t\t\t]\n\t\t}\n\t]\n}`);
  });

  test("index comments are renumbered on reorder and delete", () => {
    const text = `{ name: "t", vertexes: [\n  /* 0 */ { x: 0, y: 0 }, // origin\n  /* 1 */ { x: 1, y: 1 },\n  /* 2 */ { x: 2, y: 2 },\n] }`;
    const { doc, source } = importText(text);
    const [a, b, c] = doc.lists.vertexes;
    doc.lists.vertexes = [c, a];
    void b;
    expect(exportText(doc, source)).toBe(`{ name: "t", vertexes: [\n  /* 0 */ { x: 2, y: 2 },\n  /* 1 */ { x: 0, y: 0 }, // origin\n] }`);
  });

  test("comments and unknown keys are kept when a field changes", () => {
    const text = `{\n  // the name\n  name: "t", custom: { a: 1 }, // keep me\n  width: 10,\n}`;
    const { doc, source } = importText(text);
    doc.fields = { ...doc.fields, width: 20 };
    expect(exportText(doc, source)).toBe(`{\n  // the name\n  name: "t", custom: { a: 1 }, // keep me\n  width: 20,\n}`);
  });

  test("removing a key drops its entry", () => {
    const text = `{ "name": "t", "a": 1, "b": 2 }`;
    const { doc, source } = importText(text);
    doc.keys = doc.keys.filter((k) => k !== "a");
    delete doc.fields.a;
    expect(exportText(doc, source)).toBe(`{ "name": "t", "b": 2 }`);
  });

  test("a list that gains its first items is added", () => {
    const text = `{ "name": "t", "discs": [] }`;
    const { doc, source } = importText(text);
    doc.lists.joints = [{ id: newId(), v: { d0: 0, d1: 1 } }];
    expect(exportText(doc, source)).toBe(`{ "name": "t", "discs": [], "joints": [{ "d0": 0, "d1": 1 }] }`);
  });
});

describe("new map", () => {
  test("prints one object per line and compiles", () => {
    const doc = newDoc("Teste");
    doc.lists.vertexes = [{ id: newId(), v: { x: 0, y: 0 } }, { id: newId(), v: { x: 10, y: 0 } }];
    doc.lists.segments = [{ id: newId(), v: { v0: 0, v1: 1 } }];
    const text = exportText(doc, null);
    expect(text).toContain(`  "vertexes": [\n    { "x": 0, "y": 0 },\n    { "x": 10, "y": 0 }\n  ],`);
    expect(() => compileStadium(JSON5.parse(text))).not.toThrow();
  });
});
