// The playground: a HaxBall room and its client in the same tab, connected by
// a loopback "network" with artificial latency. The server side is kickr's
// room logic (input scheduling with HaxBall's rules, one game step per frame),
// the client side is kickr's ClientSim, so /extrapolation and /lag behave as
// they do online.
//
// Everything runs on a virtual clock: pausing, slow motion and frame stepping
// slow down the whole universe (server, client and the network) together, so
// the netcode never notices. The server keeps the last seconds of states,
// which is what rewinding restores.
import { ClientSim, EXTRAPOLATION_MAX, EXTRAPOLATION_MIN } from "../vendor/kickr/client/sim";
import { applyInput, cloneGame, createGame, step, startGame, type Game, type Player } from "../vendor/kickr/shared/game";
import { stepWorld } from "../vendor/kickr/shared/physics";
import { FRAMES_PER_MS, INPUT_DELAY, MAX_AHEAD, TICK_MS, type InputEvent } from "../vendor/kickr/shared/protocol";
import type { Stadium } from "../vendor/kickr/shared/stadium";

const LATENESS_WINDOW = 15;
const HISTORY_FRAMES = 600; // 10 s of rewind
const PING_EVERY = 1000;

type ToServer = { t: "input"; id: number; i: number; f: number; s: number } | { t: "ping"; c: number };
type ToClient = { t: "ev"; ev: InputEvent } | { t: "f"; f: number } | { t: "pong"; c: number; f: number };

// Messages delivered after a delay (in virtual milliseconds).
class Pipe<T> {
  private q: { at: number; msg: T }[] = [];
  send(msg: T, at: number): void {
    this.q.push({ at, msg });
  }
  drain(now: number): T[] {
    const out: T[] = [];
    while (this.q.length && this.q[0].at <= now) out.push(this.q.shift()!.msg);
    return out;
  }
  clear(): void {
    this.q = [];
  }
}

export const P1 = 1;
export const P2 = 2;

// A game with no score or time limit, started, with one or two players.
function freshGame(stadium: Stadium, twoPlayers: boolean): Game {
  const g = createGame();
  g.scoreLimit = 0;
  g.timeLimit = 0;
  const player = (id: number, name: string, team: 1 | 2): Player => ({ id, name, team, input: 0, kicking: false, kickCooldown: 0, disc: -1 });
  g.players.push(player(P1, "Você", 1));
  if (twoPlayers) g.players.push(player(P2, "Jogador 2", 2));
  startGame(g, stadium);
  return g;
}

export class Playground {
  // Virtual time (ms) and how fast it runs (0 = paused).
  now = 0;
  speed = 1;
  lag = 0;
  extrapolation = 0;
  stadium: Stadium;

  // Server side.
  game: Game;
  private events: InputEvent[] = [];
  private start = 0;
  private lastFrame = new Map<number, number>();
  private lateness = new Map<number, number[]>();
  history: { game: Game; events: InputEvent[] }[] = [];
  // While paused after a rewind: the history entry being shown. The entries
  // after it are dropped only when time moves on, so scrubbing can go back
  // and forth.
  cursor: number | null = null;

  // Client side.
  sim: ClientSim;
  rtt = 0;
  private up = new Pipe<ToServer>();
  private down = new Pipe<ToClient>();
  private nextPing = 0;
  private seq2 = 0;
  // Inputs held locally, re-sent after kickoffs (HaxBall clears them).
  held = new Map<number, number>();

  constructor(
    stadium: Stadium,
    readonly twoPlayers: boolean,
  ) {
    this.stadium = stadium;
    this.game = freshGame(stadium, twoPlayers);
    this.sim = new ClientSim(stadium, P1, cloneGame(this.game), []);
    this.resync();
  }

  get paused(): boolean {
    return this.speed === 0;
  }

  // ---- Clock ---------------------------------------------------------------------

  private clockFrame(at = this.now): number {
    return (at - this.start) * FRAMES_PER_MS;
  }

  // Advances the virtual clock by a wall-clock delta, running everything due.
  advance(wallMs: number): void {
    this.now += Math.min(100, wallMs) * this.speed;
    this.pump();
  }

  // One frame forward, while paused.
  stepFrame(): void {
    this.now += TICK_MS;
    this.pump();
  }

