// Pointer and keyboard handling on the canvas, one state machine per tool.
// Tools edit the document through commit() (one undo step per action, or
// one per gesture for drags) and describe their previews in `overlay`.
import type { Json } from "../doc/json";
import type { Doc } from "../doc/model";
import { addItems, ballOffset, copyRefs, findItem, movableRefs, obj, pasteClip, refOf, setProp, translateRefs, type Ref } from "../doc/ops";
import { resolve } from "../doc/resolve";
import { overlay } from "./draw";
import { createSmart, isLinked, refsOf, shiftSmart, smartOf, smartSelected } from "../smart/smart";
import { tr } from "../i18n";
import { toast } from "./toast";
import { curveThrough, hitTest, marquee, roundFor, segmentMid, snap, type Snap, type Vec } from "./geom";
import { beginGesture, commit, ed, editor, endGesture, patch, prefs, requestDraw, select, view, type ToolId } from "./state";

// ---- Coordinates ----------------------------------------------------------------

export const toWorld = (sx: number, sy: number): Vec => [(sx - view.width / 2) / view.cam.zoom + view.cam.x, (sy - view.height / 2) / view.cam.zoom + view.cam.y];

export function zoomAt(sx: number, sy: number, factor: number): void {
  const before = toWorld(sx, sy);
  view.cam.zoom = Math.max(0.05, Math.min(40, view.cam.zoom * factor));
  const after = toWorld(sx, sy);
  view.cam.x += before[0] - after[0];
  view.cam.y += before[1] - after[1];
  requestDraw();
}

// Fits the camera limits (or the content, when larger) in the view.
export function fitView(): void {
  const doc = ed().doc;
  const geo = resolve(doc);
  let x0 = -geo.stadium.width;
  let x1 = geo.stadium.width;
  let y0 = -geo.stadium.height;
  let y1 = geo.stadium.height;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const v of geo.vertexes) if (v) grow(v.x, v.y);
  for (const d of geo.discs) if (d) grow(d.x, d.y);
  if (x1 - x0 < 1 || y1 - y0 < 1) [x0, x1, y0, y1] = [-400, 400, -200, 200];
  const margin = 60;
  view.cam.zoom = Math.max(0.05, Math.min((view.width - margin * 2) / (x1 - x0), (view.height - margin * 2) / (y1 - y0), 8));
  view.cam.x = (x0 + x1) / 2;
  view.cam.y = (y0 + y1) / 2;
  requestDraw();
}

// ---- Tool state -------------------------------------------------------------------

type Drag =
  | { kind: "pan"; sx: number; sy: number; cx: number; cy: number }
  | { kind: "move"; start: Vec; anchor: Vec; base: Doc; moving: ReturnType<typeof movableRefs>; skip: Set<Ref>; moved: boolean }
  | { kind: "marquee"; start: Vec; base: Ref[]; additive: boolean; moved: boolean }
  | { kind: "curve"; ref: Ref; a: Vec; b: Vec; useCurveF: boolean }
  | { kind: "disc"; ref: Ref; center: Vec }
  | { kind: "goal"; p0: Vec }
  | { kind: "plane"; p0: Vec };

let drag: Drag | null = null;
// Segment tool: the vertex the next segment starts from, and the first one.
let chain: { last: number; first: number } | null = null;
// Joint tool: the first disc picked (as a joint index).
let jointFirst: { index: number; ref: Ref } | null = null;
// Numbers typed while drawing a segment ("120" or "120<45").
let typed = "";
let spaceDown = false;
let lastPointer: Vec = [0, 0];

const doc = () => ed().doc;
const geo = () => resolve(doc());
const round = () => roundFor(view.cam.zoom);
const skipRef = (r: Ref) => ed().hidden.has(r) || ed().locked.has(r);
const indexOf = (d: Doc, ref: Ref) => findItem(d, ref)?.index ?? -1;
const withTrait = (v: Record<string, Json>): Json => {
  const t = ed().drawTrait;
  return t ? { ...v, trait: t } : v;
};

export function setTool(tool: ToolId): void {
  finishChain();
  jointFirst = null;
  typed = "";
  clearOverlay();
  patch({ tool });
  requestDraw();
}

