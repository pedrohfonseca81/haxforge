// Wall Stresser: deterministic simulation of high-velocity ball trajectories to
// test if walls leak, tunnel or clip ("se a bola vara a parede").
// Uses HaxBall's exact bit-identical physics engine (stepWorld).
import { stepWorld, type Disc } from "../vendor/haxball/shared/physics";
import type { Segment, Plane, Stadium } from "../vendor/haxball/shared/stadium";
import { Flag } from "../vendor/haxball/shared/flags";
import { tr } from "../i18n";

export type StressPattern = "single" | "fan" | "radial";

export interface Breach {
  frame: number;
  hit: [number, number];
  wallType: "segment" | "plane" | "bounds";
  wallIndex: number;
  speed: number;
  incidentAngleDeg: number;
  description: string;
}

export interface StressTrajectory {
  points: [number, number][];
  speed: number;
  angleDeg: number;
  breach: Breach | null;
  bounces: [number, number][];
}

export interface StressBurstResult {
  trajectories: StressTrajectory[];
  totalBreaches: number;
  minBreachSpeed: number | null;
  breachedWalls: Set<number>;
  summary: string;
}

export interface BallDef {
  radius?: number;
  invMass?: number;
  damping?: number;
  bCoef?: number;
  cMask?: number;
  cGroup?: number;
  gx?: number;
  gy?: number;
}

export const DEFAULT_BALL: Required<BallDef> = {
  radius: 10,
  invMass: 1,
  damping: 0.99,
  bCoef: 0.5,
  cMask: Flag.all,
  cGroup: Flag.ball,
  gx: 0,
  gy: 0,
};

const canCollide = (a: { cMask: number; cGroup: number }, b: { cMask: number; cGroup: number }) =>
  (b.cMask & a.cGroup) !== 0 && (b.cGroup & a.cMask) !== 0;

/**
 * Checks whether a single physics step from p1 to p2 breached a straight segment.
 */
/**
 * Checks whether a single physics step from points[frame-1] to points[frame] breached a straight segment.
 *
 * An actual breach (tunneling/varamento) occurs if and only if:
 * 1. The ball crossed the segment line.
 * 2. The crossing point fell strictly within the physical segment endpoints (0 <= u <= 1).
 * 3. The ball REMAINED on the other side in subsequent frames (did not rebound/bounce back).
 * If the ball rebounded back to the approach side, the physics solver resolved the collision,
 * meaning it is a SAFE BOUNCE — NOT a breach!
 */
function checkStraightSegmentBreach(
  s: Segment,
  index: number,
  points: [number, number][],
  frame: number,
  speed: number,
): Breach | null {
  const p1 = points[frame - 1];
  const p2 = points[frame];
  const d1 = s.nx * (p1[0] - s.x1) + s.ny * (p1[1] - s.y1);
  const d2 = s.nx * (p2[0] - s.x1) + s.ny * (p2[1] - s.y1);

  let crossed = false;
  if (s.bias === 0) {
    crossed = (d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0);
  } else if (s.bias > 0) {
    crossed = d1 > 0 && d2 < -s.bias;
  } else {
    crossed = d1 < 0 && d2 > -s.bias;
  }

  if (!crossed) return null;

  // Fraction t along p1 -> p2 where crossing of the infinite wall line occurred
  const t = d1 / (d1 - d2);
  if (t < 0 || t > 1) return null;

  const hitX = p1[0] + t * (p2[0] - p1[0]);
  const hitY = p1[1] + t * (p2[1] - p1[1]);

  // Check if hit point is strictly along the segment AB
  const wx = s.x1 - s.x0;
  const wy = s.y1 - s.y0;
  const wLen2 = wx * wx + wy * wy;
  if (wLen2 === 0) return null;

  const u = ((hitX - s.x0) * wx + (hitY - s.y0) * wy) / wLen2;
  if (u < 0 || u > 1) return null;

  // Trajectory verification: did the ball rebound back to the approach side in subsequent frames?
  const dStart0 = s.nx * (points[0][0] - s.x1) + s.ny * (points[0][1] - s.y1);
  const approachSide = Math.abs(dStart0) > 0.001 ? dStart0 : d1;
  for (let k = frame; k < points.length; k++) {
    const dk = s.nx * (points[k][0] - s.x1) + s.ny * (points[k][1] - s.y1);
    if ((approachSide > 0 && dk > 0) || (approachSide < 0 && dk < 0)) {
      return null; // Bounced back to original approach side! Safe!
    }
  }

  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const vLen = Math.hypot(dx, dy) || 1;
  const dot = Math.abs((dx * s.nx + dy * s.ny) / vLen);
  const incidentAngle = Math.round((Math.asin(Math.min(1, dot)) * 180) / Math.PI);

  return {
    frame,
    hit: [hitX, hitY],
    wallType: "segment",
    wallIndex: index,
    speed: Number(speed.toFixed(2)),
    incidentAngleDeg: incidentAngle,
    description: tr(
      `Segmento #${index} varado com vel. ${speed.toFixed(1)} u/f (incidência ${incidentAngle}°)`,
      `Segment #${index} tunneled with speed ${speed.toFixed(1)} u/f (${incidentAngle}° incident)`,
    ),
  };
}

