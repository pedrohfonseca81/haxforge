// Loads a HaxBall .hbs stadium into a compiled, JSON-serializable form.
// Parsing rules (JSON5, traits, defaults, limits) follow HaxBall's own loader,
// so any stadium that works in HaxBall works here.
// All derived geometry (curve centers, normals) is computed once on the server
// and shipped to clients, so no engine-specific Math.tan result can cause desync.
import JSON5 from "json5";
import { Flag, parseFlags } from "./flags";

type Vec = [number, number];
type Raw = Record<string, unknown>;

export interface Vertex {
  x: number;
  y: number;
  bCoef: number;
  cMask: number;
  cGroup: number;
}

export interface Segment {
  // Endpoints after normalization (a negative curve swaps v0/v1).
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  bCoef: number;
  cMask: number;
  cGroup: number;
  bias: number;
  curved: boolean;
  // 1 / tan(curve / 2); only meaningful when curved.
  curveF: number;
  // Curved: circle center, radius and the two tangents bounding the arc.
  cx: number;
  cy: number;
  radius: number;
  t0x: number;
  t0y: number;
  t1x: number;
  t1y: number;
  // Straight: unit normal.
  nx: number;
  ny: number;
  vis: boolean;
  color: number; // 0xRRGGBB, -1 = transparent
}

export interface Plane {
  nx: number;
  ny: number;
  dist: number;
  bCoef: number;
  cMask: number;
  cGroup: number;
}

export interface Goal {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  team: 1 | 2;
}

export interface Joint {
  d0: number;
  d1: number;
  minLength: number;
  maxLength: number;
  rigid: boolean;
  strength: number; // spring strength when not rigid
  color: number;
}

export interface DiscDef {
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
  color: number;
}

export interface PlayerPhysics {
  radius: number;
  bCoef: number;
  invMass: number;
  damping: number;
  acceleration: number;
  kickingAcceleration: number;
  kickingDamping: number;
  kickStrength: number;
  kickback: number;
  gx: number;
  gy: number;
  cGroup: number;
}

export interface Stadium {
  name: string;
  width: number;
  height: number;
  spawnDistance: number;
  maxViewWidth: number;
  cameraFollowPlayer: boolean;
  kickOffResetFull: boolean;
  bg: {
    type: "none" | "grass" | "hockey";
    width: number;
    height: number;
    kickOffRadius: number;
    cornerRadius: number;
    goalLine: number;
    color: number;
  };
  vertices: Vertex[];
  segments: Segment[];
  planes: Plane[];
  goals: Goal[];
  joints: Joint[];
  // discs[0] is the ball, followed by the stadium's own discs.
  discs: DiscDef[];
  playerPhysics: PlayerPhysics;
  redSpawnPoints: Vec[];
  blueSpawnPoints: Vec[];
}

