// Builds generated content as a Clip: vertexes are shared when two strokes
// meet at the same point with the same properties, segments refer to them by
// clip index.
import type { Json, JsonObject } from "../doc/json";
import type { Clip } from "../doc/ops";

export type Pt = [number, number];

const r6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

export class Builder {
  vertexes: JsonObject[] = [];
  segments: JsonObject[] = [];
  discs: JsonObject[] = [];
  goals: JsonObject[] = [];
  planes: JsonObject[] = [];
  red: Json[] = [];
  blue: Json[] = [];
  private index = new Map<string, number>();

  constructor(private round: (n: number) => number = (n) => Math.round(n * 100) / 100 + 0) {}

  r = (n: number) => this.round(n);

  vertex(p: Pt, props: JsonObject = {}): number {
    const x = this.r(p[0]);
    const y = this.r(p[1]);
    const key = `${x},${y},${JSON.stringify(props)}`;
    const hit = this.index.get(key);
    if (hit !== undefined) return hit;
    this.vertexes.push({ x, y, ...props });
    this.index.set(key, this.vertexes.length - 1);
    return this.vertexes.length - 1;
  }

  // A straight (curve 0) or curved segment from a to b. Zero-length ones are skipped.
  segment(a: Pt, b: Pt, curve: number, props: JsonObject = {}, vertexProps: JsonObject = {}): void {
    const v0 = this.vertex(a, vertexProps);
    const v1 = this.vertex(b, vertexProps);
    if (v0 === v1) return;
    const c = r6(curve);
    this.segments.push({ v0, v1, ...(Math.abs(c) >= 0.01 && { curve: Math.round(c * 100) / 100 }), ...props });
  }

  clip(): Clip {
    const out: Clip = {};
    if (this.vertexes.length) out.vertexes = this.vertexes;
    if (this.segments.length) out.segments = this.segments;
    if (this.discs.length) out.discs = this.discs;
    if (this.goals.length) out.goals = this.goals;
    if (this.planes.length) out.planes = this.planes;
    if (this.red.length) out.redSpawnPoints = this.red;
    if (this.blue.length) out.blueSpawnPoints = this.blue;
    return out;
  }
}

// Mirroring a segment (one reflection) and drawing it backwards keeps its
// curve and bias on the same side, so a reflected arc is (m(b) -> m(a), same curve).
export function reflected(a: Pt, b: Pt, sx: 1 | -1, sy: 1 | -1): [Pt, Pt] {
  const ma: Pt = [a[0] * sx, a[1] * sy];
  const mb: Pt = [b[0] * sx, b[1] * sy];
  return sx * sy < 0 ? [mb, ma] : [ma, mb];
}
