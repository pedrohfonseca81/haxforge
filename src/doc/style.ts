// How a .hbs file is formatted, detected from its syntax tree, and a printer
// for values that have no original text (new objects, new keys), so that
// what the editor adds looks like the rest of the file.
import type { ContainerNode, CstDoc, Node } from "./cst";
import { isObject, type Json } from "./json";

export interface Style {
  // minified: everything on one line. items: one object per line (the root and
  // its arrays broken into lines, objects inline). expanded: every non-empty
  // container broken into lines, like JSON.stringify(v, null, indent).
  layout: "minified" | "items" | "expanded";
  // How keys are quoted; "" means bare identifiers when the name allows it.
  keyQuote: '"' | "'" | "";
  strQuote: '"' | "'";
  colon: string;
  // Whitespace after a comma inside an inline container.
  sep: string;
  // Whitespace inside the braces of an inline object.
  pad: string;
  indent: string;
  eol: string;
}

export const DEFAULT_STYLE: Style = {
  layout: "items",
  keyQuote: '"',
  strQuote: '"',
  colon: ": ",
  sep: " ",
  pad: " ",
  indent: "  ",
  eol: "\n",
};

const ITEM_KEYS = ["vertexes", "segments", "discs", "goals", "planes", "joints"];
const WS = /^[^\S\n\r]*$/;

function walk(node: Node, fn: (n: Node) => boolean | void): boolean {
  if (fn(node)) return true;
  if (node.kind !== "scalar") for (const e of node.entries) if (walk(e.node, fn)) return true;
  return false;
}

export function detectStyle(doc: CstDoc, src: string): Style {
  const style: Style = { ...DEFAULT_STYLE, eol: src.includes("\r\n") ? "\r\n" : "\n" };
  const root = doc.root;
  if (root.kind !== "object" || root.entries.length === 0) return style;

  const firstKey = root.entries[0].key!.raw[0];
  style.keyQuote = firstKey === '"' || firstKey === "'" ? firstKey : "";
  walk(root, (n) => {
    if (n.kind === "scalar" && typeof n.value === "string") {
      style.strQuote = n.raw[0] as '"' | "'";
      return true;
    }
  });

  let inline: ContainerNode | undefined;
  walk(root, (n) => {
    if (n.kind === "object" && n.entries.length >= 2 && !/[\n\r]/.test(n.raw)) {
      inline = n;
      return true;
    }
  });
  const colonOf = (n: ContainerNode) => n.entries.find((e) => !e.colon.includes("/"))?.colon;
  style.colon = (inline && colonOf(inline)) ?? colonOf(root) ?? style.colon;
  if (inline) {
    if (WS.test(inline.entries[1].lead)) style.sep = inline.entries[1].lead;
    if (WS.test(inline.entries[0].lead)) style.pad = inline.entries[0].lead;
  }

  if (!/[\n\r]/.test(root.raw)) {
    style.layout = "minified";
    if (!inline) style.sep = style.pad = "";
    return style;
  }
  const lead = root.entries[0].lead;
  const nl = Math.max(lead.lastIndexOf("\n"), lead.lastIndexOf("\r"));
  if (nl >= 0 && WS.test(lead.slice(nl + 1)) && lead.length > nl + 1) style.indent = lead.slice(nl + 1);

  // An item object (or else any object one level down) on several lines
  // means the whole file is expanded.
  let sample: Node | undefined;
  for (const k of ITEM_KEYS) {
    const list = root.entries.find((e) => e.key!.name === k)?.node;
    sample = list?.kind === "array" ? list.entries.find((e) => e.node.kind === "object")?.node : undefined;
    if (sample) break;
  }
  sample ??= root.entries.find((e) => e.node.kind === "object")?.node;
  style.layout = sample && /[\n\r]/.test(sample.raw) ? "expanded" : "items";
  return style;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function quoteString(s: string, q: '"' | "'"): string {
  const json = JSON.stringify(s);
  if (q === '"') return json;
  return `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}

export const keyText = (name: string, style: Style): string =>
  style.keyQuote === "" && IDENT.test(name) ? name : quoteString(name, style.keyQuote || '"');

export function numberText(n: number): string {
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  return Object.is(n, -0) ? "0" : String(n);
}

// Whether a fresh container at this depth breaks into lines. path[0] is the
// top-level key it lives under (if any).
export function isExpanded(kind: "object" | "array", depth: number, path: string[], style: Style): boolean {
  if (style.layout === "minified") return false;
  if (style.layout === "expanded") return true;
  if (depth === 0) return true;
  if (depth === 1) return kind === "array" || path[0] === "traits" || path[0] === "haxforge";
  return false;
}

export const indentOf = (depth: number, style: Style) => style.indent.repeat(depth);

// Wraps already printed entries ("key: value" or values) in brackets.
export function wrap(kind: "object" | "array", entries: string[], depth: number, path: string[], style: Style): string {
  const [o, c] = kind === "object" ? ["{", "}"] : ["[", "]"];
  if (entries.length === 0) return o + c;
  if (isExpanded(kind, depth, path, style)) {
    const inner = indentOf(depth + 1, style);
    return o + style.eol + entries.map((e) => inner + e).join("," + style.eol) + style.eol + indentOf(depth, style) + c;
  }
  const pad = kind === "object" ? style.pad : "";
  return o + pad + entries.join("," + style.sep) + pad + c;
}

export function fresh(v: Json, depth: number, path: string[], style: Style): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return numberText(v);
  if (typeof v === "string") return quoteString(v, style.strQuote);
  if (Array.isArray(v)) return wrap("array", v.map((x) => fresh(x, depth + 1, path, style)), depth, path, style);
  if (isObject(v)) {
    const entries = Object.keys(v).map((k) => keyText(k, style) + style.colon + fresh(v[k], depth + 1, depth === 0 ? [k] : path, style));
    return wrap("object", entries, depth, path, style);
  }
  return "null";
}

// One-line JSON5 for small editors: { vis: false, cMask: ["ball"] }.
const INLINE: Style = { ...DEFAULT_STYLE, layout: "minified", keyQuote: "", sep: " ", pad: " " };
export const inlineText = (v: Json): string => fresh(v, 2, [], INLINE);
