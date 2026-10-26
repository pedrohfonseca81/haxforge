// The editor screen: top bar, tools, layers, canvas and inspector, plus the
// keyboard shortcuts.
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  ChevronLeft,
  Circle,
  CircleDot,
  Cloud,
  CloudOff,
  Command as CommandIcon,
  Download,
  Eye,
  Goal,
  Grid3x3,
  Hand,
  Link,
  Magnet,
  Minus,
  MousePointer2,
  Play,
  Redo2,
  Slash,
  Undo2,
  UserRound,
  ChevronDown,
  Copy,
  FileJson,
  Columns2,
  Atom,
  Type,
  History,
} from "lucide-preact";
import { VersionsDialog } from "./Versions";
import { AgentButton } from "./AgentPanel";
import { ImportButton, TraceDialog } from "./ImageImport";
import { versionsOpen } from "../editor/versions";
import { OptimizerDialog } from "./Optimizer";
import { Playground } from "./Playground";
import { Issues } from "./Issues";
import { issues } from "../editor/lintState";
import { ROLE_STYLE } from "../doc/bodies";
import { playMode } from "../play/mode";
import { traitsOf } from "../doc/fields";
import { budget, LIMIT } from "../doc/resolve";
import { goHome } from "../app";
import { copyShareLink, optimizerOpen, commands, copyHbs, copySelection, cutSelection, deleteSelection, duplicate, exportHbs, moveSelection, nudge, paste, selectAll, TOOLS } from "../editor/actions";
import { ed, editor, patch, prefs, redo, saveNow, select, undo, type EditorState, type ToolId } from "../editor/state";
import { cancelTool, fitView, releaseSpace, setTool, toolKey, zoomAt } from "../editor/tools";
import { view } from "../editor/state";
import { useStore } from "../vendor/kickr/client/store";
import { Canvas } from "./Canvas";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { Palette } from "./Palette";
import { Traits } from "./Traits";
import { toast } from "../editor/actions";
import { setField } from "../doc/ops";
import { commit } from "../editor/state";

const TOOL_ICONS: Record<ToolId, typeof Hand> = {
  select: MousePointer2,
  hand: Hand,
  segment: Minus,
  vertex: CircleDot,
  disc: Circle,
  goal: Goal,
  plane: Slash,
  joint: Link,
  redSpawn: UserRound,
  blueSpawn: UserRound,
  text: Type,
};

const HINTS: Record<ToolId, string> = {
  select: "Clique seleciona · Shift soma · arraste move · Alt+arrastar duplica · arraste o losango para curvar",
  hand: "Arraste para mover a vista · roda do mouse dá zoom",
  segment: "Clique cria pontos encadeados · Shift trava 15° · digite 120 ou 120<45 e Enter · Esc termina · Alt sem ímã",
  vertex: "Clique cria um vértice solto (vértices também colidem)",
  disc: "Clique cria um disco · arraste para definir o raio",
  goal: "Arraste de um poste ao outro · lado esquerdo = gol red",
  plane: "Arraste ao longo da parede · a normal aponta para o centro",
  joint: "Clique em dois discos (ou na bola) para ligá-los",
  redSpawn: "Clique para adicionar um ponto de spawn do red",
  blueSpawn: "Clique para adicionar um ponto de spawn do blue",
  text: "Clique onde o letreiro vai ficar · depois edite o texto no painel",
};

const DRAWING = new Set<ToolId>(["segment", "vertex", "disc", "goal", "plane", "joint"]);