function clearOverlay(): void {
  for (const k of Object.keys(overlay)) delete overlay[k as keyof typeof overlay];
}

function finishChain(): void {
  chain = null;
  typed = "";
  delete overlay.lines;
  delete overlay.label;
}

const activeTool = (): ToolId => (spaceDown ? "hand" : ed().tool);

function snapAt(p: Vec, e: { shiftKey: boolean; altKey: boolean }, anchor?: Vec, skip?: (r: Ref) => boolean): Snap {
  return snap(doc(), geo(), p, { zoom: view.cam.zoom, prefs: prefs.get(), anchor, angleLock: e.shiftKey && !!anchor, free: e.altKey, skip });
}

const fmt = (n: number) => String(Math.round(n * 10) / 10);
const measure = (a: Vec, b: Vec) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Angles as on paper: 0° to the right, 90° up.
  const ang = (-Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  return `${fmt(len)}  ∠ ${fmt(ang < 0 ? ang + 360 : ang)}°`;
};

// ---- Selection tool helpers ----------------------------------------------------------

// The curve handle of the only selected segment, if any.
function curveHandle(): { ref: Ref; p: Vec; a: Vec; b: Vec; useCurveF: boolean } | null {
  // Also runs while the editor closes, when there is no map anymore.
  const s = editor.get();
  if (!s || s.tool !== "select" || s.selection.length !== 1) return null;
  const f = findItem(s.doc, s.selection[0]);
  if (!f || f.list !== "segments") return null;
  const g = geo().segments[f.index];
  if (!g) return null;
  const raw = obj(f.item.v);
  const va = geo().vertexes[raw.v0 as number];
  const vb = geo().vertexes[raw.v1 as number];
  if (!va || !vb) return null;
  return { ref: s.selection[0], p: segmentMid(g), a: [va.x, va.y], b: [vb.x, vb.y], useCurveF: raw.curveF != null };
}

export function refreshOverlay(): void {
  const h = curveHandle();
  if (h) overlay.curveHandle = h.p;
  else delete overlay.curveHandle;
}

// ---- Pointer events ------------------------------------------------------------------

