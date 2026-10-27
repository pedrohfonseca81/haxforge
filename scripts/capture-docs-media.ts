import { spawn, type ChildProcess } from "child_process";
import { chromium, type Browser, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.resolve("public/docs/media");
const DOCS_DIR = path.resolve("docs/screenshots");
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(DOCS_DIR, { recursive: true });

async function run() {
  console.log("Starting vite preview server...");
  const server: ChildProcess = spawn("bun", ["run", "preview", "--port", "4173"], { stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    const browser: Browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 2, // HiDPI / retina for crisp screenshots
    });

    const page: Page = await context.newPage();

    // Helper to save screenshot to both public/docs/media and docs/screenshots
    async function saveShot(name: string) {
      const p1 = path.join(OUT_DIR, `${name}.webp`);
      const p2 = path.join(DOCS_DIR, `${name}.webp`);
      await page.screenshot({ path: p1, type: "webp", quality: 90 });
      fs.copyFileSync(p1, p2);
      console.log(`Saved screenshot: ${name}.webp`);
    }

    // 1. Home Screen
    console.log("Capturing Home screen...");
    await page.goto("http://localhost:4173");
    await page.waitForSelector(".home-head");
    await saveShot("home");

    // 2. Open Classic Template -> Editor Screen
    console.log("Opening Classic Template...");
    const classicCard = page.locator(".cards.small .card").first();
    await classicCard.click();
    await page.waitForSelector(".topbar");
    await page.waitForTimeout(500);
    await saveShot("editor-overview");

    // 3. Command Palette (Ctrl+K)
    console.log("Capturing Command Palette...");
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".palette");
    await page.waitForTimeout(300);
    await saveShot("command-palette");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    // 4. Physics Overlay Menu
    console.log("Capturing Physics Overlay...");
    const physBtn = page.locator(".phys button");
    if (await physBtn.count() > 0) {
      await physBtn.click();
      await page.waitForSelector(".phys-menu");
      // Check collision colors
      const check = page.locator(".phys-menu input[type=checkbox]").first();
      if (await check.count() > 0) await check.check();
      await page.waitForTimeout(300);
      await saveShot("physics-overlay");
    }

    // 5. Right panel tabs: Issues
    console.log("Capturing Issues tab...");
    const issuesTab = page.locator(".tabs button", { hasText: "Problemas" }).or(page.locator(".tabs button", { hasText: "Issues" }));
    if (await issuesTab.count() > 0) {
      await issuesTab.first().click();
      await page.waitForTimeout(300);
      await saveShot("issues-panel");
    }

    // 6. Right panel tabs: Traits
    console.log("Capturing Traits tab...");
    const traitsTab = page.locator(".tabs button", { hasText: "Traits" });
    if (await traitsTab.count() > 0) {
      await traitsTab.first().click();
      await page.waitForTimeout(300);
      await saveShot("traits-panel");
    }

    // Switch back to props
    const propsTab = page.locator(".tabs button", { hasText: "Propriedades" }).or(page.locator(".tabs button", { hasText: "Properties" }));
    if (await propsTab.count() > 0) {
      await propsTab.first().click();
    }

    // 7. Playground Split Mode
    console.log("Capturing Playground Split mode...");
    const splitBtn = page.locator(".caret-btn");
    if (await splitBtn.count() > 0) {
      await splitBtn.click();
      await page.waitForSelector(".playground");
      await page.waitForTimeout(600);
      await saveShot("playground-split");
      // Close split play
      await splitBtn.click();
      await page.waitForTimeout(300);
    }

    // 8. Go Home and Generate Field
    console.log("Capturing Field Generator...");
    const homeBtn = page.locator(".topbar button").first();
    await homeBtn.click();
    await page.waitForSelector(".home-head");
    const genFieldBtn = page.locator(".home-actions button", { hasText: "Gerar campo" }).or(page.locator(".home-actions button", { hasText: "Generate field" }));
    if (await genFieldBtn.count() > 0) {
      await genFieldBtn.first().click();
      await page.waitForSelector(".topbar");
      await page.waitForTimeout(500);
      await saveShot("field-generator");
    }

    // 9. Smart Text tool
    console.log("Capturing Smart Text tool...");
    // Press 't' to activate text tool
    await page.keyboard.press("t");
    await page.waitForTimeout(200);
    // Click on canvas center to create text
    const canvas = page.locator("canvas");
    if (await canvas.count() > 0) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(500);
        await saveShot("smart-text");
      }
    }

    // 10. Optimizer modal (press Ctrl+K and type Otimizador)
    console.log("Capturing Optimizer modal...");
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".palette-input input");
    await page.keyboard.type("Otimiz");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    if (await page.locator(".modal-back").count() > 0) {
      await saveShot("optimizer");
      await page.keyboard.press("Escape");
    }

    // 11. Image Trace dialog
    console.log("Capturing Trace dialog...");
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".palette-input input");
    await page.keyboard.type("Importar");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    if (await page.locator(".modal-back").count() > 0) {
      await saveShot("image-import");
      await page.keyboard.press("Escape");
    }

    console.log("Done taking screenshots!");
    await browser.close();
  } finally {
    server.kill();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
