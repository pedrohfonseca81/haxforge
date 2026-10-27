// WebMCP: registers the editor's tools (tools.ts) with the browser, so AI
// agents running in it can use them. The API is a W3C Community Group draft:
// the current text exposes document.modelContext.registerTool(tool, { signal })
// (aborting the signal unregisters); earlier drafts and Chrome's first preview
// used navigator.modelContext, with unregisterTool(name). Both are supported.
import { Store } from "../vendor/kickr/client/store";
import { toast } from "../editor/toast";
import { lang, tr } from "../i18n";
import { isToolError, TOOLS, type AgentTool } from "./tools";

interface ModelContextLike {
  registerTool(tool: object, options?: { signal?: AbortSignal }): unknown;
  unregisterTool?(name: string): unknown;
}

export interface AgentCall {
  id: number;
  tool: string;
  title: string;
  input: string;
  ok: boolean;
  result: string;
  at: number;
}

export const agentStatus = new Store<{ supported: boolean; enabled: boolean; api: "document" | "navigator" | null }>({ supported: false, enabled: false, api: null });
export const agentLog = new Store<AgentCall[]>([]);

const PREF = "haxforge.webmcp";
let controller: AbortController | null = null;
let callId = 0;

function context(): { ctx: ModelContextLike; api: "document" | "navigator" } | null {
  const d = (document as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (d?.registerTool) return { ctx: d, api: "document" };
  const n = (navigator as unknown as { modelContext?: ModelContextLike }).modelContext;
  if (n?.registerTool) return { ctx: n, api: "navigator" };
  return null;
}

const short = (v: unknown, n = 160) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

// Runs a tool, logs it, and shapes the result for the API in use.
async function execute(tool: AgentTool, input: object, api: "document" | "navigator"): Promise<unknown> {
  const id = ++callId;
  let ok = true;
  let result: unknown;
  try {
    result = await tool.run((input ?? {}) as never);
  } catch (e) {
    ok = false;
    result = { error: isToolError(e) ? e.message : tr(`Erro inesperado: ${(e as Error).message}`, `Unexpected error: ${(e as Error).message}`) };
  }
  agentLog.set([{ id, tool: tool.name, title: tool.title, input: short(input), ok, result: short(result), at: Date.now() }, ...agentLog.get()].slice(0, 100));
  if (!tool.readOnly) toast(ok ? `${tr("Agente", "Agent")}: ${tool.title}` : `${tr("Agente", "Agent")}: ${tool.title} ${tr("falhou", "failed")}`, ok ? "info" : "error");
  const text = typeof result === "string" ? result : JSON.stringify(result);
  // The current draft returns any value to the agent; the older one expected MCP content.
  return api === "document" ? result : { content: [{ type: "text", text }], ...(ok ? {} : { isError: true }) };
}

export function enableAgents(on: boolean): void {
  try {
    localStorage.setItem(PREF, on ? "1" : "0");
  } catch {}
  const found = context();
  controller?.abort();
  controller = null;
  if (found && found.api === "navigator" && found.ctx.unregisterTool) for (const t of TOOLS) void Promise.resolve().then(() => found.ctx.unregisterTool!(t.name)).catch(() => undefined);
  if (found && on) {
    controller = new AbortController();
    for (const tool of TOOLS) {
      const def = {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: !!tool.readOnly },
        execute: (input: object) => execute(tool, input, found.api),
      };
      try {
        void Promise.resolve(found.ctx.registerTool(def, { signal: controller.signal })).catch(() => undefined);
      } catch {}
    }
  }
  agentStatus.set({ supported: !!found, enabled: on && !!found, api: found?.api ?? null });
}

export function startAgents(): void {
  let on = true;
  try {
    on = localStorage.getItem(PREF) !== "0";
  } catch {}
  enableAgents(on);
  lang.subscribe(() => {
    if (agentStatus.get().enabled) enableAgents(true);
  });
}

// Lets tests and other in-page code call a tool the way an agent would.
export const runTool = (name: string, input: object = {}) => {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return execute(tool, input, "document");
};