/**
 * Checks whether a single physics step from points[frame-1] to points[frame] breached a curved segment.
 */
function checkCurvedSegmentBreach(
  s: Segment,
  index: number,
  points: [number, number][],
  frame: number,
  speed: number,
): Breach | null {
  const p1 = points[frame - 1];
  const p2 = points[frame];
  const r1 = Math.hypot(p1[0] - s.cx, p1[1] - s.cy);
  const r2 = Math.hypot(p2[0] - s.cx, p2[1] - s.cy);

  // Crossed the circle radius
  let crossed = (r1 - s.radius) * (r2 - s.radius) < 0;
  if (!crossed) return null;

  const denom = Math.abs(r1 - s.radius) + Math.abs(r2 - s.radius);
  const t = denom > 0 ? Math.abs(r1 - s.radius) / denom : 0.5;
  const hitX = p1[0] + t * (p2[0] - p1[0]);
  const hitY = p1[1] + t * (p2[1] - p1[1]);
  const hx = hitX - s.cx;
  const hy = hitY - s.cy;
  const inArc = 0 < s.t0x * hx + s.t0y * hy && 0 < s.t1x * hx + s.t1y * hy;
  if (inArc === (s.curveF <= 0)) return null; // Outside the physical arc span

  // Trajectory verification: did the ball rebound back to approach side in subsequent frames?
  const rStart0 = Math.hypot(points[0][0] - s.cx, points[0][1] - s.cy);
  const rApproach = Math.abs(rStart0 - s.radius) > 0.001 ? rStart0 : r1;
  for (let k = frame; k < points.length; k++) {
    const rk = Math.hypot(points[k][0] - s.cx, points[k][1] - s.cy);
    if ((rApproach < s.radius && rk < s.radius) || (rApproach > s.radius && rk > s.radius)) {
      return null; // Bounced back! Safe!
    }
  }

  return {
    frame,
    hit: [hitX, hitY],
    wallType: "segment",
    wallIndex: index,
    speed: Number(speed.toFixed(2)),
    incidentAngleDeg: 90,
    description: tr(
      `Arco #${index} varado com vel. ${speed.toFixed(1)} u/f`,
      `Curved segment #${index} tunneled with speed ${speed.toFixed(1)} u/f`,
    ),
  };
}

/**
 * Checks whether the ball leaped out of stadium boundaries.
 */
