// The bodies that move in a match (the ball and each team's players), with
// the collision flags HaxBall gives them, and what each one bumps into.
import { Flag, PLAYER_CMASK } from "../vendor/haxball/shared/flags";
import { tr } from "../i18n";
import type { Doc } from "./model";
import type { Geo } from "./resolve";

export interface Body {
  key: "ball" | "red" | "blue";
  // With its article, for sentences: "a bola", "o jogador red".
  label: string;
  radius: number;
  cMask: number;
  cGroup: number;
  // Where it starts.
  starts: [number, number][];
}

export const canCollide = (a: { cMask: number; cGroup: number }, b: { cMask: number; cGroup: number }) =>
  (b.cMask & a.cGroup) !== 0 && (b.cGroup & a.cMask) !== 0;

export function bodies(_doc: Doc, geo: Geo): Body[] {
  const out: Body[] = [];
  const ball = geo.ball ?? geo.discs[0] ?? null;
  if (ball) out.push({ key: "ball", label: tr("a bola", "the ball"), radius: ball.radius, cMask: ball.cMask, cGroup: ball.cGroup, starts: [[ball.x, ball.y]] });
  for (const [key, flag, list, side] of [
    ["red", Flag.red, geo.redSpawnPoints, -1],
    ["blue", Flag.blue, geo.blueSpawnPoints, 1],
  ] as const) {
    const pts = list.filter((p) => p !== null);
    out.push({
      key,
      label: key === "red" ? tr("o jogador red", "the red player") : tr("o jogador blue", "the blue player"),
      radius: geo.playerRadius,
      cMask: PLAYER_CMASK,
      cGroup: flag | geo.playerGroup,
      starts: pts.length ? pts : [[side * geo.stadium.spawnDistance, 0]],
    });
  }
  return out;
}

// What a segment does to the moving bodies, for the collision overlay.
export type Role = "all" | "ball" | "players" | "kickoff" | "none";

export function roleOf(wall: { cMask: number; cGroup: number }, bs: Body[]): Role {
  const ball = bs.find((b) => b.key === "ball");
  const hitsBall = !!ball && canCollide(ball, wall);
  const hitsPlayers = bs.some((b) => b.key !== "ball" && canCollide(b, wall));
  if (hitsBall && hitsPlayers) return "all";
  if (hitsBall) return "ball";
  if (hitsPlayers) return "players";
  // During kickoff players also collide with redKO/blueKO walls.
  const ko = bs.some((b) => b.key !== "ball" && canCollide({ cMask: b.cMask | Flag.redKO | Flag.blueKO, cGroup: b.cGroup }, wall));
  return ko ? "kickoff" : "none";
}

export const ROLE_STYLE: Record<Role, { color: string; readonly label: string }> = {
  all: {
    color: "#22d3ee",
    get label() {
      return tr("bola e jogadores", "ball and players");
    },
  },
  ball: {
    color: "#fbbf24",
    get label() {
      return tr("só a bola", "ball only");
    },
  },
  players: {
    color: "#f472b6",
    get label() {
      return tr("só jogadores", "players only");
    },
  },
  kickoff: {
    color: "#a78bfa",
    get label() {
      return tr("barreira do kickoff", "kickoff barrier");
    },
  },
  none: {
    color: "#6b7280",
    get label() {
      return tr("nada (decorativo)", "nothing (decorative)");
    },
  },
};