export function Editor() {
  const s = useStore(editor);
  const p = useStore(prefs);
  const play = useStore(playMode);
  const optimizing = useStore(optimizerOpen);
  const showVersions = useStore(versionsOpen);
  const [palette, setPalette] = useState(false);
  const cmds = useMemo(() => commands(() => void goHome()), []);

  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        playMode.set(e.shiftKey ? (playMode.get() === "split" ? null : "split") : "full");
        return;
      }
      if (isField(e.target) || document.querySelector(".modal-back")) return;
      // The game has the keyboard while it is full screen or focused.
      if (document.querySelector(".playground.full") || (e.target instanceof HTMLElement && e.target.closest(".playground"))) return;
      if (toolKey(e)) {
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (mod) {
        const act: Record<string, () => void> = {
          z: e.shiftKey ? redo : undo,
          y: redo,
          d: duplicate,
          c: copySelection,
          x: cutSelection,
          v: () => paste(),
          a: selectAll,
          e: () => exportHbs(false),
          s: () => void saveNow().then(() => toast("Salvo")),
          "'": () => prefs.update({ showGrid: !prefs.get().showGrid }),
        };
        if (e.code === "BracketRight") return (e.preventDefault(), moveSelection(e.shiftKey ? "front" : "forward"));
        if (e.code === "BracketLeft") return (e.preventDefault(), moveSelection(e.shiftKey ? "back" : "backward"));
        if (act[k]) {
          e.preventDefault();
          act[k]();
        }
        return;
      }
      if (e.shiftKey && e.code === "Digit1") return fitView();
      if (e.shiftKey && e.code === "Digit0") return zoomAt(view.width / 2, view.height / 2, 1 / view.cam.zoom);
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        return deleteSelection();
      }
      if (e.key === "Escape") {
        if (cancelTool()) return;
        if (ed().tool !== "select") return setTool("select");
        return select([]);
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrows[e.key]) {
        e.preventDefault();
        const step = e.shiftKey ? prefs.get().grid : 1;
        return nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
      }
      if (!e.altKey && !e.shiftKey) {
        const t = TOOLS.find((t) => t.key.toLowerCase() === k);
        if (t) setTool(t.id);
      }
    };
    const up = (e: KeyboardEvent) => toolKey(e);
    const blur = () => releaseSpace();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  if (!s) return null;
  return (
    <div class="editor">
      <TopBar s={s} onPalette={() => setPalette(true)} />
      <nav class="toolbar">
        {TOOLS.map((t) => {
          const Icon = TOOL_ICONS[t.id];
          return (
            <button class={`tool ${s.tool === t.id ? "on" : ""} ${t.id}`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
              <Icon size={18} />
              <kbd>{t.key}</kbd>
            </button>
          );
        })}
        <span class="tool-sep" />
        <ImportButton />
      </nav>
      <aside class="left">
        <div class="panel-title">Camadas</div>
        <Layers s={s} />
      </aside>
      <main class={`stage ${play === "split" ? "split" : ""}`}>
        <div class="edit-pane">
        <Canvas tool={s.tool} />
        <div class="hint">
          <span>{HINTS[s.tool]}</span>
          {DRAWING.has(s.tool) && <DrawTrait s={s} />}
        </div>
        <div class="view-toggles">
          <button class={`icon-btn ${p.showGrid ? "on" : ""}`} title="Grid (Ctrl+')" onClick={() => prefs.update({ showGrid: !p.showGrid })}>
            <Grid3x3 size={15} />
          </button>
          <label class="grid-size" title="Tamanho do grid">
            <input type="number" min={1} value={p.grid} onChange={(e) => prefs.update({ grid: Math.max(1, Number((e.target as HTMLInputElement).value) || 10) })} />
          </label>
          <button class={`icon-btn ${p.snapGrid ? "on" : ""}`} title="Snap no grid" onClick={() => prefs.update({ snapGrid: !p.snapGrid })}>
            <Grid3x3 size={15} strokeWidth={3} />
          </button>
          <button class={`icon-btn ${p.snapPoints ? "on" : ""}`} title="Ímã em pontos, guias de alinhamento" onClick={() => prefs.update({ snapPoints: !p.snapPoints })}>
            <Magnet size={15} />
          </button>
          <button class={`icon-btn ${p.showInvisible ? "on" : ""}`} title="Mostrar objetos invisíveis" onClick={() => prefs.update({ showInvisible: !p.showInvisible })}>
            <Eye size={15} />
          </button>
          <button class={`icon-btn ${p.showVertices ? "on" : ""}`} title="Mostrar vértices" onClick={() => prefs.update({ showVertices: !p.showVertices })}>
            <CircleDot size={15} />
          </button>
          <span class="sep" />
          <PhysicsMenu />
        </div>
        {p.physRoles && (
          <div class="legend">
            {(Object.keys(ROLE_STYLE) as (keyof typeof ROLE_STYLE)[]).map((k) => (
              <span>
                <i style={{ background: ROLE_STYLE[k].color }} />
                {ROLE_STYLE[k].label}
              </span>
            ))}
          </div>
        )}
        </div>
        {play === "split" && <Playground mode="split" />}
      </main>
      <aside class="right">
        <div class="tabs">
          <button class={s.panel === "props" ? "on" : ""} onClick={() => patch({ panel: "props" })}>
            Propriedades
          </button>
          <button class={s.panel === "traits" ? "on" : ""} onClick={() => patch({ panel: "traits" })}>
            Traits
            <span class="count">{Object.keys(traitsOf(s.doc.fields)).length}</span>
          </button>
          <button class={s.panel === "issues" ? "on" : ""} onClick={() => patch({ panel: "issues" })}>
            Problemas
            <IssueCount />
          </button>
        </div>
        <div class="right-body">{s.panel === "props" ? <Inspector s={s} /> : s.panel === "traits" ? <Traits s={s} /> : <Issues s={s} />}</div>
      </aside>
      {palette && <Palette commands={cmds} onClose={() => setPalette(false)} />}
      {play === "full" && <Playground mode="full" />}
      {optimizing && <OptimizerDialog onClose={() => optimizerOpen.set(false)} />}
      {showVersions && <VersionsDialog onClose={() => versionsOpen.set(false)} />}
      <TraceDialog />
    </div>
  );
}

