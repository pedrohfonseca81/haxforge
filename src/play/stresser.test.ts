import { describe, expect, test } from "bun:test";
import { compileStadium } from "../vendor/haxball/shared/stadium";
import { autoStressSegment, simulateStressBurst, simulateStressTrajectory } from "./stresser";

const testStadium = compileStadium({
  name: "wall-test",
  width: 500,
  height: 500,
  spawnDistance: 100,
  goals: [],
  discs: [],
  planes: [],
  joints: [],
  segments: [
    { v0: 0, v1: 1, cMask: ["ball"], cGroup: ["wall"], bias: 0 }
  ],
  vertexes: [
    { x: 0, y: -200, cMask: ["ball"], cGroup: ["wall"] },
    { x: 0, y: 200, cMask: ["ball"], cGroup: ["wall"] }
  ]
});

describe("wall stresser", () => {
  test("detects breach when a high-speed ball tunnels through a thin wall", () => {
    // High speed shot straight into the wall at x = 0
    const highSpeed = simulateStressTrajectory(testStadium, -30, 0, 30, 0);
    expect(highSpeed.breach).not.toBeNull();
    expect(highSpeed.breach?.wallType).toBe("segment");
    expect(highSpeed.breach?.wallIndex).toBe(0);
    expect(highSpeed.breach?.hit[0]).toBeCloseTo(0, 1);
  });

  test("confirms safe bounce when shot speed is low enough", () => {
    // Gentle shot into the wall bounces back properly
    const lowSpeed = simulateStressTrajectory(testStadium, -30, 0, 5, 0);
    expect(lowSpeed.breach).toBeNull();
    // After bounce, ball stays on negative x side
    const lastX = lowSpeed.points[lowSpeed.points.length - 1][0];
    expect(lastX).toBeLessThan(0);
  });

  test("never produces false positives on angled bounces against straight segments", () => {
    for (const angleDeg of [-45, -30, -15, 0, 15, 30, 45]) {
      const rad = (angleDeg * Math.PI) / 180;
      const speed = 6;
      const vx = Math.cos(rad) * speed;
      const vy = Math.sin(rad) * speed;
      const res = simulateStressTrajectory(testStadium, -35, 0, vx, vy);
      expect(res.breach).toBeNull();
      const lastX = res.points[res.points.length - 1][0];
      expect(lastX).toBeLessThan(0);
    }
  });

  test("simulateStressBurst runs single pattern with exactly 1 clean line", () => {
    const burst = simulateStressBurst(testStadium, [-15, 0], [10, 0], "single", 26);
    expect(burst.trajectories.length).toBe(1);
    expect(burst.totalBreaches).toBe(1);
    expect(burst.minBreachSpeed).toBeCloseTo(25.7, 0);
    expect(burst.breachedWalls.has(0)).toBe(true);
  });

  test("simulateStressBurst runs fan pattern with 3 rays", () => {
    const burst = simulateStressBurst(testStadium, [-15, 0], [10, 0], "fan", 26);
    expect(burst.trajectories.length).toBe(3);
    expect(burst.totalBreaches).toBeGreaterThan(0);
    expect(burst.minBreachSpeed).toBeGreaterThan(0);
    expect(burst.breachedWalls.has(0)).toBe(true);
  });

  test("simulateStressBurst runs radial pattern with 8 rays", () => {
    const burst = simulateStressBurst(testStadium, [-15, 0], [10, 0], "radial", 26);
    expect(burst.trajectories.length).toBe(8);
    expect(burst.totalBreaches).toBeGreaterThan(0);
  });

  test("autoStressSegment detects vulnerabilities and offers recommendations", () => {
    const res = autoStressSegment(testStadium, 0);
    expect(res.totalTests).toBeGreaterThan(0);
    expect(res.breachCount).toBeGreaterThan(0);
    expect(res.isSecure).toBe(false);
    expect(res.tips.length).toBeGreaterThan(0);
  });
});
