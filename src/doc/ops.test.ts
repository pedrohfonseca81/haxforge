import { describe, expect, test } from "bun:test";
import { importText } from "./model";
import { copyRefs, deleteRefs, moveItems, pasteClip, refOf } from "./ops";

const text = `{
  name: "t", width: 100, height: 100,
  vertexes: [ { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 } ],
  segments: [ { v0: 0, v1: 1 }, { v0: 1, v1: 2 }, { v0: 2, v1: 3 } ],
  discs: [ { pos: [0, 0] }, { pos: [10, 0] }, { pos: [20, 0] } ],
  joints: [ { d0: 1, d1: 2 }, { d0: 2, d1: 3 }, { d0: 0, d1: 3 } ],
  goals: [], planes: [],
}`;

const vals = (items: { v: unknown }[]) => items.map((i) => i.v);

describe("delete", () => {
  test("deleting a vertex drops its segments and remaps the rest", () => {
    const { doc } = importText(text);
    const d = deleteRefs(doc, [refOf("vertexes", doc.lists.vertexes[1].id)]);
    expect(vals(d.lists.vertexes)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]);
    expect(vals(d.lists.segments)).toEqual([{ v0: 1, v1: 2 }]);
  });

  test("joint indices skip the ball (ballPhysics is not disc0)", () => {
    const { doc } = importText(text);
    const d = deleteRefs(doc, [refOf("discs", doc.lists.discs[0].id)]);
    // Disc 0 was joint index 1: joints touching it go, the others shift down.
    expect(vals(d.lists.joints)).toEqual([{ d0: 1, d1: 2 }, { d0: 0, d1: 2 }]);
  });

  test("the ball of a disc0 stadium cannot be deleted", () => {
    const { doc } = importText(text.replace(`name: "t",`, `name: "t", ballPhysics: "disc0",`));
    const d = deleteRefs(doc, [refOf("discs", doc.lists.discs[0].id)]);
    expect(d.lists.discs.length).toBe(3);
  });
});

describe("move", () => {
  test("moving a vertex keeps segments on the same points", () => {
    const { doc } = importText(text);
    const d = moveItems(doc, "vertexes", [doc.lists.vertexes[0].id], "front");
    expect(vals(d.lists.vertexes)[3]).toEqual({ x: 0, y: 0 });
    expect(vals(d.lists.segments)).toEqual([{ v0: 3, v1: 0 }, { v0: 0, v1: 1 }, { v0: 1, v1: 2 }]);
  });

  test("forward and backward swap with the neighbour", () => {
    const { doc } = importText(text);
    const id = doc.lists.discs[1].id;
    const f = moveItems(doc, "discs", [id], "forward");
    expect(f.lists.discs.map((i) => i.id)).toEqual([doc.lists.discs[0].id, doc.lists.discs[2].id, id]);
    expect(vals(f.lists.joints)).toEqual([{ d0: 1, d1: 3 }, { d0: 3, d1: 2 }, { d0: 0, d1: 2 }]);
    expect(moveItems(f, "discs", [id], "backward").lists.discs).toEqual(doc.lists.discs);
  });

  test("the disc0 ball stays first", () => {
    const { doc } = importText(text.replace(`name: "t",`, `name: "t", ballPhysics: "disc0",`));
    const d = moveItems(doc, "discs", [doc.lists.discs[2].id], "back");
    expect(d.lists.discs.map((i) => i.id)).toEqual([0, 2, 1].map((i) => doc.lists.discs[i].id));
  });
});

describe("copy and paste", () => {
  test("a pasted segment brings its own vertexes", () => {
    const { doc } = importText(text);
    const clip = copyRefs(doc, [refOf("segments", doc.lists.segments[1].id)]);
    const { doc: d, refs } = pasteClip(doc, clip, 5, 5, (n) => n);
    expect(refs.length).toBe(3);
    expect(vals(d.lists.vertexes).slice(4)).toEqual([{ x: 15, y: 5 }, { x: 25, y: 5 }]);
    expect(vals(d.lists.segments)[3]).toEqual({ v0: 4, v1: 5 });
  });

  test("a pasted joint points at the pasted discs", () => {
    const { doc } = importText(text);
    const refs = [refOf("discs", doc.lists.discs[1].id), refOf("discs", doc.lists.discs[2].id), refOf("joints", doc.lists.joints[1].id)];
    const { doc: d } = pasteClip(doc, copyRefs(doc, refs), 0, 0, (n) => n);
    expect(vals(d.lists.joints)[3]).toEqual({ d0: 4, d1: 5 });
  });

  test("clip serializes to JSON and pastes back cleanly across documents", () => {
    const { doc } = importText(text);
    const clip = copyRefs(doc, [refOf("segments", doc.lists.segments[1].id)]);
    const serialized = JSON.stringify({ type: "haxforge_clip", clip });
    const parsed = JSON.parse(serialized);
    const { doc: d, refs } = pasteClip(importText(text).doc, parsed.clip, 10, 10, (n) => n);
    expect(refs.length).toBe(3);
    expect(d.lists.segments.length).toBe(4);
  });
});
