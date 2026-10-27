// The editor's document: the stadium's top-level fields plus its object lists,
// each object with a stable id. It is immutable: every edit makes a new Doc
// that shares what did not change, which is what undo/redo stores.
//
// Lossless round trip: the Source keeps the original syntax tree, and each
// imported item remembers the array entry it came from, so printing only
// rewrites what was edited.
import { parseCst, type ContainerNode, type CstDoc, type Entry } from "./cst";
import { isObject, type Json, type JsonObject } from "./json";
import { assemble, patchObject, printValue, type OutEntry } from "./print";
import { DEFAULT_STYLE, detectStyle, fresh, keyText, wrap, type Style } from "./style";
import { tr } from "../i18n";

export const LIST_KEYS = ["vertexes", "segments", "goals", "discs", "planes", "joints", "redSpawnPoints", "blueSpawnPoints"] as const;
export type ListKey = (typeof LIST_KEYS)[number];
export const isListKey = (k: string): k is ListKey => (LIST_KEYS as readonly string[]).includes(k);

// Editor metadata lives under this top-level key, which HaxBall ignores.
export const META_KEY = "haxforge";

export interface Item {
  id: number;
  v: Json;
}

export interface Doc {
  // Top-level key order (list keys included).
  keys: string[];
  // Top-level values other than the lists.
  fields: JsonObject;
  lists: Record<ListKey, Item[]>;
  // Smart objects (text, field generator, mirror copies) and the items they made.
  smart: Smart[];
}

export type SmartKind = "text" | "field" | "pattern" | "shape" | "mirror" | "array";
export type IdSets = Partial<Record<ListKey, number[]>>;

// A smart object owns the items it generated (by item id, which survives
// reordering). In the file it is stored under "haxforge" with item indices.
export interface Smart {
  id: string;
  kind: SmartKind;
  params: JsonObject;
  items: IdSets;
  // Mirror and array copies: the items they copy.
  source?: IdSets;
}

export interface Source {
  cst: CstDoc;
  style: Style;
  // Item id -> the array entry it was imported from.
  origins: Map<number, Entry>;
}

let lastId = 0;
export const newId = () => ++lastId;

const emptyLists = (): Record<ListKey, Item[]> =>
  Object.fromEntries(LIST_KEYS.map((k) => [k, [] as Item[]])) as unknown as Record<ListKey, Item[]>;

export function importText(text: string): { doc: Doc; source: Source } {
  const cst = parseCst(text);
  if (cst.root.kind !== "object") throw new Error(tr("o arquivo não contém um objeto de estádio", "file does not contain a stadium object"));
  const style = detectStyle(cst, text);
  const origins = new Map<number, Entry>();
  const doc: Doc = { keys: [], fields: {}, lists: emptyLists(), smart: [] };
  for (const e of cst.root.entries) {
    const name = e.key!.name;
    if (!doc.keys.includes(name)) doc.keys.push(name);
    if (isListKey(name) && e.node.kind === "array") {
      doc.lists[name] = e.node.entries.map((entry) => {
        const id = newId();
        origins.set(id, entry);
        return { id, v: entry.node.value };
      });
    } else {
      doc.fields[name] = e.node.value;
      // A later duplicate key wins, like in JSON5; drop a list parsed earlier.
      if (isListKey(name)) doc.lists[name] = [];
    }
  }
  doc.smart = readSmart(doc);
  return { doc, source: { cst, style, origins } };
}

export function newDoc(name = tr("Novo mapa", "New map")): Doc {
  return {
    keys: ["name", "width", "height", "spawnDistance", "bg", "vertexes", "segments", "goals", "discs", "planes"],
    fields: {
      name,
      width: 420,
      height: 200,
      spawnDistance: 170,
      bg: { type: "grass", width: 370, height: 170, kickOffRadius: 75, cornerRadius: 0 },
    },
    lists: emptyLists(),
    smart: [],
  };
}

// Keys printed for this doc: its own order, plus lists that gained items and
// the editor's metadata when there are smart objects.
function effectiveKeys(doc: Doc, clean: boolean): string[] {
  const keys = doc.keys.filter((k) => !(clean && k === META_KEY));
  for (const k of LIST_KEYS) if (doc.lists[k].length > 0 && !keys.includes(k)) keys.push(k);
  if (!clean && doc.smart.length && !keys.includes(META_KEY)) keys.push(META_KEY);
  return keys.filter((k) => k !== META_KEY || metaValue(doc) !== undefined);
}

// ---- Smart objects in the file ----------------------------------------------------