function IssueCount() {
  const { list } = useStore(issues);
  if (!list.length) return null;
  const worst = list.some((i) => i.level === "error") ? "error" : list.some((i) => i.level === "warn") ? "warn" : "info";
  return <span class={`count ${worst}`}>{list.length}</span>;
}

function PhysicsMenu() {
  const p = useStore(prefs);
  const [open, setOpen] = useState(false);
  const active = p.physBias || p.physRoles || p.inflate !== "none";
  return (
    <div class="phys">
      <button class={`btn small ${active ? "on" : ""}`} title="Overlays de física" onClick={() => setOpen(!open)}>
        <Atom size={14} /> Física
      </button>
      {open && (
        <div class="phys-menu" onPointerLeave={() => setOpen(false)}>
          <label>
            <input type="checkbox" checked={p.physRoles} onChange={() => prefs.update({ physRoles: !p.physRoles })} />
            Cores por colisão
            <span class="muted small">o que cada parede segura</span>
          </label>
          <label>
            <input type="checkbox" checked={p.physBias} onChange={() => prefs.update({ physBias: !p.physBias })} />
            Bias
            <span class="muted small">espessura extra e lado do empurrão</span>
          </label>
          <div class="phys-row">
            <span>Parede inflada para</span>
            <select value={p.inflate} onChange={(e) => prefs.update({ inflate: (e.target as HTMLSelectElement).value as typeof p.inflate })}>
              <option value="none">ninguém</option>
              <option value="ball">a bola</option>
              <option value="red">jogador red</option>
              <option value="blue">jogador blue</option>
            </select>
          </div>
          <p class="muted small">A área pintada é onde o centro do corpo não consegue chegar.</p>
          <label>
            <input type="checkbox" checked={p.showIssues} onChange={() => prefs.update({ showIssues: !p.showIssues })} />
            Marcadores de problemas
          </label>
        </div>
      )}
    </div>
  );
}

