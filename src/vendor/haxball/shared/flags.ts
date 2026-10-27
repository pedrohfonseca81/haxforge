// Collision flags, same bit layout as HaxBall's .hbs format.
export const Flag = {
  ball: 1,
  red: 2,
  blue: 4,
  redKO: 8,
  blueKO: 16,
  wall: 32,
  all: 63,
  kick: 64,
  score: 128,
  c0: 1 << 28,
  c1: 1 << 29,
  c2: 1 << 30,
  c3: 1 << 31,
} as const;

export type FlagName = keyof typeof Flag;

// Like HaxBall, unknown names are ignored.
export function parseFlags(names: unknown, fallback: number): number {
  if (names == null) return fallback;
  if (!Array.isArray(names)) throw new Error("collision flags must be an array");
  let bits = 0;
  for (const name of names) bits |= Flag[name as FlagName] ?? 0;
  return bits;
}

// Default collision mask for a player disc (ball | red | blue | wall).
export const PLAYER_CMASK = 39;
