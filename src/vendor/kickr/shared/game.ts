// Match simulation: player input, kicks, kickoff barrier, goals, clock.
// Mirrors HaxBall's game step. Everything here is deterministic and the whole
// state is plain JSON, so it can be cloned, snapshotted and re-simulated.
import { Flag, PLAYER_CMASK } from "./flags";
import { stepWorld, type Disc } from "./physics";
import type { Stadium } from "./stadium";

export const Input = { up: 1, down: 2, left: 4, right: 8, kick: 16 } as const;

export type Team = 0 | 1 | 2; // spectator, red, blue

export const Phase = { Kickoff: 0, Playing: 1, Goal: 2, Ended: 3 } as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export interface Player {
  id: number;
  name: string;
  team: Team;
  input: number;
  kicking: boolean;
  kickCooldown: number;
  disc: number; // index into Game.discs, -1 when not on the field
}

export interface Game {
  frame: number;
  // False while the room has no game running (HaxBall's "game stopped").
  active: boolean;
  discs: Disc[];
  players: Player[];
  phase: Phase;
  timer: number; // frames left in Goal / Ended phases
  red: number;
  blue: number;
  time: number; // seconds of play, counted like HaxBall (+= 1/60 per frame)
  kickoffTeam: 1 | 2;
  scoreLimit: number;
  timeLimit: number; // minutes
  // HaxBall's pause counter: 120 while paused; unpausing sets 119 and the
  // game stays frozen until it counts down to 0.
  pause: number;
}

const DIAGONAL = 1 / Math.SQRT2;
const KICK_COOLDOWN = 2;
const GOAL_FRAMES = 150;
const END_FRAMES = 300;

export function koFlag(team: 1 | 2): number {
  return team === 1 ? Flag.redKO : Flag.blueKO;
}

export function cloneGame(g: Game): Game {
  return {
    ...g,
    discs: g.discs.map((d) => ({ ...d })),
    players: g.players.map((p) => ({ ...p })),
  };
}

export function createGame(): Game {
  return {
    frame: 0,
    active: false,
    discs: [],
    players: [],
    phase: Phase.Kickoff,
    timer: 0,
    red: 0,
    blue: 0,
    time: 0,
    kickoffTeam: 1,
    scoreLimit: 3,
    timeLimit: 3,
    pause: 0,
  };
}

function removeDisc(g: Game, p: Player): void {
  if (p.disc < 0) return;
  const removed = p.disc;
  g.discs.splice(removed, 1);
  p.disc = -1;
  for (const other of g.players) if (other.disc > removed) other.disc--;
}

// Creates or resets a player's disc at its team's default spot (HaxBall's
// behavior when a player enters the field). Also clears the input.
function placeOnField(g: Game, stadium: Stadium, p: Player): void {
  if (p.team === 0) {
    removeDisc(g, p);
    return;
  }
  p.input = 0;
  if (p.disc < 0) {
    p.disc = g.discs.length;
    g.discs.push({ x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, radius: 0, invMass: 0, damping: 0, bCoef: 0, cMask: 0, cGroup: 0 });
  }
  const d = g.discs[p.disc];
  const pp = stadium.playerPhysics;
  d.radius = pp.radius;
  d.invMass = pp.invMass;
  d.damping = pp.damping;
  d.bCoef = pp.bCoef;
  d.cMask = PLAYER_CMASK;
  d.cGroup = (p.team === 1 ? Flag.red : Flag.blue) | pp.cGroup;
  // Like HaxBall, a player entering mid-game starts at the stadium's edge
  // behind their goal (or the team's last spawn point).
  const spawns = p.team === 1 ? stadium.redSpawnPoints : stadium.blueSpawnPoints;
  if (spawns.length === 0) {
    d.x = (p.team === 1 ? -1 : 1) * stadium.width;
    d.y = 0;
  } else {
    [d.x, d.y] = spawns[spawns.length - 1];
  }
  d.vx = 0;
  d.vy = 0;
  d.gx = pp.gx;
  d.gy = pp.gy;
}

