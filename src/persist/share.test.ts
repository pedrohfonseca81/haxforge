import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeMap, encodeMap, sharedCode, shareUrl } from "./share";

test("a map survives the share link, and the link is short", async () => {
  const text = readFileSync(join(import.meta.dir, "../vendor/kickr/shared/stadiums/futsal-bazinga.hbs"), "utf8");
  const url = await shareUrl(text, "https://x.github.io/haxforge/#old");
  expect(url.startsWith("https://x.github.io/haxforge/#map=")).toBe(true);
  expect(url.length).toBeLessThan(text.length / 3);
  expect(await decodeMap(sharedCode(url.slice(url.indexOf("#")))!)).toBe(text);
  expect(await decodeMap(await encodeMap("{ name: 'é ã ç 😀' }"))).toBe("{ name: 'é ã ç 😀' }");
});
