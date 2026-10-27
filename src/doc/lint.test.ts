import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lint } from "./lint";
import { setLang } from "../i18n";
import { importText, toJson, type Doc } from "./model";
import { compileStadium } from "../vendor/kickr/shared/stadium";
import { stepWorld } from "../vendor/kickr/shared/physics";
import { deleteRefs, refOf } from "./ops";

const classic = readFileSync(join(import.meta.dir, "../vendor/kickr/shared/stadiums/classic.hbs"), "utf8");
const ids = (doc: Doc) => lint(doc).map((i) => i.id);

// A closed box for the ball (radius 10), with a gap of `gap` units in its top
// wall; vertexMask is the cMask of the gap's two vertexes.
function box(gap: number, vertexMask: string[] | null): Doc {
  const vm = vertexMask ? `, cMask: ${JSON.stringify(vertexMask)}` : "";
  return importText(`{
    name: "box", width: 300, height: 300,
    ballPhysics: { radius: 10 },
    redSpawnPoints: [[0, 0]], blueSpawnPoints: [[0, 0]],
    vertexes: [
      { x: -100, y: -100 }, { x: ${-gap / 2}, y: -100${vm} }, { x: ${gap / 2}, y: -100${vm} }, { x: 100, y: -100 },
      { x: 100, y: 100 }, { x: -100, y: 100 },
    ],
    segments: [ { v0: 0, v1: 1 }, { v0: 2, v1: 3 }, { v0: 3, v1: 4 }, { v0: 4, v1: 5 }, { v0: 5, v1: 0 } ],
    goals: [], discs: [], planes: [],
  }`).doc;
}

describe("lint", () => {
  test("HaxBall's classic stadium has no problems", () => {
    expect(lint(importText(classic).doc).filter((i) => i.level !== "info")).toEqual([]);
  });

  test("opening a goal's net lets the ball out", () => {
    const { doc } = importText(classic);
    // Segment 0 is the back of a goal net; planes 2 and 3 are the fences at x = ±420.
    const d = deleteRefs(doc, [refOf("segments", doc.lists.segments[0].id), ...doc.lists.planes.slice(2, 4).map((p) => refOf("planes", p.id))]);
    const esc = lint(d).find((i) => i.id === "escape:ball");
    expect(esc?.level).toBe("error");
    expect(esc?.path?.length).toBeGreaterThan(2);
  });

  test("a gap narrower than the ball holds it when its vertexes collide", () => {
    expect(ids(box(15, null))).not.toContain("escape:ball");
    expect(ids(box(25, null))).toContain("escape:ball");
  });

  test("a tiny gap leaks when its vertexes do not collide (segments stop at their ends)", () => {
    expect(ids(box(4, []))).toContain("escape:ball");
    // The physics agrees: a ball shot at the gap goes through it.
    const stadium = compileStadium(toJson(box(4, [])));
    const discs = [{ ...stadium.discs[0], vx: 0, vy: -5 }];
    for (let i = 0; i < 60; i++) stepWorld(discs, stadium);
    expect(discs[0].y).toBeLessThan(-150);
    // With colliding vertexes it bounces back.
    const closed = compileStadium(toJson(box(4, null)));
    const d2 = [{ ...closed.discs[0], vx: 0, vy: -5 }];
    for (let i = 0; i < 60; i++) stepWorld(d2, closed);
    expect(d2[0].y).toBeGreaterThan(-100);
  });

  test("a spawn inside a wall is reported", () => {
    setLang("pt");
    const d = box(0, null);
    const text = JSON.stringify(lint(d).map((i) => i.text));
    expect(text).not.toContain("começa dentro");
    const moved = importText(classic.replace('"name": "Classic",', '"name": "Classic", "redSpawnPoints": [[-415, 0]],')).doc;
    expect(lint(moved).some((i) => i.text.includes("jogador red começa dentro"))).toBe(true);
    setLang("en");
    expect(lint(moved).some((i) => i.text.includes("red player starts inside"))).toBe(true);
  });

  test("zero-length and duplicated segments have quick fixes", () => {
    const { doc } = importText(`{ name: "t", width: 100, height: 100,
      vertexes: [ { x: 0, y: 0 }, { x: 10, y: 0 } ],
      segments: [ { v0: 0, v1: 1, curve: 30 }, { v0: 1, v1: 0, curve: -30 }, { v0: 1, v1: 1 } ],
      goals: [], discs: [], planes: [] }`);
    const issues = lint(doc);
    const dup = issues.find((i) => i.id.startsWith("dup:"))!;
    const zero = issues.find((i) => i.id.startsWith("zero:"))!;
    expect(dup.fix!.apply(doc).lists.segments.length).toBe(2);
    expect(zero.fix!.apply(doc).lists.segments.length).toBe(2);
  });
});