function resetPositions(g: Game, stadium: Stadium): void {
  g.phase = Phase.Kickoff;
  const resetCount = stadium.kickOffResetFull ? stadium.discs.length : 1;
  for (let i = 0; i < resetCount; i++) {
    const { color: _, ...def } = stadium.discs[i];
    Object.assign(g.discs[i], def);
  }

  const count = [0, 0, 0];
  for (const p of g.players) {
    placeOnField(g, stadium, p);
    if (p.team === 0) continue;
    const d = g.discs[p.disc];
    const q = count[p.team];
    const spawns = p.team === 1 ? stadium.redSpawnPoints : stadium.blueSpawnPoints;
    if (spawns.length === 0) {
      let h = (q + 1) >> 1;
      if ((q & 1) === 0) h = -h;
      d.x = (p.team === 1 ? -1 : 1) * stadium.spawnDistance;
      d.y = 55 * h;
    } else {
      [d.x, d.y] = spawns[Math.min(q, spawns.length - 1)];
    }
    count[p.team]++;
  }
}

export function startGame(g: Game, stadium: Stadium): void {
  g.active = true;
  g.discs = stadium.discs.map(({ color: _, ...d }) => ({ ...d }));
  for (const p of g.players) {
    p.disc = -1;
    p.kicking = false;
    p.kickCooldown = 0;
  }
  g.red = 0;
  g.blue = 0;
  g.time = 0;
  g.timer = 0;
  g.kickoffTeam = 1;
  g.pause = 0;
  resetPositions(g, stadium);
}

export function stopGame(g: Game): void {
  g.active = false;
  g.pause = 0;
  g.discs = [];
  g.phase = Phase.Kickoff;
  for (const p of g.players) p.disc = -1;
}

const PAUSE_FRAMES = 120;

export function setPaused(g: Game, paused: boolean): void {
  if (!g.active) return;
  if (paused) g.pause = PAUSE_FRAMES;
  else if (g.pause === PAUSE_FRAMES) g.pause = PAUSE_FRAMES - 1;
}

export function isPaused(g: Game): boolean {
  return g.pause === PAUSE_FRAMES;
}

export function setPlayerTeam(g: Game, stadium: Stadium, playerId: number, team: Team): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p || p.team === team) return;
  p.team = team;
  if (g.active) placeOnField(g, stadium, p);
}

export function removePlayer(g: Game, playerId: number): void {
  const p = g.players.find((x) => x.id === playerId);
  if (!p) return;
  removeDisc(g, p);
  g.players = g.players.filter((x) => x !== p);
}

export function applyInput(g: Game, playerId: number, input: number): void {
  const p = g.players.find((p) => p.id === playerId);
  if (!p) return;
  if (!(p.input & Input.kick) && input & Input.kick) p.kicking = true;
  p.input = input;
}

function tryKick(player: Disc, ball: Disc, stadium: Stadium): boolean {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist - ball.radius - player.radius >= 4) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  const pp = stadium.playerPhysics;
  ball.vx += pp.kickStrength * nx * ball.invMass;
  ball.vy += pp.kickStrength * ny * ball.invMass;
  player.vx += -pp.kickback * nx * player.invMass;
  player.vy += -pp.kickback * ny * player.invMass;
  return true;
}

function crossesGoal(goalX0: number, goalY0: number, goalX1: number, goalY1: number, ax: number, ay: number, bx: number, by: number): boolean {
  let ex = bx - ax;
  let ey = by - ay;
  if (0 < ey * (goalX0 - ax) - ex * (goalY0 - ay) === 0 < ey * (goalX1 - ax) - ex * (goalY1 - ay)) return false;
  ex = goalX1 - goalX0;
  ey = goalY1 - goalY0;
  return 0 < ey * (ax - goalX0) - ex * (ay - goalY0) !== 0 < ey * (bx - goalX0) - ex * (by - goalY0);
}

function endMatch(g: Game): void {
  g.phase = Phase.Ended;
  g.timer = END_FRAMES;
}

