// A JSON5 parser that keeps the concrete syntax: every node remembers its exact
// source text and the trivia (whitespace, comments) around its entries, so a
// document can be printed back byte for byte and edited surgically.
//
// A container prints as:
//   open + entries.map(e => e.lead + e.key?.raw + e.colon + e.node.raw + e.trail).join(",")
//        + (trailingComma ? "," : "") + close + closing bracket
// Scalar values are decoded with the json5 package itself, so the semantics
// (escapes, hex numbers, Infinity...) are exactly JSON5's.
import JSON5 from "json5";
import type { Json, JsonObject } from "./json";

export interface ScalarNode {
  kind: "scalar";
  raw: string;
  value: Json;
}

export interface ContainerNode {
  kind: "object" | "array";
  raw: string;
  value: Json;
  entries: Entry[];
  trailingComma: boolean;
  // Trivia right before the closing bracket.
  close: string;
}

export type Node = ScalarNode | ContainerNode;

export interface Entry {
  // Trivia between the opening bracket (or the previous comma) and the entry.
  lead: string;
  // Object entries only: the key as written and its decoded name.
  key?: { raw: string; name: string };
  // Object entries only: everything between the key and the value (":" and trivia).
  colon: string;
  node: Node;
  // Trivia between the value and the following comma (empty when none follows).
  trail: string;
  // A comment on the same line right after the comma ("}, // left post"):
  // it belongs to this entry, not to the next one.
  post: string;
}

export interface CstDoc {
  lead: string;
  root: Node;
  tail: string;
}

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${message} (linha ${line}, coluna ${column})`);
  }
}

const NUMBER = /[+-]?(?:Infinity|NaN|0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
const WORD = /true|false|null/y;
const IDENT = /(?:[\p{L}\p{Nl}$_]|\\u[0-9a-fA-F]{4})(?:[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_‌‍]|\\u[0-9a-fA-F]{4})*/uy;

export function parseCst(src: string): CstDoc {
  let i = 0;

  const fail = (msg: string, at = i): never => {
    const before = src.slice(0, at).split("\n");
    throw new ParseError(msg, before.length, before[before.length - 1].length + 1);
  };

  function trivia(): string {
    const start = i;
    for (;;) {
      const c = src[i];
      if (c === undefined) break;
      if (/\s/.test(c)) {
        i++;
      } else if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n" && src[i] !== "\r" && src[i] !== " " && src[i] !== " ") i++;
      } else if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        if (end < 0) fail("comentário sem fechamento");
        i = end + 2;
      } else break;
    }
    return src.slice(start, i);
  }

  function string(): string {
    const q = src[i];
    const start = i++;
    while (i < src.length && src[i] !== q) {
      if (src[i] === "\\") i++;
      else if (src[i] === "\n" || src[i] === "\r") fail("quebra de linha dentro de string");
      i++;
    }
    if (i >= src.length) fail("string sem fechamento", start);
    i++;
    return src.slice(start, i);
  }

  function match(re: RegExp): string | null {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return null;
    i += m[0].length;
    return m[0];
  }

  function decode(raw: string, at: number): Json {
    try {
      return JSON5.parse(raw) as Json;
    } catch (e) {
      return fail(`valor inválido: ${raw}`, at);
    }
  }

  function value(): Node {
    const c = src[i];
    const start = i;
    if (c === "{" || c === "[") return container(c === "{" ? "object" : "array");
    let raw: string | null = null;
    if (c === '"' || c === "'") raw = string();
    else raw = match(NUMBER) ?? match(WORD);
    if (raw === null) return fail(c === undefined ? "fim inesperado do arquivo" : `caractere inesperado "${c}"`);
    return { kind: "scalar", raw, value: decode(raw, start) };
  }

  function key(): { raw: string; name: string } {
    const start = i;
    const c = src[i];
    if (c === '"' || c === "'") {
      const raw = string();
      return { raw, name: decode(raw, start) as string };
    }
    const raw = match(IDENT);
    if (raw === null) return fail("esperava uma chave");
    // Unicode escapes in identifiers are rare; let JSON5 decode them.
    const name = raw.includes("\\") ? (Object.keys(decode(`{${raw}:0}`, start) as JsonObject)[0] ?? raw) : raw;
    return { raw, name };
  }

  function container(kind: "object" | "array"): ContainerNode {
    const start = i;
    const closer = kind === "object" ? "}" : "]";
    i++;
    const entries: Entry[] = [];
    let trailingComma = false;
    let close = "";
    for (;;) {
      let lead = trivia();
      const prev = entries[entries.length - 1];
      if (prev) [prev.post, lead] = splitPost(lead);
      if (src[i] === closer) {
        // Either an empty container or a trailing comma.
        if (entries.length > 0) trailingComma = true;
        close = lead;
        i++;
        break;
      }
      let k: Entry["key"];
      let colon = "";
      if (kind === "object") {
        k = key();
        const colonStart = i;
        trivia();
        if (src[i] !== ":") fail('esperava ":"');
        i++;
        trivia();
        colon = src.slice(colonStart, i);
      }
      const node = value();
      const afterValue = i;
      const trail = trivia();
      if (src[i] === ",") {
        entries.push({ lead, key: k, colon, node, trail, post: "" });
        i++;
        continue;
      }
      if (src[i] === closer) {
        entries.push({ lead, key: k, colon, node, trail: "", post: "" });
        close = src.slice(afterValue, i);
        i++;
        break;
      }
      fail(`esperava "," ou "${closer}"`);
    }
    const raw = src.slice(start, i);
    let v: Json;
    if (kind === "object") {
      const o: JsonObject = {};
      for (const e of entries) o[e.key!.name] = e.node.value;
      v = o;
    } else {
      v = entries.map((e) => e.node.value);
    }
    return { kind, raw, value: v, entries, trailingComma, close };
  }

  const lead = trivia();
  if (i >= src.length) fail("arquivo vazio");
  const root = value();
  const tail = trivia();
  if (i < src.length) fail("conteúdo depois do fim do objeto");
  return { lead, root, tail };
}

// Splits the trivia after a comma into a same-line comment (if any) and the rest.
function splitPost(trivia: string): [string, string] {
  const nl = trivia.search(/[\n\r]/);
  if (nl <= 0) return ["", trivia];
  const line = trivia.slice(0, nl);
  const opened = line.split("/*").length - 1;
  const closed = line.split("*/").length - 1;
  if (!/\/[/*]/.test(line) || opened !== closed) return ["", trivia];
  return [line, trivia.slice(nl)];
}

// Joins entries (text without the comma, plus the same-line comment that
// follows the comma) back into a container.
export function containerText(kind: "object" | "array", entries: { text: string; post: string }[], trailingComma: boolean, close: string): string {
  const [o, c] = kind === "object" ? ["{", "}"] : ["[", "]"];
  let out = o;
  entries.forEach((e, i) => {
    out += e.text;
    if (i < entries.length - 1 || trailingComma) out += "," + e.post;
    else out += e.post;
  });
  return out + close + c;
}
