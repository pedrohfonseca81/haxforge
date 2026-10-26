// Client side of the HaxBall netcode.
//
// - confirmed: the server-ordered state, advanced by frame messages.
// - queue: input events the server already scheduled for future frames.
// - pending: our own inputs sent but not yet echoed by the server.
// - clock: ping/pong samples give the server frame at which a message sent
//   now will arrive (server frame + one-way latency + INPUT_DELAY).
//
// Rendering (like HaxBall's client): copy the confirmed state and simulate up
// to clock(now + extrapolation), applying queued and pending events at their
// frames; the last step is fractional so motion is smooth at any refresh rate.
// With /extrapolation 0 that already shows our own input immediately; other
// players' inputs show up late (their latency), so they can be mispredicted.
import { applyInput, cloneGame, step, type Game } from "../shared/game";
import { FRAMES_PER_MS, type InputEvent } from "../shared/protocol";
import type { Stadium } from "../shared/stadium";

export const EXTRAPOLATION_MIN = -200;
export const EXTRAPOLATION_MAX = 1000;
const MAX_PREDICTED_FRAMES = 120;
const CLOCK_SAMPLES = 50;

export class ClientSim {
  confirmed: Game;
  desyncs = 0;
  // Called after each confirmed step with the state before and after it.
  onStep: ((before: Game, after: Game) => void) | null = null;
  private queue: InputEvent[];
  private pending: InputEvent[] = [];
  private clockSamples: number[] = [];
  private clockOffset = 0;
  private seq = 0;

  constructor(
    // Replaced by the server only while the game is stopped.
    public stadium: Stadium,
    readonly myId: number,
    game: Game,
    events: InputEvent[],
  ) {
    this.confirmed = game;
    this.queue = [...events];
  }

  get synced(): boolean {
    return this.clockSamples.length > 0;
  }

  onPong(sentAt: number, serverFrame: number): void {
    this.clockSamples.push(serverFrame - sentAt * FRAMES_PER_MS);
    if (this.clockSamples.length > CLOCK_SAMPLES) this.clockSamples.shift();
    const sorted = [...this.clockSamples].sort((a, b) => a - b);
    this.clockOffset = sorted[sorted.length >> 1];
  }

  // Estimated server frame at which a message sent at `now` is applied.
  serverFrameAt(now: number): number {
    return now * FRAMES_PER_MS + this.clockOffset;
  }

  // Frames to simulate past the confirmed state to render at `now`.
  framesAhead(now: number, extrapolationMs: number): number {
    if (!this.synced) return 0;
    const m = this.serverFrameAt(now + extrapolationMs) - this.confirmed.frame;
    return Math.max(0, Math.min(MAX_PREDICTED_FRAMES, m));
  }

  // Records a local input and returns the message fields to send.
  localInput(input: number, now: number): InputEvent {
    const j = this.confirmed.frame;
    const ahead = Math.max(0, Math.min(MAX_PREDICTED_FRAMES, Math.floor(this.serverFrameAt(now) - j)));
    const ev: InputEvent = { f: j + ahead, id: this.myId, i: input, s: ++this.seq };
    this.pending.push(ev);
    return ev;
  }

  // True while one of our inputs is still on its way to the confirmed state.
  inputInFlight(): boolean {
    return this.pending.length > 0 || this.queue.some((e) => e.id === this.myId);
  }

  onEvent(ev: InputEvent): void {
    this.queue.push(ev);
    if (ev.id === this.myId) this.pending = this.pending.filter((p) => p.s > ev.s);
  }

  onFrame(f: number): void {
    while (this.confirmed.frame < f) {
      const now = this.confirmed.frame;
      this.queue = this.queue.filter((e) => {
        if (e.f > now) return true;
        applyInput(this.confirmed, e.id, e.i);
        return false;
      });
      const before = this.onStep ? cloneGame(this.confirmed) : null;
      step(this.confirmed, this.stadium);
      if (before) this.onStep!(before, this.confirmed);
    }
    // Unconfirmed inputs stamped for frames already confirmed were scheduled
    // later by the server; their echo will put them in the queue.
    this.pending = this.pending.filter((p) => p.f >= this.confirmed.frame);
  }

  onSnapshot(game: Game, events: InputEvent[], periodic: boolean): void {
    if (game.frame < this.confirmed.frame) return;
    if (periodic && game.frame === this.confirmed.frame && JSON.stringify(game) !== JSON.stringify(this.confirmed)) {
      this.desyncs++;
    }
    this.confirmed = game;
    this.queue = [...events];
  }

  // The state `ahead` frames past the confirmed one (fractional allowed).
  extrapolate(ahead: number): Game {
    if (ahead <= 0) return this.confirmed;
    const g = cloneGame(this.confirmed);
    // Stable merge by frame; confirmed (queued) events first on ties.
    const events = [...this.queue, ...this.pending].sort((a, b) => a.f - b.f);
    const whole = Math.floor(ahead);
    const last = this.confirmed.frame + whole;
    let next = 0;
    for (let frame = this.confirmed.frame; frame <= last; frame++) {
      while (next < events.length && events[next].f <= frame) {
        applyInput(g, events[next].id, events[next].i);
        next++;
      }
      step(g, this.stadium, frame !== last ? 1 : ahead - whole);
    }
    return g;
  }
}
