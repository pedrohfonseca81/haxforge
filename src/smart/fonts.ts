// Font files for the letreiro (TTF, OTF, WOFF), parsed with opentype.js and
// kept in the browser. The map only stores the font's name: on a browser
// without the file the text keeps its segments but cannot be regenerated.
import type opentype from "opentype.js";
import { Store } from "../vendor/kickr/client/store";

const fonts = new Map<string, opentype.Font>();
export const fontNames = new Store<string[]>([]);

export class MissingFont extends Error {
  constructor(readonly font: string) {
    super(`a fonte "${font}" não está neste navegador`);
  }
}

export function getFont(name: string): opentype.Font {
  const f = fonts.get(name);
  if (!f) throw new MissingFont(name);
  return f;
}

// Registers a font file; returns the name to use in the letreiro. The parser
// is only loaded when a font is actually used.
export async function addFont(data: ArrayBuffer, fallbackName: string): Promise<string> {
  const { parse } = await import("opentype.js");
  const font = parse(data);
  const family = font.names.fullName?.en ?? font.names.fontFamily?.en ?? fallbackName;
  fonts.set(family, font);
  fontNames.set([...fonts.keys()].sort());
  return family;
}

// Fonts saved in this browser, loaded once at startup.
export async function loadSavedFonts(list: () => Promise<{ name: string; data: ArrayBuffer }[]>): Promise<void> {
  try {
    for (const f of await list()) {
      try {
        await addFont(f.data, f.name);
      } catch {}
    }
  } catch {}
}
