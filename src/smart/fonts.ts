// Fonts for the letreiro, by the name stored in its "font" parameter:
//   ""               Haxforge Sans (built in, see font.ts)
//   "stroke:<id>"    single-stroke Hershey/EMS fonts (strokefonts.json, loaded on demand)
//   "google:<id>"    Google Fonts, downloaded as TTF from the Fontsource CDN
//   anything else    a font file uploaded by the user
// Outline fonts (Google and uploaded) are parsed with opentype.js and kept in
// the browser; the map only stores the name.
import type opentype from "opentype.js";
import { putFont } from "../persist/db";
import { Store } from "../vendor/kickr/client/store";

const fonts = new Map<string, opentype.Font>();
// Uploaded fonts (not Google ones), for the "your fonts" list.
export const fontNames = new Store<string[]>([]);

export class MissingFont extends Error {
  constructor(readonly font: string) {
    super(`a fonte "${fontLabel(font)}" não está carregada neste navegador`);
  }
}

// ---- Single-stroke fonts ------------------------------------------------------------------

export const STROKE_FONTS: [id: string, name: string][] = [
  ["hershey-sans", "Hershey Sans"],
  ["hershey-sans-med", "Hershey Sans Médio"],
  ["hershey-serif", "Hershey Serif"],
  ["hershey-serif-italic", "Hershey Serif Itálico"],
  ["hershey-serif-bold", "Hershey Serif Negrito"],
  ["hershey-script", "Hershey Script"],
  ["hershey-script-med", "Hershey Script Médio"],
  ["hershey-gothic", "Gótica"],
  ["ems-allure", "Allure (manuscrita)"],
  ["ems-elfin", "Elfin"],
  ["ems-felix", "Felix"],
  ["ems-nixish", "Nixish"],
  ["ems-osmotron", "Osmotron"],
  ["ems-readability", "Readability"],
  ["ems-tech", "Tech"],
];

export interface StrokeGlyph {
  w: number;
  // Polylines as flat [x0, y0, x1, y1, ...] in glyph space (capitals 8 tall, y down).
  p: number[][];
}
type StrokeData = Record<string, { name: string; glyphs: Record<string, StrokeGlyph> }>;
let strokeData: StrokeData | null = null;

export async function loadStrokeFonts(): Promise<StrokeData> {
  strokeData ??= (await import("./strokefonts.json")).default as unknown as StrokeData;
  return strokeData;
}

export function strokeGlyphs(id: string): Record<string, StrokeGlyph> {
  const f = strokeData?.[id];
  if (!f) throw new MissingFont(`stroke:${id}`);
  return f.glyphs;
}

// ---- Google Fonts (outlines) --------------------------------------------------------------------

export const GOOGLE_FONTS: [id: string, family: string][] = [
  ["bebas-neue", "Bebas Neue"],
  ["anton", "Anton"],
  ["oswald", "Oswald"],
  ["teko", "Teko"],
  ["staatliches", "Staatliches"],
  ["archivo-black", "Archivo Black"],
  ["russo-one", "Russo One"],
  ["passion-one", "Passion One"],
  ["alfa-slab-one", "Alfa Slab One"],
  ["titan-one", "Titan One"],
  ["luckiest-guy", "Luckiest Guy"],
  ["bangers", "Bangers"],
  ["righteous", "Righteous"],
  ["racing-sans-one", "Racing Sans One"],
  ["kanit", "Kanit"],
  ["chakra-petch", "Chakra Petch"],
  ["orbitron", "Orbitron"],
  ["audiowide", "Audiowide"],
  ["black-ops-one", "Black Ops One"],
  ["saira-stencil-one", "Saira Stencil One"],
  ["bungee", "Bungee"],
  ["rubik-mono-one", "Rubik Mono One"],
  ["press-start-2p", "Press Start 2P"],
  ["silkscreen", "Silkscreen"],
  ["vt323", "VT323"],
  ["major-mono-display", "Major Mono Display"],
  ["permanent-marker", "Permanent Marker"],
  ["pacifico", "Pacifico"],
  ["lobster", "Lobster"],
  ["monoton", "Monoton"],
];

const googleUrl = (id: string) => `https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-400-normal.ttf`;

// ---- Registry ------------------------------------------------------------------------------------

export function fontLabel(name: string): string {
  if (!name) return "Haxforge Sans";
  if (name.startsWith("stroke:")) return STROKE_FONTS.find(([id]) => `stroke:${id}` === name)?.[1] ?? name.slice(7);
  if (name.startsWith("google:")) return GOOGLE_FONTS.find(([id]) => `google:${id}` === name)?.[1] ?? name.slice(7);
  return name;
}

export function getFont(name: string): opentype.Font {
  const f = fonts.get(name);
  if (!f) throw new MissingFont(name);
  return f;
}

export const fontReady = (name: string) => !name || (name.startsWith("stroke:") ? strokeData !== null : fonts.has(name));

// Registers a font file under `as` (or its family name). The parser is only
// loaded when a font is actually used.
export async function addFont(data: ArrayBuffer, fallbackName: string, as?: string): Promise<string> {
  const { parse } = await import("opentype.js");
  const font = parse(data);
  const name = as ?? font.names.fullName?.en ?? font.names.fontFamily?.en ?? fallbackName;
  fonts.set(name, font);
  if (!name.startsWith("google:")) fontNames.set([...new Set([...fontNames.get(), name])].sort());
  return name;
}

// Makes a font usable: loads the stroke fonts, or downloads a Google font
// (kept in the browser for next time). Uploaded fonts can only be uploaded.
export async function ensureFont(name: string): Promise<void> {
  if (fontReady(name)) return;
  if (name.startsWith("stroke:")) {
    await loadStrokeFonts();
    return;
  }
  if (name.startsWith("google:")) {
    const res = await fetch(googleUrl(name.slice(7)));
    if (!res.ok) throw new Error(`não consegui baixar a fonte ${fontLabel(name)} (${res.status})`);
    const data = await res.arrayBuffer();
    await addFont(data, name, name);
    await putFont({ name, data }).catch(() => undefined);
    return;
  }
  throw new MissingFont(name);
}

// Fonts saved in this browser, loaded once at startup.
export async function loadSavedFonts(list: () => Promise<{ name: string; data: ArrayBuffer }[]>): Promise<void> {
  try {
    for (const f of await list()) {
      try {
        await addFont(f.data, f.name, f.name);
      } catch {}
    }
  } catch {}
}
