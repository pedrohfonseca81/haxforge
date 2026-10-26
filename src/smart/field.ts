// Parametric fields. Every stadium part is generated from a few numbers, with
// the conventions of HaxBall's own maps: ball-only walls and nets, posts as
// fixed discs, the kickoff barrier (center line + circle with redKO/blueKO
// halves) and planes keeping the players inside the camera area.
import type { JsonObject } from "../doc/json";
import { Builder, reflected, type Pt } from "./builder";

export type Template = "classic" | "big" | "futsal" | "real" | "hockey";

export interface FieldParams {
  template: Template;
  // Half sizes of the playing field.
  width: number;
  height: number;
  // Half the goal mouth, and how deep the net goes.
  goal: number;
  depth: number;
  post: number;
  corner: number;
  kickoff: number;
  spawn: number;
  // Room around the field for the players and the camera.
  marginX: number;
  marginY: number;
  // Hockey: goals this far inside the field, with play behind them.
  inset: number;
  bg: "grass" | "hockey" | "none";
  // "bg": the background draws border, center line and circle; "segments": drawn with segments.
  lines: "bg" | "segments";
  lineColor: string;
  net: "curve" | "box";
  netColor: string;
  // Penalty areas.
  area: "none" | "futsal" | "real";
  areaDepth: number;
  areaWidth: number;
  smallDepth: number;
  smallWidth: number;
  spot: number;
  arc: number;
  bounce: number;
}

const COMMON = { post: 8, corner: 0, inset: 0, marginX: 50, marginY: 30, net: "curve", netColor: "000000", lineColor: "C7E6BD", lines: "bg", bg: "grass", area: "none", bounce: 1 } as const;
const AREAS = { areaDepth: 120, areaWidth: 40, smallDepth: 60, smallWidth: 110, spot: 110, arc: 90 };

export const TEMPLATES: Record<Template, { label: string; params: FieldParams }> = {
  classic: { label: "Classic", params: { ...COMMON, ...AREAS, template: "classic", width: 370, height: 170, goal: 64, depth: 30, kickoff: 75, spawn: 170 } },
  big: { label: "Big", params: { ...COMMON, ...AREAS, template: "big", width: 550, height: 240, goal: 80, depth: 40, kickoff: 80, spawn: 350 } },
  futsal: {
    label: "Futsal",
    params: { ...COMMON, ...AREAS, template: "futsal", width: 550, height: 240, goal: 80, depth: 40, post: 5, kickoff: 80, spawn: 350, bg: "hockey", lines: "segments", lineColor: "F8F8F8", net: "box", netColor: "F8F8F8", area: "futsal", areaDepth: 160, areaWidth: 40, marginX: 70, marginY: 30 },
  },
  real: {
    label: "Real Soccer",
    params: { ...COMMON, template: "real", width: 900, height: 580, goal: 90, depth: 50, kickoff: 157, spawn: 450, lines: "bg", lineColor: "C7E6BD", area: "real", areaDepth: 283, areaWidth: 345, smallDepth: 94, smallWidth: 157, spot: 189, arc: 157, marginX: 80, marginY: 60 },
  },
  hockey: {
    label: "Hockey / arena",
    params: { ...COMMON, ...AREAS, template: "hockey", width: 370, height: 170, goal: 64, depth: 30, kickoff: 75, spawn: 170, corner: 75, inset: 60, bg: "hockey", net: "box", marginX: 50, marginY: 30 },
  },
};

export function fieldParams(p: JsonObject): FieldParams {
  const t = TEMPLATES[(p.template as Template) ?? "classic"] ?? TEMPLATES.classic;
  return { ...t.params, ...(p as Partial<FieldParams>) };
}

export interface FieldGen {
  builder: Builder;
  // Top-level stadium fields the generator controls.
  fields: JsonObject;
}