export function pointerDown(e: PointerEvent, sx: number, sy: number): void {
  const p = toWorld(sx, sy);
  lastPointer = p;
  if (e.button === 1 || (e.button === 0 && activeTool() === "hand")) {
    drag = { kind: "pan", sx, sy, cx: view.cam.x, cy: view.cam.y };
    return;
  }
  if (e.button === 2) {
    // Right click ends what is being drawn.
    finishChain();
    jointFirst = null;
    delete overlay.highlight;
    requestDraw();
    return;
  }
  if (e.button !== 0) return;
  const tool = activeTool();
  const tol = 6 / view.cam.zoom;

  if (tool === "select") {
    const h = curveHandle();
    if (h && Math.hypot(p[0] - h.p[0], p[1] - h.p[1]) <= 8 / view.cam.zoom) {
      beginGesture();
      drag = { kind: "curve", ref: h.ref, a: h.a, b: h.b, useCurveF: h.useCurveF };
      return;
    }
    const hit = hitTest(doc(), geo(), p, { tol, skip: skipRef });
    if (!hit) {
      drag = { kind: "marquee", start: p, base: ed().selection, additive: e.shiftKey, moved: false };
      return;
    }
    // Generated items select as a group; Ctrl/Cmd picks one of them.
    const group = smartOf(doc(), hit);
    const hitRefs = group && !(e.ctrlKey || e.metaKey) ? refsOf(group.items) : [hit];
    let selection = ed().selection;
    if (e.shiftKey) {
      const on = selection.includes(hit);
      selection = on ? selection.filter((r) => !hitRefs.includes(r)) : [...selection, ...hitRefs.filter((r) => !selection.includes(r))];
      select(selection);
      return;
    }
    if (!selection.includes(hit)) selection = hitRefs;
    // Mirror copies follow their originals: they are not moved by hand.
    if (selection.some((r) => isLinked(smartOf(doc(), r)))) {
      select(selection);
      toast(tr("Cópias (espelho ou repetição) acompanham o original: mova o original, ou desvincule as cópias.", "Copies (mirror or repeat) follow the original: move the original, or unlink the copies."));
      return;
    }
    beginGesture();
    let base = doc();
    // Alt+drag drags a copy (a smart text stays a smart text).
    const textSmart = smartSelected(base, selection);
    if (e.altKey && textSmart?.kind === "text") {
      const made = createSmart(base, "text", textSmart.params);
      base = made.doc;
      selection = refsOf(made.smart.items);
      commit(base, selection);
    } else if (e.altKey && selection.every((r) => r !== "ball")) {
      const pasted = pasteClip(base, copyRefs(base, selection), 0, 0, (n) => n);
      base = pasted.doc;
      selection = pasted.refs;
      commit(base, selection);
    } else select(selection);
    const moving = movableRefs(base, selection);
    const skip = new Set<Ref>();
    for (const [list, ids] of moving) for (const id of ids) skip.add(refOf(list, id));
    for (const r of selection) skip.add(r);
    drag = { kind: "move", start: p, anchor: anchorOf(base, hit, p), base, moving, skip, moved: false };
    return;
  }

  if (tool === "segment") return segmentClick(p, e);

  if (tool === "vertex") {
    const s = snapAt(p, e);
    const r = addItems(doc(), "vertexes", [withTrait({ x: s.p[0], y: s.p[1] })]);
    commit(r.doc, [refOf("vertexes", r.ids[0])]);
    return;
  }

  if (tool === "disc") {
    const s = snapAt(p, e);
    beginGesture();
    const r = addItems(doc(), "discs", [withTrait({ pos: [s.p[0], s.p[1]] })]);
    const ref = refOf("discs", r.ids[0]);
    commit(r.doc, [ref]);
    drag = { kind: "disc", ref, center: s.p };
    return;
  }

  if (tool === "goal" || tool === "plane") {
    const s = snapAt(p, e);
    drag = tool === "goal" ? { kind: "goal", p0: s.p } : { kind: "plane", p0: s.p };
    return;
  }

  if (tool === "joint") {
    const hit = hitTest(doc(), geo(), p, { tol, skip: (r) => skipRef(r) || !(r === "ball" || r.startsWith("discs:")) });
    if (!hit) return;
    const index = hit === "ball" ? 0 : indexOf(doc(), hit) + ballOffset(doc());
    if (!jointFirst) {
      jointFirst = { index, ref: hit };
      overlay.highlight = [hit];
      requestDraw();
      return;
    }
    if (index !== jointFirst.index) {
      const r = addItems(doc(), "joints", [withTrait({ d0: jointFirst.index, d1: index })]);
      commit(r.doc, [refOf("joints", r.ids[0])]);
    }
    jointFirst = null;
    delete overlay.highlight;
    delete overlay.lines;
    requestDraw();
    return;
  }

  if (tool === "text") {
    const s = snapAt(p, e);
    const made = createSmart(doc(), "text", { text: tr("TEXTO", "TEXT"), x: s.p[0], y: s.p[1] });
    commit(made.doc, refsOf(made.smart.items));
    setTool("select");
    return;
  }

  if (tool === "redSpawn" || tool === "blueSpawn") {
    const s = snapAt(p, e);
    const list = tool === "redSpawn" ? "redSpawnPoints" : "blueSpawnPoints";
    const r = addItems(doc(), list, [[s.p[0], s.p[1]]]);
    commit(r.doc, [refOf(list, r.ids[0])]);
  }
}

