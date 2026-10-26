// Plays the map being edited, with HaxBall's renderer and netcode: full
// screen, or next to the editor with every edit reloaded live.
import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronsRight, Columns2, Maximize2, Pause, Play as PlayIcon, RotateCcw, StepForward, Users, Activity, X } from "lucide-preact";
import { toJson, type Doc } from "../doc/model";
import { editor } from "../editor/state";
import { P1, P2, Playground as Engine } from "../play/engine";
import { keyMap } from "../play/keys";
import { playMode, type PlayMode } from "../play/mode";
import { render as renderGame, VIEW_MODES, type Camera } from "../vendor/kickr/client/render";
import { Input, isOvertime } from "../vendor/kickr/shared/game";
import { DEFAULT_COLORS, TICK_MS } from "../vendor/kickr/shared/protocol";
import { compileStadium, type Stadium } from "../vendor/kickr/shared/stadium";
import { Store, useStore } from "../vendor/kickr/client/store";


// ---- Settings (per browser) -------------------------------------------------------

interface PlaySettings {
  extrapolation: number;
  lag: number;
  twoPlayers: boolean;
  viewMode: number;
  stats: boolean;
}
const KEY = "haxforge.play";
const DEFAULTS: PlaySettings = { extrapolation: 0, lag: 0, twoPlayers: false, viewMode: -1, stats: true };
function load(): PlaySettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
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
const HELP = [
  "/extrapolation <ms>  renderiza à frente (-200 a 1000)",
  "/lag <ms>  latência artificial de ida e volta (0 a 2000)",
  "/speed <x>  velocidade do tempo (ex.: 0.25)",
  "/reset  recomeça a partida",
  "/p2  liga/desliga o segundo jogador (blue: WASD + Shift esquerdo/Q)",
  "P pausa · . avança um frame · 0-7 zoom · arraste no campo para lançar a bola",
];

interface Line {
  id: number;
  text: string;
  warn?: boolean;
}
let lineId = 0;

export function Playground({ mode }: { mode: PlayMode }) {
  const settings = useStore(playSettings);
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
      drawLaunch(ctx, pg);
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
            `confirmado   F=${pg.sim.confirmed.frame}`,
            `renderizado  F=${(pg.sim.confirmed.frame + ahead).toFixed(1)} (+${ahead.toFixed(1)})`,
            `servidor     F=${pg.game.frame}`,
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
        return print(`lag: ${pg.lag} ms (metade em cada sentido)`);
      case "speed":
        if (!pg) return;
        if (Number.isFinite(n) && n > 0) {
          pg.speed = Math.min(4, n);
          lastSpeed.current = pg.speed;
          setRewind(null);
        }
        return print(`velocidade: ${pg.speed}x`);
      case "reset":
        pg?.restart();
        setRewind(null);
        return print("partida recomeçada");
      case "p2":
        playSettings.update({ twoPlayers: !playSettings.get().twoPlayers });
        return restartEngine();
      case "help":
        return HELP.forEach((h) => print(h));
      default:
        return print(`comando desconhecido: /${name} (veja /help)`, true);
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
    print(pg.twoPlayers ? "2 jogadores: red = setas + X/Espaço (ou . / Ctrl direito) · blue = WASD + Shift esquerdo/Q" : "1 jogador: setas/WASD + X/Espaço");
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
          <span class="clock">{hud.overtime ? "prorrogação" : fmtTime(hud.time)}</span>
        </span>
        <div class="grow" />
        <button class="icon-btn" title={hud.paused ? "Continuar (P)" : "Pausar (P)"} onClick={() => pg && togglePause(pg)}>
          {hud.paused ? <PlayIcon size={15} /> : <Pause size={15} />}
        </button>
        <button class="icon-btn" title="Avançar um frame (.)" disabled={!hud.paused} onClick={() => pg?.stepFrame()}>
          <StepForward size={15} />
        </button>
        <select
          class="speed"
          title="Velocidade do tempo"
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
        <select class="speed" title="Zoom (teclas 0-7, como no HaxBall)" value={String(settings.viewMode)} onChange={(e) => playSettings.update({ viewMode: Number((e.target as HTMLSelectElement).value) })}>
          {VIEW_MODES.map(([m, label]) => (
            <option value={String(m)}>{label}</option>
          ))}
        </select>
        <button class="icon-btn" title="Recomeçar (/reset)" onClick={() => run("/reset")}>
          <RotateCcw size={15} />
        </button>
        <button class={`icon-btn ${settings.twoPlayers ? "on" : ""}`} title="Segundo jogador (/p2)" onClick={() => run("/p2")}>
          <Users size={15} />
        </button>
        <button class={`icon-btn ${settings.stats ? "on" : ""}`} title="Estatísticas de rede" onClick={() => playSettings.update({ stats: !settings.stats })}>
          <Activity size={15} />
        </button>
        <span class="sep" />
        {mode === "full" ? (
          <button class="icon-btn" title="Lado a lado com o editor" onClick={() => playMode.set("split")}>
            <Columns2 size={15} />
          </button>
        ) : (
          <button class="icon-btn" title="Tela cheia" onClick={() => playMode.set("full")}>
            <Maximize2 size={15} />
          </button>
        )}
        <button class="icon-btn" title={mode === "full" ? "Voltar ao editor (Esc)" : "Fechar"} onClick={() => playMode.set(null)}>
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
            title="Voltar no tempo (até 10 s)"
            onInput={(e) => {
              const i = Number((e.target as HTMLInputElement).value);
              setRewind(i);
              engineRef.current?.rewindTo(i);
            }}
          />
          <span class="muted small">{((((rewind ?? hud.history - 1) - (hud.history - 1)) * TICK_MS) / 1000).toFixed(2)} s</span>
          <span class="muted small hide-narrow">pausado · . avança um frame · P continua</span>
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
            launch.current = { origin: near ? [ball.x, ball.y] : p, end: p };
          }}
          onPointerMove={(e) => {
            const p = toWorld(e);
            if (p && launch.current) launch.current.end = p;
          }}
          onPointerUp={() => {
            const l = launch.current;
            launch.current = null;
            const eng = engineRef.current;
            if (!l || !eng) return;
            const [vx, vy] = velocity(l);
            eng.launch(l.origin[0], l.origin[1], vx, vy);
            if (eng.paused) setRewind(eng.history.length - 1);
          }}
        />
        {error && <div class="play-error">O mapa não carrega: {error}</div>}
        {settings.stats && <pre class="net-stats">{hud.stats}</pre>}
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
            placeholder="Enter para comandos: /extrapolation 100, /lag 150, /help"
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
