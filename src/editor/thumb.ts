// Small previews of a map (project cards, templates): background, visible
// segments and discs, fitted into the canvas.
import type { Doc } from "../doc/model";
import { resolve } from "../doc/resolve";
import { drawBackground } from "../vendor/kickr/client/render";
import type { Stadium } from "../vendor/kickr/shared/stadium";

const hex = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, "0")}`;

export function drawThumb(canvas: HTMLCanvasElement, doc: Doc): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const geo = resolve(doc);
  let x0 = -Math.max(geo.stadium.width, geo.stadium.bg.width, 1);
  let y0 = -Math.max(geo.stadium.height, geo.stadium.bg.height, 1);
  let x1 = -x0;
  let y1 = -y0;
  for (const v of geo.vertexes) {
    if (!v) continue;
    x0 = Math.min(x0, v.x);
    x1 = Math.max(x1, v.x);
    y0 = Math.min(y0, v.y);
    y1 = Math.max(y1, v.y);
  }
  const W = canvas.width;
  const H = canvas.height;
  const z = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.92;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  ctx.setTransform(z, 0, 0, z, W / 2 - cx * z, H / 2 - cy * z);
  ctx.lineWidth = 3;
  drawBackground(ctx, geo.stadium as Stadium, { x: cx, y: cy });
  ctx.lineWidth = Math.max(3, 1.2 / z);
  for (const s of geo.segments) {
    if (!s || !s.vis || s.color === -1) continue;
    ctx.strokeStyle = hex(s.color);
    ctx.beginPath();
    if (s.curved) ctx.arc(s.cx, s.cy, s.radius, Math.atan2(s.y0 - s.cy, s.x0 - s.cx), Math.atan2(s.y1 - s.cy, s.x1 - s.cx));
    else {
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
    }
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (const d of [geo.ball, ...geo.discs]) {
    if (!d || d.radius < 0) continue;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
    if (d.color !== -1) {
      ctx.fillStyle = hex(d.color);
      ctx.fill();
    }
    ctx.strokeStyle = "black";
    ctx.stroke();
  }
}