// Where a dragged object "is", for snapping: its point, or the grabbed point.
function anchorOf(d: Doc, hit: Ref, p: Vec): Vec {
  const g = resolve(d);
  if (hit === "ball") return g.ball ? [g.ball.x, g.ball.y] : p;
  const f = findItem(d, hit);
  if (!f) return p;
  if (f.list === "vertexes") {
    const v = g.vertexes[f.index];
    if (v) return [v.x, v.y];
  }
  if (f.list === "discs") {
    const c = g.discs[f.index];
    if (c) return [c.x, c.y];
  }
  if (f.list === "redSpawnPoints" || f.list === "blueSpawnPoints") return g[f.list][f.index] ?? p;
  if (f.list === "segments") {
    // Grab the nearest endpoint so it snaps onto other points.
    const s = g.segments[f.index];
    if (s) return Math.hypot(p[0] - s.x0, p[1] - s.y0) < Math.hypot(p[0] - s.x1, p[1] - s.y1) ? [s.x0, s.y0] : [s.x1, s.y1];
  }
  if (f.list === "goals") {
    const go = g.goals[f.index];
    if (go) return Math.hypot(p[0] - go.p0[0], p[1] - go.p0[1]) < Math.hypot(p[0] - go.p1[0], p[1] - go.p1[1]) ? go.p0 : go.p1;
  }
  return p;
}

function segmentClick(p: Vec, e: PointerEvent): void {
  const d = doc();
  const g = resolve(d);
  const anchor = chain ? g.vertexes[chain.last] : null;
  const s = snapAt(p, e, anchor ? [anchor.x, anchor.y] : undefined);
  placeSegmentPoint(s);
}

function placeSegmentPoint(s: Snap): void {
  let d = doc();
  // Reuse the vertex under the cursor, so segments connect.
  let index = s.ref ? indexOf(d, s.ref) : -1;
  const created: Ref[] = [];
  if (index < 0) {
    const r = addItems(d, "vertexes", [withTrait({ x: s.p[0], y: s.p[1] })]);
    d = r.doc;
    index = d.lists.vertexes.length - 1;
    created.push(refOf("vertexes", r.ids[0]));
  }
  if (!chain) {
    chain = { last: index, first: index };
    if (d !== doc()) commit(d, created);
    return;
  }
  if (index === chain.last) return;
  const r = addItems(d, "segments", [withTrait({ v0: chain.last, v1: index })]);
  commit(r.doc, [refOf("segments", r.ids[0])]);
  typed = "";
  if (index === chain.first) finishChain();
  else chain = { last: index, first: chain.first };
  requestDraw();
}