  private pump(): void {
    for (const m of this.up.drain(this.now)) this.serverReceive(m);
    this.serverTick();
    for (const m of this.down.drain(this.now)) this.clientReceive(m);
    if (this.now >= this.nextPing) {
      this.nextPing = this.now + PING_EVERY;
      this.toServer({ t: "ping", c: this.now });
    }
    // HaxBall resets inputs on every kickoff; re-send keys still held.
    const c = this.sim.confirmed;
    for (const [id, input] of this.held) {
      const p = c.players.find((x) => x.id === id);
      if (c.active && p && p.team !== 0 && p.input !== input && !this.inFlight(id)) this.sendInput(id, input);
    }
  }

  private inFlight(id: number): boolean {
    if (id === P1) return this.sim.inputInFlight();
    return this.p2Sent > this.p2Received || this.p2LastFrame >= this.sim.confirmed.frame;
  }
  // The second player's inputs: sent, echoed back, and the last echo's frame.
  private p2Sent = 0;
  private p2Received = 0;
  private p2LastFrame = -1;

  private toServer(m: ToServer): void {
    this.up.send(m, this.now + this.lag / 2);
  }
  private toClient(m: ToClient): void {
    this.down.send(m, this.now + this.lag / 2);
  }

  // ---- Client ----------------------------------------------------------------------

  setInput(id: number, input: number): void {
    if (this.held.get(id) === input) return;
    this.held.set(id, input);
    this.sendInput(id, input);
  }

  private sendInput(id: number, input: number): void {
    if (id === P1) {
      const ev = this.sim.localInput(input, this.now);
      this.toServer({ t: "input", id, i: input, f: ev.f, s: ev.s });
    } else {
      // A second local player is just another input stream on the same connection.
      const f = Math.floor(this.sim.serverFrameAt(this.now));
      this.p2Sent++;
      this.toServer({ t: "input", id, i: input, f, s: ++this.seq2 });
    }
  }

  private clientReceive(m: ToClient): void {
    if (m.t === "ev") {
      if (m.ev.id === P2) {
        this.p2Received++;
        this.p2LastFrame = m.ev.f;
      }
      this.sim.onEvent(m.ev);
    } else if (m.t === "f") this.sim.onFrame(m.f);
    else {
      this.rtt = this.now - m.c;
      this.sim.onPong(m.c, m.f);
    }
  }

  // Frames past the confirmed state that the screen shows now.
  framesAhead(): number {
    return this.sim.framesAhead(this.now, this.extrapolation);
  }

  // The state to draw.
  view(): Game {
    return this.sim.extrapolate(this.framesAhead());
  }

  // ---- Server ---------------------------------------------------------------------------

  private serverReceive(m: ToServer): void {
    if (m.t === "ping") {
      this.toClient({ t: "pong", c: m.c, f: this.clockFrame() + INPUT_DELAY });
      return;
    }
    // HaxBall's host scheduling (see kickr's Room.scheduleInput).
    const j = this.game.frame;
    let frame = Math.max(j, Math.min(j + MAX_AHEAD, m.f));
    const expected = j + INPUT_DELAY;
    const late = m.f - expected;
    const lateness = this.lateness.get(m.id) ?? [];
    if (late < -INPUT_DELAY - 3) frame = expected;
    else {
      lateness.push(Math.max(-INPUT_DELAY, Math.min(INPUT_DELAY, late)));
      if (lateness.length > LATENESS_WINDOW) lateness.shift();
    }
    this.lateness.set(m.id, lateness);
    const avg = lateness.reduce((a, b) => a + b, 0) / LATENESS_WINDOW;
    if (frame < expected && avg < -0.85) frame = expected;
    frame = Math.max(frame, this.lastFrame.get(m.id) ?? 0);
    this.lastFrame.set(m.id, frame);
    const ev: InputEvent = { f: frame, id: m.id, i: m.i, s: m.s };
    this.events.push(ev);
    this.toClient({ t: "ev", ev });
  }

  private serverTick(): void {
    const target = Math.floor(this.clockFrame());
    let budget = 30;
    while (this.game.frame < target && budget-- > 0) {
      const g = this.game;
      const now = g.frame;
      this.events = this.events.filter((e) => {
        if (e.f > now) return true;
        applyInput(g, e.id, e.i);
        return false;
      });
      step(g, this.stadium);
      if (this.cursor !== null) {
        this.history = this.history.slice(0, this.cursor + 1);
        this.cursor = null;
      }
      this.history.push({ game: cloneGame(g), events: this.events.map((e) => ({ ...e })) });
      if (this.history.length > HISTORY_FRAMES) this.history.shift();
      this.toClient({ t: "f", f: g.frame });
    }
    if (this.game.frame < target) this.start = this.now - this.game.frame * TICK_MS;
  }

