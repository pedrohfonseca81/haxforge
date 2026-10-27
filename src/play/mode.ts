// Whether the playground is open, and how.
import { Store } from "../vendor/haxball/client/store";

export type PlayMode = "full" | "split";
export const playMode = new Store<PlayMode | null>(null);