export function pointerMove(e: PointerEvent, sx: number, sy: number): void {
  const p = toWorld(sx, sy);
  lastPointer = p;
  const tool = activeTool();

  if (drag?.kind === "pan") {
    view.cam.x = drag.cx - (sx - drag.sx) / view.cam.zoom;
    view.cam.y = drag.cy - (sy - drag.sy) / view.cam.zoom;
    requestDraw();
    return;
  }

  if (drag?.kind === "move") {
    const dist = Math.hypot(p[0] - drag.start[0], p[1] - drag.start[1]) * view.cam.zoom;
    if (!drag.moved && dist < 3) return;
    drag.moved = true;
    const skip = drag.skip;
    const target: Vec = [drag.anchor[0] + p[0] - drag.start[0], drag.anchor[1] + p[1] - drag.start[1]];
    const s = snapAt(target, e, drag.anchor, (r) => skip.has(r));
    overlay.snap = s;
    const dx = s.p[0] - drag.anchor[0];
    const dy = s.p[1] - drag.anchor[1];
    // Always from the base doc, so rounding never accumulates; smart objects
    // moved as a whole take their anchor along.
    commit(shiftSmart(translateRefs(drag.base, drag.moving, dx, dy, round()), ed().selection, dx, dy));
    overlay.label = { p, text: `Δ ${fmt(dx)}, ${fmt(dy)}` };
    refreshOverlay();
    return;
  }

  if (drag?.kind === "marquee") {
    drag.moved = true;
    overlay.marquee = [drag.start, p];
    const inside = marquee(doc(), geo(), drag.start, p, skipRef);
    const set = new Set(drag.additive ? [...drag.base, ...inside] : inside);
    select([...set]);
    return;
  }

  if (drag?.kind === "curve") {
    let curve = Math.round(curveThrough(drag.a, drag.b, p));
    if (e.shiftKey) curve = Math.round(curve / 15) * 15;
    curve = Math.max(-340, Math.min(340, curve));
    const f = findItem(doc(), drag.ref);
    if (!f) return;
    let d = setProp(doc(), "segments", [f.item.id], "curveF", undefined);
    d = setProp(d, "segments", [f.item.id], "curve", Math.abs(curve) < 10 ? undefined : curve);
    commit(d);
    overlay.label = { p, text: Math.abs(curve) < 10 ? tr("reto", "straight") : `${tr("curva", "curve")} ${curve}°` };
    refreshOverlay();
    return;
  }

  if (drag?.kind === "disc") {
    const r = Math.max(1, Math.round(Math.hypot(p[0] - drag.center[0], p[1] - drag.center[1])));
    const f = findItem(doc(), drag.ref);
    if (f) commit(setProp(doc(), "discs", [f.item.id], "radius", r === 10 ? undefined : r));
    overlay.label = { p, text: `${tr("raio", "radius")} ${r}` };
    return;
  }

  if (drag?.kind === "goal" || drag?.kind === "plane") {
    const s = snapAt(p, e, drag.p0);
    overlay.snap = s;
    if (drag.kind === "goal") overlay.goal = { p0: drag.p0, p1: s.p, team: goalTeam(drag.p0, s.p) };
    else overlay.plane = planeFrom(drag.p0, s.p) ?? undefined;
    overlay.label = { p: s.p, text: measure(drag.p0, s.p) };
    requestDraw();
    return;
  }

  // Hover and previews with no button down.
  if (tool === "select" || tool === "joint") {
    const tol = 6 / view.cam.zoom;
    const hit = hitTest(doc(), geo(), p, {
      tol,
      skip: tool === "joint" ? (r) => skipRef(r) || !(r === "ball" || r.startsWith("discs:")) : skipRef,
    });
    if (hit !== view.hover) {
      view.hover = hit;
      requestDraw();
    }
    if (tool === "joint" && jointFirst) {
      const g = geo();
      const a = jointFirst.ref === "ball" ? g.ball : g.discs[findItem(doc(), jointFirst.ref)?.index ?? -1];
      if (a) overlay.lines = [[[a.x, a.y], p]];
      requestDraw();
    }
    return;
  }
  if (view.hover) view.hover = null;

  if (tool === "segment" || tool === "vertex" || tool === "disc" || tool === "goal" || tool === "plane" || tool === "redSpawn" || tool === "blueSpawn" || tool === "text") {
    const anchorV = tool === "segment" && chain ? geo().vertexes[chain.last] : null;
    const anchor: Vec | undefined = anchorV ? [anchorV.x, anchorV.y] : undefined;
    const s = snapAt(p, e, anchor);
    overlay.snap = s;
    if (anchor) {
      overlay.lines = [[anchor, s.p]];
      overlay.label = { p: s.p, text: typed ? `${typed}▏` : measure(anchor, s.p) };
    } else {
      delete overlay.lines;
      overlay.label = { p: s.p, text: `${fmt(s.p[0])}, ${fmt(s.p[1])}` };
    }
    requestDraw();
  }
}

export function pointerUp(e: PointerEvent, sx: number, sy: number): void {
  const p = toWorld(sx, sy);
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.kind === "move") {
    endGesture();
    delete overlay.snap;
    delete overlay.label;
    requestDraw();
  } else if (d.kind === "marquee") {
    delete overlay.marquee;
    if (!d.moved && !d.additive) select([]);
    requestDraw();
  } else if (d.kind === "curve" || d.kind === "disc") {
    endGesture();
    delete overlay.label;
    refreshOverlay();
    requestDraw();
  } else if (d.kind === "goal") {
    const s = snapAt(p, e, d.p0);
    delete overlay.goal;
    delete overlay.label;
    if (Math.hypot(s.p[0] - d.p0[0], s.p[1] - d.p0[1]) * view.cam.zoom < 4) return requestDraw();
    const r = addItems(doc(), "goals", [withTrait({ p0: d.p0, p1: s.p, team: goalTeam(d.p0, s.p) === 1 ? "red" : "blue" })]);
    commit(r.doc, [refOf("goals", r.ids[0])]);
  } else if (d.kind === "plane") {
    const s = snapAt(p, e, d.p0);
    delete overlay.plane;
    delete overlay.label;
    const pl = planeFrom(d.p0, s.p);
    if (!pl || Math.hypot(s.p[0] - d.p0[0], s.p[1] - d.p0[1]) * view.cam.zoom < 4) return requestDraw();
    const r = addItems(doc(), "planes", [withTrait({ normal: [pl.nx, pl.ny], dist: pl.dist })]);
    commit(r.doc, [refOf("planes", r.ids[0])]);
  }
}

