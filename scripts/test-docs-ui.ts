import { spawn, type ChildProcess } from "child_process";
import { chromium, type Browser, type Page } from "playwright";
import * as path from "path";

async function verify() {
  const server: ChildProcess = spawn("bun", ["run", "preview", "--port", "4175"], { stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    const browser: Browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const page: Page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 });

    console.log("Navigating to http://localhost:4175...");
    await page.goto("http://localhost:4175");
    await page.waitForSelector(".home-head");

    // 1. Click the '?' icon button on home
    console.log("Clicking '?' button on home screen...");
    const helpBtn = page.locator(".home-actions button[title='Documentação'], .home-actions button[title='Documentation']");
    await helpBtn.click();
    await page.waitForSelector(".docs-page");
    console.log("Docs page opened successfully!");

    // Take screenshot of Docs overview
    await page.screenshot({ path: "public/docs/media/docs-overview.webp", type: "webp", quality: 90 });
    console.log("Saved public/docs/media/docs-overview.webp");

    // 2. Click a topic: 'Gerador de Campo' / 'field-generator'
    console.log("Clicking on 'Gerador de Campo' topic...");
    const fieldTopic = page.locator(".docs-nav-item", { hasText: "Gerador de Campo" }).or(page.locator(".docs-nav-item", { hasText: "Field Generator" }));
    await fieldTopic.first().click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: "public/docs/media/docs-topic-field.webp", type: "webp", quality: 90 });
    console.log("Saved public/docs/media/docs-topic-field.webp");

    // 3. Test back button
    console.log("Clicking 'Voltar'...");
    const backBtn = page.locator(".docs-topbar-left button");
    await backBtn.click();
    await page.waitForSelector(".home-head");
    console.log("Returned to home successfully!");

    // 4. Open Classic map and click '?' from topbar
    console.log("Opening Classic map in editor...");
    const classicCard = page.locator(".cards.small .card").first();
    await classicCard.click();
    await page.waitForSelector(".topbar");
    console.log("In editor. Clicking '?' in topbar...");
    const topbarHelp = page.locator(".topbar button[title='Documentação'], .topbar button[title='Documentation']");
    await topbarHelp.click();
    await page.waitForSelector(".docs-page");
    console.log("In docs. Clicking 'Voltar' to return to editor...");
    await page.locator(".docs-topbar-left button").click();
    await page.waitForSelector(".topbar");
    console.log("Returned to editor successfully!");

    // 5. Test direct URL navigation: #docs/smart-text
    console.log("Testing direct hash URL: #docs/smart-text...");
    await page.goto("http://localhost:4175/#docs/smart-text");
    await page.waitForSelector(".docs-page");
    const activeTitle = await page.locator(".docs-title").textContent();
    console.log("Loaded title from direct hash:", activeTitle);

    console.log("All Docs UI tests passed with 100% success!");
    await browser.close();
  } finally {
    server.kill();
  }
}

verify().catch((e) => {
  console.error(e);
  process.exit(1);
});
