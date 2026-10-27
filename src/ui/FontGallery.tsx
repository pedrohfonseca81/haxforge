// Choosing the letreiro's font: previews of the text itself in every font,
// grouped by cost (single strokes are cheap, outlines cost more).
import { useEffect, useRef, useState } from "preact/hooks";
import { Check, LoaderCircle, Type, Upload } from "lucide-preact";
import { putFont } from "../persist/db";
import { addFont, ensureFont, fontNames, GOOGLE_FONTS, loadStrokeFonts, STROKE_FONTS, type StrokeGlyph } from "../smart/fonts";
import { glyph as sansGlyph } from "../smart/font";
import { toast } from "../editor/toast";
import { generateText } from "../smart/text";
import { lang, tr } from "../i18n";
import { useStore } from "../vendor/kickr/client/store";

// Loads Google's own CSS once, only to draw the previews.
let cssLoaded = false;
function loadGoogleCss(): void {
  if (cssLoaded) return;
  cssLoaded = true;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${GOOGLE_FONTS.map(([, f]) => `family=${f.replace(/ /g, "+")}`).join("&")}&display=swap`;
  document.head.appendChild(link);
}

// A preview drawn from glyph polylines (Haxforge Sans or a stroke font).
function StrokePreview({ text, glyphs }: { text: string; glyphs: (ch: string) => { w: number; p: number[][] } | null }) {
  let x = 0;
  const paths: string[] = [];
  for (const ch of text) {
    const g = glyphs(ch);
    if (!g) {
      x += 3;
      continue;
    }
    for (const poly of g.p) {
      let d = "";
      for (let k = 0; k + 1 < poly.length; k += 2) d += `${k ? "L" : "M"}${(x + poly[k]).toFixed(2)} ${poly[k + 1].toFixed(2)}`;
      paths.push(d);
    }
    x += g.w + (g.w > 6 ? 0.4 : 1.6);
  }
  return (
    <svg class="font-preview-svg" viewBox={`-1 -10 ${Math.max(10, x + 2)} 14`} preserveAspectRatio="xMinYMid meet">
      {paths.map((d) => (
        <path d={d} />
      ))}
    </svg>
  );
}

// Haxforge Sans glyphs as polylines (arcs flattened), for the preview.
function sansAsPolylines(ch: string): StrokeGlyph | null {
  const g = sansGlyph(ch);
  if (!g) return null;
  const p: number[][] = [];
  for (const stroke of g.s) {
    const out: number[] = [stroke[0][0], stroke[0][1]];
    for (let i = 1; i < stroke.length; i++) {
      const [ax, ay] = stroke[i - 1];
      const [bx, by, curve = 0] = stroke[i];
      if (!curve) {
        out.push(bx, by);
        continue;
      }
      // Sample the arc (positive curve bulges left of a -> b on screen).
      const th = (curve * Math.PI) / 180;
      const hx = (bx - ax) / 2;
      const hy = (by - ay) / 2;
      const h = Math.hypot(hx, hy);
      const cx = ax + hx - (hy / h) * h / Math.tan(th / 2);
      const cy = ay + hy + (hx / h) * h / Math.tan(th / 2);
      const r = Math.hypot(ax - cx, ay - cy);
      const a0 = Math.atan2(ay - cy, ax - cx);
      let a1 = Math.atan2(by - cy, bx - cx);
      if (th > 0) while (a1 < a0) a1 += Math.PI * 2;
      else while (a1 > a0) a1 -= Math.PI * 2;
      for (let k = 1; k <= 8; k++) out.push(cx + r * Math.cos(a0 + ((a1 - a0) * k) / 8), cy + r * Math.sin(a0 + ((a1 - a0) * k) / 8));
    }
    p.push(out);
  }
  return { w: g.w, p };
}

export function FontGallery({ current, sample, onPick, onClose }: { current: string; sample: string; onPick: (font: string) => void; onClose: () => void }) {
  useStore(lang);
  const [stroke, setStroke] = useState<Awaited<ReturnType<typeof loadStrokeFonts>> | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const uploaded = useStore(fontNames);
  const input = useRef<HTMLInputElement>(null);
  const text = (sample.split("\n")[0] || "Haxforge").slice(0, 16);

  useEffect(() => {
    void loadStrokeFonts().then(setStroke);
    loadGoogleCss();
  }, []);

  const pick = async (name: string) => {
    setLoading(name);
    try {
      await ensureFont(name);
      onPick(name);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(null);
    }
  };

  // What the current text costs in each stroke font (known without downloading).
  const cost = (name: string): number | null => {
    if (name && !stroke) return null;
    try {
      return generateText({ text, font: name, size: 40 }).segments.length;
    } catch {
      return null;
    }
  };

  const card = (name: string, label: string, preview: preact.ComponentChildren, note?: string, segments?: number | null) => (
    <button class={`font-card ${current === name ? "on" : ""}`} onClick={() => void pick(name)} title={note}>
      <div class="font-preview">{preview}</div>
      <div class="font-name">
        {current === name && <Check size={12} />}
        {loading === name && <LoaderCircle size={12} class="spin" />}
        <span>{label}</span>
        {segments != null && <span class={`font-cost ${segments > 120 ? "high" : ""}`}>{segments} seg</span>}
      </div>
    </button>
  );

  return (
    <div class="modal-back" onPointerDown={onClose}>
      <div class="dialog fonts" onPointerDown={(e) => e.stopPropagation()}>
        <h3>
          <Type size={16} /> {tr("Fontes do letreiro", "Banner fonts")}
        </h3>
        <h4>{tr("Traço único · baratas", "Single-stroke · low cost")}</h4>
        <p class="muted small">
          {tr(
            "Cada letra é desenhada com um traço só, como uma caneta, e as curvas viram arcos do HaxBall. O número é quanto o seu texto custa em segmentos (de 255).",
            "Each letter is drawn with a single stroke, like a pen, and curves become native HaxBall arcs. The number shows how many segments your text costs (out of 255).",
          )}
        </p>
        <div class="font-grid">
          {card(
            "",
            "Haxforge Sans",
            <StrokePreview text={text.toUpperCase()} glyphs={sansAsPolylines} />,
            tr("A fonte própria: maiúsculas feitas de retas e arcos", "Built-in font: uppercase letters made of lines and arcs"),
            cost(""),
          )}
          {STROKE_FONTS.map(([id, name]) =>
            card(
              `stroke:${id}`,
              name,
              stroke ? <StrokePreview text={text} glyphs={(ch) => stroke[id]?.glyphs[ch] ?? null} /> : <span class="muted small">{tr("carregando…", "loading…")}</span>,
              undefined,
              cost(`stroke:${id}`),
            ),
          )}
        </div>
        <h4>{tr("Google Fonts · contorno", "Google Fonts · outline")}</h4>
        <p class="muted small">
          {tr(
            "Desenham o contorno das letras: ficam iguais à fonte, mas custam mais (ajuste a simplificação no painel). Baixadas na hora e guardadas no navegador.",
            "Draws letter outlines: matches the font faithfully, but costs more segments (adjust simplification in the panel). Downloaded on demand and cached in the browser.",
          )}
        </p>
        <div class="font-grid">
          {GOOGLE_FONTS.map(([id, family]) =>
            card(
              `google:${id}`,
              family,
              <span class="font-preview-css" style={{ fontFamily: `'${family}', sans-serif` }}>
                {text}
              </span>,
            ),
          )}
        </div>
        <h4>{tr("Suas fontes", "Your fonts")}</h4>
        <div class="font-grid">
          {uploaded.map((name) => card(name, name, <span class="muted small">{tr("enviada", "uploaded")}</span>))}
          <button class="font-card upload" onClick={() => input.current?.click()}>
            <Upload size={18} />
            <span>{tr("Enviar TTF, OTF ou WOFF", "Upload TTF, OTF, or WOFF")}</span>
          </button>
          <input
            ref={input}
            type="file"
            accept=".ttf,.otf,.woff"
            hidden
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = "";
              if (!f) return;
              try {
                const data = await f.arrayBuffer();
                const name = await addFont(data, f.name.replace(/\.[^.]+$/, ""));
                await putFont({ name, data });
                onPick(name);
                onClose();
              } catch {
                toast(tr("Não consegui ler essa fonte (use TTF, OTF ou WOFF).", "Could not read this font (use TTF, OTF, or WOFF)."), "error");
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
