// Raster images to outlines: threshold the pixels into a mask, follow the
// mask's borders (marching squares) and write them as an SVG path, which the
// shape object then simplifies and fits like any SVG.

export interface Mask {
  w: number;
  h: number;
  // 1 = part of the drawing.
  bits: Uint8Array;
}

export function maskFromPixels(rgba: Uint8ClampedArray, w: number, h: number, threshold: number, invert: boolean): Mask {
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]];
    if (a < 128) continue;
    const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < threshold;
    bits[i] = dark !== invert ? 1 : 0;
  }
  return { w, h, bits };
}

// Border loops of the mask, in pixel coordinates (corners between pixels).
export function traceMask(m: Mask, minLength = 12): [number, number][][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 0 : m.bits[y * m.w + x]);
  // Edge pieces between cell edge midpoints, in doubled coordinates so they are integers.
  const next = new Map<string, string[]>();
  const add = (a: [number, number], b: [number, number]) => {
    const ka = `${a[0]},${a[1]}`;
    const kb = `${b[0]},${b[1]}`;
    (next.get(ka) ?? next.set(ka, []).get(ka)!).push(kb);
    (next.get(kb) ?? next.set(kb, []).get(kb)!).push(ka);
  };
  for (let y = -1; y < m.h; y++) {
    for (let x = -1; x < m.w; x++) {
      // Corners are pixel centers (x, y) .. (x + 1, y + 1).
      const c = (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      const X = 2 * x + 1;
      const Y = 2 * y + 1;
      const top: [number, number] = [X + 1, Y];
      const right: [number, number] = [X + 2, Y + 1];
      const bottom: [number, number] = [X + 1, Y + 2];
      const left: [number, number] = [X, Y + 1];
      switch (c) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 5: add(left, top); add(bottom, right); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  }
  const loops: [number, number][][] = [];
  const used = new Set<string>();
  const edge = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const [start, outs] of next) {
    for (const first of outs) {
      if (used.has(edge(start, first))) continue;
      const loop = [start];
      let prev = start;
      let cur = first;
      used.add(edge(start, first));
      while (cur !== start) {
        loop.push(cur);
        const n = (next.get(cur) ?? []).find((k) => k !== prev && !used.has(edge(cur, k))) ?? (next.get(cur) ?? []).find((k) => !used.has(edge(cur, k)));
        if (!n) break;
        used.add(edge(cur, n));
        prev = cur;
        cur = n;
      }
      if (loop.length >= minLength) loops.push(smooth(loop.map((k) => k.split(",").map((v) => Number(v) / 2) as [number, number])));
    }
  }
  return loops;
}

// Pixel borders are staircases: average each point with its neighbours
// (a few passes) so curves come out as curves. The loop stays closed.
function smooth(loop: [number, number][], passes = 3): [number, number][] {
  let pts = loop;
  const n = pts.length;
  for (let k = 0; k < passes; k++) {
    pts = pts.map((_, i) => {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      return [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4];
    });
  }
  return [...pts, pts[0]];
}

export function loopsToSvg(loops: [number, number][][], w: number, h: number, color = "FFFFFF"): string {
  const d = loops.map((l) => `M${l.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" stroke="#${color}" fill="none"/></svg>`;
}
