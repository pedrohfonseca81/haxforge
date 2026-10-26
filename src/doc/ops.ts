// Immutable edits on a Doc. Lists reference each other by index (segments ->
// vertexes through v0/v1, joints -> discs through d0/d1), so every reorder or
// delete remaps those indices; objects left pointing at something deleted are
// deleted too.
import { isObject, type Json, type JsonObject } from "./json";
import { LIST_KEYS, newId, type Doc, type IdSets, type Item, type ListKey } from "./model";

export type Ref = string; // "<list>:<id>", or "ball" for the ball defined by ballPhysics

export const refOf = (list: ListKey, id: number): Ref => `${list}:${id}`;
export function parseRef(ref: Ref): { list: ListKey; id: number } | null {
  const i = ref.indexOf(":");
  if (i < 0) return null;
  return { list: ref.slice(0, i) as ListKey, id: Number(ref.slice(i + 1)) };
}

// Joint indices count the ball first, unless the first disc is the ball.
export const isDisc0 = (doc: Doc) => doc.fields.ballPhysics === "disc0";
export const ballOffset = (doc: Doc) => (isDisc0(doc) ? 0 : 1);

export const obj = (v: Json): JsonObject => (isObject(v) ? v : {});

export function findItem(doc: Doc, ref: Ref): { list: ListKey; item: Item; index: number } | null {
  const p = parseRef(ref);
  if (!p || !doc.lists[p.list]) return null;
  const index = doc.lists[p.list].findIndex((it) => it.id === p.id);
  return index < 0 ? null : { list: p.list, item: doc.lists[p.list][index], index };
}

export function setField(doc: Doc, key: string, value: Json | undefined): Doc {
  const fields = { ...doc.fields };
  let keys = doc.keys;
  if (value === undefined) {
    delete fields[key];
    keys = keys.filter((k) => k !== key);
  } else {
    fields[key] = value;
    if (!keys.includes(key)) keys = [...keys, key];
  }
  return { ...doc, fields, keys };
}

export function updateItems(doc: Doc, list: ListKey, ids: Iterable<number>, fn: (v: Json, index: number) => Json): Doc {
  const set = new Set(ids);
  let changed = false;
  const items = doc.lists[list].map((it, i) => {
    if (!set.has(it.id)) return it;
    const v = fn(it.v, i);
    if (v === it.v) return it;
    changed = true;
    return { id: it.id, v };
  });
  return changed ? { ...doc, lists: { ...doc.lists, [list]: items } } : doc;
}

// Sets (or with undefined, removes) one property of the given objects.
export function setProp(doc: Doc, list: ListKey, ids: Iterable<number>, key: string, value: Json | undefined): Doc {
  return updateItems(doc, list, ids, (v) => {
    const o = { ...obj(v) };
    if (value === undefined) delete o[key];
    else o[key] = value;
    return o;
  });
}

export function addItems(doc: Doc, list: ListKey, values: Json[]): { doc: Doc; ids: number[] } {
  const items = values.map((v) => ({ id: newId(), v }));
  return { doc: { ...doc, lists: { ...doc.lists, [list]: [...doc.lists[list], ...items] } }, ids: items.map((i) => i.id) };
}

// Rewrites the lists after some of them were reordered or filtered. `before`
// holds the old order of the lists that changed.
export function remap(doc: Doc, before: Partial<Record<ListKey, Item[]>>): Doc {
  const indexMap = (list: ListKey): Map<number, number> | null => {
    const old = before[list];
    if (!old) return null;
    const pos = new Map(doc.lists[list].map((it, i) => [it.id, i]));
    return new Map(old.map((it, i) => [i, pos.get(it.id) ?? -1]));
  };
  let lists = doc.lists;
  const vmap = indexMap("vertexes");
  if (vmap) {
    const segments: Item[] = [];
    for (const it of lists.segments) {
      const s = obj(it.v);
      const v0 = typeof s.v0 === "number" ? vmap.get(s.v0) : undefined;
      const v1 = typeof s.v1 === "number" ? vmap.get(s.v1) : undefined;
      if (v0 === -1 || v1 === -1) continue;
      if ((v0 === undefined || v0 === s.v0) && (v1 === undefined || v1 === s.v1)) segments.push(it);
      else segments.push({ id: it.id, v: { ...s, ...(v0 !== undefined && { v0 }), ...(v1 !== undefined && { v1 }) } });
    }
    lists = { ...lists, segments };
  }
  const dmap = indexMap("discs");
  if (dmap) {
    const off = ballOffset(doc);
    const map = (d: Json) => (typeof d === "number" && d >= off ? dmap.get(d - off) : undefined);
    const joints: Item[] = [];
    for (const it of lists.joints) {
      const j = obj(it.v);
      const d0 = map(j.d0);
      const d1 = map(j.d1);
      if (d0 === -1 || d1 === -1) continue;
      const n0 = d0 === undefined ? j.d0 : d0 + off;
      const n1 = d1 === undefined ? j.d1 : d1 + off;
      joints.push(n0 === j.d0 && n1 === j.d1 ? it : { id: it.id, v: { ...j, d0: n0, d1: n1 } });
    }
    lists = { ...lists, joints };
  }
  return { ...doc, lists };
}

