// Turns a Doc into drawable, hit-testable geometry, object by object. Unlike
// compileStadium, a broken object only marks itself as invalid instead of
// failing the whole map (the map is often half drawn while editing).
import { Flag, parseFlags } from "../vendor/kickr/shared/flags";
import { compileDisc, compileSegment, DISC_DEFAULTS, parseColor, withTrait, type DiscDef, type Segment, type Stadium, type Vertex } from "../vendor/kickr/shared/stadium";
import { lang, tr } from "../i18n";
import { traitsOf } from "./fields";
import { isObject, type JsonObject } from "./json";
import type { Doc, Item, ListKey } from "./model";
import { ballOffset, isDisc0 } from "./ops";

type Raw = Record<string, unknown>;
type Vec = [number, number];

export interface GeoGoal {
  p0: Vec;
  p1: Vec;
  team: 0 | 1 | 2;
}
export interface GeoPlane {
  nx: number;
  ny: number;
  dist: number;
  cMask: number;
  cGroup: number;
}
export interface GeoJoint {
  a: Vec;
  b: Vec;
  color: number;
}
export interface GeoSegment extends Segment {
  v0: number;
  v1: number;
}

export interface Geo {
  traits: Record<string, JsonObject>;
  // Indexed like doc.lists; null when the object is invalid.
  vertexes: (Vertex | null)[];
  segments: (GeoSegment | null)[];
  discs: (DiscDef | null)[];
  goals: (GeoGoal | null)[];
  planes: (GeoPlane | null)[];
  joints: (GeoJoint | null)[];
  redSpawnPoints: (Vec | null)[];
  blueSpawnPoints: (Vec | null)[];
  // The ball defined by ballPhysics (null for a "disc0" stadium).
  ball: DiscDef | null;
  errors: Map<string, string>;
  // Enough of a compiled Stadium for kickr's background renderer.
  stadium: Pick<Stadium, "width" | "height" | "bg" | "spawnDistance">;
  playerRadius: number;
  // Extra collision groups every player gets (playerPhysics.cGroup).
  playerGroup: number;
}

let cache = new WeakMap<Doc, Geo>();
let cacheLang = lang.get();

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const vec = (v: unknown): Vec | null => (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? [v[0], v[1]] : null);