function checkBoundsBreach(
  stadium: Stadium,
  points: [number, number][],
  frame: number,
  speed: number,
): Breach | null {
  const w = stadium.width;
  const h = stadium.height;
  if (w <= 0 || h <= 0) return null;
  const margin = 20;
  const p1 = points[frame - 1];
  const p2 = points[frame];
  const inside1 = Math.abs(p1[0]) <= w && Math.abs(p1[1]) <= h;
  const outside2 = Math.abs(p2[0]) > w + margin || Math.abs(p2[1]) > h + margin;
  if (inside1 && outside2) {
    // Check if it remained outside across all remaining frames
    let returned = false;
    for (let k = frame; k < points.length; k++) {
      if (Math.abs(points[k][0]) <= w && Math.abs(points[k][1]) <= h) {
        returned = true;
        break;
      }
    }
    if (returned) return null;

    return {
      frame,
      hit: [p2[0], p2[1]],
      wallType: "bounds",
      wallIndex: 0,
      speed: Number(speed.toFixed(2)),
      incidentAngleDeg: 90,
      description: tr(
        `Bola escapou dos limites do campo com vel. ${speed.toFixed(1)} u/f`,
        `Ball escaped stadium bounds with speed ${speed.toFixed(1)} u/f`,
      ),
    };
  }
  return null;
}

/**
 * Simulates a single trajectory with HaxBall's stepWorld and checks for tunneling breaches.
 */
export function simulateStressTrajectory(
  stadium: Stadium,
  x: number,
  y: number,
  vx: number,
  vy: number,
  ballDef: BallDef = {},
  maxFrames = 180,
): StressTrajectory {
  const ball: Disc = {
    x,
    y,
    vx,
    vy,
    gx: ballDef.gx ?? DEFAULT_BALL.gx,
    gy: ballDef.gy ?? DEFAULT_BALL.gy,
    radius: ballDef.radius ?? DEFAULT_BALL.radius,
    invMass: ballDef.invMass ?? DEFAULT_BALL.invMass,
    damping: ballDef.damping ?? DEFAULT_BALL.damping,
    bCoef: ballDef.bCoef ?? DEFAULT_BALL.bCoef,
    cMask: ballDef.cMask ?? DEFAULT_BALL.cMask,
    cGroup: ballDef.cGroup ?? DEFAULT_BALL.cGroup,
  };

  const initialSpeed = Math.hypot(vx, vy);
  const angleDeg = (Math.atan2(vy, vx) * 180) / Math.PI;
  const points: [number, number][] = [[x, y]];
  const bounces: [number, number][] = [];
  const stepSpeeds: number[] = [initialSpeed];

  const discs = [ball];

  // 1. Simulate the complete physical trajectory first
  for (let frame = 1; frame <= maxFrames; frame++) {
    const prevVx = ball.vx;
    const prevVy = ball.vy;

    stepWorld(discs, stadium);

    points.push([ball.x, ball.y]);
    const stepSpeed = Math.hypot(ball.vx, ball.vy);
    stepSpeeds.push(stepSpeed);

    // Detect bounce (velocity direction changed noticeably)
    const dotV = prevVx * ball.vx + prevVy * ball.vy;
    if (dotV < 0.2 * (prevVx * prevVx + prevVy * prevVy)) {
      bounces.push([ball.x, ball.y]);
    }

    if (stepSpeed < 0.05) break;
  }

  // 2. Scan trajectory for real breaches using trajectory-level verification
  let breach: Breach | null = null;
  for (let frame = 1; frame < points.length; frame++) {
    const stepSpeed = stepSpeeds[frame];

    for (let sIdx = 0; sIdx < stadium.segments.length; sIdx++) {
      const seg = stadium.segments[sIdx];
      if (!canCollide(ball, seg)) continue;
      const b = seg.curved
        ? checkCurvedSegmentBreach(seg, sIdx, points, frame, stepSpeed)
        : checkStraightSegmentBreach(seg, sIdx, points, frame, stepSpeed);
      if (b) {
        breach = b;
        break;
      }
    }
    if (breach) break;

    const bBounds = checkBoundsBreach(stadium, points, frame, stepSpeed);
    if (bBounds) {
      breach = bBounds;
      break;
    }
  }

  return {
    points,
    speed: initialSpeed,
    angleDeg,
    breach,
    bounces,
  };
}