export function deleteRefs(doc: Doc, refs: Iterable<Ref>): Doc {
  const byList = new Map<ListKey, Set<number>>();
  for (const r of refs) {
    const p = parseRef(r);
    if (!p) continue;
    if (!byList.has(p.list)) byList.set(p.list, new Set());
    byList.get(p.list)!.add(p.id);
  }
  // The ball of a "disc0" stadium cannot go.
  if (isDisc0(doc) && doc.lists.discs[0]) byList.get("discs")?.delete(doc.lists.discs[0].id);
  if (byList.size === 0) return doc;
  const before: Partial<Record<ListKey, Item[]>> = {};
  const lists = { ...doc.lists };
  for (const [list, ids] of byList) {
    before[list] = lists[list];
    lists[list] = lists[list].filter((it) => !ids.has(it.id));
  }
  return pruneSmart(remap({ ...doc, lists }, before));
}

// Drops deleted items from smart objects, and smart objects left empty.
export function pruneSmart(doc: Doc): Doc {
  if (!doc.smart.length) return doc;
  const alive = new Map(LIST_KEYS.map((l) => [l, new Set(doc.lists[l].map((it) => it.id))]));
  const clean = (sets: IdSets | undefined): IdSets | undefined => {
    if (!sets) return sets;
    const out: IdSets = {};
    for (const list of LIST_KEYS) {
      const ids = sets[list]?.filter((id) => alive.get(list)!.has(id));
      if (ids?.length) out[list] = ids;
    }
    return out;
  };
  const count = (sets: IdSets | undefined) => LIST_KEYS.reduce((n, l) => n + (sets?.[l]?.length ?? 0), 0);
  let changed = false;
  const smart = doc.smart.flatMap((sm) => {
    const items = clean(sm.items)!;
    const source = clean(sm.source);
    const keep = sm.source ? count(source) > 0 && count(items) > 0 : count(items) > 0;
    if (count(items) !== count(sm.items) || count(source) !== count(sm.source) || !keep) changed = true;
    return keep ? [{ ...sm, items, ...(source && { source }) }] : [];
  });
  return changed ? { ...doc, smart } : doc;
}

// Replaces a group of items with freshly generated ones, in place: each list
// gets the new items where the first old one was (so the draw order stays),
// or at the end. Clip indices (segments -> vertexes, joints -> discs) are
// relative to the clip.
export function replaceItems(doc: Doc, old: IdSets, clip: Clip): { doc: Doc; ids: IdSets } {
  const before: Partial<Record<ListKey, Item[]>> = {};
  const lists = { ...doc.lists };
  const pos: Partial<Record<ListKey, number>> = {};
  const ids: IdSets = {};
  for (const list of LIST_KEYS) {
    const gone = new Set(old[list] ?? []);
    const cur = lists[list];
    const first = cur.findIndex((it) => gone.has(it.id));
    const kept = gone.size ? cur.filter((it) => !gone.has(it.id)) : cur;
    let at = first >= 0 ? first : kept.length;
    // The ball of a "disc0" stadium stays first.
    if (list === "discs" && isDisc0(doc) && kept.length) at = Math.max(1, at);
    pos[list] = at;
    const vals = list === "segments" || list === "joints" ? [] : (clip[list] ?? []);
    if (kept === cur && !vals.length) continue;
    before[list] = cur;
    const items = vals.map((v) => ({ id: newId(), v }));
    if (items.length) ids[list] = items.map((i) => i.id);
    lists[list] = [...kept.slice(0, at), ...items, ...kept.slice(at)];
  }
  // Survivors keep pointing at the same vertexes and discs...
  let d = remap({ ...doc, lists }, before);
  // ...and the new segments and joints point into the new block.
  const vBase = pos.vertexes ?? 0;
  const dBase = (pos.discs ?? 0) + ballOffset(doc);
  for (const list of ["segments", "joints"] as const) {
    const vals = clip[list] ?? [];
    if (!vals.length) continue;
    const items = vals.map((v) => {
      const o = obj(v);
      return {
        id: newId(),
        v: list === "segments" ? { ...o, v0: (o.v0 as number) + vBase, v1: (o.v1 as number) + vBase } : { ...o, d0: (o.d0 as number) + dBase, d1: (o.d1 as number) + dBase },
      };
    });
    ids[list] = items.map((i) => i.id);
    const cur = d.lists[list];
    const at = Math.min(pos[list] ?? cur.length, cur.length);
    d = { ...d, lists: { ...d.lists, [list]: [...cur.slice(0, at), ...items, ...cur.slice(at)] } };
  }
  return { doc: d, ids };
}

