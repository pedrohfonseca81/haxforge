import { spawn, type ChildProcess } from "child_process";
import { chromium, type Browser, type Page } from "playwright";

async function verify() {
  console.log("Starting server for test...");
  const server: ChildProcess = spawn("bun", ["run", "preview", "--port", "4176"], { stdio: "inherit" });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    const browser: Browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
    });

    // ----------------------------------------------------
    // TEST 1: Cross-tab Copy and Paste
    // ----------------------------------------------------
    console.log("--- TEST 1: Cross-tab Copy and Paste ---");
    const page1: Page = await context.newPage();
    await page1.goto("http://localhost:4176");
    await page1.waitForSelector(".cards.small");

    // Open Classic map in Tab 1
    console.log("Tab 1: Opening Classic template...");
    await page1.locator(".cards.small .card").first().click();
    await page1.waitForSelector(".topbar");

    // Select all elements in Tab 1 (Ctrl+A) and copy (Ctrl+C)
    console.log("Tab 1: Selecting all and copying (Ctrl+A, Ctrl+C)...");
    await page1.keyboard.press("Control+a");
    await page1.waitForTimeout(200);
    await page1.keyboard.press("Control+c");
    await page1.waitForTimeout(300);

    // Verify localStorage has the clip
    const storedClip = await page1.evaluate(() => localStorage.getItem("haxforge.clipboard"));
    console.log("Tab 1: Clipboard stored in localStorage? Length:", storedClip?.length ?? 0);
    if (!storedClip || storedClip.length < 20) {
      throw new Error("Clipboard was not saved to localStorage!");
    }

    // Open Tab 2 with Blank map
    console.log("Tab 2: Opening Blank map...");
    const page2: Page = await context.newPage();
    await page2.goto("http://localhost:4176");
    await page2.waitForSelector(".home-actions");
    await page2.locator(".home-actions button", { hasText: "Novo mapa" }).or(page2.locator(".home-actions button", { hasText: "New map" })).click();
    await page2.waitForSelector(".topbar");

    // In Tab 2, check initial vertex count
    const initialMeter = await page2.locator(".meter-num").first().textContent();
    console.log("Tab 2 initial vertex count:", initialMeter);

    // Paste in Tab 2 (Ctrl+V)
    console.log("Tab 2: Pasting (Ctrl+V)...");
    await page2.keyboard.press("Control+v");
    await page2.waitForTimeout(400);

    const pastedMeter = await page2.locator(".meter-num").first().textContent();
    console.log("Tab 2 vertex count after paste:", pastedMeter);
    if (Number(pastedMeter) <= Number(initialMeter)) {
      throw new Error(`Paste did not add vertices from Tab 1! Before: ${initialMeter}, After: ${pastedMeter}`);
    }
    console.log("✓ SUCCESS: Cross-tab copy and paste works flawlessly!");

    // ----------------------------------------------------
    // TEST 2: Context Menu (Right Click)
    // ----------------------------------------------------
    console.log("\n--- TEST 2: Context Menu on Canvas ---");
    const canvas = page2.locator("canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Canvas bounding box not found!");

    // Right-click on empty canvas
    console.log("Right-clicking empty canvas area...");
    await page2.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page2.waitForSelector(".context-menu");
    console.log("Context menu appeared!");

    // Verify empty canvas options
    const menuText = await page2.locator(".context-menu").textContent();
    console.log("Context menu items visible:", menuText?.slice(0, 100));
    if (!menuText?.includes("Colar") && !menuText?.includes("Paste")) {
      throw new Error("Context menu missing paste option!");
    }

    // Click 'Escape' to close
    await page2.keyboard.press("Escape");
    await page2.waitForTimeout(200);
    const menuCount = await page2.locator(".context-menu").count();
    if (menuCount !== 0) throw new Error("Escape key did not close context menu!");
    console.log("✓ Context menu closed on Escape.");

    // Select an object and right-click on it
    console.log("Right clicking on object with active selection...");
    await page2.keyboard.press("Control+a");
    await page2.waitForTimeout(200);
    await page2.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
    await page2.waitForSelector(".context-menu");

    const selMenuText = await page2.locator(".context-menu").textContent();
    console.log("Selection context menu:", selMenuText?.slice(0, 100));
    if (!selMenuText?.includes("Recortar") && !selMenuText?.includes("Cut")) {
      throw new Error("Context menu for selection missing Cut option!");
    }
    if (!selMenuText?.includes("Apagar") && !selMenuText?.includes("Delete")) {
      throw new Error("Context menu for selection missing Delete option!");
    }
    console.log("✓ SUCCESS: Context menu on selection contains all required actions!");

    // Take a screenshot of the context menu in action
    await page2.screenshot({ path: "public/docs/media/context-menu.webp", type: "webp", quality: 90 });
    console.log("Saved context-menu.webp screenshot!");

    await browser.close();
    console.log("\nAll tests passed with 100% success!");
  } finally {
    server.kill();
  }
}

verify().catch((e) => {
  console.error(e);
  process.exit(1);
});