export function generateField(params: JsonObject): FieldGen {
  const p = fieldParams(params);
  const b = new Builder();
  const W = p.width;
  const H = p.height;
  const G = Math.min(p.goal, H - 1);
  const C = Math.max(0, Math.min(p.corner, H - G - 1, W / 2));
  const stadiumW = W + p.marginX;
  const stadiumH = H + p.marginY;
  const drawn = p.lines === "segments";
  const quads: [1 | -1, 1 | -1][] = [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];

  // Adds an element designed in the top right quadrant (or on the right side)
  // to every quadrant (or both sides): reflected arcs keep their curve.
  const seg4 = (a: Pt, c: Pt, curve: number, props: JsonObject, vprops: JsonObject, sides = quads) => {
    for (const [sx, sy] of sides) {
      const [m0, m1] = reflected(a, c, sx, sy);
      b.segment(m0, m1, curve, props, vprops);
    }
  };
  const right: [1 | -1, 1 | -1][] = [[1, 1], [-1, 1]];

  // ---- Ball walls: the field's border, open at the goals ----
  const ballWall = { bCoef: p.bounce, cMask: ["ball"], ...(drawn ? { color: p.lineColor } : { vis: false }) };
  const ballVert = { bCoef: p.bounce, cMask: ["ball"] };
  const goalX = W - p.inset;
  seg4([0, -H], [W - C, -H], 0, ballWall, ballVert);
  if (C > 0) seg4([W - C, -H], [W, -H + C], 90, ballWall, ballVert);
  if (p.inset > 0) seg4([W, -H + C], [W, 0], 0, ballWall, ballVert);
  else seg4([W, -H + C], [W, -G], 0, ballWall, ballVert);

  // ---- Goals, posts and nets ----
  b.goals.push({ p0: [-goalX, -G], p1: [-goalX, G], team: "red" }, { p0: [goalX, -G], p1: [goalX, G], team: "blue" });
  for (const [sx, color] of [
    [-1, "FFCCCC"],
    [1, "CCCCFF"],
  ] as const) {
    for (const sy of [-1, 1]) b.discs.push({ pos: [sx * goalX, sy * G], radius: p.post, invMass: 0, bCoef: 0.5, color });
  }
  const net = { bCoef: 0.1, cMask: ["ball"], color: p.netColor };
  const netVert = { bCoef: 0.1, cMask: ["ball"] };
  const back = goalX + p.depth;
  if (p.net === "curve") {
    const r = Math.min(p.depth, G) * 0.75;
    seg4([goalX + p.post, -G], [back, -G + r], 90, net, netVert);
    seg4([back, -G + r], [back, 0], 0, net, netVert);
  } else {
    seg4([goalX, -G], [back, -G], 0, net, netVert);
    seg4([back, -G], [back, 0], 0, net, netVert);
  }

  // ---- Kickoff barrier (HaxBall's: invisible, players only) ----
  const ko = { bCoef: 0.1, vis: false, cMask: ["red", "blue"], cGroup: ["redKO", "blueKO"] };
  const koVert = { bCoef: 0.1, cMask: ["red", "blue"], cGroup: ["redKO", "blueKO"] };
  const K = Math.min(p.kickoff, H - 1);
  b.segment([0, -stadiumH], [0, -K], 0, ko, koVert);
  b.segment([0, K], [0, stadiumH], 0, ko, koVert);
  b.segment([0, -K], [0, K], 180, { ...ko, cGroup: ["redKO"] }, koVert);
  b.segment([0, K], [0, -K], 180, { ...ko, cGroup: ["blueKO"] }, koVert);

  // ---- Markings drawn with segments (decorative) ----
  const line = { cMask: [], color: p.lineColor };
  const lineVert = { cMask: [] };
  if (drawn) {
    b.segment([0, -H], [0, H], 0, line, lineVert);
    b.segment([0, -K], [0, K], 180, line, lineVert);
    b.segment([0, K], [0, -K], 180, line, lineVert);
    if (p.inset > 0) seg4([goalX, -H], [goalX, 0], 0, line, lineVert);
  }
  const spot = (x: number, y: number, r = 2.5) => {
    b.segment([x, y - r], [x, y + r], 180, line, lineVert);
    b.segment([x, y + r], [x, y - r], 180, line, lineVert);
  };
  if (drawn || p.area !== "none") spot(0, 0);

  if (p.area === "futsal") {
    // Quarter circles from the goal line joined by a straight line.
    const R = p.areaDepth;
    const c = p.areaWidth;
    seg4([goalX, -c - R], [goalX - R, -c], -90, line, lineVert, right);
    seg4([goalX - R, -c], [goalX - R, c], 0, line, lineVert, right);
    seg4([goalX - R, c], [goalX, c + R], -90, line, lineVert, right);
    for (const sx of [-1, 1]) spot(sx * (goalX - p.spot), 0);
  } else if (p.area === "real") {
    const bd = p.areaDepth;
    const bw = Math.min(p.areaWidth, H);
    const sd = p.smallDepth;
    const sw = Math.min(p.smallWidth, H);
    seg4([goalX, -bw], [goalX - bd, -bw], 0, line, lineVert);
    seg4([goalX - bd, -bw], [goalX - bd, 0], 0, line, lineVert);
    seg4([goalX, -sw], [goalX - sd, -sw], 0, line, lineVert);
    seg4([goalX - sd, -sw], [goalX - sd, 0], 0, line, lineVert);
    for (const sx of [-1, 1]) spot(sx * (goalX - p.spot), 0);
    // The arc outside the box, around the penalty spot.
    const d = bd - p.spot;
    if (p.arc > d) {
      const yy = Math.sqrt(p.arc * p.arc - d * d);
      const angle = (2 * Math.acos(d / p.arc) * 180) / Math.PI;
      seg4([goalX - bd, -yy], [goalX - bd, yy], -angle, line, lineVert, right);
    }
    // Corner arcs.
    const cr = Math.max(8, H * 0.03);
    seg4([W, -H + cr], [W - cr, -H], 90, line, lineVert);
  }

  // ---- Players: kept inside the camera area ----
  b.planes.push(
    { normal: [0, 1], dist: -stadiumH, bCoef: 0.1 },
    { normal: [0, -1], dist: -stadiumH, bCoef: 0.1 },
    { normal: [1, 0], dist: -stadiumW, bCoef: 0.1 },
    { normal: [-1, 0], dist: -stadiumW, bCoef: 0.1 },
  );

  const bg: JsonObject = { type: p.bg, width: W, height: H, kickOffRadius: drawn ? 0 : K, cornerRadius: C };
  if (p.bg === "hockey" && p.inset > 0) bg.goalLine = p.inset;
  return {
    builder: b,
    fields: { width: stadiumW, height: stadiumH, spawnDistance: p.spawn, bg },
  };
}