export type MoveTarget = "forward" | "backward" | "front" | "back";

// Moves objects in their list (draw order). Front = drawn last = end of the list.
export function moveItems(doc: Doc, list: ListKey, ids: Iterable<number>, target: MoveTarget | number): Doc {
  const set = new Set(ids);
  const old = doc.lists[list];
  // The first disc of a "disc0" stadium is the ball: it stays first.
  const pinned = list === "discs" && isDisc0(doc) && old[0] ? old[0].id : null;
  if (pinned !== null) set.delete(pinned);
  if (set.size === 0) return doc;
  const items = [...old];
  if (target === "front" || target === "back" || typeof target === "number") {
    const moving = items.filter((it) => set.has(it.id));
    const rest = items.filter((it) => !set.has(it.id));
    let at = target === "front" ? rest.length : target === "back" ? 0 : Math.min(rest.length, items.slice(0, target).filter((it) => !set.has(it.id)).length);
    if (pinned !== null) at = Math.max(1, at);
    rest.splice(at, 0, ...moving);
    items.splice(0, items.length, ...rest);
  } else if (target === "forward") {
    for (let i = items.length - 2; i >= 0; i--) {
      if (set.has(items[i].id) && !set.has(items[i + 1].id)) [items[i], items[i + 1]] = [items[i + 1], items[i]];
    }
  } else {
    const first = pinned !== null ? 2 : 1;
    for (let i = first; i < items.length; i++) {
      if (set.has(items[i].id) && !set.has(items[i - 1].id)) [items[i], items[i - 1]] = [items[i - 1], items[i]];
    }
  }
  if (items.every((it, i) => it === old[i])) return doc;
  return remap({ ...doc, lists: { ...doc.lists, [list]: items } }, { [list]: old });
}

// ---- Geometry helpers on raw values ---------------------------------------

const vec2 = (v: Json): [number, number] | null =>
  Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? [v[0], v[1]] : null;

// Moves an object by (dx, dy). Segments and joints move through their
// vertexes and discs, so they are left as they are here.
export function translateValue(list: ListKey, v: Json, dx: number, dy: number, round: (n: number) => number): Json {
  const o = obj(v);
  switch (list) {
    case "vertexes":
      if (typeof o.x !== "number" || typeof o.y !== "number") return v;
      return { ...o, x: round(o.x + dx), y: round(o.y + dy) };
    case "discs": {
      const p = vec2(o.pos) ?? [0, 0];
      return { ...o, pos: [round(p[0] + dx), round(p[1] + dy)] };
    }
    case "goals": {
      const p0 = vec2(o.p0);
      const p1 = vec2(o.p1);
      if (!p0 || !p1) return v;
      return { ...o, p0: [round(p0[0] + dx), round(p0[1] + dy)], p1: [round(p1[0] + dx), round(p1[1] + dy)] };
    }
    case "planes": {
      const n = vec2(o.normal);
      if (!n || typeof o.dist !== "number") return v;
      const len = Math.hypot(n[0], n[1]) || 1;
      return { ...o, dist: round(o.dist + (n[0] * dx + n[1] * dy) / len) };
    }
    case "redSpawnPoints":
    case "blueSpawnPoints": {
      const p = vec2(v);
      return p ? [round(p[0] + dx), round(p[1] + dy)] : v;
    }
    default:
      return v;
  }
}

// Every ref whose position follows the given selection (a segment drags its
// vertexes, a joint its discs).
export function movableRefs(doc: Doc, refs: Iterable<Ref>): Map<ListKey, Set<number>> {
  const out = new Map<ListKey, Set<number>>();
  const add = (list: ListKey, id: number) => {
    if (!out.has(list)) out.set(list, new Set());
    out.get(list)!.add(id);
  };
  const off = ballOffset(doc);
  for (const r of refs) {
    const f = findItem(doc, r);
    if (!f) continue;
    if (f.list === "segments") {
      const s = obj(f.item.v);
      for (const k of ["v0", "v1"]) {
        const vi = s[k];
        const vert = typeof vi === "number" ? doc.lists.vertexes[vi] : undefined;
        if (vert) add("vertexes", vert.id);
      }
    } else if (f.list === "joints") {
      const j = obj(f.item.v);
      for (const k of ["d0", "d1"]) {
        const di = j[k];
        const disc = typeof di === "number" ? doc.lists.discs[di - off] : undefined;
        if (disc) add("discs", disc.id);
      }
    } else add(f.list, f.item.id);
  }
  return out;
}