const toIndices = (doc: Doc, sets: IdSets): JsonObject => {
  const out: JsonObject = {};
  for (const list of LIST_KEYS) {
    const ids = sets[list];
    if (!ids?.length) continue;
    const pos = new Map(doc.lists[list].map((it, i) => [it.id, i]));
    const idx = ids.map((id) => pos.get(id)).filter((i): i is number => i !== undefined);
    if (idx.length) out[list] = idx;
  }
  return out;
};

const toIds = (doc: Doc, v: unknown): IdSets => {
  const out: IdSets = {};
  if (!isObject(v as Json)) return out;
  for (const list of LIST_KEYS) {
    const idx = (v as JsonObject)[list];
    if (!Array.isArray(idx)) continue;
    out[list] = idx.map((i) => doc.lists[list][i as number]?.id).filter((id): id is number => id !== undefined);
  }
  return out;
};

function readSmart(doc: Doc): Smart[] {
  const meta = doc.fields[META_KEY];
  if (!isObject(meta) || !Array.isArray(meta.objects)) return [];
  return meta.objects.filter(isObject).map((o) => ({
    id: String(o.id),
    kind: o.kind as SmartKind,
    params: isObject(o.params) ? o.params : {},
    items: toIds(doc, o.items),
    ...(o.source !== undefined && { source: toIds(doc, o.source) }),
  }));
}

// The "haxforge" value to write: what the file had, with the smart objects
// as they are now (undefined when nothing is left to store).
function metaValue(doc: Doc): Json | undefined {
  const had = doc.fields[META_KEY];
  const base: JsonObject = isObject(had) ? { ...had } : {};
  delete base.objects;
  if (doc.smart.length) {
    base.objects = doc.smart.map((s) => ({
      id: s.id,
      kind: s.kind,
      params: s.params,
      items: toIndices(doc, s.items),
      ...(s.source && { source: toIndices(doc, s.source) }),
    }));
  }
  if (!Object.keys(base).length) return had !== undefined && !isObject(had) ? had : undefined;
  return base;
}

const fieldValue = (doc: Doc, k: string): Json => (k === META_KEY ? (metaValue(doc) as Json) : doc.fields[k]);

export function toJson(doc: Doc, clean = false): JsonObject {
  const out: JsonObject = {};
  for (const k of effectiveKeys(doc, clean)) {
    if (isListKey(k) && !(k in doc.fields)) out[k] = doc.lists[k].map((i) => i.v);
    else if (k in doc.fields || k === META_KEY) out[k] = fieldValue(doc, k);
  }
  return out;
}

const fieldOrList = (doc: Doc, k: string) => isListKey(k) && !(k in doc.fields);

export function exportText(doc: Doc, source: Source | null, opts: { clean?: boolean } = {}): string {
  const keys = effectiveKeys(doc, !!opts.clean).filter((k) => fieldOrList(doc, k) || k in doc.fields || k === META_KEY);
  const style = source?.style ?? DEFAULT_STYLE;
  const listText = (k: ListKey, orig: ContainerNode | undefined) => printItems(doc.lists[k], orig, source, style, k);

  if (!source) {
    const entries = keys.map((k) => keyText(k, style) + style.colon + (fieldOrList(doc, k) ? listText(k as ListKey, undefined) : fresh(fieldValue(doc, k), 1, [k], style)));
    return wrap("object", entries, 0, [], style) + style.eol;
  }
  const root = source.cst.root as ContainerNode;
  const body = patchObject(root, keys, 0, [], style, (name, node) => {
    if (fieldOrList(doc, name)) return listText(name as ListKey, node?.kind === "array" ? node : undefined);
    const v = fieldValue(doc, name);
    return node ? printValue(v, node, 1, [name], style) : fresh(v, 1, [name], style);
  });
  return source.cst.lead + body + source.cst.tail;
}

function printItems(items: Item[], orig: ContainerNode | undefined, source: Source | null, style: Style, key: string): string {
  const index = new Map<Entry, number>();
  orig?.entries.forEach((e, i) => index.set(e, i));
  const out = items.map((it): OutEntry => {
    const e = source?.origins.get(it.id);
    const i = e && index.get(e);
    if (e && i !== undefined) return { orig: e, origIndex: i, body: printValue(it.v, e.node, 2, [key], style) };
    return { body: fresh(it.v, 2, [key], style) };
  });
  if (!orig) return wrap("array", out.map((o) => o.body), 1, [key], style);
  return assemble("array", orig, out, 1, [key], style);
}

export const metaOf = (doc: Doc): JsonObject => (isObject(doc.fields[META_KEY]) ? (doc.fields[META_KEY] as JsonObject) : {});