/**
 * Simulates a stress test burst pattern:
 * - "single": 1 single clean line in the aim direction (default, simplest and cleanest)
 * - "fan": 3 clean rays (-15°, 0°, +15°)
 * - "radial": 8 clean rays (45° apart)
 */
export function simulateStressBurst(
  stadium: Stadium,
  origin: [number, number],
  target: [number, number],
  pattern: StressPattern = "single",
  maxSpeed = 25,
  ballDef: BallDef = {},
): StressBurstResult {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dist = Math.hypot(dx, dy);
  const baseAngle = dist > 0.001 ? Math.atan2(dy, dx) : 0;
  const effectiveMaxSpeed = Math.max(10, Math.min(35, maxSpeed));

  const trajectories: StressTrajectory[] = [];
  const breachedWalls = new Set<number>();
  let minBreachSpeed: number | null = null;

  if (pattern === "single") {
    // 1 single clean line! Simple, focused and unmistakable
    const vx = Math.cos(baseAngle) * effectiveMaxSpeed;
    const vy = Math.sin(baseAngle) * effectiveMaxSpeed;
    const traj = simulateStressTrajectory(stadium, origin[0], origin[1], vx, vy, ballDef);
    trajectories.push(traj);
    if (traj.breach) {
      if (traj.breach.wallType === "segment") breachedWalls.add(traj.breach.wallIndex);
      minBreachSpeed = traj.breach.speed;
    }
  } else if (pattern === "fan") {
    // 3 clean rays (0°, -15°, +15°)
    for (const offsetDeg of [0, -15, 15]) {
      const angle = baseAngle + (offsetDeg * Math.PI) / 180;
      const vx = Math.cos(angle) * effectiveMaxSpeed;
      const vy = Math.sin(angle) * effectiveMaxSpeed;
      const traj = simulateStressTrajectory(stadium, origin[0], origin[1], vx, vy, ballDef);
      trajectories.push(traj);
      if (traj.breach) {
        if (traj.breach.wallType === "segment") breachedWalls.add(traj.breach.wallIndex);
        if (minBreachSpeed === null || traj.breach.speed < minBreachSpeed) {
          minBreachSpeed = traj.breach.speed;
        }
      }
    }
  } else if (pattern === "radial") {
    // 8 clean directions (45° apart)
    for (let i = 0; i < 8; i++) {
      const angle = (i * 2 * Math.PI) / 8;
      const vx = Math.cos(angle) * effectiveMaxSpeed;
      const vy = Math.sin(angle) * effectiveMaxSpeed;
      const traj = simulateStressTrajectory(stadium, origin[0], origin[1], vx, vy, ballDef);
      trajectories.push(traj);
      if (traj.breach) {
        if (traj.breach.wallType === "segment") breachedWalls.add(traj.breach.wallIndex);
        if (minBreachSpeed === null || traj.breach.speed < minBreachSpeed) {
          minBreachSpeed = traj.breach.speed;
        }
      }
    }
  }

  const totalBreaches = trajectories.filter((t) => t.breach !== null).length;
  const summary = totalBreaches > 0
    ? tr(
        `⚠️ VAZAMENTO DETECTADO! A bola varou a parede com velocidade ${minBreachSpeed?.toFixed(1) ?? effectiveMaxSpeed.toFixed(1)} u/f!`,
        `⚠️ BREACH DETECTED! The ball tunneled the wall at speed ${minBreachSpeed?.toFixed(1) ?? effectiveMaxSpeed.toFixed(1)} u/f!`,
      )
    : tr(
        `✅ SEGURO: A bola ricocheteia normalmente (vel: ${effectiveMaxSpeed.toFixed(1)} u/f).`,
        `✅ SECURE: The ball rebounds normally (speed: ${effectiveMaxSpeed.toFixed(1)} u/f).`,
      );

  return {
    trajectories,
    totalBreaches,
    minBreachSpeed,
    breachedWalls,
    summary,
  };
}

