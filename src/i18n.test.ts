import { describe, expect, test } from "bun:test";
import { detectLang, lang, locale, setLang, toggleLang, tr } from "./i18n";

describe("i18n", () => {
  test("detects Portuguese for Brazil locales and timezones", () => {
    expect(detectLang(["pt-BR"], "UTC")).toBe("pt");
    expect(detectLang(["pt_BR"], "UTC")).toBe("pt");
    expect(detectLang(["pt"], "UTC")).toBe("pt");
    expect(detectLang(["en-BR"], "UTC")).toBe("pt");
    expect(detectLang(["en-US"], "America/Sao_Paulo")).toBe("pt");
    expect(detectLang(["en-US"], "America/Fortaleza")).toBe("pt");
    expect(detectLang(["en-US"], "America/Manaus")).toBe("pt");
  });

  test("defaults to English for other countries and locales", () => {
    expect(detectLang(["en-US"], "America/New_York")).toBe("en");
    expect(detectLang(["en-GB"], "Europe/London")).toBe("en");
    expect(detectLang(["es-AR"], "America/Argentina/Buenos_Aires")).toBe("en");
    expect(detectLang(["es-ES"], "Europe/Madrid")).toBe("en");
    expect(detectLang(["pt-PT"], "Europe/Lisbon")).toBe("en");
    expect(detectLang(["fr-FR"], "Europe/Paris")).toBe("en");
    expect(detectLang([], "UTC")).toBe("en");
  });

  test("switches and translates reactively", () => {
    setLang("pt");
    expect(lang.get()).toBe("pt");
    expect(tr("Olá", "Hello")).toBe("Olá");
    expect(locale()).toBe("pt-BR");

    toggleLang();
    expect(lang.get()).toBe("en");
    expect(tr("Olá", "Hello")).toBe("Hello");
    expect(locale()).toBe("en-US");
  });
});
