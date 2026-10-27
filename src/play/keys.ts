// Playground keys for one or two local players.
import { Input } from "../vendor/haxball/shared/game";
import { P1, P2 } from "./engine";

// One player: arrows or WASD, kick with X or Space (default controls).
// Two players: player 1 keeps its usual kick keys (X, Space) plus . and right
// Ctrl for the right hand, and moves with the arrows; player 2 moves with WASD
// and kicks with left Shift or Q (keys player 1 never uses).
export function keyMap(two: boolean): Record<string, [number, number]> {
  if (!two) {
    return {
      ArrowUp: [P1, Input.up], KeyW: [P1, Input.up], ArrowDown: [P1, Input.down], KeyS: [P1, Input.down],
      ArrowLeft: [P1, Input.left], KeyA: [P1, Input.left], ArrowRight: [P1, Input.right], KeyD: [P1, Input.right],
      KeyX: [P1, Input.kick], Space: [P1, Input.kick],
    };
  }
  return {
    ArrowUp: [P1, Input.up], ArrowDown: [P1, Input.down], ArrowLeft: [P1, Input.left], ArrowRight: [P1, Input.right],
    KeyX: [P1, Input.kick], Space: [P1, Input.kick], Period: [P1, Input.kick], ControlRight: [P1, Input.kick], Numpad0: [P1, Input.kick],
    KeyW: [P2, Input.up], KeyS: [P2, Input.down], KeyA: [P2, Input.left], KeyD: [P2, Input.right], ShiftLeft: [P2, Input.kick], KeyQ: [P2, Input.kick],
  };
}