/**
 * Automatically stress tests a specific segment along its length from various angles.
 */
export function autoStressSegment(
  stadium: Stadium,
  segmentIndex: number,
  ballDef: BallDef = {},
): {
  isSecure: boolean;
  minBreachSpeed: number | null;
  breachPoints: [number, number][];
  totalTests: number;
  breachCount: number;
  tips: string[];
} {
  const seg = stadium.segments[segmentIndex];
  if (!seg) {
    return { isSecure: true, minBreachSpeed: null, breachPoints: [], totalTests: 0, breachCount: 0, tips: [] };
  }

  const testSpeeds = [12, 16, 20, 24, 28, 32];
  const pointsAlong = [0.15, 0.35, 0.5, 0.65, 0.85];
  const breachPoints: [number, number][] = [];
  let minBreachSpeed: number | null = null;
  let totalTests = 0;
  let breachCount = 0;

  for (const t of pointsAlong) {
    const wallX = seg.x0 + (seg.x1 - seg.x0) * t;
    const wallY = seg.y0 + (seg.y1 - seg.y0) * t;

    // Normals from both sides
    const nx = seg.nx || -(seg.y1 - seg.y0) / (Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) || 1);
    const ny = seg.ny || (seg.x1 - seg.x0) / (Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) || 1);

    for (const side of [1, -1]) {
      // Test perpendicular and angled shots (±30°)
      const baseNx = nx * side;
      const baseNy = ny * side;
      const baseAngle = Math.atan2(-baseNy, -baseNx);

      for (const dAng of [-0.5, 0, 0.5]) {
        const shotAngle = baseAngle + dAng;
        const startDist = 35;
        const originX = wallX + baseNx * startDist;
        const originY = wallY + baseNy * startDist;

        for (const sp of testSpeeds) {
          totalTests++;
          const vx = Math.cos(shotAngle) * sp;
          const vy = Math.sin(shotAngle) * sp;
          const traj = simulateStressTrajectory(stadium, originX, originY, vx, vy, ballDef, 60);

          if (traj.breach && traj.breach.wallIndex === segmentIndex) {
            breachCount++;
            breachPoints.push(traj.breach.hit);
            if (minBreachSpeed === null || traj.breach.speed < minBreachSpeed) {
              minBreachSpeed = traj.breach.speed;
            }
          }
        }
      }
    }
  }

  const isSecure = breachCount === 0;
  const tips: string[] = [];
  if (!isSecure) {
    tips.push(tr("Adicione bias no segmento para torná-lo unidirecional espesso", "Add bias to make the segment thick and one-sided"));
    tips.push(tr("Adicione uma parede dupla (segmento paralelo de apoio)", "Add a double wall (parallel backing segment)"));
    tips.push(tr("Posicione um plano (plane) de contenção atrás da parede", "Place a containment plane behind the wall"));
    tips.push(tr("Certifique-se de que os vértices nas pontas possuem cMask ativa", "Ensure vertices at endpoints have active cMask"));
  }

  return {
    isSecure,
    minBreachSpeed,
    breachPoints,
    totalTests,
    breachCount,
    tips,
  };
}

/**
 * Automatically audits all segments in the stadium for wall tunneling vulnerabilities.
 */
