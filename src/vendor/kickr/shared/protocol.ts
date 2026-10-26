// Netcode modeled on HaxBall's:
// - Clients stamp each input with the server frame they expect it to arrive at
//   (estimated from ping/pong clock samples).
// - The server schedules it at that frame (clamped to [now, now+20], with an
//   INPUT_DELAY jitter buffer), rebroadcasts it immediately, and streams frame
//   numbers as it advances. Clients advance their confirmed state with them.
// - Clients render ahead of the confirmed state (see client/sim.ts).
import type { Game, Team } from "./game";
import type { Stadium } from "./stadium";

export const TICK_MS = 1000 / 60;
export const FRAMES_PER_MS = 0.06;
export const INPUT_DELAY = 4; // frames, HaxBall host default
export const MAX_AHEAD = 20; // frames an input may be scheduled into the future
export const SNAPSHOT_EVERY = 120; // frames (~2s)

// An input event scheduled at frame f: applied when the state is at frame f,
// right before stepping to f+1. s is the sender's sequence number.
export interface InputEvent {
  f: number;
  id: number;
  i: number;
  s: number;
}

export const MAX_STADIUM_BYTES = 1_000_000;
export const MAX_NAME = 25;
export const MAX_CHAT = 140;
export const MAX_AVATAR = 2; // characters, like HaxBall

// "auto": official room run by the server (queue, auto teams, no admins).
// "classic": HaxBall's room, run by its admins.
export type RoomMode = "auto" | "classic";

// One row of the room list.
export interface RoomSummary {
  id: string;
  name: string;
  mode: RoomMode;
  players: number;
  maxPlayers: number;
  password: boolean;
  mobile: boolean; // mobile players allowed
  stadium: string;
  community: boolean; // listed by a self-hosted server
  region: string;
  url?: string; // websocket URL of a community room
}

export interface PlayerMeta {
  ping: number;
  mobile: boolean;
  avatar: string;
  afk: boolean;
}

// HaxBall's /colors: stripe angle (degrees), avatar text color, 1-3 stripes.
export interface TeamColors {
  angle: number;
  text: number;
  stripes: number[];
}

export const DEFAULT_COLORS: [TeamColors, TeamColors] = [
  { angle: 0, text: 0xffffff, stripes: [0xe56e56] },
  { angle: 0, text: 0xffffff, stripes: [0x5689e5] },
];

// Room state outside the simulation (HaxBall's room view).
export interface RoomInfo {
  id: string;
  name: string;
  mode: RoomMode;
  maxPlayers: number;
  mobile: boolean;
  password: boolean;
  admins: number[];
  teamsLocked: boolean;
  stadiums: string[]; // built-in stadium names (classic rooms)
  meta: Record<number, PlayerMeta>;
  colors: [TeamColors, TeamColors]; // red, blue
  // Auto rooms: players waiting for the next game, in order.
  queue: number[];
  teamSize: number;
}

// Why a join was refused.
export type DenyReason = "full" | "password" | "banned" | "mobile" | "room";

export type ClientMsg =
  | { t: "join"; name: string; password?: string; mobile?: boolean; avatar?: string }
  // Admin (or anyone moving themselves while teams are unlocked).
  | { t: "team"; id: number; team: Team }
  // Admin only.
  | { t: "start" }
  | { t: "stop" }
  | { t: "pause"; paused: boolean }
  | { t: "limits"; score: number; time: number }
  | { t: "lock"; locked: boolean }
  | { t: "admin"; id: number; admin: boolean }
  | { t: "kick"; id: number; ban: boolean; reason?: string }
  | { t: "colors"; team: 1 | 2; colors: TeamColors }
  | { t: "stadium"; name: string }
  | { t: "stadiumFile"; hbs: string }
  // Anyone.
  | { t: "avatar"; avatar: string }
  | { t: "input"; i: number; f: number; s: number }
  | { t: "chat"; text: string }
  | { t: "lag"; ms: number }
  // rtt: the client's last measured round trip, shown to others as its ping.
  | { t: "ping"; c: number; rtt?: number };

// System messages are translation keys plus parameters (see client/i18n).
export interface SysText {
  key: string;
  params?: Record<string, string | number>;
}

export type ServerMsg =
  | { t: "welcome"; you: number; stadium: Stadium; game: Game; events: InputEvent[]; room: RoomInfo; lag: number }
  | { t: "denied"; reason: DenyReason }
  | { t: "kicked"; ban: boolean; by: string | null; reason: string }
  | { t: "room"; room: RoomInfo }
  // Sent before the snapshot that goes with it.
  | { t: "stadium"; stadium: Stadium }
  | { t: "ev"; ev: InputEvent }
  | { t: "f"; f: number }
  // periodic: routine resync (a mismatch means desync); otherwise a roster change.
  | { t: "snap"; game: Game; events: InputEvent[]; periodic: boolean }
  // f: fractional server frame when the ping arrived, plus INPUT_DELAY.
  | { t: "pong"; c: number; f: number }
  // A goal at confirmed frame f: scorer/assist are player ids (own = own goal).
  | { t: "goal"; f: number; team: 1 | 2; scorer: number | null; assist: number | null; own: boolean }
  | { t: "chat"; from: number; name: string; text: string }
  | ({ t: "sys"; level?: "info" | "warn" } & SysText);
