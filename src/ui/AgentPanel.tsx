// The agents button: whether WebMCP is available, a switch to allow agents,
// and what they did (every edit can be undone with Ctrl+Z).
import { useState } from "preact/hooks";
import { Bot, CircleAlert, Check } from "lucide-preact";
import { agentLog, agentStatus, enableAgents } from "../agent/webmcp";
import { TOOLS } from "../agent/tools";
import { useStore } from "../vendor/kickr/client/store";
import { Toggle } from "./widgets";

const time = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function AgentButton() {
  const status = useStore(agentStatus);
  const log = useStore(agentLog);
  const [open, setOpen] = useState(false);
  const recent = log.length > 0 && Date.now() - log[0].at < 4000;
  return (
    <div class="agent">
      <button class={`icon-btn ${status.enabled ? "on" : ""} ${recent ? "busy" : ""}`} title="Agentes de IA (WebMCP)" onClick={() => setOpen(!open)}>
        <Bot size={16} />
      </button>
      {open && (
        <div class="agent-panel" onPointerLeave={() => setOpen(false)}>
          <div class="agent-head">
            <b>Agentes de IA (WebMCP)</b>
            {status.supported && <Toggle value={status.enabled} onChange={enableAgents} />}
          </div>
          {status.supported ? (
            <p class="muted small">
              {status.enabled
                ? `${TOOLS.length} ferramentas registradas em ${status.api === "document" ? "document" : "navigator"}.modelContext. Um agente no navegador pode ler e editar este mapa; cada edição dele entra no histórico (Ctrl+Z desfaz).`
                : "Desligado: nenhuma ferramenta exposta para agentes."}
            </p>
          ) : (
            <p class="muted small">
              Este navegador não expõe WebMCP. Ele existe em prévia no Chrome (flag de WebMCP) e via extensões que trazem <code>modelContext</code> para a página; quando houver, as ferramentas aparecem sozinhas.
            </p>
          )}
          <div class="agent-log">
            {log.length === 0 && <div class="empty">Nenhuma ação de agente ainda.</div>}
            {log.slice(0, 30).map((c) => (
              <div class={`agent-call ${c.ok ? "" : "bad"}`} title={`${c.input}\n→ ${c.result}`}>
                {c.ok ? <Check size={13} /> : <CircleAlert size={13} />}
                <span class="call-title">{c.title}</span>
                <span class="muted small">{time(c.at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
