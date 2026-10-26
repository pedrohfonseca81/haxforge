import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Input } from "../vendor/kickr/shared/game";
import { parseStadium } from "../vendor/kickr/shared/stadium";
import { P1, P2, Playground } from "./engine";

const classic = parseStadium(readFileSync(join(import.meta.dir, "../vendor/kickr/shared/stadiums/classic.hbs"), "utf8"));

const run = (pg: Playground, ms: number) => {
  for (let t = 0; t < ms; t += 16) pg.advance(16);
};
const discOf = (pg: Playground, id: number) => {
  const p = pg.game.players.find((x) => x.id === id)!;
  return pg.game.discs[p.disc];
};

describe("playground", () => {
  test("a held key moves the player, through the loopback", () => {
    const pg = new Playground(classic, false);
    const x0 = discOf(pg, P1).x;
    pg.setInput(P1, Input.right);
    run(pg, 1000);
    expect(discOf(pg, P1).x).toBeGreaterThan(x0 + 50);
    // The client agrees with the server on the confirmed frames.
    expect(pg.sim.confirmed.frame).toBeLessThanOrEqual(pg.game.frame);
  });

  test("with lag, the confirmed state trails and extrapolation covers it", () => {
    const pg = new Playground(classic, false);
    pg.setLag(300);
    run(pg, 2000);
    const behind = pg.game.frame - pg.sim.confirmed.frame;
    expect(behind).toBeGreaterThanOrEqual(8);
    expect(behind).toBeLessThanOrEqual(11);
    // At /extrapolation 0 the client renders where an input sent now lands.
    expect(pg.framesAhead()).toBeGreaterThan(behind);
  });

  test("a second local player plays as its own input stream", () => {
    const pg = new Playground(classic, true);
    const x0 = discOf(pg, P2).x;
    pg.setInput(P2, Input.left);
    run(pg, 1000);
    expect(discOf(pg, P2).x).toBeLessThan(x0 - 50);
  });

  test("paused time does not move; stepping moves one frame", () => {
    const pg = new Playground(classic, false);
    run(pg, 500);
    pg.speed = 0;
    const f = pg.game.frame;
    run(pg, 500);
    expect(pg.game.frame).toBe(f);
    pg.stepFrame();
    expect(pg.game.frame).toBe(f + 1);
  });

  test("rewinding restores an earlier state, and replaying it is deterministic", () => {
    const pg = new Playground(classic, false);
    pg.launch(0, 0, 6, 2.5);
    run(pg, 1500);
    const mid = pg.history.length - 60;
    const at = { ...pg.history[mid].game.discs[0] };
    const later = { ...pg.history[mid + 30].game.discs[0] };
    pg.speed = 0;
    pg.rewindTo(mid);
    expect(pg.game.discs[0].x).toBe(at.x);
    for (let i = 0; i < 30; i++) pg.stepFrame();
    expect(pg.game.discs[0].x).toBe(later.x);
    expect(pg.game.discs[0].y).toBe(later.y);
  });

  test("the launcher's prediction is where the ball really goes", () => {
    const pg = new Playground(classic, false);
    const path = pg.predict(-100, 0, 8, 3, 90);
    pg.launch(-100, 0, 8, 3);
    pg.speed = 0;
    for (let i = 0; i < 90; i++) pg.stepFrame();
    const ball = pg.game.discs[0];
    const [px, py] = path[path.length - 1];
    expect(Math.hypot(ball.x - px, ball.y - py)).toBeLessThan(1e-9);
  });
});

test("two players: player 1 keeps Space and X; player 2's keys never move player 1", async () => {
  const { keyMap } = await import("./keys");
  const two = keyMap(true);
  expect(two.Space).toEqual([P1, Input.kick]);
  expect(two.KeyX).toEqual([P1, Input.kick]);
  expect(two.ShiftLeft).toEqual([P2, Input.kick]);
  expect(Object.values(two).filter(([id]) => id === P2).length).toBe(6);
  expect(keyMap(false).Space).toEqual([P1, Input.kick]);
});