export function autoStressStadium(
  stadium: Stadium,
  ballDef: BallDef = {},
): {
  vulnerableSegments: Map<number, { minBreachSpeed: number; breachCount: number; breachPoints: [number, number][]; tips: string[] }>;
  totalVulnerabilities: number;
  summary: string;
} {
  const vulnerableSegments = new Map<number, { minBreachSpeed: number; breachCount: number; breachPoints: [number, number][]; tips: string[] }>();

  for (let i = 0; i < stadium.segments.length; i++) {
    const res = autoStressSegment(stadium, i, ballDef);
    if (!res.isSecure && res.minBreachSpeed !== null) {
      vulnerableSegments.set(i, {
        minBreachSpeed: res.minBreachSpeed,
        breachCount: res.breachCount,
        breachPoints: res.breachPoints,
        tips: res.tips,
      });
    }
  }

  const totalVulnerabilities = vulnerableSegments.size;
  const summary = totalVulnerabilities > 0
    ? tr(
        `⚠️ Auditoria: ${totalVulnerabilities} parede(s) vulnerável(is) a varamento detectada(s)!`,
        `⚠️ Audit: ${totalVulnerabilities} wall(s) vulnerable to tunneling detected!`,
      )
    : tr(
        `✅ Auditoria: Todas as paredes suportaram chutes fortes sem varar!`,
        `✅ Audit: All stadium walls held up to high-speed shots without tunneling!`,
      );

  return {
    vulnerableSegments,
    totalVulnerabilities,
    summary,
  };
}

/**
 * Renders the Wall Stresser trajectories, breach points, and diagnostic overlay on Canvas 2D.
 */
