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
  Globe,
  CircleHelp,
} from "lucide-preact";
import { lang, toggleLang, tr } from "../i18n";
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
import { goHome, openDocs } from "../app";
import { copyShareLink, optimizerOpen, commands, copyHbs, copySelection, cutSelection, deleteSelection, duplicate, exportHbs, moveSelection, nudge, paste, selectAll, TOOLS } from "../editor/actions";
import { ed, editor, patch, prefs, redo, saveNow, select, undo, type EditorState, type ToolId } from "../editor/state";
import { cancelTool, fitView, releaseSpace, setTool, toolKey, zoomAt } from "../editor/tools";
import { view } from "../editor/state";
import { useStore } from "../vendor/haxball/client/store";
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

const hintFor = (t: ToolId): string =>
  ({
    select: tr(
      "Clique seleciona · Shift soma · arraste move · Alt+arrastar duplica · arraste o losango para curvar",
      "Click selects · Shift adds · drag moves · Alt+drag duplicates · drag the diamond to curve",
    ),
    hand: tr("Arraste para mover a vista · roda do mouse dá zoom", "Drag to pan view · mouse wheel zooms"),
    segment: tr(
      "Clique cria pontos encadeados · Shift trava 15° · digite 120 ou 120<45 e Enter · Esc termina · Alt sem ímã",
      "Click chains points · Shift locks 15° · type 120 or 120<45 and Enter · Esc finishes · Alt disables snap",
    ),
    vertex: tr("Clique cria um vértice solto (vértices também colidem)", "Click creates a loose vertex (vertices also collide)"),
    disc: tr("Clique cria um disco · arraste para definir o raio", "Click creates a disc · drag to set radius"),
    goal: tr("Arraste de um poste ao outro · lado esquerdo = gol red", "Drag from one post to the other · left half = red goal"),
    plane: tr("Arraste ao longo da parede · a normal aponta para o centro", "Drag along the wall · normal points toward the center"),
    joint: tr("Clique em dois discos (ou na bola) para ligá-los", "Click two discs (or the ball) to connect them"),
    redSpawn: tr("Clique para adicionar um ponto de spawn do red", "Click to add a red spawn point"),
    blueSpawn: tr("Clique para adicionar um ponto de spawn do blue", "Click to add a blue spawn point"),
    text: tr("Clique onde o letreiro vai ficar · depois edite o texto no painel", "Click where the banner text goes · then edit it in the panel"),
  })[t];

const DRAWING = new Set<ToolId>(["segment", "vertex", "disc", "goal", "plane", "joint"]);

