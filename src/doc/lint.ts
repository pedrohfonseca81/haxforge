// Problems in a map, found while editing. Most checks are simple; the escape
// check floods the space each body can reach (walls inflated by its radius,
// with the same collision tests as the physics) to find gaps it slips through.
import { compileStadium } from "../vendor/kickr/shared/stadium";
import { lang, tr } from "../i18n";
import { bodies, canCollide, type Body } from "./bodies";
import { LIST_KEYS, toJson, type Doc } from "./model";
import { deleteRefs, obj, refOf, setField, type Ref } from "./ops";
import { budget, LIMIT, resolve, type Geo } from "./resolve";
import { traitsOf } from "./fields";

type Vec = [number, number];

export interface Issue {
  id: string;
  level: "error" | "warn" | "info";
  text: string;
  refs: Ref[];
  // Where to look (and where the canvas puts a marker).
  at?: Vec;
  // The way out, for escape problems.
  path?: Vec[];
  fix?: { label: string; apply: (doc: Doc) => Doc };
}

let cache = new WeakMap<Doc, Issue[]>();
let cacheLang = lang.get();
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function lint(doc: Doc): Issue[] {
  if (cacheLang !== lang.get()) {
    cache = new WeakMap<Doc, Issue[]>();
    cacheLang = lang.get();
  }
  const hit = cache.get(doc);
  if (hit) return hit;
  const geo = resolve(doc);
  const out: Issue[] = [];
  const ref = (list: (typeof LIST_KEYS)[number], i: number) => refOf(list, doc.lists[list][i].id);

  // ---- Broken objects and limits ----
  for (const [r, msg] of geo.errors) out.push({ id: `err:${r}`, level: "error", text: msg, refs: [r] });
  for (const b of budget(doc)) {
    if (b.used > LIMIT)
      out.push({
        id: `limit:${b.key}`,
        level: "error",
        text: tr(`${b.label}: ${b.used} de ${LIMIT}. O HaxBall não carrega mais que ${LIMIT}.`, `${b.label}: ${b.used} of ${LIMIT}. HaxBall cannot load more than ${LIMIT}.`),
        refs: [],
      });
  }
  if (!geo.errors.size) {
    try {
      compileStadium(toJson(doc, true));
    } catch (e) {
      out.push({ id: "compile", level: "error", text: tr(`O HaxBall recusaria o mapa: ${(e as Error).message}`, `HaxBall would reject the map: ${(e as Error).message}`), refs: [] });
    }
  }

  // ---- Segments ----
  const seen = new Map<string, number>();
  geo.segments.forEach((s, i) => {
    if (!s) return;
    const r = ref("segments", i);
    if (s.v0 === s.v1 || (s.x0 === s.x1 && s.y0 === s.y1)) {
      out.push({ id: `zero:${r}`, level: "warn", text: tr("Segmento de comprimento zero.", "Zero-length segment."), refs: [r], at: [s.x0, s.y0], fix: { label: tr("Apagar", "Delete"), apply: (d) => deleteRefs(d, [r]) } });
      return;
    }
    // The same segment drawn the other way round has its curve and bias negated.
    const raw = obj(doc.lists.segments[i].v);
    const flip = s.v0 > s.v1;
    const neg = (v: unknown) => (typeof v === "number" ? -v : v);
    const key = JSON.stringify({ ...raw, v0: Math.min(s.v0, s.v1), v1: Math.max(s.v0, s.v1), curve: flip ? neg(raw.curve) : raw.curve, bias: flip ? neg(raw.bias) : raw.bias });
    const first = seen.get(key);
    if (first !== undefined) {
      out.push({
        id: `dup:${r}`,
        level: "warn",
        text: tr(`Segmento repetido (igual ao #${first}).`, `Duplicate segment (same as #${first}).`),
        refs: [r],
        at: [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2],
        fix: { label: tr("Apagar a cópia", "Delete copy"), apply: (d) => deleteRefs(d, [r]) },
      });
    } else seen.set(key, i);
    const invisible = !s.vis || s.color === -1;
    if (invisible && (s.cMask === 0 || s.cGroup === 0)) {
      out.push({
        id: `noop:${r}`,
        level: "info",
        text: tr("Segmento invisível que não colide com nada.", "Invisible segment that collides with nothing."),
        refs: [r],
        at: [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2],
        fix: { label: tr("Apagar", "Delete"), apply: (d) => deleteRefs(d, [r]) },
      });
    }
  });

  // ---- Loose vertexes: invisible points that still collide ----
  const used = new Set<number>();
  for (const s of geo.segments) if (s) used.add(s.v0).add(s.v1);
  const loose: Ref[] = [];
  geo.vertexes.forEach((v, i) => v && !used.has(i) && v.cMask !== 0 && v.cGroup !== 0 && loose.push(ref("vertexes", i)));
  if (loose.length) {
    out.push({
      id: "loose",
      level: "info",
      text: tr(`${loose.length} vértice(s) solto(s): sem segmento, mas colidem como pontos invisíveis.`, `${loose.length} loose vertex(es): no segment, but still collide as invisible points.`),
      refs: loose,
      fix: { label: tr("Apagar", "Delete"), apply: (d) => deleteRefs(d, loose) },
    });
  }

  // ---- Goals ----
  if (doc.lists.goals.length === 0) out.push({ id: "nogoals", level: "info", text: tr("O mapa não tem gols: ninguém marca.", "The map has no goals: nobody can score."), refs: [] });
  const { width, height } = geo.stadium;
  geo.goals.forEach((g, i) => {
    if (!g) return;
    const r = ref("goals", i);
    if (g.p0[0] === g.p1[0] && g.p0[1] === g.p1[1]) out.push({ id: `goal0:${r}`, level: "error", text: tr("Gol de comprimento zero.", "Zero-length goal."), refs: [r], at: g.p0 });
  });

  // ---- Out of the camera's reach ----
  if (width > 0 && height > 0) {
    const outside: Ref[] = [];
    geo.segments.forEach((s, i) => {
      if (!s || !s.vis || s.color === -1) return;
      if (Math.max(Math.abs(s.x0), Math.abs(s.x1)) > width + 1 || Math.max(Math.abs(s.y0), Math.abs(s.y1)) > height + 1) outside.push(ref("segments", i));
    });
    if (outside.length) {
      out.push({
        id: "outside",
        level: "info",
        text: tr(
          `${outside.length} segmento(s) visível(is) além da área da câmera (largura/altura): pode ser que ninguém veja.`,
          `${outside.length} visible segment(s) outside the camera bounds (width/height): players might not see them.`,
        ),
        refs: outside,
      });
    }
  }

  // ---- Unused traits ----
  const traits = Object.keys(traitsOf(doc.fields));
  const usedTraits = new Set<string>();
  for (const list of LIST_KEYS) for (const it of doc.lists[list]) if (typeof obj(it.v).trait === "string") usedTraits.add(obj(it.v).trait as string);
  const bp = obj(doc.fields.ballPhysics ?? null);
  if (typeof bp.trait === "string") usedTraits.add(bp.trait);
  const unused = traits.filter((t) => !usedTraits.has(t));
  if (unused.length) {
    out.push({
      id: "traits",
      level: "info",
      text: tr(`Trait(s) sem uso: ${unused.join(", ")}.`, `Unused trait(s): ${unused.join(", ")}.`),
      refs: [],
      fix: {
        label: tr("Remover", "Remove"),
        apply: (d) => {
          const t = { ...traitsOf(d.fields) };
          for (const n of unused) delete t[n];
          return setField(d, "traits", t);
        },
      },
    });
  }

  // ---- Bodies: starting inside walls, escaping the map ----
  if (!geo.errors.size) {
    for (const b of bodies(doc, geo)) {
      for (const p of b.starts) {
        const wall = insideWall(doc, geo, b, p);
        if (wall)
          out.push({
            id: `start:${b.key}:${p}`,
            level: "warn",
            text: tr(`${cap(b.label)} começa dentro de ${wall.text}.`, `${cap(b.label)} starts inside ${wall.text}.`),
            refs: wall.ref ? [wall.ref] : [],
            at: p,
          });
      }
      const esc = escape(geo, b);
      if (esc) {
        out.push({
          id: `escape:${b.key}`,
          level: b.key === "ball" ? "error" : "warn",
          text:
            esc.kind === "nowalls"
              ? tr(
                  `Nada segura ${b.label}: não há paredes que colidam com ${b.key === "ball" ? "ela" : "ele"}.`,
                  `Nothing stops ${b.label}: there are no walls that collide with ${b.key === "ball" ? "it" : "them"}.`,
                )
              : tr(
                  `${cap(b.label)} consegue sair do mapa por um vão${b.key === "ball" ? "" : " (planos costumam fechar a área dos jogadores)"}.`,
                  `${cap(b.label)} can escape the map through a gap${b.key === "ball" ? "" : " (planes usually enclose the player area)"}.`,
                ),
          refs: [],
          at: esc.at,
          path: esc.path,
        });
      }
    }
  }

  const order = { error: 0, warn: 1, info: 2 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  cache.set(doc, out);
  return out;
}

// ---- Collision zones -------------------------------------------------------------------

// Whether a body centered at p would be pushed by a wall: the same tests as
// kickr's physics (arcs only within their span, segments only between their
// ends, bias making a wall one-sided and thicker).
function segmentHits(s: NonNullable<Geo["segments"][number]>, x: number, y: number, r: number): boolean {
  let dist: number;
  if (s.curved) {
    const rx = x - s.cx;
    const ry = y - s.cy;
    const inArc = 0 < s.t0x * rx + s.t0y * ry && 0 < s.t1x * rx + s.t1y * ry;
    if (inArc === s.curveF <= 0) return false;
    dist = Math.sqrt(rx * rx + ry * ry) - s.radius;
  } else {
    const ex = s.x1 - s.x0;
    const ey = s.y1 - s.y0;
    const px = x - s.x1;
    const py = y - s.y1;
    if (0 >= (x - s.x0) * ex + (y - s.y0) * ey || 0 <= px * ex + py * ey) return false;
    dist = s.nx * px + s.ny * py;
  }
  if (s.bias === 0) return Math.abs(dist) < r;
  if (s.bias < 0) dist = -dist;
  return dist >= -Math.abs(s.bias) && dist < r;
}

function insideWall(doc: Doc, geo: Geo, b: Body, p: Vec): { text: string; ref?: Ref } | null {
  const r = b.radius;
  for (let i = 0; i < geo.segments.length; i++) {
    const s = geo.segments[i];
    if (s && canCollide(b, s) && segmentHits(s, p[0], p[1], r)) return { text: tr(`um segmento (#${i})`, `a segment (#${i})`), ref: refOf("segments", doc.lists.segments[i].id) };
  }
  for (let i = 0; i < geo.vertexes.length; i++) {
    const v = geo.vertexes[i];
    if (v && canCollide(b, v) && Math.hypot(v.x - p[0], v.y - p[1]) < r) return { text: tr(`um vértice (#${i})`, `a vertex (#${i})`), ref: refOf("vertexes", doc.lists.vertexes[i].id) };
  }
  for (let i = 0; i < geo.planes.length; i++) {
    const pl = geo.planes[i];
    if (pl && canCollide(b, pl) && pl.dist - (pl.nx * p[0] + pl.ny * p[1]) + r > 0) return { text: tr(`um plano (#${i})`, `a plane (#${i})`), ref: refOf("planes", doc.lists.planes[i].id) };
  }
  return null;
}

const MAX_CELLS = 300_000;

// Floods from the body's start through every cell its center can reach. If
// the flood reaches the edge of the area around all walls, the body escapes;
// the path back to the start shows where.
function escape(geo: Geo, b: Body): { kind: "gap" | "nowalls"; at?: Vec; path?: Vec[] } | null {
  const r = b.radius;
  const segs = geo.segments.filter((s) => s && canCollide(b, s)) as NonNullable<Geo["segments"][number]>[];
  const verts = geo.vertexes.filter((v) => v && canCollide(b, v)) as NonNullable<Geo["vertexes"][number]>[];
  const planes = geo.planes.filter((p) => p && canCollide(b, p)) as NonNullable<Geo["planes"][number]>[];
  if (!segs.length && !verts.length && !planes.length) return { kind: "nowalls" };

  // The area: every wall point, plus the start, plus a margin.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const s of segs) {
    grow(s.x0, s.y0);
    grow(s.x1, s.y1);
    if (s.curved) {
      grow(s.cx - s.radius, s.cy - s.radius);
      grow(s.cx + s.radius, s.cy + s.radius);
    }
  }
  for (const v of verts) grow(v.x, v.y);
  for (const p of b.starts) grow(p[0], p[1]);
  const inner = { x0, y0, x1, y1 };
  // Planes far out (the usual fence around the players) must be inside the area.
  for (const p of planes) grow(p.nx * p.dist, p.ny * p.dist);
  if (!segs.length && !verts.length) {
    // Planes only: they close the area if the body is boxed in; use a large box.
    grow(x0 - 2000, y0 - 2000);
    grow(x1 + 2000, y1 + 2000);
  }
  const margin = 2 * r + 8;
  x0 -= margin;
  y0 -= margin;
  x1 += margin;
  y1 += margin;
  const cell = Math.max(2, Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_CELLS));
  const W = Math.ceil((x1 - x0) / cell) + 1;
  const H = Math.ceil((y1 - y0) / cell) + 1;
  const blocked = new Uint8Array(W * H);
  const cx = (i: number) => x0 + i * cell;
  const cy = (j: number) => y0 + j * cell;
  const span = (a: number, b2: number, lo: number, n: number) => [Math.max(0, Math.floor((a - lo) / cell)), Math.min(n - 1, Math.ceil((b2 - lo) / cell))];

  for (const s of segs) {
    const reach = r + Math.abs(s.bias) + cell;
    const [ia, ib] = s.curved ? span(s.cx - s.radius - reach, s.cx + s.radius + reach, x0, W) : span(Math.min(s.x0, s.x1) - reach, Math.max(s.x0, s.x1) + reach, x0, W);
    const [ja, jb] = s.curved ? span(s.cy - s.radius - reach, s.cy + s.radius + reach, y0, H) : span(Math.min(s.y0, s.y1) - reach, Math.max(s.y0, s.y1) + reach, y0, H);
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) if (segmentHits(s, cx(i), cy(j), r)) blocked[j * W + i] = 1;
  }
  for (const v of verts) {
    const [ia, ib] = span(v.x - r, v.x + r, x0, W);
    const [ja, jb] = span(v.y - r, v.y + r, y0, H);
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) if (Math.hypot(cx(i) - v.x, cy(j) - v.y) < r) blocked[j * W + i] = 1;
  }
  // Planes block a half-space: per row, one run of cells.
  for (const p of planes) {
    for (let j = 0; j < H; j++) {
      const y = cy(j);
      // Blocked where nx * x < dist + r - ny * y.
      const lim = p.dist + r - p.ny * y;
      if (Math.abs(p.nx) < 1e-12) {
        if (lim > 0) blocked.fill(1, j * W, j * W + W);
        continue;
      }
      const xb = lim / p.nx;
      const ib = (xb - x0) / cell;
      if (p.nx > 0) blocked.fill(1, j * W, j * W + Math.max(0, Math.min(W, Math.ceil(ib))));
      else blocked.fill(1, j * W + Math.max(0, Math.min(W, Math.floor(ib) + 1)), j * W + W);
    }
  }

  // Breadth-first from every start.
  const prev = new Int32Array(W * H).fill(-2);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (const p of b.starts) {
    const i = Math.round((p[0] - x0) / cell);
    const j = Math.round((p[1] - y0) / cell);
    if (i < 0 || j < 0 || i >= W || j >= H) continue;
    const k = j * W + i;
    if (prev[k] !== -2) continue;
    // A start inside a wall is reported separately; flood from it anyway.
    prev[k] = -1;
    queue[tail++] = k;
  }
  while (head < tail) {
    const k = queue[head++];
    const i = k % W;
    const j = (k - i) / W;
    if (i === 0 || j === 0 || i === W - 1 || j === H - 1) {
      const path: Vec[] = [];
      for (let c = k; c >= 0; c = prev[c]) path.push([cx(c % W), cy(Math.floor(c / W))]);
      path.reverse();
      // The gap: where the way out leaves the box around the walls.
      const out = path.find(([x, y]) => x < inner.x0 || x > inner.x1 || y < inner.y0 || y > inner.y1) ?? path[path.length - 1];
      const step = Math.max(1, Math.floor(path.length / 200));
      return { kind: "gap", at: out, path: path.filter((_, n) => n % step === 0 || n === path.length - 1) };
    }
    for (const n of [k - 1, k + 1, k - W, k + W]) {
      if (prev[n] === -2 && !blocked[n]) {
        prev[n] = k;
        queue[tail++] = n;
      }
    }
  }
  return null;
}