export function resolve(doc: Doc): Geo {
  if (cacheLang !== lang.get()) {
    cache = new WeakMap<Doc, Geo>();
    cacheLang = lang.get();
  }
  const hit = cache.get(doc);
  if (hit) return hit;
  const traits = traitsOf(doc.fields);
  const errors = new Map<string, string>();
  const each = <T>(list: ListKey, fn: (raw: Raw, it: Item) => T): (T | null)[] =>
    doc.lists[list].map((it) => {
      try {
        return fn(withTrait(it.v, traits as Record<string, Raw>), it);
      } catch (e) {
        errors.set(`${list}:${it.id}`, (e as Error).message);
        return null;
      }
    });

  const vertexes = each("vertexes", (raw): Vertex => {
    if (typeof raw.x !== "number" || typeof raw.y !== "number") throw new Error(tr("vértice sem x/y", "vertex missing x/y"));
    return { x: raw.x, y: raw.y, bCoef: num(raw.bCoef, 1), cMask: parseFlags(raw.cMask, Flag.all), cGroup: parseFlags(raw.cGroup, Flag.wall) };
  });
  const segments = each("segments", (raw): GeoSegment => {
    const v0 = raw.v0 as number;
    const v1 = raw.v1 as number;
    if (!vertexes[v0] || !vertexes[v1]) throw new Error(tr("segmento aponta para um vértice inexistente", "segment points to a non-existent vertex"));
    return { ...compileSegment(raw, vertexes as Vertex[]), v0, v1 };
  });
  const discs = each("discs", (raw) => compileDisc(raw));
  const goals = each("goals", (raw): GeoGoal => {
    const p0 = vec(raw.p0);
    const p1 = vec(raw.p1);
    if (!p0 || !p1) throw new Error(tr("gol sem p0/p1", "goal missing p0/p1"));
    return { p0, p1, team: raw.team === "red" ? 1 : raw.team === "blue" ? 2 : 0 };
  });
  const planes = each("planes", (raw): GeoPlane => {
    const nv = vec(raw.normal);
    if (!nv || typeof raw.dist !== "number") throw new Error(tr("plano sem normal/dist", "plane missing normal/dist"));
    const len = Math.hypot(nv[0], nv[1]);
    if (!len) throw new Error(tr("normal nula", "zero normal"));
    return { nx: nv[0] / len, ny: nv[1] / len, dist: raw.dist, cMask: parseFlags(raw.cMask, Flag.all), cGroup: parseFlags(raw.cGroup, Flag.wall) };
  });

  let ball: DiscDef | null = null;
  if (!isDisc0(doc)) {
    const bp = doc.fields.ballPhysics;
    const base = { ...DISC_DEFAULTS, cGroup: Flag.ball | Flag.kick | Flag.score };
    try {
      ball = bp == null ? base : compileDisc(withTrait(bp, traits as Record<string, Raw>), base);
    } catch (e) {
      errors.set("ball", (e as Error).message);
    }
  }
  // Joint indices count the ball first unless it is disc 0.
  const off = ballOffset(doc);
  const discAt = (i: unknown): DiscDef | null => (typeof i !== "number" ? null : off && i === 0 ? ball : (discs[i - off] ?? null));
  const joints = each("joints", (raw): GeoJoint => {
    const a = discAt(raw.d0);
    const b = discAt(raw.d1);
    if (!a || !b) throw new Error(tr("joint aponta para um disco inexistente", "joint points to a non-existent disc"));
    return { a: [a.x, a.y], b: [b.x, b.y], color: parseColor(raw.color, 0) };
  });
  const spawns = (list: "redSpawnPoints" | "blueSpawnPoints") =>
    doc.lists[list].map((it) => {
      const p = vec(it.v);
      if (!p) errors.set(`${list}:${it.id}`, tr("spawn deve ser [x, y]", "spawn must be [x, y]"));
      return p;
    });

  const bg = isObject(doc.fields.bg) ? (doc.fields.bg as Raw) : {};
  let bgColor = 0x718c5a;
  try {
    bgColor = parseColor(bg.color, bgColor);
  } catch {}
  const pp = isObject(doc.fields.playerPhysics) ? (doc.fields.playerPhysics as Raw) : {};
  const geo: Geo = {
    traits,
    vertexes,
    segments,
    discs,
    goals,
    planes,
    joints,
    redSpawnPoints: spawns("redSpawnPoints"),
    blueSpawnPoints: spawns("blueSpawnPoints"),
    ball,
    errors,
    stadium: {
      width: num(doc.fields.width, 0),
      height: num(doc.fields.height, 0),
      spawnDistance: num(doc.fields.spawnDistance, 200),
      bg: {
        type: bg.type === "grass" || bg.type === "hockey" ? bg.type : "none",
        width: num(bg.width, 0),
        height: num(bg.height, 0),
        kickOffRadius: num(bg.kickOffRadius, 0),
        cornerRadius: num(bg.cornerRadius, 0),
        goalLine: num(bg.goalLine, 0),
        color: bgColor,
      },
    },
    playerRadius: num(pp.radius, 15),
    playerGroup: (() => {
      try {
        return parseFlags(pp.cGroup, 0);
      } catch {
        return 0;
      }
    })(),
  };
  cache.set(doc, geo);
  return geo;
}

// Counts against HaxBall's limit of 255 per kind (the ball counts as a disc).
export function budget(doc: Doc): { key: string; label: string; used: number }[] {
  return [
    { key: "vertexes", label: tr("Vértices", "Vertices"), used: doc.lists.vertexes.length },
    { key: "segments", label: tr("Segmentos", "Segments"), used: doc.lists.segments.length },
    { key: "discs", label: tr("Discos", "Discs"), used: doc.lists.discs.length + ballOffset(doc) },
    { key: "planes", label: tr("Planos", "Planes"), used: doc.lists.planes.length },
    { key: "goals", label: tr("Gols", "Goals"), used: doc.lists.goals.length },
  ];
}
export const LIMIT = 255;
