// Canvas renderer ported from HaxBall's game client (camera, view modes,
// background textures, draw order and decorations).
import { Input, type Game, type Player } from "../shared/game";
import { DEFAULT_COLORS, type TeamColors } from "../shared/protocol";
import type { Stadium } from "../shared/stadium";
import type { RenderStyle } from "./settings";
import concreteUrl from "./images/concrete.png";
import concrete2Url from "./images/concrete2.png";
import grassUrl from "./images/grass.png";

const SPECTATOR_COLOR = 0x888888;
const KICKR_FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif";

// HaxBall's "Viewport Mode" setting: -1 Dynamic, 0 Restricted 840x410,
// 1..7 Full 1x..2.5x zoom. Keys 0-7 select modes 0-7, like the original.
export const VIEW_MODES: [number, string][] = [
  [-1, "Dynamic"],
  [0, "Restricted 840x410"],
  ...[1, 2, 3, 4, 5, 6, 7].map((m): [number, string] => [m, `Full ${1 + 0.25 * (m - 1)}x Zoom`]),
];

export interface Camera {
  x: number;
  y: number;
}

export interface View {
  mode: number;
  // Height in CSS px covered by the chat at the bottom of the canvas.
  bottomInset: number;
  // Seconds since the last frame.
  dt: number;
  style: RenderStyle;
  colors: [TeamColors, TeamColors];
  avatars: Record<number, string>;
}

export const defaultView = (): View => ({
  mode: -1,
  bottomInset: 0,
  dt: 0,
  style: "kickr",
  colors: DEFAULT_COLORS,
  avatars: {},
});

const teamColor = (view: View, team: number) => (team === 1 || team === 2 ? view.colors[team - 1].stripes[0] : SPECTATOR_COLOR);

const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;

const images = { grass: loadImage(grassUrl), concrete: loadImage(concreteUrl), concrete2: loadImage(concrete2Url) };
let patterns: Record<keyof typeof images, CanvasPattern | null> | null = null;

function loadImage(src: string): HTMLImageElement {
  const img = new Image();
  img.src = src;
  return img;
}

function getPatterns(ctx: CanvasRenderingContext2D) {
  if (patterns) return patterns;
  const imgs = Object.values(images);
  if (!imgs.every((i) => i.complete && i.naturalWidth > 0)) return null;
  patterns = {
    grass: ctx.createPattern(images.grass, "repeat"),
    concrete: ctx.createPattern(images.concrete, "repeat"),
    concrete2: ctx.createPattern(images.concrete2, "repeat"),
  };
  return patterns;
}