function num(v: unknown, fallback: number, field = "value"): number {
  if (v == null) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${field} must be a number`);
  return v;
}

function req(v: unknown, field: string): number {
  if (v == null) throw new Error(`missing "${field}"`);
  return num(v, 0, field);
}

function vec(v: unknown, field: string): Vec {
  if (!Array.isArray(v) || v.length < 2) throw new Error(`${field} must be [x, y]`);
  return [num(v[0], 0, field), num(v[1], 0, field)];
}

export function parseColor(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (v === "transparent") return -1;
  if (typeof v === "string") {
    const n = parseInt(v, 16);
    if (Number.isNaN(n)) throw new Error(`invalid color "${v}"`);
    return n;
  }
  if (Array.isArray(v)) return ((v[0] | 0) << 16) + ((v[1] | 0) << 8) + (v[2] | 0);
  throw new Error("invalid color");
}

function teamOf(v: unknown): 1 | 2 {
  if (v === "red") return 1;
  if (v === "blue") return 2;
  throw new Error(`invalid goal team "${String(v)}"`);
}

// Trait values fill in properties the object leaves unset (null or missing).
export function withTrait(obj: unknown, traits: Record<string, Raw>): Raw {
  if (!obj || typeof obj !== "object") throw new Error("expected an object");
  const raw = { ...(obj as Raw) };
  const trait = typeof raw.trait === "string" ? traits[raw.trait] : undefined;
  if (trait) for (const k of Object.keys(trait)) if (raw[k] == null) raw[k] = trait[k];
  return raw;
}

export function compileSegment(raw: Raw, vertices: Vertex[]): Segment {
  let v0 = vertices[raw.v0 as number];
  let v1 = vertices[raw.v1 as number];
  if (!v0 || !v1) throw new Error("segment references a missing vertex");
  let bias = num(raw.bias, 0, "bias");

  // Same rules as HaxBall: curveF wins; curve is in degrees, a negative curve
  // swaps the endpoints, and only 10..340 degrees counts as curved.
  let curveF = Infinity;
  if (raw.curveF != null) {
    curveF = num(raw.curveF, Infinity, "curveF");
  } else if (raw.curve != null) {
    let angle = num(raw.curve, 0, "curve") * 0.017453292519943295;
    if (angle < 0) {
      angle = -angle;
      [v0, v1] = [v1, v0];
      bias = -bias;
    }
    if (angle > 0.17435839227423353 && angle < 5.934119456780721) curveF = 1 / Math.tan(angle / 2);
  }

  const seg: Segment = {
    x0: v0.x,
    y0: v0.y,
    x1: v1.x,
    y1: v1.y,
    bCoef: num(raw.bCoef, 1, "bCoef"),
    cMask: parseFlags(raw.cMask, Flag.all),
    cGroup: parseFlags(raw.cGroup, Flag.wall),
    bias: bias + 0, // normalizes -0, which JSON would turn into 0
    curved: Number.isFinite(curveF),
    curveF: Number.isFinite(curveF) ? curveF : 0,
    cx: 0,
    cy: 0,
    radius: 0,
    t0x: 0,
    t0y: 0,
    t1x: 0,
    t1y: 0,
    nx: 0,
    ny: 0,
    vis: raw.vis == null ? true : Boolean(raw.vis),
    color: parseColor(raw.color, 0),
  };

  if (seg.curved) {
    const hx = 0.5 * (v1.x - v0.x);
    const hy = 0.5 * (v1.y - v0.y);
    seg.cx = v0.x + hx - hy * curveF;
    seg.cy = v0.y + hy + hx * curveF;
    const dx = v0.x - seg.cx;
    const dy = v0.y - seg.cy;
    seg.radius = Math.sqrt(dx * dx + dy * dy);
    seg.t0x = seg.cy - v0.y;
    seg.t0y = v0.x - seg.cx;
    seg.t1x = v1.y - seg.cy;
    seg.t1y = seg.cx - v1.x;
    if (curveF <= 0) {
      seg.t0x = -seg.t0x;
      seg.t0y = -seg.t0y;
      seg.t1x = -seg.t1x;
      seg.t1y = -seg.t1y;
    }
  } else {
    const dx = v0.x - v1.x;
    const dy = v0.y - v1.y;
    const len = Math.sqrt(dy * dy + dx * dx);
    seg.nx = -dy / len;
    seg.ny = dx / len;
  }
  return seg;
}

// HaxBall's default disc; the default ball is the same with cGroup ball|kick|score.
export const DISC_DEFAULTS: DiscDef = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  gx: 0,
  gy: 0,
  radius: 10,
  invMass: 1,
  damping: 0.99,
  bCoef: 0.5,
  cMask: Flag.all,
  cGroup: Flag.all,
  color: 0xffffff,
};

export function compileDisc(raw: Raw, base: DiscDef = DISC_DEFAULTS): DiscDef {
  const d = { ...base };
  if (raw.pos != null) [d.x, d.y] = vec(raw.pos, "pos");
  if (raw.speed != null) [d.vx, d.vy] = vec(raw.speed, "speed");
  if (raw.gravity != null) [d.gx, d.gy] = vec(raw.gravity, "gravity");
  d.radius = num(raw.radius, d.radius, "radius");
  d.bCoef = num(raw.bCoef, d.bCoef, "bCoef");
  d.invMass = num(raw.invMass, d.invMass, "invMass");
  d.damping = num(raw.damping, d.damping, "damping");
  d.color = parseColor(raw.color, d.color);
  d.cMask = parseFlags(raw.cMask, d.cMask);
  d.cGroup = parseFlags(raw.cGroup, d.cGroup);
  return d;
}

function list(hbs: Raw, key: string, optional: boolean): unknown[] {
  const v = hbs[key];
  if (v == null) {
    if (optional) return [];
    throw new Error(`missing "${key}"`);
  }
  if (!Array.isArray(v)) throw new Error(`"${key}" must be an array`);
  return v;
}

function each<T>(hbs: Raw, key: string, traits: Record<string, Raw>, fn: (raw: Raw) => T, optional = false): T[] {
  return list(hbs, key, optional).map((o, i) => {
    try {
      return fn(withTrait(o, traits));
    } catch (e) {
      throw new Error(`${key}[${i}]: ${(e as Error).message}`);
    }
  });
}

export function parseStadium(text: string): Stadium {
  let hbs: unknown;
  try {
    hbs = JSON5.parse(text);
  } catch (e) {
    throw new Error(`not a valid .hbs file: ${(e as Error).message}`);
  }
  return compileStadium(hbs);
}

export function compileStadium(input: unknown): Stadium {
  if (!input || typeof input !== "object") throw new Error("stadium must be an object");
  const hbs = input as Raw;
  const traits = (hbs.traits ?? {}) as Record<string, Raw>;

  if (typeof hbs.name !== "string") throw new Error('missing "name"');
  const bgRaw = (hbs.bg ?? {}) as Raw;

  const vertices: Vertex[] = each(hbs, "vertexes", traits, (raw) => ({
    x: req(raw.x, "x"),
    y: req(raw.y, "y"),
    bCoef: num(raw.bCoef, 1, "bCoef"),
    cMask: parseFlags(raw.cMask, Flag.all),
    cGroup: parseFlags(raw.cGroup, Flag.wall),
  }));

  const segments = each(hbs, "segments", traits, (raw) => compileSegment(raw, vertices));

  const goals: Goal[] = each(hbs, "goals", traits, (raw) => {
    const [x0, y0] = vec(raw.p0, "p0");
    const [x1, y1] = vec(raw.p1, "p1");
    return { x0, y0, x1, y1, team: teamOf(raw.team) };
  });

  // The ball: "disc0" uses the first disc as is; otherwise ballPhysics
  // overrides the default ball and always keeps the kick and score flags.
  const discs: DiscDef[] = [];
  const ballPhysics = hbs.ballPhysics;
  const defaultBall = { ...DISC_DEFAULTS, cGroup: Flag.ball | Flag.kick | Flag.score };
  if (ballPhysics !== "disc0") {
    if (ballPhysics == null) {
      discs.push(defaultBall);
    } else {
      const ball = compileDisc(withTrait(ballPhysics, traits), defaultBall);
      ball.cGroup |= Flag.kick | Flag.score;
      discs.push(ball);
    }
  }
  discs.push(...each(hbs, "discs", traits, (raw) => compileDisc(raw)));

  const planes: Plane[] = each(hbs, "planes", traits, (raw) => {
    const [x, y] = vec(raw.normal, "normal");
    const len = Math.sqrt(x * x + y * y);
    return {
      nx: x / len,
      ny: y / len,
      dist: req(raw.dist, "dist"),
      bCoef: num(raw.bCoef, 1, "bCoef"),
      cMask: parseFlags(raw.cMask, Flag.all),
      cGroup: parseFlags(raw.cGroup, Flag.wall),
    };
  });

  const joints: Joint[] = each(
    hbs,
    "joints",
    traits,
    (raw) => {
      const d0 = raw.d0 as number;
      const d1 = raw.d1 as number;
      if (!(d0 >= 0 && d0 < discs.length && d1 >= 0 && d1 < discs.length)) throw new Error("invalid disc index");
      let minLength: number;
      let maxLength: number;
      if (raw.length == null) {
        const a = discs[d0];
        const b = discs[d1];
        minLength = maxLength = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
      } else if (Array.isArray(raw.length)) {
        minLength = num(raw.length[0], 0, "length");
        maxLength = num(raw.length[1], 0, "length");
      } else {
        minLength = maxLength = num(raw.length, 0, "length");
      }
      const rigid = raw.strength == null || raw.strength === "rigid";
      const strength = rigid ? 0 : num(raw.strength, 0, "strength");
      return { d0, d1, minLength, maxLength, rigid, strength, color: parseColor(raw.color, 0) };
    },
    true,
  );

  const spawns = (key: string): Vec[] => list(hbs, key, true).map((p) => vec(p, key));

  const pp = (hbs.playerPhysics ?? {}) as Raw;
  const [gx, gy] = pp.gravity == null ? [0, 0] : vec(pp.gravity, "gravity");
  const playerPhysics: PlayerPhysics = {
    radius: num(pp.radius, 15, "radius"),
    bCoef: num(pp.bCoef, 0.5, "bCoef"),
    invMass: num(pp.invMass, 0.5, "invMass"),
    damping: num(pp.damping, 0.96, "damping"),
    acceleration: num(pp.acceleration, 0.1, "acceleration"),
    kickingAcceleration: num(pp.kickingAcceleration, 0.07, "kickingAcceleration"),
    kickingDamping: num(pp.kickingDamping, 0.96, "kickingDamping"),
    kickStrength: num(pp.kickStrength, 5, "kickStrength"),
    kickback: num(pp.kickback, 0, "kickback"),
    gx,
    gy,
    cGroup: parseFlags(pp.cGroup, 0),
  };

  if (vertices.length > 255 || segments.length > 255 || planes.length > 255 || goals.length > 255) {
    throw new Error("too many objects (max 255 of each)");
  }
  if (discs.length < 1 || discs.length > 255) throw new Error("a stadium needs 1 to 255 discs (the ball included)");

  const stadium: Stadium = {
    name: hbs.name,
    width: req(hbs.width, "width"),
    height: req(hbs.height, "height"),
    spawnDistance: num(hbs.spawnDistance, 200, "spawnDistance"),
    maxViewWidth: num(hbs.maxViewWidth, 0, "maxViewWidth") | 0,
    cameraFollowPlayer: hbs.cameraFollow === "player",
    kickOffResetFull: hbs.kickOffReset === "full",
    bg: {
      type: bgRaw.type === "grass" || bgRaw.type === "hockey" ? bgRaw.type : "none",
      width: num(bgRaw.width, 0, "bg.width"),
      height: num(bgRaw.height, 0, "bg.height"),
      kickOffRadius: num(bgRaw.kickOffRadius, 0, "bg.kickOffRadius"),
      cornerRadius: num(bgRaw.cornerRadius, 0, "bg.cornerRadius"),
      goalLine: num(bgRaw.goalLine, 0, "bg.goalLine"),
      color: parseColor(bgRaw.color, 0x718c5a),
    },
    vertices,
    segments,
    planes,
    goals,
    joints,
    discs,
    playerPhysics,
    redSpawnPoints: spawns("redSpawnPoints"),
    blueSpawnPoints: spawns("blueSpawnPoints"),
  };
  // Clients get the stadium as JSON, which turns -0 into 0. The server must
  // simulate with exactly the values they get, or a zero's sign can diverge.
  return JSON.parse(JSON.stringify(stadium));
}