// A goal on the left half is red's.
const goalTeam = (a: Vec, b: Vec): 1 | 2 => (a[0] + b[0] < 0 ? 1 : 2);

// The plane through a and b, facing the origin (where the field usually is).
function planeFrom(a: Vec, b: Vec): { nx: number; ny: number; dist: number } | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!len) return null;
  const r4 = (n: number) => Math.round(n * 1e4) / 1e4 + 0;
  let nx = r4(dy / len);
  let ny = r4(-dx / len);
  if (nx * -a[0] + ny * -a[1] < 0) [nx, ny] = [-nx + 0, -ny + 0];
  return { nx, ny, dist: roundFor(view.cam.zoom)(nx * a[0] + ny * a[1]) };
}

export function wheel(e: WheelEvent, sx: number, sy: number): void {
  if (e.shiftKey && !e.ctrlKey) {
    view.cam.x += (e.deltaY || e.deltaX) / view.cam.zoom;
    requestDraw();
    return;
  }
  const scale = e.deltaMode === 1 ? 40 : 1;
  zoomAt(sx, sy, Math.exp((-e.deltaY * scale) / (e.ctrlKey ? 120 : 500)));
}

// ---- Keyboard (only while the canvas has the user's attention) ---------------------

// Returns true when the key was used by the current tool.
export function toolKey(e: KeyboardEvent): boolean {
  if (e.key === " " && !e.repeat) {
    spaceDown = e.type === "keydown";
    return true;
  }
  if (e.type !== "keydown") return false;
  const tool = ed().tool;
  if (tool === "segment" && chain) {
    if (/^[0-9.<-]$/.test(e.key)) {
      typed += e.key;
      showTyped();
      return true;
    }
    if (e.key === "Backspace" && typed) {
      typed = typed.slice(0, -1);
      showTyped();
      return true;
    }
    if (e.key === "Enter") {
      if (typed) applyTyped();
      else finishChain();
      requestDraw();
      return true;
    }
    if (e.key === "Escape") {
      finishChain();
      requestDraw();
      return true;
    }
  }
  if (tool === "joint" && jointFirst && e.key === "Escape") {
    jointFirst = null;
    delete overlay.highlight;
    delete overlay.lines;
    requestDraw();
    return true;
  }
  return false;
}

export const isSpaceDown = () => spaceDown;
export const releaseSpace = () => {
  spaceDown = false;
};

function showTyped(): void {
  overlay.label = { p: lastPointer, text: `${typed}▏  (${tr("comprimento<ângulo", "length<angle")})` };
  requestDraw();
}

// "120" places the next point 120 units along the cursor's direction;
// "120<45" at 45° (0° = right, 90° = up).
function applyTyped(): void {
  if (!chain) return;
  const v = geo().vertexes[chain.last];
  const [lenStr, angStr] = typed.split("<");
  const len = Number(lenStr);
  typed = "";
  if (!v || !Number.isFinite(len)) return;
  let ang: number;
  if (angStr !== undefined && angStr !== "" && Number.isFinite(Number(angStr))) ang = (-Number(angStr) * Math.PI) / 180;
  else ang = Math.atan2(lastPointer[1] - v.y, lastPointer[0] - v.x);
  const r = round();
  placeSegmentPoint({ p: [r(v.x + Math.cos(ang) * len), r(v.y + Math.sin(ang) * len)], kind: "free" });
}

export function cancelTool(): boolean {
  if (chain || jointFirst || drag) {
    finishChain();
    jointFirst = null;
    drag = null;
    clearOverlay();
    refreshOverlay();
    requestDraw();
    return true;
  }
  return false;
}
