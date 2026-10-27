// Plays the map being edited, with HaxBall's renderer and netcode: full
// screen, or next to the editor with every edit reloaded live.
import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronsRight, Columns2, Maximize2, Pause, Play as PlayIcon, RotateCcw, StepForward, Users, Activity, X, Target, Zap, ShieldAlert } from "lucide-preact";
import { toJson, type Doc } from "../doc/model";
import { editor } from "../editor/state";
import { P1, P2, Playground as Engine } from "../play/engine";
import { keyMap } from "../play/keys";
import { playgroundTool, playMode, stressTargetSegment, type PlaygroundTool, type PlayMode } from "../play/mode";
import { autoStressSegment, autoStressStadium, drawStresserOverlay, simulateStressBurst, type StressBurstResult, type StressPattern } from "../play/stresser";
import { render as renderGame, VIEW_MODES, type Camera } from "../vendor/haxball/client/render";
import { Input, isOvertime } from "../vendor/haxball/shared/game";
import { DEFAULT_COLORS, TICK_MS } from "../vendor/haxball/shared/protocol";
import { compileStadium, type Stadium } from "../vendor/haxball/shared/stadium";
import { lang, tr } from "../i18n";
import { Store, useStore } from "../vendor/haxball/client/store";


// ---- Settings (per browser) -------------------------------------------------------

interface PlaySettings {
  extrapolation: number;
  lag: number;
  twoPlayers: boolean;
  viewMode: number;
  stats: boolean;
}
const KEY = "haxforge.play";
const DEFAULTS: PlaySettings = { extrapolation: 0, lag: 0, twoPlayers: false, viewMode: -1, stats: false };
function load(): PlaySettings {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    s.stats = false;
    return s;
  } catch {
    return DEFAULTS;
  }
}
const playSettings = new Store<PlaySettings>(load());
playSettings.subscribe((s) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {}
});

// ---- Keys ---------------------------------------------------------------------------