export function Editor() {
  const l = useStore(lang);
  const s = useStore(editor);
  const p = useStore(prefs);
  const play = useStore(playMode);
  const optimizing = useStore(optimizerOpen);
  const showVersions = useStore(versionsOpen);
  const [palette, setPalette] = useState(false);
  const cmds = useMemo(() => commands(() => void goHome()), [l]);

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
          s: () => void saveNow().then(() => toast(tr("Salvo", "Saved"))),
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
        <div class="panel-title">{tr("Camadas", "Layers")}</div>
        <Layers s={s} />
      </aside>
      <main class={`stage ${play === "split" ? "split" : ""}`}>
        <div class="edit-pane">
        <Canvas tool={s.tool} />
        <div class="hint">
          <span>{hintFor(s.tool)}</span>
          {DRAWING.has(s.tool) && <DrawTrait s={s} />}
        </div>
        <div class="view-toggles">
          <button class={`icon-btn ${p.showGrid ? "on" : ""}`} title="Grid (Ctrl+')" onClick={() => prefs.update({ showGrid: !p.showGrid })}>
            <Grid3x3 size={15} />
          </button>
          <label class="grid-size" title={tr("Tamanho do grid", "Grid size")}>
            <input type="number" min={1} value={p.grid} onChange={(e) => prefs.update({ grid: Math.max(1, Number((e.target as HTMLInputElement).value) || 10) })} />
          </label>
          <button class={`icon-btn ${p.snapGrid ? "on" : ""}`} title={tr("Snap no grid", "Snap to grid")} onClick={() => prefs.update({ snapGrid: !p.snapGrid })}>
            <Grid3x3 size={15} strokeWidth={3} />
          </button>
          <button class={`icon-btn ${p.snapPoints ? "on" : ""}`} title={tr("Ímã em pontos, guias de alinhamento", "Snap to points and alignment guides")} onClick={() => prefs.update({ snapPoints: !p.snapPoints })}>
            <Magnet size={15} />
          </button>
          <button class={`icon-btn ${p.showInvisible ? "on" : ""}`} title={tr("Mostrar objetos invisíveis", "Show invisible objects")} onClick={() => prefs.update({ showInvisible: !p.showInvisible })}>
            <Eye size={15} />
          </button>
          <button class={`icon-btn ${p.showVertices ? "on" : ""}`} title={tr("Mostrar vértices", "Show vertices")} onClick={() => prefs.update({ showVertices: !p.showVertices })}>
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
            {tr("Propriedades", "Properties")}
          </button>
          <button class={s.panel === "traits" ? "on" : ""} onClick={() => patch({ panel: "traits" })}>
            Traits
            <span class="count">{Object.keys(traitsOf(s.doc.fields)).length}</span>
          </button>
          <button class={s.panel === "issues" ? "on" : ""} onClick={() => patch({ panel: "issues" })}>
            {tr("Problemas", "Issues")}
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
      <button class={`btn small ${active ? "on" : ""}`} title={tr("Overlays de física", "Physics overlays")} onClick={() => setOpen(!open)}>
        <Atom size={14} /> {tr("Física", "Physics")}
      </button>
      {open && (
        <div class="phys-menu" onPointerLeave={() => setOpen(false)}>
          <label>
            <input type="checkbox" checked={p.physRoles} onChange={() => prefs.update({ physRoles: !p.physRoles })} />
            {tr("Cores por colisão", "Collision colors")}
            <span class="muted small">{tr("o que cada parede segura", "what each wall stops")}</span>
          </label>
          <label>
            <input type="checkbox" checked={p.physBias} onChange={() => prefs.update({ physBias: !p.physBias })} />
            Bias
            <span class="muted small">{tr("espessura extra e lado do empurrão", "extra thickness and push direction")}</span>
          </label>
          <div class="phys-row">
            <span>{tr("Parede inflada para", "Inflated wall for")}</span>
            <select value={p.inflate} onChange={(e) => prefs.update({ inflate: (e.target as HTMLSelectElement).value as typeof p.inflate })}>
              <option value="none">{tr("ninguém", "nobody")}</option>
              <option value="ball">{tr("a bola", "the ball")}</option>
              <option value="red">{tr("jogador red", "red player")}</option>
              <option value="blue">{tr("jogador blue", "blue player")}</option>
            </select>
          </div>
          <p class="muted small">{tr("A área pintada é onde o centro do corpo não consegue chegar.", "The shaded area is where the body's center cannot reach.")}</p>
          <label>
            <input type="checkbox" checked={p.showIssues} onChange={() => prefs.update({ showIssues: !p.showIssues })} />
            {tr("Marcadores de problemas", "Issue markers")}
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
        <option value="">{tr("(nenhum)", "(none)")}</option>
        {names.map((n) => (
          <option value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

function TopBar({ s, onPalette }: { s: EditorState; onPalette: () => void }) {
  const l = useStore(lang);
  const play = useStore(playMode);
  const name = typeof s.doc.fields.name === "string" ? s.doc.fields.name : "";
  const [menu, setMenu] = useState(false);
  return (
    <header class="topbar">
      <button class="icon-btn" title={tr("Projetos", "Projects")} onClick={() => void goHome()}>
        <ChevronLeft size={18} />
      </button>
      <img src="./logo.svg" alt="haxforge logo" class="topbar-logo" width="22" height="22" />
      <span class="brand">haxforge</span>
      <input
        class="map-name"
        value={name}
        onChange={(e) => commit(setField(ed().doc, "name", (e.target as HTMLInputElement).value))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        title={tr("Nome do mapa", "Map name")}
      />
      <span
        class={`save ${s.saved}`}
        title={
          s.saved === "error"
            ? tr("Erro ao salvar no navegador", "Error saving in browser")
            : s.saved === "pending"
              ? tr("Salvando…", "Saving…")
              : tr("Salvo no navegador", "Saved in browser")
        }
      >
        {s.saved === "error" ? <CloudOff size={15} /> : <Cloud size={15} />}
        {s.saved === "pending" ? tr("salvando…", "saving…") : s.saved === "error" ? tr("erro", "error") : tr("salvo", "saved")}
      </span>
      <div class="sep" />
      <button class="icon-btn" title={tr("Desfazer (Ctrl+Z)", "Undo (Ctrl+Z)")} disabled={!s.past.length} onClick={undo}>
        <Undo2 size={16} />
      </button>
      <button class="icon-btn" title={tr("Refazer (Ctrl+Shift+Z)", "Redo (Ctrl+Shift+Z)")} disabled={!s.future.length} onClick={redo}>
        <Redo2 size={16} />
      </button>
      <button class="icon-btn" title={tr("Versões", "Versions")} onClick={() => versionsOpen.set(true)}>
        <History size={16} />
      </button>
      <div class="budget" title={tr("Limite do HaxBall: 255 de cada", "HaxBall limit: 255 of each")}>
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
      <button class="btn ghost small" title={tr("Mudar para inglês (EN)", "Mudar para português (PT-BR)")} onClick={toggleLang}>
        <Globe size={14} /> {l.toUpperCase()}
      </button>
      <button class="icon-btn" title={tr("Documentação", "Documentation")} onClick={() => openDocs()}>
        <CircleHelp size={16} />
      </button>
      <AgentButton />
      <button class="btn ghost" title={tr("Paleta de comandos (Ctrl+K)", "Command palette (Ctrl+K)")} onClick={onPalette}>
        <CommandIcon size={15} /> K
      </button>
      <div class="dropdown">
        <button class="btn" title={tr("Jogar no mapa (Ctrl+Enter)", "Play on map (Ctrl+Enter)")} onClick={() => playMode.set("full")}>
          <Play size={15} /> {tr("Jogar", "Play")}
        </button>
        <button
          class={`btn caret-btn ${play === "split" ? "on" : ""}`}
          title={tr("Jogar lado a lado com o editor, recarregando a cada edição (Ctrl+Shift+Enter)", "Play side-by-side with the editor, reloading on every edit (Ctrl+Shift+Enter)")}
          onClick={() => playMode.set(play === "split" ? null : "split")}
        >
          <Columns2 size={15} />
        </button>
      </div>
      <div class="dropdown">
        <button class="btn primary" onClick={() => exportHbs(false)} title={tr("Baixar .hbs (Ctrl+E)", "Download .hbs (Ctrl+E)")}>
          <Download size={15} /> {tr("Exportar", "Export")}
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
              <Download size={14} /> {tr("Baixar .hbs", "Download .hbs")}
            </button>
            <button
              onClick={() => {
                setMenu(false);
                exportHbs(true);
              }}
            >
              <FileJson size={14} /> {tr("Baixar limpo (sem metadados do editor)", "Download clean (without editor metadata)")}
            </button>
            <button
              onClick={() => {
                setMenu(false);
                void copyHbs();
              }}
            >
              <Copy size={14} /> {tr("Copiar texto", "Copy text")}
            </button>
            <button
              onClick={() => {
                setMenu(false);
                void copyShareLink();
              }}
            >
              <Link size={14} /> {tr("Copiar link do mapa", "Copy map link")}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