export function translateRefs(doc: Doc, moving: Map<ListKey, Set<number>>, dx: number, dy: number, round: (n: number) => number): Doc {
  let d = doc;
  for (const [list, ids] of moving) d = updateItems(d, list, ids, (v) => translateValue(list, v, dx, dy, round));
  return d;
}

// ---- Copy and paste --------------------------------------------------------

// Copied objects, with segment and joint indices relative to the clip's own
// vertexes and discs.
export type Clip = Partial<Record<ListKey, Json[]>>;

export function copyRefs(doc: Doc, refs: Iterable<Ref>): Clip {
  const sel = new Map<ListKey, Set<number>>();
  for (const r of refs) {
    const p = parseRef(r);
    if (!p) continue;
    if (!sel.has(p.list)) sel.set(p.list, new Set());
    sel.get(p.list)!.add(p.id);
  }
  const clip: Clip = {};
  // Vertexes: the selected ones plus those used by selected segments.
  const vIndex = new Map<number, number>();
  const vertexes: Json[] = [];
  const takeVertex = (i: number) => {
    if (!vIndex.has(i) && doc.lists.vertexes[i]) {
      vIndex.set(i, vertexes.length);
      vertexes.push(doc.lists.vertexes[i].v);
    }
    return vIndex.get(i);
  };
  doc.lists.vertexes.forEach((it, i) => sel.get("vertexes")?.has(it.id) && takeVertex(i));
  const segments: Json[] = [];
  for (const it of doc.lists.segments) {
    if (!sel.get("segments")?.has(it.id)) continue;
    const s = obj(it.v);
    const v0 = typeof s.v0 === "number" ? takeVertex(s.v0) : undefined;
    const v1 = typeof s.v1 === "number" ? takeVertex(s.v1) : undefined;
    if (v0 === undefined || v1 === undefined) continue;
    segments.push({ ...s, v0, v1 });
  }
  // Discs, then joints whose two discs are both copied.
  const off = ballOffset(doc);
  const dIndex = new Map<number, number>();
  const discs: Json[] = [];
  doc.lists.discs.forEach((it, i) => {
    if (sel.get("discs")?.has(it.id)) {
      dIndex.set(i + off, discs.length);
      discs.push(it.v);
    }
  });
  const joints: Json[] = [];
  for (const it of doc.lists.joints) {
    if (!sel.get("joints")?.has(it.id)) continue;
    const j = obj(it.v);
    const d0 = typeof j.d0 === "number" ? dIndex.get(j.d0) : undefined;
    const d1 = typeof j.d1 === "number" ? dIndex.get(j.d1) : undefined;
    if (d0 !== undefined && d1 !== undefined) joints.push({ ...j, d0, d1 });
  }
  if (vertexes.length) clip.vertexes = vertexes;
  if (segments.length) clip.segments = segments;
  if (discs.length) clip.discs = discs;
  if (joints.length) clip.joints = joints;
  for (const k of ["goals", "planes", "redSpawnPoints", "blueSpawnPoints"] as const) {
    const vals = doc.lists[k].filter((it) => sel.get(k)?.has(it.id)).map((it) => it.v);
    if (vals.length) clip[k] = vals;
  }
  return clip;
}

export function pasteClip(doc: Doc, clip: Clip, dx: number, dy: number, round: (n: number) => number): { doc: Doc; refs: Ref[] } {
  const vBase = doc.lists.vertexes.length;
  const dBase = doc.lists.discs.length + ballOffset(doc);
  const refs: Ref[] = [];
  let d = doc;
  for (const list of LIST_KEYS) {
    const vals = clip[list];
    if (!vals?.length) continue;
    const shifted = vals.map((v) => {
      const o = obj(v);
      if (list === "segments") return { ...o, v0: (o.v0 as number) + vBase, v1: (o.v1 as number) + vBase };
      if (list === "joints") return { ...o, d0: (o.d0 as number) + dBase, d1: (o.d1 as number) + dBase };
      return translateValue(list, v, dx, dy, round);
    });
    const r = addItems(d, list, shifted);
    d = r.doc;
    refs.push(...r.ids.map((id) => refOf(list, id)));
  }
  return { doc: d, refs };
}