function compile(doc: Doc): { stadium: Stadium } | { error: string } {
  try {
    return { stadium: compileStadium(toJson(doc, true)) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// One match at a time, kept while the playground is open in any mode.
let shared: { engine: Engine; doc: Doc } | null = null;
playMode.subscribe((m) => {
  if (m === null) shared = null;
});

function newEngine(stadium: Stadium): Engine {
  const st = playSettings.get();
  const pg = new Engine(stadium, st.twoPlayers);
  pg.setExtrapolation(st.extrapolation);
  if (st.lag) pg.setLag(st.lag);
  return pg;
}

const SPEEDS = [1, 0.5, 0.25, 0.1];
function getHelp(): string[] {
  return tr(
    [
      "/extrapolation <ms>  renderiza à frente (-200 a 1000)",
      "/lag <ms>  latência artificial de ida e volta (0 a 2000)",
      "/speed <x>  velocidade do tempo (ex.: 0.25)",
      "/reset  recomeça a partida",
      "/p2  liga/desliga o segundo jogador (blue: WASD + Shift esquerdo/Q)",
      "/stresser  alterna entre lançador e stresser de parede",
      "/audit  audita todas as paredes do mapa para achar varamentos",
      "P pausa · . avança frame · S alternar lançador/stresser · 0-7 zoom · arraste para testar",
    ],
    [
      "/extrapolation <ms>  render ahead (-200 to 1000)",
      "/lag <ms>  artificial round-trip latency (0 to 2000)",
      "/speed <x>  time speed (e.g. 0.25)",
      "/reset  restart match",
      "/p2  toggle second player (blue: WASD + Left Shift/Q)",
      "/stresser  toggle launcher and wall stresser",
      "/audit  audit all walls for tunneling vulnerabilities",
      "P pause · . step frame · S toggle launcher/stresser · 0-7 zoom · drag to test",
    ],
  );
}

interface Line {
  id: number;
  text: string;
  warn?: boolean;
}
let lineId = 0;

export function Playground({ mode }: { mode: PlayMode }) {
  useStore(lang);
  const settings = useStore(playSettings);
  const tool = useStore(playgroundTool);
  const [stressPattern, setStressPattern] = useState<StressPattern>("single");
  const [stressSpeed, setStressSpeed] = useState<number>(25);
  const [auditHighlight, setAuditHighlight] = useState<Set<number> | null>(null);
  const [stressResultHud, setStressResultHud] = useState<StressBurstResult | null>(null);
  const [stressHudClosed, setStressHudClosed] = useState(false);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const stressPatternRef = useRef(stressPattern);
  stressPatternRef.current = stressPattern;
  const stressSpeedRef = useRef(stressSpeed);
  stressSpeedRef.current = stressSpeed;
  const auditHighlightRef = useRef(auditHighlight);
  auditHighlightRef.current = auditHighlight;
  const stressDrag = useRef<{
    origin: [number, number];
    end: [number, number];
    result: StressBurstResult;
  } | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hud, setHud] = useState({ red: 0, blue: 0, time: 0, overtime: false, paused: false, speed: 1, history: 0, stats: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [cmd, setCmd] = useState("");
  const [rewind, setRewind] = useState<number | null>(null);
  const cmdInput = useRef<HTMLInputElement>(null);

  const print = (text: string, warn = false) => {
    const id = ++lineId;
    setLines((l) => [...l.slice(-5), { id, text, warn }]);
    setTimeout(() => setLines((l) => l.filter((x) => x.id !== id)), 7000);
  };

  // The match survives switching between full screen and split; it is
  // swapped live as the map changes.
  useEffect(() => {
    const s = editor.get();
    if (!s) return;
    if (!shared) {
      const c = compile(s.doc);
      if ("error" in c) {
        setError(c.error);
        return;
      }
      shared = { engine: newEngine(c.stadium), doc: s.doc };
    }
    engineRef.current = shared.engine;
    let lastDoc = shared.doc;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = editor.subscribe((st) => {
      if (!st || st.doc === lastDoc) return;
      lastDoc = st.doc;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const next = compile(st.doc);
        if ("error" in next) return setError(next.error);
        setError(null);
        engineRef.current?.swapStadium(next.stadium);
        if (shared) shared.doc = st.doc;
      }, 120);
    });
    // Catch up with edits made while no playground was showing.
    if (s.doc !== shared.doc) {
      const next = compile(s.doc);
      if (!("error" in next)) shared.engine.swapStadium(next.stadium);
      shared.doc = s.doc;
    }
    return () => {
      unsub();
      clearTimeout(timer);
      engineRef.current = null;
    };
  }, []);

  // Focus and stress test a target segment when requested from editor/context menu
  useEffect(() => {
    const unsub = stressTargetSegment.subscribe((segIdx) => {
      if (segIdx === null) return;
      const pg = engineRef.current;
      if (!pg) return;
      playgroundTool.set("stresser");
      const res = autoStressSegment(pg.stadium, segIdx, pg.game.discs[0]);
      if (!res.isSecure) {
        setAuditHighlight(new Set([segIdx]));
        print(
          tr(
            `⚠️ Segmento #${segIdx} VARA A PAREDE! Falhou a partir de ${res.minBreachSpeed?.toFixed(1)} u/f (${res.breachCount} falhas em ${res.totalTests} testes)`,
            `⚠️ Segment #${segIdx} TUNNELS WALL! Failed starting at ${res.minBreachSpeed?.toFixed(1)} u/f (${res.breachCount} fails in ${res.totalTests} tests)`,
          ),
          true,
        );
        for (const tip of res.tips) print(`  💡 ${tip}`, false);
      } else {
        setAuditHighlight(null);
        print(tr(`✅ Segmento #${segIdx} 100% seguro contra varamento! (${res.totalTests} testes)`, `✅ Segment #${segIdx} 100% secure against tunneling! (${res.totalTests} tests)`));
      }
      stressTargetSegment.set(null);
    });
    return unsub;
  }, []);

  // Render loop and keyboard.
  const launch = useRef<{ origin: [number, number]; end: [number, number] } | null>(null);
  const inverse = useRef<DOMMatrix | null>(null);
  useEffect(() => {
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const cam: Camera = { x: 0, y: 0 };
    let raf = 0;
    let last = performance.now();
    let fps = 60;
    let hudAt = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const pg = engineRef.current;
      const dt = now - last;
      last = now;
      fps += (1000 / Math.max(dt, 1) - fps) * 0.05;
      if (!pg) return;
      pg.advance(dt);
      const dpr = window.devicePixelRatio || 1;
      const r = cv.getBoundingClientRect();
      const w = Math.round(r.width * dpr);
      const h = Math.round(r.height * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      const g = pg.view();
      const st = playSettings.get();
      renderGame(ctx, pg.stadium, g, P1, cam, { mode: st.viewMode, bottomInset: 0, dt: dt / 1000, style: "classic", colors: DEFAULT_COLORS, avatars: { [P1]: "1", [P2]: "2" } });
      inverse.current = ctx.getTransform().inverse();
      if (toolRef.current === "launcher") {
        drawLaunch(ctx, pg);
      } else {
        drawStress(ctx, pg);
      }
      if (now - hudAt > 100) {
        hudAt = now;
        const ahead = pg.framesAhead();
        setHud({
          red: g.red,
          blue: g.blue,
          time: g.time,
          overtime: isOvertime(g),
          paused: pg.paused,
          speed: pg.speed,
          history: pg.history.length,
          stats: [
            `ping         ${Math.round(pg.rtt)} ms`,
            `lag (/lag)   ${pg.lag} ms`,
            `extrapol.    ${pg.extrapolation} ms`,
            `${tr("confirmado ", "confirmed  ")}  F=${pg.sim.confirmed.frame}`,
            `${tr("renderizado", "rendered   ")}  F=${(pg.sim.confirmed.frame + ahead).toFixed(1)} (+${ahead.toFixed(1)})`,
            `${tr("servidor   ", "server     ")}  F=${pg.game.frame}`,
            `fps          ${Math.round(fps)}`,
          ].join("\n"),
        });
      }
    };
    raf = requestAnimationFrame(loop);

    const held = new Set<string>();
    const isActive = () => mode === "full" || root.current?.contains(document.activeElement);
    const update = () => {
      const pg = engineRef.current;
      if (!pg) return;
      const map = keyMap(pg.twoPlayers);
      const bits = new Map<number, number>([[P1, 0], [P2, 0]]);
      for (const code of held) {
        const k = map[code];
        if (k) bits.set(k[0], bits.get(k[0])! | k[1]);
      }
      pg.setInput(P1, bits.get(P1)!);
      if (pg.twoPlayers) pg.setInput(P2, bits.get(P2)!);
    };
    const typing = () => document.activeElement === cmdInput.current;
    const down = (e: KeyboardEvent) => {
      if (!isActive() || typing()) return;
      const pg = engineRef.current;
      if (e.code === "Escape" && mode === "full") return playMode.set(null);
      if (e.code === "Enter") {
        e.preventDefault();
        held.clear();
        update();
        cmdInput.current?.focus();
        return;
      }
      if (e.code === "KeyP" && !e.repeat && pg) return togglePause(pg);
      if (e.code === "Period" && pg?.paused) return pg.stepFrame();
      if (e.code === "KeyS" && !e.repeat && !pg?.twoPlayers) {
        playgroundTool.set(playgroundTool.get() === "launcher" ? "stresser" : "launcher");
        return;
      }
      // Like HaxBall: 0 = Restricted 840x410, 1-7 = Full 1x..2.5x zoom.
      const digit = /^Digit([0-7])$/.exec(e.code);
      if (digit && !e.repeat) return playSettings.update({ viewMode: Number(digit[1]) });
      if (pg && keyMap(pg.twoPlayers)[e.code]) {
        e.preventDefault();
        held.add(e.code);
        update();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (held.delete(e.code)) update();
    };
    const blur = () => {
      held.clear();
      update();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    if (mode === "full" || mode === "split") cv.focus();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [mode]);

  const lastSpeed = useRef(1);
  const togglePause = (pg: Engine) => {
    pg.speed = pg.paused ? lastSpeed.current : 0;
    setRewind(pg.paused ? pg.history.length - 1 : null);
  };

  const run = (line: string) => {
    const pg = engineRef.current;
    const [name, arg] = line.trim().replace(/^\//, "").split(/\s+/);
    const n = Number(arg);
    switch (name.toLowerCase()) {
      case "":
        return;
      case "extrapolation":
        if (!pg) return;
        if (arg !== undefined && Number.isFinite(n)) {
          pg.setExtrapolation(n);
          playSettings.update({ extrapolation: pg.extrapolation });
        }
        return print(`extrapolation: ${pg.extrapolation} ms`);
      case "lag":
        if (!pg) return;
        if (arg !== undefined && Number.isFinite(n)) {
          pg.setLag(n);
          playSettings.update({ lag: pg.lag });
        }
        return print(tr(`lag: ${pg.lag} ms (metade em cada sentido)`, `lag: ${pg.lag} ms (half each way)`));
      case "speed":
        if (!pg) return;
        if (Number.isFinite(n) && n > 0) {
          pg.speed = Math.min(4, n);
          lastSpeed.current = pg.speed;
          setRewind(null);
        }
        return print(tr(`velocidade: ${pg.speed}x`, `speed: ${pg.speed}x`));
      case "reset":
        pg?.restart();
        setRewind(null);
        return print(tr("partida recomeçada", "match restarted"));
      case "p2":
        playSettings.update({ twoPlayers: !playSettings.get().twoPlayers });
        return restartEngine();
      case "stresser":
        playgroundTool.set(playgroundTool.get() === "launcher" ? "stresser" : "launcher");
        return print(
          tr(
            `Modo: ${playgroundTool.get() === "stresser" ? "⚡ Stresser de Parede" : "🎯 Lançador normal"}`,
            `Mode: ${playgroundTool.get() === "stresser" ? "⚡ Wall Stresser" : "🎯 Normal Launcher"}`,
          ),
        );
      case "audit":
        return runAuditAllWalls();
      case "pattern":
        if (arg === "single" || arg === "fan" || arg === "radial") {
          setStressPattern(arg);
          return print(tr(`Padrão do stresser: ${arg}`, `Stresser pattern: ${arg}`));
        }
        return print(tr("Uso: /pattern single | fan | radial", "Usage: /pattern single | fan | radial"), true);
      case "help":
        return getHelp().forEach((h) => print(h));
      default:
        return print(tr(`comando desconhecido: /${name} (veja /help)`, `unknown command: /${name} (see /help)`), true);
    }
  };

  const restartEngine = () => {
    const s = editor.get();
    const old = engineRef.current;
    if (!s || !old) return;
    const c = compile(s.doc);
    if ("error" in c) return setError(c.error);
    const pg = newEngine(c.stadium);
    engineRef.current = pg;
    shared = { engine: pg, doc: s.doc };
    setRewind(null);
    print(
      pg.twoPlayers
        ? tr("2 jogadores: red = setas + X/Espaço (ou . / Ctrl direito) · blue = WASD + Shift esquerdo/Q", "2 players: red = arrows + X/Space (or . / Right Ctrl) · blue = WASD + Left Shift/Q")
        : tr("1 jogador: setas/WASD + X/Espaço", "1 player: arrows/WASD + X/Space"),
    );
  };

  // ---- Ball launcher ------------------------------------------------------------------------

  const toWorld = (e: PointerEvent): [number, number] | null => {
    const inv = inverse.current;
    const cv = canvas.current;
    if (!inv || !cv) return null;
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const p = inv.transformPoint(new DOMPoint((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr));
    return [p.x, p.y];
  };
  const velocity = (l: { origin: [number, number]; end: [number, number] }): [number, number] => {
    let vx = (l.end[0] - l.origin[0]) * 0.06;
    let vy = (l.end[1] - l.origin[1]) * 0.06;
    const sp = Math.hypot(vx, vy);
    if (sp > 25) {
      vx *= 25 / sp;
      vy *= 25 / sp;
    }
    return [vx, vy];
  };
  function drawLaunch(ctx: CanvasRenderingContext2D, pg: Engine): void {
    const l = launch.current;
    if (!l) return;
    const [vx, vy] = velocity(l);
    const path = pg.predict(l.origin[0], l.origin[1], vx, vy);
    const px = 1 / ctx.getTransform().a;
    ctx.save();
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 5 * px]);
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.moveTo(...l.origin);
    ctx.lineTo(...l.end);
    ctx.stroke();
    ctx.fillStyle = "#ffd166";
    ctx.font = `600 ${12 * px}px Inter, sans-serif`;
    ctx.fillText(`${Math.hypot(vx, vy).toFixed(1)} u/frame`, l.end[0] + 8 * px, l.end[1] - 8 * px);
    ctx.restore();
  }

  const runAuditAllWalls = () => {
    const pg = engineRef.current;
    if (!pg) return;
    const audit = autoStressStadium(pg.stadium, pg.game.discs[0]);
    if (audit.totalVulnerabilities > 0) {
      const vulnSet = new Set(audit.vulnerableSegments.keys());
      setAuditHighlight(vulnSet);
      print(
        tr(
          `⚠️ Auditoria: ${audit.totalVulnerabilities} parede(s) vulnerável(is) a varamento detectada(s)! (Destacadas em vermelho)`,
          `⚠️ Audit: ${audit.totalVulnerabilities} wall(s) vulnerable to tunneling detected! (Highlighted in red)`,
        ),
        true,
      );
      for (const [idx, data] of audit.vulnerableSegments) {
        print(
          tr(
            `  • Segmento #${idx}: vara a partir de ${data.minBreachSpeed.toFixed(1)} u/f (${data.breachCount} falhas)`,
            `  • Segment #${idx}: tunnels starting at ${data.minBreachSpeed.toFixed(1)} u/f (${data.breachCount} fails)`,
          ),
          true,
        );
      }
    } else {
      setAuditHighlight(null);
      print(tr("✅ Auditoria: Todas as paredes suportaram chutes fortes sem varar!", "✅ Audit: All walls held up to high-speed shots without tunneling!"));
    }
  };

  function drawStress(ctx: CanvasRenderingContext2D, pg: Engine): void {
    const s = stressDrag.current;
    if (!s) {
      if (auditHighlightRef.current && auditHighlightRef.current.size > 0) {
        const px = 1 / ctx.getTransform().a;
        ctx.save();
        ctx.lineWidth = 6 * px;
        ctx.strokeStyle = "rgba(255, 51, 68, 0.4)";
        for (const wIdx of auditHighlightRef.current) {
          const seg = pg.stadium.segments[wIdx];
          if (!seg) continue;
          ctx.beginPath();
          if (seg.curved) {
            ctx.arc(seg.cx, seg.cy, seg.radius, 0, Math.PI * 2);
          } else {
            ctx.moveTo(seg.x0, seg.y0);
            ctx.lineTo(seg.x1, seg.y1);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
      return;
    }
    const currentSpeed = stressSpeedRef.current;
    drawStresserOverlay(
      ctx,
      pg.stadium,
      s.origin,
      s.end,
      s.result,
      stressPatternRef.current,
      currentSpeed,
      auditHighlightRef.current ?? undefined,
    );
  }

  const fmtTime = (t: number) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const pg = engineRef.current;

  return (
    <div ref={root} class={`playground ${mode}`}>
      <div class="play-bar">
        <span class="play-title">Playground</span>
        <span class="score">
          <b class="red">{hud.red}</b>
          <span>–</span>
          <b class="blue">{hud.blue}</b>
          <span class="clock">{hud.overtime ? tr("prorrogação", "overtime") : fmtTime(hud.time)}</span>
        </span>
        <div class="play-tool-group">
          <button
            class={`play-tool-btn ${tool === "launcher" ? "active" : ""}`}
            title={tr("Lançador normal (trajetória única)", "Normal launcher (single trajectory)")}
            onClick={() => playgroundTool.set("launcher")}
          >
            <Target size={13} />
            <span>{tr("Lançador", "Launcher")}</span>
          </button>
          <button
            class={`play-tool-btn ${tool === "stresser" ? "active stresser" : ""}`}
            title={tr("Stresser de Parede (detecta se a bola vara a parede) · Tecla S", "Wall Stresser (checks if ball tunnels walls) · Key S")}
            onClick={() => {
              setStressHudClosed(false);
              playgroundTool.set("stresser");
            }}
          >
            <Zap size={13} />
            <span>{tr("Stresser", "Stresser")}</span>
          </button>
        </div>
        {tool === "stresser" && (
          <>
            <select
              class="speed"
              title={tr("Padrão de estresse", "Stress pattern")}
              value={stressPattern}
              onChange={(e) => setStressPattern((e.target as HTMLSelectElement).value as StressPattern)}
            >
              <option value="single">{tr("1 Linha (Simples)", "1 Line (Simple)")}</option>
              <option value="fan">{tr("Leque (3 Raios)", "Fan (3 Rays)")}</option>
              <option value="radial">{tr("Radial 360°", "Radial 360°")}</option>
            </select>
            <select
              class="speed"
              title={tr("Velocidade de teste", "Test speed")}
              value={String(stressSpeed)}
              onChange={(e) => setStressSpeed(Number((e.target as HTMLSelectElement).value))}
            >
              <option value="15">{tr("Normal (15 u/f)", "Normal (15 u/f)")}</option>
              <option value="22">{tr("Forte (22 u/f)", "Hard (22 u/f)")}</option>
              <option value="28">{tr("Extremo (28 u/f)", "Extreme (28 u/f)")}</option>
              <option value="35">{tr("Máx/Bug (35 u/f)", "Max/Bug (35 u/f)")}</option>
            </select>
            <button
              class={`icon-btn ${auditHighlight ? "on" : ""}`}
              title={tr("Auditar todas as paredes (detecta vulnerabilidades em todo o mapa)", "Audit all stadium walls (finds vulnerabilities across the map)")}
              onClick={runAuditAllWalls}
            >
              <ShieldAlert size={15} />
            </button>
          </>
        )}
        <div class="grow" />
        <button class="icon-btn" title={hud.paused ? tr("Continuar (P)", "Resume (P)") : tr("Pausar (P)", "Pause (P)")} onClick={() => pg && togglePause(pg)}>
          {hud.paused ? <PlayIcon size={15} /> : <Pause size={15} />}
        </button>
        <button class="icon-btn" title={tr("Avançar um frame (.)", "Step one frame (.)")} disabled={!hud.paused} onClick={() => pg?.stepFrame()}>
          <StepForward size={15} />
        </button>
        <select
          class="speed"
          title={tr("Velocidade do tempo", "Time speed")}
          value={String(hud.paused ? lastSpeed.current : hud.speed)}
          onChange={(e) => {
            const v = Number((e.target as HTMLSelectElement).value);
            lastSpeed.current = v;
            if (pg && !pg.paused) pg.speed = v;
          }}
        >
          {SPEEDS.map((s) => (
            <option value={String(s)}>{s}x</option>
          ))}
        </select>
        <select class="speed" title={tr("Zoom (teclas 0-7, como no HaxBall)", "Zoom (keys 0-7, like HaxBall)")} value={String(settings.viewMode)} onChange={(e) => playSettings.update({ viewMode: Number((e.target as HTMLSelectElement).value) })}>
          {VIEW_MODES.map(([m, label]) => (
            <option value={String(m)}>{label}</option>
          ))}
        </select>
        <button class="icon-btn" title={tr("Recomeçar (/reset)", "Restart (/reset)")} onClick={() => run("/reset")}>
          <RotateCcw size={15} />
        </button>
        <button class={`icon-btn ${settings.twoPlayers ? "on" : ""}`} title={tr("Segundo jogador (/p2)", "Second player (/p2)")} onClick={() => run("/p2")}>
          <Users size={15} />
        </button>
        <button class={`icon-btn ${settings.stats ? "on" : ""}`} title={tr("Estatísticas de rede", "Network stats")} onClick={() => playSettings.update({ stats: !settings.stats })}>
          <Activity size={15} />
        </button>
        <span class="sep" />
        {mode === "full" ? (
          <button class="icon-btn" title={tr("Lado a lado com o editor", "Side-by-side with editor")} onClick={() => playMode.set("split")}>
            <Columns2 size={15} />
          </button>
        ) : (
          <button class="icon-btn" title={tr("Tela cheia", "Full screen")} onClick={() => playMode.set("full")}>
            <Maximize2 size={15} />
          </button>
        )}
        <button class="icon-btn" title={mode === "full" ? tr("Voltar ao editor (Esc)", "Back to editor (Esc)") : tr("Fechar", "Close")} onClick={() => playMode.set(null)}>
          <X size={15} />
        </button>
      </div>
      {hud.paused && (
        <div class="rewind">
          <ChevronsRight size={14} style={{ transform: "scaleX(-1)" }} />
          <input
            type="range"
            min={0}
            max={Math.max(0, hud.history - 1)}
            value={rewind ?? hud.history - 1}
            title={tr("Voltar no tempo (até 10 s)", "Rewind in time (up to 10 s)")}
            onInput={(e) => {
              const i = Number((e.target as HTMLInputElement).value);
              setRewind(i);
              engineRef.current?.rewindTo(i);
            }}
          />
          <span class="muted small">{((((rewind ?? hud.history - 1) - (hud.history - 1)) * TICK_MS) / 1000).toFixed(2)} s</span>
          <span class="muted small hide-narrow">{tr("pausado · . avança um frame · P continua", "paused · . step one frame · P resume")}</span>
        </div>
      )}
      <div class="play-stage">
        <canvas
          ref={canvas}
          class="play-canvas"
          tabIndex={0}
          onPointerDown={(e) => {
            const p = toWorld(e);
            const g = engineRef.current?.game;
            if (!p || !g || e.button !== 0) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            const ball = g.discs[0];
            const near = ball && Math.hypot(ball.x - p[0], ball.y - p[1]) < ball.radius + 12;
            const origin: [number, number] = near ? [ball.x, ball.y] : p;
            if (tool === "launcher") {
              launch.current = { origin, end: p };
            } else {
              setStressHudClosed(false);
              const pg = engineRef.current;
              if (!pg) return;
              const res = simulateStressBurst(pg.stadium, origin, p, stressPattern, stressSpeed, ball);
              stressDrag.current = { origin, end: p, result: res };
              setStressResultHud(res);
            }
          }}
          onPointerMove={(e) => {
            const p = toWorld(e);
            if (!p) return;
            if (tool === "launcher" && launch.current) {
              launch.current.end = p;
            } else if (tool === "stresser" && stressDrag.current) {
              const pg = engineRef.current;
              if (!pg) return;
              const origin = stressDrag.current.origin;
              const ball = pg.game.discs[0];
              const res = simulateStressBurst(pg.stadium, origin, p, stressPattern, stressSpeed, ball);
              stressDrag.current.end = p;
              stressDrag.current.result = res;
              setStressResultHud(res);
            }
          }}
          onPointerUp={() => {
            const eng = engineRef.current;
            if (!eng) return;
            if (tool === "launcher") {
              const l = launch.current;
              launch.current = null;
              if (!l) return;
              const [vx, vy] = velocity(l);
              eng.launch(l.origin[0], l.origin[1], vx, vy);
              if (eng.paused) setRewind(eng.history.length - 1);
            } else {
              const s = stressDrag.current;
              stressDrag.current = null;
              if (!s) return;
              const res = s.result;
              if (res.totalBreaches > 0) {
                const breachTraj = res.trajectories.find((t) => t.breach) ?? res.trajectories[0];
                const vx = Math.cos((breachTraj.angleDeg * Math.PI) / 180) * breachTraj.speed;
                const vy = Math.sin((breachTraj.angleDeg * Math.PI) / 180) * breachTraj.speed;
                eng.launch(s.origin[0], s.origin[1], vx, vy);
                print(
                  tr(
                    `⚠️ Disparando chute que varou a parede: v=${breachTraj.speed.toFixed(1)} u/f (Segmento #${breachTraj.breach?.wallIndex ?? 0})`,
                    `⚠️ Firing wall-tunneling shot: v=${breachTraj.speed.toFixed(1)} u/f (Segment #${breachTraj.breach?.wallIndex ?? 0})`,
                  ),
                  true,
                );
              } else if (res.trajectories[0]) {
                const vx = Math.cos((res.trajectories[0].angleDeg * Math.PI) / 180) * res.trajectories[0].speed;
                const vy = Math.sin((res.trajectories[0].angleDeg * Math.PI) / 180) * res.trajectories[0].speed;
                eng.launch(s.origin[0], s.origin[1], vx, vy);
                print(tr(`✅ Parede resistiu! Velocidade testada: ${stressSpeed.toFixed(1)} u/f`, `✅ Wall held! Speed tested: ${stressSpeed.toFixed(1)} u/f`));
              }
              if (eng.paused) setRewind(eng.history.length - 1);
            }
          }}
        />
        {tool === "stresser" && !stressHudClosed && (
          <div class={`stresser-hud ${stressResultHud?.totalBreaches ? "breach" : ""}`}>
            <div class="stresser-hud-title">
              <Zap size={14} color={stressResultHud?.totalBreaches ? "#ff3344" : "#00f5d4"} />
              <span>{tr("Stresser de Parede", "Wall Stresser")}</span>
              <span class="stresser-badge">
                {stressPattern === "single" ? tr("1 LINHA", "1 LINE") : stressPattern === "fan" ? tr("LEQUE", "FAN") : tr("RADIAL", "RADIAL")}
              </span>
              <button
                class="stresser-hud-close"
                title={tr("Fechar aviso", "Close notice")}
                onClick={() => {
                  setStressHudClosed(true);
                  setStressResultHud(null);
                }}
              >
                <X size={13} />
              </button>
            </div>
            <div class="stresser-hud-desc">
              {stressResultHud ? stressResultHud.summary : tr("Arraste em direção a uma parede para testar se a bola vara com chutes em alta velocidade.", "Drag towards a wall to test if the ball tunnels with high-speed shots.")}
            </div>
            {stressResultHud && stressResultHud.totalBreaches > 0 && (
              <div class="stresser-hud-action">
                {tr("Solte o mouse para disparar o chute que varou!", "Release mouse to fire the breaching shot live!")}
              </div>
            )}
          </div>
        )}
        {error && <div class="play-error">{tr("O mapa não carrega:", "Map failed to load:")} {error}</div>}
        {settings.stats && (
          <pre
            class="net-stats"
            style={{ pointerEvents: "auto", cursor: "pointer" }}
            title={tr("Clique para fechar estatísticas de rede", "Click to close network stats")}
            onClick={() => playSettings.update({ stats: false })}
          >
            {hud.stats}
          </pre>
        )}
        <div class="console">
          {lines.map((l) => (
            <div class={`line ${l.warn ? "warn" : ""}`} key={l.id}>
              {l.text}
            </div>
          ))}
          <input
            ref={cmdInput}
            class="cmd"
            value={cmd}
            placeholder={tr("Enter para comandos: /extrapolation 100, /lag 150, /help", "Enter for commands: /extrapolation 100, /lag 150, /help")}
            onInput={(e) => setCmd((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                run(cmd);
                setCmd("");
                canvas.current?.focus();
              } else if (e.key === "Escape") {
                setCmd("");
                canvas.current?.focus();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