export function render(ctx: CanvasRenderingContext2D, stadium: Stadium, g: Game, myId: number, cam: Camera, view: View): void {
  const { width: cw, height: ch } = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;

  // Zoom and the area left between the score bar (top) and the chat (bottom).
  let zoom = view.mode === -1 ? ch / 610 : (view.mode === 0 ? 1 : 1 + 0.25 * (view.mode - 1)) * dpr;
  const top = view.mode === 0 ? 0 : 35;
  const bottom = view.mode === 0 ? 0 : view.bottomInset * dpr;
  let viewW = cw / zoom;
  if (stadium.maxViewWidth > 0 && viewW > stadium.maxViewWidth) {
    viewW = stadium.maxViewWidth;
    zoom = cw / viewW;
  }
  const viewH = (ch - top - bottom) / zoom;

  const me = g.players.find((p) => p.id === myId);
  const myDisc = me && me.disc >= 0 ? g.discs[me.disc] : undefined;
  updateCamera(cam, stadium, g, myDisc, viewW, viewH, view.dt);

  ctx.translate(cw / 2, (ch + top - bottom) / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);
  ctx.lineWidth = 3;
  const kickr = view.style === "kickr";
  if (kickr && stadium.bg.type === "grass") drawKickrGrass(ctx, stadium);
  else if (kickr && stadium.bg.type === "hockey") drawKickrCourt(ctx, stadium, view);
  else drawBackground(ctx, stadium, cam);

  for (const s of stadium.segments) {
    if (!s.vis || s.color === -1) continue;
    ctx.beginPath();
    ctx.strokeStyle = hex(s.color);
    if (s.curved) {
      ctx.arc(s.cx, s.cy, s.radius, Math.atan2(s.y0 - s.cy, s.x0 - s.cx), Math.atan2(s.y1 - s.cy, s.x1 - s.cx));
    } else {
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
    }
    ctx.stroke();
  }

  for (const j of stadium.joints) {
    const a = g.discs[j.d0];
    const b = g.discs[j.d1];
    if (!a || !b || j.color < 0) continue;
    ctx.beginPath();
    ctx.strokeStyle = hex(j.color);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const players = g.players.filter((p) => p.disc >= 0 && g.discs[p.disc]);

  // Arrows at the screen edge pointing to the ball and off-screen players.
  if (g.discs[0]) drawIndicator(ctx, cam, g.discs[0], stadium.discs[0]?.color ?? 0xffffff, viewW, viewH);
  for (const p of players) drawIndicator(ctx, cam, g.discs[p.disc], teamColor(view, p.team), viewW, viewH);

  if (kickr) drawKickrDiscs(ctx, stadium, g, players, myId, view);
  else drawClassicDiscs(ctx, stadium, g, players, myId, view);
}

function drawClassicDiscs(ctx: CanvasRenderingContext2D, stadium: Stadium, g: Game, players: Player[], myId: number, view: View): void {
  // Names below the players (not our own), then a halo around ours.
  ctx.font = "13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFFFFF";
  for (const p of players) {
    if (p.id === myId) continue;
    const d = g.discs[p.disc];
    ctx.fillText(p.name, d.x, d.y + 30.5, 80);
  }
  const me = players.find((p) => p.id === myId);
  if (me) {
    const d = g.discs[me.disc];
    ctx.beginPath();
    ctx.strokeStyle = "white";
    ctx.globalAlpha = 0.3;
    ctx.arc(d.x, d.y, 25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Players first, then the remaining discs in index order (ball first).
  ctx.lineWidth = 2;
  for (const p of players) {
    const d = g.discs[p.disc];
    const colors = p.team === 1 || p.team === 2 ? view.colors[p.team - 1] : null;
    drawStripes(ctx, d.x, d.y, d.radius, colors);
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    ctx.strokeStyle = p.kicking || (p.input & Input.kick) !== 0 ? "white" : "black";
    ctx.stroke();
    // Avatar text, laid out on HaxBall's 64x64 player texture.
    const k = d.radius / 32;
    ctx.fillStyle = hex(colors?.text ?? 0xffffff);
    ctx.font = `900 ${34 * k}px 'Arial Black','Arial Bold',Gadget,sans-serif`;
    ctx.fillText(avatarOf(p, view), d.x, d.y + 12 * k);
  }
  forOtherDiscs(stadium, g, players, (d, color) => {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    if (color !== -1) {
      ctx.fillStyle = hex(color);
      ctx.fill();
    }
    ctx.strokeStyle = "black";
    ctx.stroke();
  });
}

function drawKickrDiscs(ctx: CanvasRenderingContext2D, stadium: Stadium, g: Game, players: Player[], myId: number, view: View): void {
  // Shadows under everything, as if lit from the top left.
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (const p of players) shadow(ctx, g.discs[p.disc]);
  forOtherDiscs(stadium, g, players, (d, color) => color !== -1 && shadow(ctx, d));

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of players) {
    if (p.id === myId) continue;
    const d = g.discs[p.disc];
    nameTag(ctx, p.name, d.x, d.y + d.radius + 14);
  }

  // HaxBall's halo around our own player.
  const me = players.find((p) => p.id === myId);
  if (me) {
    const d = g.discs[me.disc];
    ctx.beginPath();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.3;
    ctx.arc(d.x, d.y, 25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const p of players) {
    const d = g.discs[p.disc];
    const colors = p.team === 1 || p.team === 2 ? view.colors[p.team - 1] : null;
    const kicking = p.kicking || (p.input & Input.kick) !== 0;
    if (kicking) {
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius + 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fill();
    }
    drawStripes(ctx, d.x, d.y, d.radius, colors);
    gloss(ctx, d);
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius - 1, 0, Math.PI * 2);
    ctx.lineWidth = kicking ? 3 : 2;
    ctx.strokeStyle = kicking ? "#FFFFFF" : "rgba(10,14,20,0.85)";
    ctx.stroke();
    const k = d.radius / 15;
    ctx.fillStyle = hex(colors?.text ?? 0xffffff);
    ctx.font = `italic 800 ${17 * k}px ${KICKR_FONT}`;
    ctx.fillText(avatarOf(p, view), d.x, d.y + 1 * k);
  }

  forOtherDiscs(stadium, g, players, (d, color, i) => {
    if (color === -1) return;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    ctx.fillStyle = hex(color);
    ctx.fill();
    if (i === 0) gloss(ctx, d);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(10,14,20,0.9)";
    ctx.stroke();
  });
}

const avatarOf = (p: Player, view: View) => view.avatars[p.id] || p.name.slice(0, 1).toUpperCase();

// Non-player discs in index order (ball first), stopping like HaxBall at the
// first one with a negative radius.
function forOtherDiscs(stadium: Stadium, g: Game, players: Player[], fn: (d: Game["discs"][number], color: number, i: number) => void): void {
  const playerDiscs = new Set(players.map((p) => p.disc));
  for (let i = 0; i < g.discs.length; i++) {
    if (playerDiscs.has(i)) continue;
    const d = g.discs[i];
    if (d.radius < 0) break;
    fn(d, stadium.discs[i]?.color ?? 0xffffff, i);
  }
}

// HaxBall's team uniform: up to 3 vertical stripes rotated by the angle.
function drawStripes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colors: TeamColors | null): void {
  const stripes = colors?.stripes ?? [SPECTATOR_COLOR];
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate(((colors?.angle ?? 0) * Math.PI) / 180);
  const w = (2 * r) / stripes.length;
  stripes.forEach((c, i) => {
    ctx.fillStyle = hex(c);
    // Overlap by a hair so no seam shows between stripes.
    ctx.fillRect(-r + i * w, -r, w + 0.5, 2 * r);
  });
  ctx.restore();
}

function shadow(ctx: CanvasRenderingContext2D, d: { x: number; y: number; radius: number }): void {
  ctx.beginPath();
  ctx.ellipse(d.x + d.radius * 0.18, d.y + d.radius * 0.3, d.radius, d.radius * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
}

function gloss(ctx: CanvasRenderingContext2D, d: { x: number; y: number; radius: number }): void {
  const r = d.radius;
  const grad = ctx.createRadialGradient(d.x - r * 0.4, d.y - r * 0.45, r * 0.1, d.x, d.y, r);
  grad.addColorStop(0, "rgba(255,255,255,0.35)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.05)");
  grad.addColorStop(1, "rgba(0,0,0,0.18)");
  ctx.beginPath();
  ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
}

function nameTag(ctx: CanvasRenderingContext2D, name: string, x: number, y: number): void {
  ctx.font = `600 12px ${KICKR_FONT}`;
  const w = Math.min(90, ctx.measureText(name).width) + 10;
  ctx.fillStyle = "rgba(8,12,18,0.55)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 8, w, 16, 8);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillText(name, x, y + 0.5, 80);
}

// Kickr's pitch: mowing stripes inside the field, crisp white markings.
function drawKickrGrass(ctx: CanvasRenderingContext2D, stadium: Stadium): void {
  const { width: w, height: h, kickOffRadius: r, cornerRadius } = stadium.bg;
  fillScreen(ctx, 0x16301f);
  ctx.save();
  roundedRect(ctx, -w, -h, 2 * w, 2 * h, cornerRadius);
  ctx.fillStyle = "#2E6B3C";
  ctx.fill();
  ctx.clip();
  const band = Math.max(30, (2 * w) / 14);
  ctx.fillStyle = "#337543";
  for (let x = -w, i = 0; x < w; x += band, i++) if (i % 2 === 0) ctx.fillRect(x, -h, band, 2 * h);
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  roundedRect(ctx, -w, -h, 2 * w, 2 * h, cornerRadius);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(0, h);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
}

// Follows the midpoint between the ball and our player, keeping our player
// at least 50 units inside the view; the stadium can ask to follow the player.
function updateCamera(cam: Camera, stadium: Stadium, g: Game, myDisc: Game["discs"][number] | undefined, viewW: number, viewH: number, dt: number): void {
  let x: number;
  let y: number;
  if (myDisc && stadium.cameraFollowPlayer) {
    x = myDisc.x;
    y = myDisc.y;
  } else {
    const ball = g.discs[0];
    x = ball?.x ?? 0;
    y = ball?.y ?? 0;
    if (myDisc) {
      x = Math.max(myDisc.x - viewW / 2 + 50, Math.min(myDisc.x + viewW / 2 - 50, (x + myDisc.x) / 2));
      y = Math.max(myDisc.y - viewH / 2 + 50, Math.min(myDisc.y + viewH / 2 - 50, (y + myDisc.y) / 2));
    }
  }
  if (x === x && y === y) {
    const t = Math.min(1, dt * 60) * 0.04;
    cam.x += (x - cam.x) * t;
    cam.y += (y - cam.y) * t;
  }

  if (viewW > 2 * stadium.width) cam.x = 0;
  else if (cam.x + viewW / 2 > stadium.width) cam.x = stadium.width - viewW / 2;
  else if (cam.x - viewW / 2 < -stadium.width) cam.x = -stadium.width + viewW / 2;
  if (viewH > 2 * stadium.height) cam.y = 0;
  else if (cam.y + viewH / 2 > stadium.height) cam.y = stadium.height - viewH / 2;
  else if (cam.y - viewH / 2 < -stadium.height) cam.y = -stadium.height + viewH / 2;
}

function drawIndicator(ctx: CanvasRenderingContext2D, cam: Camera, pos: { x: number; y: number }, color: number, viewW: number, viewH: number): void {
  const hw = viewW / 2 - 25;
  const hh = viewH / 2 - 25;
  const x = cam.x + Math.max(-hw, Math.min(hw, pos.x - cam.x));
  const y = cam.y + Math.max(-hh, Math.min(hh, pos.y - cam.y));
  const dx = pos.x - x;
  const dy = pos.y - y;
  if (dx * dx + dy * dy <= 900) return;
  const angle = Math.atan2(dy, dx);
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  drawArrow(ctx, x + 2, y + 2, angle);
  ctx.fillStyle = hex(color);
  drawArrow(ctx, x - 2, y - 2, angle);
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(15, 0);
  ctx.lineTo(0, 7);
  ctx.lineTo(0, -7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Kickr's indoor court (maps with a "hockey" background, like futsal): a
// smooth polished floor instead of concrete, team-colored ends behind the
// goals, LED boards along the sides and the Kickr mark at center. The map's
// own segments draw the markings on top.
function drawKickrCourt(ctx: CanvasRenderingContext2D, stadium: Stadium, view: View): void {
  const { width: w, height: h, kickOffRadius: r } = stadium.bg;
  const outerW = Math.max(stadium.width, w);
  const outerH = Math.max(stadium.height, h);
  fillScreen(ctx, 0x0b1322);

  // Runoff around the court, and the team ends behind each goal line.
  ctx.fillStyle = "#14223a";
  ctx.fillRect(-outerW, -outerH, 2 * outerW, 2 * outerH);
  view.colors.forEach((c, i) => {
    const side = i === 0 ? -1 : 1;
    const grad = ctx.createLinearGradient(side * w, 0, side * outerW, 0);
    grad.addColorStop(0, `${hex(c.stripes[0])}55`);
    grad.addColorStop(1, `${hex(c.stripes[0])}10`);
    ctx.fillStyle = grad;
    ctx.fillRect(Math.min(side * w, side * outerW), -outerH, outerW - w, 2 * outerH);
  });

  // The floor: smooth, with a soft sheen in the middle.
  ctx.fillStyle = "#1d5f96";
  ctx.fillRect(-w, -h, 2 * w, 2 * h);
  const sheen = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h));
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-w, -h, 2 * w, 2 * h);
  // Center circle: a lime band, the Kickr accent.
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2, true);
  ctx.fillStyle = "rgba(198,255,61,0.10)";
  ctx.fill();

  ctx.save();
  // The wordmark, faint, in each half.
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `italic 900 ${Math.round(h * 0.42)}px ${KICKR_FONT}`;
  ctx.fillText("KICKR", -w / 2, 0);
  ctx.fillText("KICKR", w / 2, 0);
  ctx.restore();

  // LED boards in the runoff along both touch lines.
  const band = outerH - h;
  if (band >= 12) {
    const boardH = Math.min(18, band - 6);
    ctx.font = `italic 800 ${Math.round(boardH * 0.8)}px ${KICKR_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const side of [-1, 1]) {
      const y = side * (h + band / 2) - boardH / 2;
      ctx.fillStyle = "#070c16";
      ctx.fillRect(-w, y, 2 * w, boardH);
      ctx.fillStyle = "#c6ff3d";
      const step = boardH * 7;
      for (let x = -w + step / 2; x < w; x += step) ctx.fillText("KICKR", x, y + boardH / 2 + 0.5);
    }
  }
}

function fillScreen(ctx: CanvasRenderingContext2D, color: number): void {
  ctx.save();
  ctx.resetTransform();
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

// Fills the current path with a texture drawn at 2x, like HaxBall.
function fillTexture(ctx: CanvasRenderingContext2D, pattern: CanvasPattern | null | undefined, fallback: string): void {
  ctx.save();
  ctx.scale(2, 2);
  ctx.fillStyle = pattern ?? fallback;
  ctx.fill();
  ctx.restore();
}

export function drawBackground(ctx: CanvasRenderingContext2D, stadium: Stadium, cam: Camera): void {
  const { type, width: w, height: h, kickOffRadius: r, cornerRadius, goalLine, color } = stadium.bg;
  const pat = getPatterns(ctx);
  ctx.imageSmoothingEnabled = false;
  if (type === "grass") {
    fillScreen(ctx, color);
    ctx.strokeStyle = "#C7E6BD";
    roundedRect(ctx, -w, -h, 2 * w, 2 * h, cornerRadius);
    fillTexture(ctx, pat?.grass, "#6E8E54");
    ctx.moveTo(0, -h);
    ctx.lineTo(0, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === "hockey") {
    ctx.strokeStyle = "#E9CC6E";
    ctx.beginPath();
    ctx.rect(cam.x - 10000, cam.y - 10000, 20000, 20000);
    fillTexture(ctx, pat?.concrete2, "#525252");
    roundedRect(ctx, -w, -h, 2 * w, 2 * h, cornerRadius);
    fillTexture(ctx, pat?.concrete, "#5E5E5E");
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.setLineDash([15, 15]);
    ctx.lineTo(0, h);
    ctx.stroke();
    ctx.setLineDash([]);
    const lineX = goalLine < cornerRadius ? 0 : w - goalLine;
    const half = (strokeColor: string, x: number, ccw: boolean) => {
      ctx.beginPath();
      ctx.strokeStyle = strokeColor;
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, ccw);
      if (x !== 0) {
        ctx.moveTo(x, -h);
        ctx.lineTo(x, h);
      }
      ctx.stroke();
    };
    half("#85ACF3", lineX, false);
    half("#E18977", -lineX, true);
  } else {
    fillScreen(ctx, color);
  }
  ctx.imageSmoothingEnabled = true;
}

export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const x2 = x + w;
  const y2 = y + h;
  ctx.beginPath();
  ctx.moveTo(x2 - r, y);
  ctx.arcTo(x2, y, x2, y + r, r);
  ctx.lineTo(x2, y2 - r);
  ctx.arcTo(x2, y2, x2 - r, y2, r);
  ctx.lineTo(x + r, y2);
  ctx.arcTo(x, y2, x, y2 - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
