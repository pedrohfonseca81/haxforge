import { chromium } from "playwright";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  const logoSvg = readFileSync(resolve("public/logo.svg"), "utf-8");
  const editorImgBase64 = readFileSync(resolve("public/docs/media/en/editor-overview.webp")).toString("base64");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1200px;
      height: 630px;
      background: radial-gradient(circle at 80% 20%, #1a2742 0%, #0a0d14 65%);
      color: #f0f4fc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      overflow: hidden;
      display: flex;
      position: relative;
    }
    .grid {
      position: absolute;
      inset: 0;
      background-image: linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px);
      background-size: 32px 32px;
      pointer-events: none;
    }
    .glow {
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(91, 140, 255, 0.15) 0%, transparent 70%);
      top: -100px;
      right: 100px;
      pointer-events: none;
    }
    .content {
      width: 580px;
      height: 100%;
      padding: 60px 48px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      z-index: 2;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .logo {
      width: 64px;
      height: 64px;
      filter: drop-shadow(0 8px 24px rgba(91,140,255,0.3));
    }
    .brand {
      font-size: 44px;
      font-weight: 800;
      letter-spacing: -1px;
      line-height: 1;
    }
    .brand span {
      color: #5b8cff;
    }
    .title-box {
      margin-top: 24px;
    }
    .tagline {
      font-size: 34px;
      font-weight: 700;
      line-height: 1.25;
      color: #ffffff;
      letter-spacing: -0.5px;
    }
    .desc {
      font-size: 17px;
      color: #94a3b8;
      line-height: 1.5;
      margin-top: 14px;
    }
    .features {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 24px;
    }
    .badge {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      padding: 7px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .badge .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #5b8cff;
    }
    .footer-url {
      font-size: 15px;
      font-weight: 600;
      color: #5b8cff;
      letter-spacing: 0.5px;
    }
    .preview-container {
      position: absolute;
      right: -60px;
      top: 55px;
      width: 720px;
      height: 520px;
      z-index: 1;
      transform: perspective(1000px) rotateY(-8deg) rotateX(4deg);
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: -20px 30px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(91, 140, 255, 0.2);
      overflow: hidden;
      background: #0f1420;
    }
    .preview-container img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: left top;
      display: block;
    }
  </style>
</head>
<body>
  <div class="grid"></div>
  <div class="glow"></div>
  
  <div class="content">
    <div>
      <div class="header">
        <div class="logo">${logoSvg}</div>
        <div class="brand">hax<span>forge</span></div>
      </div>

      <div class="title-box">
        <h1 class="tagline">Modern HaxBall Stadium & Map Editor</h1>
        <p class="desc">
          Editor completo e moderno de mapas e estádios para HaxBall (.hbs). 
          Física em tempo real, gerador inteligente de campos, curvas automáticas e 100% offline no navegador.
        </p>
      </div>

      <div class="features">
        <div class="badge"><div class="dot"></div>Live Physics Playground</div>
        <div class="badge"><div class="dot"></div>Smart Field Generator</div>
        <div class="badge"><div class="dot"></div>Curve Optimizer</div>
        <div class="badge"><div class="dot"></div>HBS & JSON5 Importer</div>
        <div class="badge"><div class="dot"></div>Cross-Tab Clipboard</div>
        <div class="badge"><div class="dot"></div>100% Offline / Local</div>
      </div>
    </div>

    <div class="footer-url">pedrohfonseca81.github.io/haxforge</div>
  </div>

  <div class="preview-container">
    <img src="data:image/webp;base64,${editorImgBase64}" alt="HaxForge Stadium Editor Screenshot" />
  </div>
</body>
</html>
  `;

  await page.setContent(html);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "public/og-image.png", type: "png" });
  console.log("Successfully generated public/og-image.png");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