export function drawStresserOverlay(
  ctx: CanvasRenderingContext2D,
  stadium: Stadium,
  origin: [number, number],
  end: [number, number],
  result: StressBurstResult,
  pattern: StressPattern,
  speed: number,
  highlightedWalls?: Set<number>,
): void {
  const px = 1 / ctx.getTransform().a;
  ctx.save();

  // Highlight any breached or audited walls in the stadium with a glowing red highlight
  const wallsToHighlight = highlightedWalls ?? result.breachedWalls;
  if (wallsToHighlight && wallsToHighlight.size > 0) {
    ctx.save();
    ctx.lineWidth = 6 * px;
    ctx.strokeStyle = "rgba(255, 35, 55, 0.5)";
    for (const wIdx of wallsToHighlight) {
      const s = stadium.segments[wIdx];
      if (!s) continue;
      ctx.beginPath();
      if (s.curved) {
        ctx.arc(s.cx, s.cy, s.radius, 0, Math.PI * 2);
      } else {
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // 1. Safe trajectories: clean, subtle dashed cyan (just like playground launcher!)
  ctx.save();
  ctx.lineWidth = 2.2 * px;
  ctx.setLineDash([6 * px, 5 * px]);
  ctx.strokeStyle = "rgba(78, 161, 255, 0.75)";
  for (const traj of result.trajectories) {
    if (traj.breach) continue;
    ctx.beginPath();
    traj.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();

    // Small bounce points
    for (const [bx, by] of traj.bounces) {
      ctx.fillStyle = "#4ea1ff";
      ctx.beginPath();
      ctx.arc(bx, by, 3 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // 2. Breached trajectories: drawn in bold NEON RED cutting through the wall
  for (const traj of result.trajectories) {
    if (!traj.breach) continue;
    const b = traj.breach;
    const [hx, hy] = b.hit;

    // A. Draw the line up to the breach point in solid red
    ctx.save();
    ctx.lineWidth = 3.5 * px;
    ctx.strokeStyle = "#ff2233";
    ctx.setLineDash([]);
    ctx.beginPath();
    const cutIdx = Math.min(b.frame, traj.points.length - 1);
    for (let i = 0; i <= cutIdx; i++) {
      const [x, y] = traj.points[i];
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // B. Draw the continuation PAST the breached wall in bright dashed red
    if (cutIdx < traj.points.length - 1) {
      ctx.lineWidth = 3 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.strokeStyle = "#ff4466";
      ctx.beginPath();
      for (let i = cutIdx; i < traj.points.length; i++) {
        const [x, y] = traj.points[i];
        if (i === cutIdx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // C. Glowing beacon at the exact breach location on the wall
    ctx.save();
    // Halo
    ctx.fillStyle = "rgba(255, 30, 50, 0.35)";
    ctx.beginPath();
    ctx.arc(hx, hy, 22 * px, 0, Math.PI * 2);
    ctx.fill();

    // Outer ring
    ctx.strokeStyle = "#ff1133";
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    ctx.arc(hx, hy, 12 * px, 0, Math.PI * 2);
    ctx.stroke();

    // Inner core
    ctx.fillStyle = "#ff1133";
    ctx.beginPath();
    ctx.arc(hx, hy, 5 * px, 0, Math.PI * 2);
    ctx.fill();

    // Crosshair ticks
    ctx.beginPath();
    ctx.moveTo(hx - 16 * px, hy);
    ctx.lineTo(hx + 16 * px, hy);
    ctx.moveTo(hx, hy - 16 * px);
    ctx.lineTo(hx, hy + 16 * px);
    ctx.stroke();

    // D. Ghost ball silhouette where the ball materialized on the other side
    const ghostPt = traj.points[Math.min(b.frame, traj.points.length - 1)];
    if (ghostPt) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 40, 60, 0.4)";
      ctx.strokeStyle = "#ff2244";
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath();
      ctx.arc(ghostPt[0], ghostPt[1], 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // E. High-contrast callout banner pinned to the wall
    const banner = tr(`💥 VAROU AQUI! #${b.wallIndex} (${b.speed.toFixed(1)} u/f)`, `💥 TUNNELED HERE! #${b.wallIndex} (${b.speed.toFixed(1)} u/f)`);
    ctx.font = `bold ${11 * px}px Inter, sans-serif`;
    const tw = ctx.measureText(banner).width;
    const pad = 6 * px;
    const bx = hx + 14 * px;
    const by = hy - 10 * px;

    ctx.fillStyle = "rgba(220, 20, 40, 0.95)";
    ctx.beginPath();
    ctx.roundRect(bx, by, tw + pad * 2, 20 * px, 5 * px);
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.fillText(banner, bx + pad, by + 14 * px);

    ctx.restore();
  }

  // 3. Aim arrow from origin to end
  const hasBreach = result.totalBreaches > 0;
  const aimColor = hasBreach ? "#ff2233" : "#ffd166";

  ctx.save();
  ctx.strokeStyle = aimColor;
  ctx.lineWidth = 3 * px;
  ctx.beginPath();
  ctx.moveTo(...origin);
  ctx.lineTo(...end);
  ctx.stroke();

  // Origin dot
  ctx.fillStyle = aimColor;
  ctx.beginPath();
  ctx.arc(origin[0], origin[1], 4.5 * px, 0, Math.PI * 2);
  ctx.fill();

  // Arrowhead at end
  const adx = end[0] - origin[0];
  const ady = end[1] - origin[1];
  const aLen = Math.hypot(adx, ady);
  if (aLen > 4) {
    const ang = Math.atan2(ady, adx);
    const arrowLen = 11 * px;
    ctx.fillStyle = aimColor;
    ctx.beginPath();
    ctx.moveTo(end[0], end[1]);
    ctx.lineTo(end[0] - arrowLen * Math.cos(ang - 0.45), end[1] - arrowLen * Math.sin(ang - 0.45));
    ctx.lineTo(end[0] - arrowLen * Math.cos(ang + 0.45), end[1] - arrowLen * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }

  // Clean status label at target
  const statusText = hasBreach
    ? tr(`⚠️ VAROU A PAREDE! (${speed.toFixed(1)} u/f)`, `⚠️ TUNNELED WALL! (${speed.toFixed(1)} u/f)`)
    : tr(`${speed.toFixed(1)} u/frame · ✅ Seguro`, `${speed.toFixed(1)} u/frame · ✅ Safe`);

  ctx.font = `bold ${12 * px}px Inter, sans-serif`;
  ctx.fillStyle = aimColor;
  ctx.fillText(statusText, end[0] + 10 * px, end[1] - 8 * px);

  ctx.restore();
  ctx.restore();
}
