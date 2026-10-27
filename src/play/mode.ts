// Whether the playground is open, and how.
import { Store } from "../vendor/haxball/client/store";

export type PlayMode = "full" | "split";
export const playMode = new Store<PlayMode | null>(null);

export type PlaygroundTool = "launcher" | "stresser";
export const playgroundTool = new Store<PlaygroundTool>("launcher");
export const stressTargetSegment = new Store<number | null>(null);
