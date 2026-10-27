// Internationalization: Portuguese (pt-BR) by default for people in Brazil,
// English (en) for everyone else, with a manual switch saved in localStorage.
import { Store } from "./vendor/kickr/client/store";

export type Lang = "pt" | "en";

const KEY = "haxforge.lang";

// IANA timezones in Brazil.
const BR_TIMEZONES = new Set([
  "America/Araguaina",
  "America/Bahia",
  "America/Belem",
  "America/Boa_Vista",
  "America/Campo_Grande",
  "America/Cuiaba",
  "America/Eirunepe",
  "America/Fortaleza",
  "America/Maceio",
  "America/Manaus",
  "America/Noronha",
  "America/Porto_Acre",
  "America/Porto_Velho",
  "America/Recife",
  "America/Rio_Branco",
  "America/Santarem",
  "America/Sao_Paulo",
  "Brazil/Acre",
  "Brazil/DeNoronha",
  "Brazil/East",
  "Brazil/West",
]);

export function detectLang(langs?: readonly string[], timeZone?: string): Lang {
  const list =
    langs ??
    (typeof navigator !== "undefined"
      ? navigator.languages?.length
        ? navigator.languages
        : navigator.language
          ? [navigator.language]
          : []
      : []);
  const tz =
    timeZone ??
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      } catch {
        return "";
      }
    })();

  const primary = (list[0] ?? "").trim();
  if (/[-_]br\b/i.test(primary)) return "pt";
  if (BR_TIMEZONES.has(tz)) return "pt";
  if (/^pt$/i.test(primary)) return "pt";
  return "en";
}

function initialLang(): Lang {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (saved === "pt" || saved === "en") return saved;
  } catch {}
  return detectLang();
}

export const lang = new Store<Lang>(initialLang());

function syncDom(l: Lang): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.lang = l === "pt" ? "pt-BR" : "en";
  document.title = l === "pt" ? "haxforge · editor de mapas do HaxBall" : "haxforge · HaxBall map editor";
}

syncDom(lang.get());

lang.subscribe((l) => {
  syncDom(l);
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, l);
  } catch {}
});

export function setLang(l: Lang): void {
  lang.set(l);
}

export function toggleLang(): void {
  lang.set(lang.get() === "pt" ? "en" : "pt");
}

export const tr = <T>(pt: T, en: T): T => (lang.get() === "pt" ? pt : en);

export const locale = (): string => (lang.get() === "pt" ? "pt-BR" : "en-US");