function timeIsUp(g: Game): boolean {
  return g.timeLimit > 0 && g.time >= 60 * g.timeLimit;
}

export function isOvertime(g: Game): boolean {
  return g.active && timeIsUp(g) && g.red === g.blue;
}

export function step(g: Game, stadium: Stadium, dt = 1): void {
  if (!g.active) {
    g.frame++;
    return;
  }
  if (g.pause > 0) {
    if (g.pause < PAUSE_FRAMES) g.pause--;
    g.frame++;
    return;
  }
  const pp = stadium.playerPhysics;

  for (const p of g.players) {
    if (p.disc < 0) continue;
    const d = g.discs[p.disc];
    if (!(p.input & Input.kick)) p.kicking = false;
    if (p.kickCooldown > 0) p.kickCooldown--;
    if (p.kicking && p.kickCooldown <= 0) {
      let kicked = false;
      for (let i = 0; i < g.discs.length; i++) {
        const other = g.discs[i];
        if (i !== p.disc && other.cGroup & Flag.kick && tryKick(d, other, stadium)) kicked = true;
      }
      if (kicked) {
        p.kicking = false;
        p.kickCooldown = KICK_COOLDOWN;
      }
    }

    let mx = ((p.input & Input.right) > 0 ? 1 : 0) - ((p.input & Input.left) > 0 ? 1 : 0);
    let my = ((p.input & Input.down) > 0 ? 1 : 0) - ((p.input & Input.up) > 0 ? 1 : 0);
    if (mx !== 0 && my !== 0) {
      mx *= DIAGONAL;
      my *= DIAGONAL;
    }
    if (mx !== 0 || my !== 0) {
      const acc = p.kicking ? pp.kickingAcceleration : pp.acceleration;
      d.vx += mx * acc;
      d.vy += my * acc;
    }
    d.damping = p.kicking ? pp.kickingDamping : pp.damping;
  }

  // Scoring discs' positions before the step, to detect goal-line crossings.
  const scorers: { i: number; x: number; y: number }[] = [];
  g.discs.forEach((d, i) => {
    if (d.cGroup & Flag.score) scorers.push({ i, x: d.x, y: d.y });
  });

  stepWorld(g.discs, stadium, dt);

  switch (g.phase) {
    case Phase.Kickoff: {
      const ko = koFlag(g.kickoffTeam);
      for (const p of g.players) if (p.disc >= 0) g.discs[p.disc].cMask = PLAYER_CMASK | ko;
      const ball = g.discs[0];
      if (ball.vx * ball.vx + ball.vy * ball.vy > 0) g.phase = Phase.Playing;
      break;
    }
    case Phase.Playing: {
      g.time += 0.016666666666666666;
      for (const p of g.players) if (p.disc >= 0) g.discs[p.disc].cMask = PLAYER_CMASK;
      let goal = -1;
      for (const s of scorers) {
        const d = g.discs[s.i];
        goal = stadium.goals.findIndex((gl) => crossesGoal(gl.x0, gl.y0, gl.x1, gl.y1, s.x, s.y, d.x, d.y));
        if (goal >= 0) break;
      }
      if (goal >= 0) {
        const conceded = stadium.goals[goal].team;
        g.phase = Phase.Goal;
        g.timer = GOAL_FRAMES;
        g.kickoffTeam = conceded;
        if (conceded === 1) g.blue++;
        else g.red++;
      } else if (timeIsUp(g) && g.red !== g.blue) {
        endMatch(g);
      }
      break;
    }
    case Phase.Goal: {
      g.timer--;
      if (g.timer <= 0) {
        const scoreReached = g.scoreLimit > 0 && (g.red >= g.scoreLimit || g.blue >= g.scoreLimit);
        if (scoreReached || (timeIsUp(g) && g.red !== g.blue)) endMatch(g);
        else resetPositions(g, stadium);
      }
      break;
    }
    case Phase.Ended: {
      g.timer--;
      if (g.timer <= 0) stopGame(g);
      break;
    }
  }

  g.frame++;
}
