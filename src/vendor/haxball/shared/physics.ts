// HaxBall world step. The order of operations and every formula mirror the
// original engine so that a given input stream yields the same trajectories.
// Only + - * / and Math.sqrt are used: all are exactly specified by IEEE 754,
// which keeps the simulation bit-identical across JS engines.
import type { Joint, Plane, Segment, Stadium, Vertex } from "./stadium";

export interface Disc {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gx: number;
  gy: number;
  radius: number;
  invMass: number;
  damping: number;
  bCoef: number;
  cMask: number;
  cGroup: number;
}

function collideDiscs(a: Disc, b: Disc): void {
  let dx = a.x - b.x;
  let dy = a.y - b.y;
  let d2 = dx * dx + dy * dy;
  let rsum = a.radius + b.radius;
  if (!(0 < d2 && d2 <= rsum * rsum)) return;

  const dist = Math.sqrt(d2);
  dx /= dist;
  dy /= dist;
  let ratio = a.invMass / (a.invMass + b.invMass);
  rsum -= dist;
  d2 = rsum * ratio;
  a.x += dx * d2;
  a.y += dy * d2;
  rsum -= d2;
  b.x -= dx * rsum;
  b.y -= dy * rsum;

  let vn = dx * (a.vx - b.vx) + dy * (a.vy - b.vy);
  if (vn < 0) {
    vn *= a.bCoef * b.bCoef + 1;
    ratio *= vn;
    a.vx -= dx * ratio;
    a.vy -= dy * ratio;
    ratio = vn - ratio;
    b.vx += dx * ratio;
    b.vy += dy * ratio;
  }
}

function collidePlane(d: Disc, p: Plane): void {
  let pen = p.dist - (p.nx * d.x + p.ny * d.y) + d.radius;
  if (!(0 < pen)) return;
  d.x += p.nx * pen;
  d.y += p.ny * pen;
  pen = d.vx * p.nx + d.vy * p.ny;
  if (pen < 0) {
    pen *= d.bCoef * p.bCoef + 1;
    d.vx -= pen * p.nx;
    d.vy -= pen * p.ny;
  }
}

function collideSegment(d: Disc, s: Segment): void {
  let dist: number;
  let nx: number;
  let ny: number;

  if (s.curved) {
    let rx = d.x - s.cx;
    let ry = d.y - s.cy;
    const inArc = 0 < s.t0x * rx + s.t0y * ry && 0 < s.t1x * rx + s.t1y * ry;
    if (inArc === s.curveF <= 0) return;
    const len = Math.sqrt(rx * rx + ry * ry);
    if (len === 0) return;
    dist = len - s.radius;
    nx = rx / len;
    ny = ry / len;
  } else {
    const ex = s.x1 - s.x0;
    const ey = s.y1 - s.y0;
    const px = d.x - s.x1;
    const py = d.y - s.y1;
    if (0 >= (d.x - s.x0) * ex + (d.y - s.y0) * ey || 0 <= px * ex + py * ey) return;
    nx = s.nx;
    ny = s.ny;
    dist = nx * px + ny * py;
  }

  let bias = s.bias;
  if (bias === 0) {
    if (dist < 0) {
      dist = -dist;
      nx = -nx;
      ny = -ny;
    }
  } else {
    if (bias < 0) {
      bias = -bias;
      dist = -dist;
      nx = -nx;
      ny = -ny;
    }
    if (dist < -bias) return;
  }

  if (dist >= d.radius) return;
  dist = d.radius - dist;
  d.x += nx * dist;
  d.y += ny * dist;
  let vn = nx * d.vx + ny * d.vy;
  if (vn < 0) {
    vn *= d.bCoef * s.bCoef + 1;
    d.vx -= nx * vn;
    d.vy -= ny * vn;
  }
}

function collideVertex(d: Disc, v: Vertex): void {
  let dx = d.x - v.x;
  let dy = d.y - v.y;
  let dist = dx * dx + dy * dy;
  if (!(0 < dist && dist <= d.radius * d.radius)) return;
  dist = Math.sqrt(dist);
  dx /= dist;
  dy /= dist;
  dist = d.radius - dist;
  d.x += dx * dist;
  d.y += dy * dist;
  let vn = dx * d.vx + dy * d.vy;
  if (vn < 0) {
    vn *= d.bCoef * v.bCoef + 1;
    d.vx -= dx * vn;
    d.vy -= dy * vn;
  }
}

const canCollide = (a: { cMask: number; cGroup: number }, b: { cMask: number; cGroup: number }) =>
  (b.cMask & a.cGroup) !== 0 && (b.cGroup & a.cMask) !== 0;

// dt only scales position integration; HaxBall uses a fractional dt for the
// last extrapolated step when rendering between frames.
export function stepWorld(discs: Disc[], stadium: Stadium, dt = 1): void {
  for (const d of discs) {
    d.x += dt * d.vx;
    d.y += dt * d.vy;
    d.vx = d.damping * (d.vx + d.gx);
    d.vy = d.damping * (d.vy + d.gy);
  }

  for (let i = 0; i < discs.length; i++) {
    const d = discs[i];
    for (let j = i + 1; j < discs.length; j++) {
      if (canCollide(d, discs[j])) collideDiscs(d, discs[j]);
    }
    if (d.invMass === 0) continue;
    for (const p of stadium.planes) if (canCollide(d, p)) collidePlane(d, p);
    for (const s of stadium.segments) if (canCollide(d, s)) collideSegment(d, s);
    for (const v of stadium.vertices) if (canCollide(d, v)) collideVertex(d, v);
  }

  for (let iteration = 0; iteration < 2; iteration++) {
    for (const j of stadium.joints) solveJoint(discs, j);
  }
}

function solveJoint(discs: Disc[], j: Joint): void {
  const a = discs[j.d0];
  const b = discs[j.d1];
  if (!a || !b) return;
  let nx = a.x - b.x;
  let ny = a.y - b.y;
  const dist = Math.sqrt(nx * nx + ny * ny);
  if (dist <= 0) return;
  nx /= dist;
  ny /= dist;
  let ratio = a.invMass / (a.invMass + b.invMass);
  if (ratio !== ratio) ratio = 0.5;

  let target: number;
  let dir: number;
  if (j.minLength >= j.maxLength) {
    target = j.minLength;
    dir = 0;
  } else if (dist <= j.minLength) {
    target = j.minLength;
    dir = 1;
  } else if (dist >= j.maxLength) {
    target = j.maxLength;
    dir = -1;
  } else {
    return;
  }

  let c = target - dist;
  if (!j.rigid) {
    const s = j.strength * c * 0.5;
    const px = nx * s;
    const py = ny * s;
    a.vx += px * a.invMass;
    a.vy += py * a.invMass;
    b.vx -= px * b.invMass;
    b.vy -= py * b.invMass;
  } else {
    const l = c * ratio;
    a.x += nx * l * 0.5;
    a.y += ny * l * 0.5;
    c -= l;
    b.x -= nx * c * 0.5;
    b.y -= ny * c * 0.5;
    const rv = nx * (a.vx - b.vx) + ny * (a.vy - b.vy);
    if (0 >= dir * rv) {
      let s = ratio * rv;
      a.vx -= nx * s;
      a.vy -= ny * s;
      s = rv - s;
      b.vx += nx * s;
      b.vy += ny * s;
    }
  }
}
