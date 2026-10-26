// Draws the editor canvas: the map as HaxBall's classic renderer shows it
// (kickr's background code, same line widths and colors), then the editor's
// layers on top: invisible objects, goals, planes, spawns, vertex handles,
// selection, and whatever the current tool is previewing.
import type { Doc } from "../doc/model";
import { refOf, type Ref } from "../doc/ops";
import { resolve, type Geo } from "../doc/resolve";
import { drawBackground } from "../vendor/kickr/client/render";
import type { Stadium } from "../vendor/kickr/shared/stadium";
import { planeLine, type Snap, type Vec } from "./geom";
import { bodies, canCollide, roleOf, ROLE_STYLE } from "../doc/bodies";
import { focusedIssue, issues } from "./lintState";
import { smartSelected } from "../smart/smart";
import { type EditorState, type Prefs, view } from "./state";

export const ACCENT = "#5b8cff";
const RED = "#ff5a5f";
const BLUE = "#4ea1ff";
const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;

// What tools want drawn on top (set by tools.ts).
export interface Overlay {
  marquee?: [Vec, Vec];
  snap?: Snap;
  lines?: [Vec, Vec][];
  disc?: { p: Vec; r: number };
  goal?: { p0: Vec; p1: Vec; team: 1 | 2 };
  plane?: { nx: number; ny: number; dist: number };
  label?: { p: Vec; text: string };
  highlight?: Ref[];
  curveHandle?: Vec;
}
export const overlay: Overlay = {};