function DrawTrait({ s }: { s: EditorState }) {
  const names = Object.keys(traitsOf(s.doc.fields));
  if (!names.length) return null;
  return (
    <label class="draw-trait">
      Trait
      <select value={s.drawTrait ?? ""} onChange={(e) => patch({ drawTrait: (e.target as HTMLSelectElement).value || null })}>
        <option value="">(nenhum)</option>
        {names.map((n) => (
          <option value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

function TopBar({ s, onPalette }: { s: EditorState; onPalette: () => void }) {
  const play = useStore(playMode);
  const name = typeof s.doc.fields.name === "string" ? s.doc.fields.name : "";
  const [menu, setMenu] = useState(false);
  return (
    <header class="topbar">
      <button class="icon-btn" title="Projetos" onClick={() => void goHome()}>
        <ChevronLeft size={18} />
      </button>
      <span class="brand">haxforge</span>
      <input
        class="map-name"
        value={name}
        onChange={(e) => commit(setField(ed().doc, "name", (e.target as HTMLInputElement).value))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        title="Nome do mapa"
      />
      <span class={`save ${s.saved}`} title={s.saved === "error" ? "Erro ao salvar no navegador" : s.saved === "pending" ? "Salvando…" : "Salvo no navegador"}>
        {s.saved === "error" ? <CloudOff size={15} /> : <Cloud size={15} />}
        {s.saved === "pending" ? "salvando…" : s.saved === "error" ? "erro" : "salvo"}
      </span>
      <div class="sep" />
      <button class="icon-btn" title="Desfazer (Ctrl+Z)" disabled={!s.past.length} onClick={undo}>
        <Undo2 size={16} />
      </button>
      <button class="icon-btn" title="Refazer (Ctrl+Shift+Z)" disabled={!s.future.length} onClick={redo}>
        <Redo2 size={16} />
      </button>
      <button class="icon-btn" title="Versões" onClick={() => versionsOpen.set(true)}>
        <History size={16} />
      </button>
      <div class="budget" title="Limite do HaxBall: 255 de cada">
        {budget(s.doc).map((b) => (
          <span class={`meter ${b.used > LIMIT ? "over" : b.used > LIMIT * 0.85 ? "warn" : ""}`}>
            <span class="meter-label">{b.label}</span>
            <span class="meter-bar">
              <span style={{ width: `${Math.min(100, (b.used / LIMIT) * 100)}%` }} />
            </span>
            <span class="meter-num">{b.used}</span>
          </span>
        ))}
      </div>
      <div class="grow" />
      <AgentButton />
      <button class="btn ghost" title="Paleta de comandos (Ctrl+K)" onClick={onPalette}>
        <CommandIcon size={15} /> K
      </button>
      <div class="dropdown">
        <button class="btn" title="Jogar no mapa (Ctrl+Enter)" onClick={() => playMode.set("full")}>
          <Play size={15} /> Jogar
        </button>
        <button class={`btn caret-btn ${play === "split" ? "on" : ""}`} title="Jogar lado a lado com o editor, recarregando a cada edição (Ctrl+Shift+Enter)" onClick={() => playMode.set(play === "split" ? null : "split")}>
          <Columns2 size={15} />
        </button>
      </div>
      <div class="dropdown">
        <button class="btn primary" onClick={() => exportHbs(false)} title="Baixar .hbs (Ctrl+E)">
          <Download size={15} /> Exportar
        </button>
        <button class="btn primary caret" onClick={() => setMenu(!menu)}>
          <ChevronDown size={15} />
        </button>
        {menu && (
          <div class="menu" onPointerLeave={() => setMenu(false)}>
            <button
              onClick={() => {
                setMenu(false);
                exportHbs(false);
              }}
            >
              <Download size={14} /> Baixar .hbs
            </button>
            <button
              onClick={() => {
                setMenu(false);
                exportHbs(true);
              }}
            >
              <FileJson size={14} /> Baixar limpo (sem metadados do editor)
            </button>
            <button
              onClick={() => {
                setMenu(false);
                void copyHbs();
              }}
            >
              <Copy size={14} /> Copiar texto
            </button>
            <button
              onClick={() => {
                setMenu(false);
                void copyShareLink();
              }}
            >
              <Link size={14} /> Copiar link do mapa
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
