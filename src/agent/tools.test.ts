import { beforeEach, describe, expect, test } from "bun:test";
import { newDoc } from "../doc/model";
import { editor, openDoc } from "../editor/state";
import { setLang } from "../i18n";
import { TOOLS } from "./tools";

// A browser exposing the current WebMCP draft.
const registered = new Map<string, { execute: (input: object) => Promise<unknown>; annotations: { readOnlyHint: boolean }; inputSchema: object }>();
let lastSignal: AbortSignal | undefined;
(globalThis as unknown as { document: object }).document = {
  modelContext: {
    registerTool(tool: { name: string; execute: (input: object) => Promise<unknown>; annotations: { readOnlyHint: boolean }; inputSchema: object }, opts?: { signal?: AbortSignal }) {
      registered.set(tool.name, tool);
      lastSignal = opts?.signal;
      opts?.signal?.addEventListener("abort", () => registered.delete(tool.name));
      return Promise.resolve();
    },
  },
};

const { enableAgents, agentLog, agentStatus } = await import("./webmcp");
// Like an agent: by name, through what the page registered.
const call = (name: string, input: object = {}) => registered.get(name)!.execute(input) as Promise<Record<string, unknown> & { error?: string }>;

beforeEach(() => {
  setLang("pt");
  enableAgents(true);
  openDoc("test", newDoc("Teste"), null);
});

describe("WebMCP", () => {
  test("every tool is registered with a schema, read-only ones are marked, and switching off unregisters", () => {
    expect(agentStatus.get()).toEqual({ supported: true, enabled: true, api: "document" });
    expect(registered.size).toBe(TOOLS.length);
    expect(registered.get("get_map")!.annotations.readOnlyHint).toBe(true);
    expect(registered.get("draw_path")!.annotations.readOnlyHint).toBe(false);
    for (const t of registered.values()) expect((t.inputSchema as { type: string }).type).toBe("object");
    enableAgents(false);
    expect(lastSignal?.aborted).toBe(true);
    expect(registered.size).toBe(0);
  });

  test("an agent builds a futsal map, writes on it and checks it", async () => {
    const field = await call("generate_field", { template: "futsal" });
    expect(field.created).toBe(true);
    expect(field.problems).toEqual([]);

    const map = await call("get_map");
    expect(map.budget).toBeTruthy();
    expect((map.smartObjects as unknown[]).length).toBe(1);

    const text = await call("add_text", { text: "COPA", y: -200, size: 50 });
    expect((text.cost as { segments: number }).segments).toBeGreaterThan(5);

    const path = await call("draw_path", { points: [[-50, 100], [50, 100], [50, 150, 90], [-50, 150]], closed: true, properties: { color: "FF0000", cMask: [] } });
    const created = path.created as { segments: number[]; vertexes: number[] };
    expect(created.segments.length).toBe(4);

    await call("update_objects", { list: "segments", indices: [created.segments[0]], properties: { curve: 45, color: null } });
    const segs = (await call("get_objects", { list: "segments", offset: created.segments[0], limit: 1 })).items as { value: { curve?: number; color?: string } }[];
    expect(segs[0].value.curve).toBe(45);
    expect(segs[0].value.color).toBeUndefined();

    const lintOut = (await call("lint_map")) as unknown as { level: string }[];
    expect(Array.isArray(lintOut)).toBe(true);

    // Each edit is one undo step.
    const before = editor.get()!.doc;
    await call("delete_objects", { list: "segments", indices: created.segments });
    expect(editor.get()!.doc).not.toBe(before);
    await call("undo");
    expect(editor.get()!.doc).toBe(before);

    expect(agentLog.get()[0].tool).toBe("undo");
  });

  test("a shot from the center into the right goal is a goal for red", async () => {
    await call("generate_field", { template: "classic" });
    const shot = await call("simulate_shot", { x: 0, y: 0, vx: 12, vy: 0 });
    expect(shot.goal).toBe("gol para o red (bola no gol blue)");
    const miss = await call("simulate_shot", { x: 0, y: 0, vx: 0, vy: 8, frames: 120 });
    expect(miss.goal).toBe(null);
  });

  test("mistakes come back as clear errors, not exceptions", async () => {
    const bad = await call("update_objects", { list: "segments", indices: [99], properties: {} });
    expect(bad.error).toContain("segments[99] não existe");
    editor.set(null);
    const none = await call("get_map");
    expect(none.error).toContain("Nenhum mapa aberto");
    expect(agentLog.get()[0].ok).toBe(false);
  });
});