export function draw(ctx: CanvasRenderingContext2D, s: EditorState, prefs: Prefs): void {
  const dpr = window.devicePixelRatio || 1;
  const { cam } = view;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const z = cam.zoom * dpr;
  const px = 1 / cam.zoom; // one CSS pixel in world units
  const doc = s.doc;
  const geo = resolve(doc);
  const hidden = s.hidden;
  const sel = new Set(s.selection);
  const ref = (list: Parameters<typeof refOf>[0], i: number) => refOf(list, doc.lists[list][i].id);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.setTransform(z, 0, 0, z, W / 2 - cam.x * z, H / 2 - cam.y * z);
  ctx.lineCap = "butt";
  ctx.lineWidth = 3;
  drawBackground(ctx, geo.stadium as Stadium, cam);

  // Visible world rectangle.
  const vx0 = cam.x - W / 2 / z;
  const vx1 = cam.x + W / 2 / z;
  const vy0 = cam.y - H / 2 / z;
  const vy1 = cam.y + H / 2 / z;

  if (prefs.showGrid) drawGrid(ctx, prefs.grid, cam.zoom, [vx0, vy0, vx1, vy1], px);

  // Camera limits (width/height of the stadium).
  const { width, height } = geo.stadium;
  if (width > 0 && height > 0) {
    ctx.save();
    ctx.setLineDash([6 * px, 6 * px]);
    ctx.lineWidth = px;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.strokeRect(-width, -height, 2 * width, 2 * height);
    ctx.restore();
  }

  // ---- The map as HaxBall draws it -------------------------------------------
  geo.segments.forEach((g, i) => {
    if (!g || hidden.has(ref("segments", i))) return;
    const visible = g.vis && g.color !== -1;
    if (!visible && !prefs.showInvisible) return;
    ctx.save();
    if (visible) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = hex(g.color);
    } else {
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.strokeStyle = "rgba(220,228,240,0.55)";
    }
    strokeSegment(ctx, g);
    ctx.restore();
  });

  geo.joints.forEach((j, i) => {
    if (!j || hidden.has(ref("joints", i))) return;
    ctx.save();
    if (j.color < 0) {
      if (!prefs.showInvisible) return ctx.restore();
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = "rgba(220,228,240,0.55)";
    } else {
      ctx.lineWidth = 3;
      ctx.strokeStyle = hex(j.color);
    }
    ctx.beginPath();
    ctx.moveTo(...j.a);
    ctx.lineTo(...j.b);
    ctx.stroke();
    ctx.restore();
  });

  // Discs in index order, the ball first (HaxBall stops at a negative radius).
  ctx.lineWidth = 2;
  const disc = (d: { x: number; y: number; radius: number; color: number }) => {
    if (d.radius < 0) return;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    if (d.color !== -1) {
      ctx.fillStyle = hex(d.color);
      ctx.fill();
    }
    ctx.strokeStyle = "black";
    ctx.stroke();
  };
  if (geo.ball && !hidden.has("ball")) disc(geo.ball);
  geo.discs.forEach((d, i) => d && !hidden.has(ref("discs", i)) && disc(d));

  // ---- Physics overlays -------------------------------------------------------------
  if (prefs.inflate !== "none") drawInflated(ctx, doc, geo, prefs.inflate, px);
  if (prefs.physBias) drawBias(ctx, geo, px);
  if (prefs.physRoles) drawRoles(ctx, doc, geo, px);

  // ---- Editor layers ---------------------------------------------------------------
  drawSpawns(ctx, geo, doc, hidden, px);

  geo.goals.forEach((g, i) => {
    if (!g || hidden.has(ref("goals", i))) return;
    ctx.save();
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = g.team === 1 ? RED : g.team === 2 ? BLUE : "#aaa";
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([8 * px, 4 * px]);
    ctx.beginPath();
    ctx.moveTo(...g.p0);
    ctx.lineTo(...g.p1);
    ctx.stroke();
    ctx.restore();
  });

  geo.planes.forEach((p, i) => {
    if (!p || hidden.has(ref("planes", i))) return;
    drawPlane(ctx, p, px, "rgba(255,214,102,0.8)");
  });

  // Hover and selection on top of everything.
  const highlight = (r: Ref, color: string, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    drawRefShape(ctx, doc, geo, r, px);
    ctx.restore();
  };
  if (view.hover && !sel.has(view.hover)) highlight(view.hover, ACCENT, 0.55);
  for (const r of overlay.highlight ?? []) highlight(r, "#ffd166", 0.9);
  // A whole smart object shows its lines, not a ring on every vertex.
  const groupSelected = smartSelected(doc, s.selection) !== null;
  for (const r of sel) if (!(groupSelected && r.startsWith("vertexes:"))) highlight(r, ACCENT, 1);

  // Vertex handles.
  if (prefs.showVertices || s.tool === "segment") {
    const size = 5 * px;
    // Generated vertexes are edited through their object's parameters: no handles
    // (unless picked one by one with Ctrl).
    const owned = new Set(doc.smart.flatMap((sm) => sm.items.vertexes ?? []));
    const wholeGroup = smartSelected(doc, s.selection) !== null;
    geo.vertexes.forEach((v, i) => {
      if (!v) return;
      const r = ref("vertexes", i);
      if (hidden.has(r)) return;
      if (owned.has(doc.lists.vertexes[i].id) && (wholeGroup || !sel.has(r))) return;
      const on = sel.has(r);
      if (!on && cam.zoom < 0.35) return;
      ctx.fillStyle = on ? ACCENT : "#ffffff";
      ctx.strokeStyle = on ? "#ffffff" : "rgba(10,14,22,0.9)";
      ctx.lineWidth = px;
      ctx.fillRect(v.x - size / 2, v.y - size / 2, size, size);
      ctx.strokeRect(v.x - size / 2, v.y - size / 2, size, size);
    });
  }

  if (overlay.curveHandle) {
    const [x, y] = overlay.curveHandle;
    const r = 5 * px;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 * px;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (prefs.showIssues) drawIssues(ctx, px);
  drawToolOverlay(ctx, px, [vx0, vy0, vx1, vy1]);
}

type GeoSeg = NonNullable<Geo["segments"][number]>;

// The band where a wall pushes a disc center: from `a` to `b` along the
// segment's normal (outward from the center for arcs), within its span.
function band(ctx: CanvasRenderingContext2D, s: GeoSeg, a: number, b: number): void {
  ctx.beginPath();
  if (s.curved) {
    const a0 = Math.atan2(s.y0 - s.cy, s.x0 - s.cx);
    const a1 = Math.atan2(s.y1 - s.cy, s.x1 - s.cx);
    ctx.arc(s.cx, s.cy, Math.max(0, s.radius + b), a0, a1);
    ctx.arc(s.cx, s.cy, Math.max(0, s.radius + a), a1, a0, true);
  } else {
    ctx.moveTo(s.x0 + s.nx * a, s.y0 + s.ny * a);
    ctx.lineTo(s.x1 + s.nx * a, s.y1 + s.ny * a);
    ctx.lineTo(s.x1 + s.nx * b, s.y1 + s.ny * b);
    ctx.lineTo(s.x0 + s.nx * b, s.y0 + s.ny * b);
  }
  ctx.closePath();
  ctx.fill();
}

