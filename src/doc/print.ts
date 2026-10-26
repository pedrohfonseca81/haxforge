// Prints a value against the syntax tree it came from: unchanged parts are
// copied verbatim, changed containers keep their original trivia (comments,
// line breaks, trailing commas) and only new text follows the file's style.
import { containerText, type ContainerNode, type Entry, type Node } from "./cst";
import { isObject, jsonEqual, type Json } from "./json";
import { fresh, keyText, wrap, type Style } from "./style";

// An entry to print: the original entry it comes from (if any), with its
// position in the original container, and its text without lead and trail.
export interface OutEntry {
  orig?: Entry;
  origIndex?: number;
  body: string;
}

const INDEX_COMMENT = /(\/\*\s*)(\d+)(\s*\*\/)/;
const hasComment = (s: string) => s.includes("/*") || s.includes("//");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n\r]*/g, "");

export function printValue(v: Json, orig: Node | undefined, depth: number, path: string[], style: Style): string {
  if (orig && jsonEqual(v, orig.value)) return orig.raw;
  if (orig?.kind === "object" && isObject(v)) {
    return patchObject(orig, Object.keys(v), depth, path, style, (name, node) =>
      node ? printValue(v[name], node, depth + 1, depth === 0 ? [name] : path, style) : fresh(v[name], depth + 1, depth === 0 ? [name] : path, style),
    );
  }
  if (orig?.kind === "array" && Array.isArray(v)) {
    const out = v.map((x, j): OutEntry => {
      const e = orig.entries[j];
      return e ? { orig: e, origIndex: j, body: printValue(x, e.node, depth + 1, path, style) } : { body: fresh(x, depth + 1, path, style) };
    });
    return assemble("array", orig, out, depth, path, style);
  }
  return fresh(v, depth, path, style);
}

// Prints an object with the given keys: original keys keep their position,
// new ones are appended. valueText gets the original value node when there is one.
export function patchObject(
  orig: ContainerNode,
  keys: string[],
  depth: number,
  path: string[],
  style: Style,
  valueText: (name: string, node: Node | undefined) => string,
): string {
  const wanted = new Set(keys);
  const done = new Set<string>();
  const out: OutEntry[] = [];
  orig.entries.forEach((e, i) => {
    const name = e.key!.name;
    if (!wanted.has(name) || done.has(name)) return;
    done.add(name);
    out.push({ orig: e, origIndex: i, body: e.key!.raw + e.colon + valueText(name, e.node) });
  });
  for (const name of keys) {
    if (done.has(name)) continue;
    out.push({ body: keyText(name, style) + style.colon + valueText(name, undefined) });
  }
  return assemble("object", orig, out, depth, path, style);
}

// Joins entries back into a container, reusing the original trivia. An entry
// that keeps its role (first or not) keeps its own lead; otherwise it takes
// the lead typical of its new position. Index comments (/* 12 */ before every
// array element) are renumbered.
export function assemble(kind: "object" | "array", orig: ContainerNode, out: OutEntry[], depth: number, path: string[], style: Style): string {
  if (out.length === 0) return kind === "object" ? "{}" : "[]";
  const n = orig.entries.length;
  if (n === 0) return wrap(kind, out.map((o) => o.body), depth, path, style);

  const firstLead = orig.entries[0].lead;
  let otherLead: string;
  if (n > 1) otherLead = orig.entries[n - 1].lead;
  else if (/[\n\r]/.test(firstLead)) otherLead = firstLead;
  else otherLead = style.sep;
  const indexed = kind === "array" && orig.entries.every((e) => INDEX_COMMENT.test(e.lead));

  const parts = out.map((o, j) => {
    const positional = j === 0 ? firstLead : otherLead;
    let lead: string;
    if (o.orig && (j === 0) === (o.origIndex === 0)) lead = o.orig.lead;
    else if (o.orig && hasComment(o.orig.lead)) lead = o.orig.lead;
    else lead = indexed ? positional : stripComments(positional);
    if (indexed) lead = lead.replace(INDEX_COMMENT, (_, a, _n, b) => a + j + b);
    return { text: lead + o.body + (o.orig ? o.orig.trail : ""), post: o.orig?.post ?? "" };
  });
  return containerText(kind, parts, orig.trailingComma, orig.close);
}
