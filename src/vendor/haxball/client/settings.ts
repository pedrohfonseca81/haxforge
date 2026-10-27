// Per-browser preferences, saved in localStorage (which may be unavailable).
import { Input } from "../shared/game";
import { EXTRAPOLATION_MAX, EXTRAPOLATION_MIN } from "./sim";
import { Store } from "./store";

export type RenderStyle = "modern" | "classic";
export type Action = "up" | "down" | "left" | "right" | "kick";

export const ACTION_BITS: Record<Action, number> = {
  up: Input.up,
  down: Input.down,
  left: Input.left,
  right: Input.right,
  kick: Input.kick,
};

export const DEFAULT_KEYS: Record<Action, string[]> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  kick: ["KeyX", "Space"],
};

export interface Settings {
  name: string;
  avatar: string;
  style: RenderStyle;
  viewMode: number;
  extrapolation: number;
  goalReplay: boolean;
  netStats: boolean;
  sfx: number; // 0..1
  crowd: number; // 0..1
  keys: Record<Action, string[]>;
  chatHeight: number | null;
}

const DEFAULTS: Settings = {
  name: "",
  avatar: "",
  style: "classic",
  viewMode: -1,
  extrapolation: 0,
  goalReplay: true,
  netStats: false,
  sfx: 0.7,
  crowd: 0.4,
  keys: DEFAULT_KEYS,
  chatHeight: null,
};

const STORAGE_KEY = "haxforge.sim.settings";

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Settings>;
    const s = { ...DEFAULTS, ...saved, keys: { ...DEFAULT_KEYS, ...saved.keys } };
    s.extrapolation = clampExtrapolation(s.extrapolation);
    return s;
  } catch {
    return DEFAULTS;
  }
}

export function clampExtrapolation(v: number): number {
  return Math.max(EXTRAPOLATION_MIN, Math.min(EXTRAPOLATION_MAX, Math.round(Number(v) || 0)));
}

export const settings = new Store<Settings>(load());

settings.subscribe((s) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
});

// Input bits for a key code under the current bindings.
export function keyBits(code: string): number {
  const { keys } = settings.get();
  let bits = 0;
  for (const action of Object.keys(keys) as Action[]) if (keys[action].includes(code)) bits |= ACTION_BITS[action];
  return bits;
}