  // ---- Resync (rewind, hot reload, /lag, launches) --------------------------------------------

  // Throws away what is in flight and restarts the client from the server's
  // state, with its clock already synced to the current lag.
  resync(): void {
    this.up.clear();
    this.down.clear();
    this.lastFrame.clear();
    this.lateness.clear();
    this.p2Sent = this.p2Received = 0;
    this.p2LastFrame = -1;
    this.start = this.now - this.game.frame * TICK_MS;
    this.sim = new ClientSim(this.stadium, P1, cloneGame(this.game), this.events.map((e) => ({ ...e })));
    // The pong a ping sent now would bring back.
    this.sim.onPong(this.now, this.clockFrame(this.now + this.lag / 2) + INPUT_DELAY);
    this.rtt = this.lag;
    this.nextPing = this.now + PING_EVERY;
    // Held keys are sent again on the next pump.
    for (const p of this.game.players) p.input = 0;
    this.sim.confirmed.players.forEach((p) => (p.input = 0));
  }

  setLag(ms: number): void {
    this.lag = Math.max(0, Math.min(2000, Math.round(ms)));
    this.resync();
  }

  setExtrapolation(ms: number): void {
    this.extrapolation = Math.max(EXTRAPOLATION_MIN, Math.min(EXTRAPOLATION_MAX, Math.round(ms)));
  }

  // Back to a recorded frame (only while paused).
  rewindTo(index: number): void {
    const h = this.history[index];
    if (!h) return;
    this.cursor = index;
    this.game = cloneGame(h.game);
    this.events = h.events.map((e) => ({ ...e }));
    this.resync();
  }

  restart(): void {
    this.game = freshGame(this.stadium, this.twoPlayers);
    this.events = [];
    this.history = [];
    this.cursor = null;
    this.resync();
  }

  // ---- Ball launcher -----------------------------------------------------------------------------

  // Puts the ball at (x, y) with velocity (vx, vy).
  launch(x: number, y: number, vx: number, vy: number): void {
    const ball = this.game.discs[0];
    if (!ball) return;
    Object.assign(ball, { x, y, vx, vy });
    this.resync();
  }

  // Where the ball goes from (x, y) at (vx, vy) if nobody touches it.
  predict(x: number, y: number, vx: number, vy: number, frames = 240): [number, number][] {
    const discs = this.game.discs.map((d) => ({ ...d }));
    if (!discs[0]) return [];
    Object.assign(discs[0], { x, y, vx, vy });
    const out: [number, number][] = [[x, y]];
    for (let i = 0; i < frames; i++) {
      stepWorld(discs, this.stadium);
      out.push([discs[0].x, discs[0].y]);
      if (Math.abs(discs[0].vx) + Math.abs(discs[0].vy) < 0.01) break;
    }
    return out;
  }

  // ---- Hot reload --------------------------------------------------------------------------------

  // Swaps in an edited stadium, keeping the match going: stadium discs keep
  // their motion unless their definition changed, players keep theirs.
  swapStadium(next: Stadium): void {
    const prev = this.stadium;
    const g = this.game;
    if (g.active) {
      const oldN = prev.discs.length;
      const newN = next.discs.length;
      const stadiumDiscs = next.discs.map(({ color: _, ...def }, i) => {
        const old = g.discs[i];
        const oldDef = prev.discs[i];
        if (i < oldN && old && oldDef && JSON.stringify(oldDef) === JSON.stringify(next.discs[i])) return old;
        return { ...def };
      });
      const players = g.discs.slice(oldN);
      const pp = next.playerPhysics;
      for (const d of players) Object.assign(d, { radius: pp.radius, invMass: pp.invMass, bCoef: pp.bCoef, damping: pp.damping, gx: pp.gx, gy: pp.gy });
      g.discs = [...stadiumDiscs, ...players];
      for (const p of g.players) if (p.disc >= 0) p.disc += newN - oldN;
    }
    this.stadium = next;
    this.history = [];
    this.cursor = null;
    this.resync();
  }
}