// Where the chosen body's center cannot go: walls inflated by its radius.
function drawInflated(ctx: CanvasRenderingContext2D, doc: Doc, geo: Geo, which: "ball" | "red" | "blue", px: number): void {
  const body = bodies(doc, geo).find((b) => b.key === which);
  if (!body) return;
  const r = body.radius;
  ctx.save();
  ctx.fillStyle = which === "ball" ? "rgba(251,191,36,0.22)" : which === "red" ? "rgba(255,90,95,0.22)" : "rgba(78,161,255,0.22)";
  for (const s of geo.segments) {
    if (!s || !canCollide(body, s)) continue;
    // Positive bias pushes along the normal and reaches |bias| behind it.
    const sign = s.bias < 0 ? -1 : 1;
    if (s.bias === 0) band(ctx, s, -r, r);
    else if (sign > 0) band(ctx, s, -Math.abs(s.bias), r);
    else band(ctx, s, -r, Math.abs(s.bias));
  }
  for (const v of geo.vertexes) {
    if (!v || !canCollide(body, v)) continue;
    ctx.beginPath();
    ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of geo.planes) {
    if (!p || !canCollide(body, p)) continue;
    const [a, b] = planeLine(p);
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineTo(b[0] + p.nx * r, b[1] + p.ny * r);
    ctx.lineTo(a[0] + p.nx * r, a[1] + p.ny * r);
    ctx.closePath();
    ctx.fill();
  }
  // The body itself, at its starting points, for scale.
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1.5 * px;
  for (const st of body.starts) {
    ctx.beginPath();
    ctx.arc(st[0], st[1], r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Bias: the extra thickness behind a wall (orange) and the side it pushes to.
function drawBias(ctx: CanvasRenderingContext2D, geo: Geo, px: number): void {
  ctx.save();
  for (const s of geo.segments) {
    if (!s || s.bias === 0) continue;
    const sign = s.bias < 0 ? -1 : 1;
    ctx.fillStyle = "rgba(255,146,60,0.45)";
    band(ctx, s, sign > 0 ? -Math.abs(s.bias) : 0, sign > 0 ? 0 : Math.abs(s.bias));
    // An arrow at the middle, pointing where discs get pushed.
    let mx: number, my: number, nx: number, ny: number;
    if (s.curved) {
      const a0 = Math.atan2(s.y0 - s.cy, s.x0 - s.cx);
      const span = (((Math.atan2(s.y1 - s.cy, s.x1 - s.cx) - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const a = a0 + span / 2;
      nx = Math.cos(a);
      ny = Math.sin(a);
      mx = s.cx + nx * s.radius;
      my = s.cy + ny * s.radius;
    } else {
      mx = (s.x0 + s.x1) / 2;
      my = (s.y0 + s.y1) / 2;
      nx = s.nx;
      ny = s.ny;
    }
    nx *= sign;
    ny *= sign;
    const len = 16 * px;
    ctx.strokeStyle = "#ff923c";
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + nx * len, my + ny * len);
    ctx.lineTo(mx + nx * len * 0.6 - ny * 5 * px, my + ny * len * 0.6 + nx * 5 * px);
    ctx.moveTo(mx + nx * len, my + ny * len);
    ctx.lineTo(mx + nx * len * 0.6 + ny * 5 * px, my + ny * len * 0.6 - nx * 5 * px);
    ctx.stroke();
  }
  ctx.restore();
}

// Every wall colored by what it stops (see ROLE_STYLE).
function drawRoles(ctx: CanvasRenderingContext2D, doc: Doc, geo: Geo, px: number): void {
  const bs = bodies(doc, geo);
  ctx.save();
  ctx.lineWidth = 3 * px;
  for (const s of geo.segments) {
    if (!s) continue;
    const role = roleOf(s, bs);
    ctx.strokeStyle = ROLE_STYLE[role].color;
    ctx.setLineDash(role === "none" ? [4 * px, 4 * px] : []);
    strokeSegment(ctx, s);
  }
  ctx.setLineDash([]);
  for (const v of geo.vertexes) {
    if (!v) continue;
    const role = roleOf(v, bs);
    if (role === "none") continue;
    ctx.fillStyle = ROLE_STYLE[role].color;
    ctx.beginPath();
    ctx.arc(v.x, v.y, 3.5 * px, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const p of geo.planes) if (p) drawPlane(ctx, p, px, ROLE_STYLE[roleOf(p, bs)].color);
  ctx.restore();
}

const LEVEL_COLOR = { error: "#ff5a5f", warn: "#f5a524", info: "#4ea1ff" };

function drawIssues(ctx: CanvasRenderingContext2D, px: number): void {
  const list = issues.get().list;
  const focus = focusedIssue.get();
  ctx.save();
  for (const is of list) {
    const on = is.id === focus;
    const color = LEVEL_COLOR[is.level];
    if (is.path && is.path.length > 1) {
      ctx.globalAlpha = on ? 1 : 0.55;
      ctx.strokeStyle = color;
      ctx.lineWidth = (on ? 3 : 2) * px;
      ctx.setLineDash([7 * px, 5 * px]);
      ctx.beginPath();
      is.path.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (is.at) {
      const [x, y] = is.at;
      const r = (on ? 9 : 7) * px;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(10,14,22,0.9)";
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#0b0e14";
      ctx.font = `800 ${r}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", x, y + r * 0.2);
    }
  }
  ctx.restore();
}

function strokeSegment(ctx: CanvasRenderingContext2D, g: NonNullable<Geo["segments"][number]>): void {
  ctx.beginPath();
  if (g.curved) ctx.arc(g.cx, g.cy, g.radius, Math.atan2(g.y0 - g.cy, g.x0 - g.cx), Math.atan2(g.y1 - g.cy, g.x1 - g.cx));
  else {
    ctx.moveTo(g.x0, g.y0);
    ctx.lineTo(g.x1, g.y1);
  }
  ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D, grid: number, zoom: number, [x0, y0, x1, y1]: number[], px: number): void {
  let step = grid;
  while (step * zoom < 8) step *= 5;
  ctx.save();
  ctx.lineWidth = px;
  const lines = (major: boolean) => {
    const s = major ? step * 10 : step;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.strokeStyle = major ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.045)";
    ctx.stroke();
  };
  lines(false);
  lines(true);
  // Axes through the origin.
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(0, y1);
  ctx.moveTo(x0, 0);
  ctx.lineTo(x1, 0);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.stroke();
  ctx.restore();
}

function drawSpawns(ctx: CanvasRenderingContext2D, geo: Geo, doc: Doc, hidden: ReadonlySet<Ref>, px: number): void {
  const r = geo.playerRadius;
  const draw = (p: Vec, color: string, label: string, ghost: boolean) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.globalAlpha = ghost ? 0.25 : 0.5;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = ghost ? 0.5 : 0.9;
    ctx.lineWidth = 1.5 * px;
    if (ghost) ctx.setLineDash([3 * px, 3 * px]);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.globalAlpha = ghost ? 0.6 : 1;
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${11 * px}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, p[0], p[1]);
    ctx.restore();
  };
  for (const [list, color] of [
    ["redSpawnPoints", RED],
    ["blueSpawnPoints", BLUE],
  ] as const) {
    const pts = geo[list];
    // Without spawn points, players start at ±spawnDistance on the x axis.
    if (pts.length === 0) {
      const x = (list === "redSpawnPoints" ? -1 : 1) * geo.stadium.spawnDistance;
      draw([x, 0], color, "", true);
    }
    pts.forEach((p, i) => p && !hidden.has(refOf(list, doc.lists[list][i].id)) && draw(p, color, String(i + 1), false));
  }
}

function drawPlane(ctx: CanvasRenderingContext2D, p: { nx: number; ny: number; dist: number }, px: number, color: string): void {
  const [a, b] = planeLine(p);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([10 * px, 6 * px]);
  ctx.beginPath();
  ctx.moveTo(...a);
  ctx.lineTo(...b);
  ctx.stroke();
  // Ticks on the side discs are kept on.
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5 * px;
  const cx = p.nx * p.dist;
  const cy = p.ny * p.dist;
  ctx.beginPath();
  for (let k = -20; k <= 20; k++) {
    const x = cx - p.ny * k * 40 * px * 2;
    const y = cy + p.nx * k * 40 * px * 2;
    ctx.moveTo(x, y);
    ctx.lineTo(x + p.nx * 8 * px, y + p.ny * 8 * px);
  }
  ctx.stroke();
  ctx.restore();
}

// Outline of one object, in the current stroke/fill style.
function drawRefShape(ctx: CanvasRenderingContext2D, doc: Doc, geo: Geo, r: Ref, px: number): void {
  if (r === "ball") {
    if (geo.ball) ring(ctx, [geo.ball.x, geo.ball.y], geo.ball.radius + 3 * px, px);
    return;
  }
  const [list, idStr] = r.split(":") as [keyof Doc["lists"], string];
  const i = doc.lists[list]?.findIndex((it) => it.id === Number(idStr)) ?? -1;
  if (i < 0) return;
  ctx.lineWidth = 2 * px;
  switch (list) {
    case "vertexes": {
      const v = geo.vertexes[i];
      if (v) ring(ctx, [v.x, v.y], 6 * px, px);
      break;
    }
    case "segments": {
      const g = geo.segments[i];
      if (!g) break;
      ctx.lineWidth = 3 * px;
      strokeSegment(ctx, g);
      break;
    }
    case "discs": {
      const d = geo.discs[i];
      if (d) ring(ctx, [d.x, d.y], Math.abs(d.radius) + 3 * px, px);
      break;
    }
    case "goals": {
      const g = geo.goals[i];
      if (!g) break;
      ctx.lineWidth = 4 * px;
      ctx.beginPath();
      ctx.moveTo(...g.p0);
      ctx.lineTo(...g.p1);
      ctx.stroke();
      break;
    }
    case "joints": {
      const j = geo.joints[i];
      if (!j) break;
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.moveTo(...j.a);
      ctx.lineTo(...j.b);
      ctx.stroke();
      break;
    }
    case "planes": {
      const p = geo.planes[i];
      if (p) drawPlane(ctx, p, px, ctx.strokeStyle as string);
      break;
    }
    case "redSpawnPoints":
    case "blueSpawnPoints": {
      const p = geo[list][i];
      if (p) ring(ctx, p, geo.playerRadius + 3 * px, px);
      break;
    }
  }
}

function ring(ctx: CanvasRenderingContext2D, p: Vec, r: number, px: number): void {
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawToolOverlay(ctx: CanvasRenderingContext2D, px: number, [x0, y0, x1, y1]: number[]): void {
  const o = overlay;
  ctx.save();
  if (o.snap?.gx !== undefined || o.snap?.gy !== undefined) {
    ctx.strokeStyle = "rgba(255,92,205,0.8)";
    ctx.lineWidth = px;
    ctx.beginPath();
    if (o.snap.gx !== undefined) {
      ctx.moveTo(o.snap.gx, y0);
      ctx.lineTo(o.snap.gx, y1);
    }
    if (o.snap.gy !== undefined) {
      ctx.moveTo(x0, o.snap.gy);
      ctx.lineTo(x1, o.snap.gy);
    }
    ctx.stroke();
  }
  if (o.lines) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.beginPath();
    for (const [a, b] of o.lines) {
      ctx.moveTo(...a);
      ctx.lineTo(...b);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.disc) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(o.disc.p[0], o.disc.p[1], o.disc.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (o.goal) {
    ctx.strokeStyle = o.goal.team === 1 ? RED : BLUE;
    ctx.lineWidth = 3 * px;
    ctx.beginPath();
    ctx.moveTo(...o.goal.p0);
    ctx.lineTo(...o.goal.p1);
    ctx.stroke();
  }
  if (o.plane) drawPlane(ctx, o.plane, px, ACCENT);
  if (o.marquee) {
    const [a, b] = o.marquee;
    ctx.fillStyle = "rgba(91,140,255,0.12)";
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = px;
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  }
  if (o.snap && o.snap.kind !== "free" && o.snap.kind !== "grid") {
    const [x, y] = o.snap.p;
    const r = 6 * px;
    ctx.strokeStyle = "#ff5ccd";
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    if (o.snap.kind === "vertex" || o.snap.kind === "disc" || o.snap.kind === "origin") ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (o.snap.kind === "mid") {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
    } else if (o.snap.kind === "intersection") {
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
    } else ctx.rect(x - r / 2, y - r / 2, r, r);
    ctx.stroke();
  }
  if (o.label) {
    const [x, y] = o.label.p;
    ctx.font = `600 ${12 * px}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(o.label.text).width + 12 * px;
    const lx = x + 14 * px;
    const ly = y + 14 * px;
    ctx.fillStyle = "rgba(12,16,26,0.92)";
    ctx.beginPath();
    ctx.roundRect(lx, ly, w, 20 * px, 5 * px);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(o.label.text, lx + 6 * px, ly + 10 * px);
  }
  ctx.restore();
}
