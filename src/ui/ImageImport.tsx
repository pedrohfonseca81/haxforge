// Bringing drawings into the map: SVG files go straight in; raster images
// are traced first (threshold + outline) with a live preview.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ImageUp } from "lucide-preact";
import { commit, ed, view } from "../editor/state";
import { toast } from "../editor/toast";
import { createSmart, refsOf } from "../smart/smart";
import { loopsToSvg, maskFromPixels, traceMask, type Mask } from "../smart/trace";
import { Store, useStore } from "../vendor/kickr/client/store";

// A raster image waiting for the trace dialog.
export const pendingImage = new Store<{ name: string; img: HTMLImageElement } | null>(null);

function insertSvg(svg: string): void {
  // About a third of what is on screen, centered in the view.
  const size = Math.round(Math.max(40, (view.width / view.cam.zoom) * 0.35));
  const made = createSmart(ed().doc, "shape", { svg, x: Math.round(view.cam.x), y: Math.round(view.cam.y), size });
  commit(made.doc, refsOf(made.smart.items));
  const n = refsOf(made.smart.items).length;
  if (!n) toast("Não encontrei contornos nesse desenho.", "error");
  else toast("Desenho importado. Ajuste tamanho e detalhe no painel (menos detalhe = menos segmentos).");
}

export async function importImageFile(file: File): Promise<void> {
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) return insertSvg(await file.text());
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => pendingImage.set({ name: file.name, img });
  img.onerror = () => toast("Não consegui abrir essa imagem.", "error");
  img.src = url;
}

export function ImportButton() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button class="tool" title="Importar SVG ou imagem" onClick={() => input.current?.click()}>
        <ImageUp size={18} />
      </button>
      <input
        ref={input}
        type="file"
        accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) void importImageFile(f);
          (e.target as HTMLInputElement).value = "";
        }}
      />
    </>
  );
}

const MAX = 220;

export function TraceDialog() {
  const pending = useStore(pendingImage);
  const [threshold, setThreshold] = useState(128);
  const [invert, setInvert] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);

  // The image's pixels, scaled down so tracing stays fast.
  const pixels = useMemo(() => {
    if (!pending) return null;
    const { img } = pending;
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, w, h };
  }, [pending]);

  const traced = useMemo(() => {
    if (!pixels) return null;
    const mask: Mask = maskFromPixels(pixels.data, pixels.w, pixels.h, threshold, invert);
    return { mask, loops: traceMask(mask) };
  }, [pixels, threshold, invert]);

  useEffect(() => {
    const c = preview.current;
    if (!c || !traced || !pixels) return;
    const { w, h } = pixels;
    const scale = Math.min(360 / w, 260 / h);
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#2e6b3c";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (traced.mask.bits[y * w + x]) ctx.fillRect(x * scale, y * scale, scale, scale);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    for (const l of traced.loops) {
      ctx.beginPath();
      l.forEach(([x, y], i) => (i ? ctx.lineTo(x * scale, y * scale) : ctx.moveTo(x * scale, y * scale)));
      ctx.stroke();
    }
  }, [traced]);

  if (!pending || !pixels || !traced) return null;
  const close = () => pendingImage.set(null);
  return (
    <div class="modal-back" onPointerDown={close}>
      <div class="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>
          <ImageUp size={16} /> Importar imagem
        </h3>
        <p class="muted small">A imagem vira contornos. Escolha o que conta como desenho; depois, no painel, o detalhe controla quantos segmentos ela custa.</p>
        <canvas ref={preview} class="trace-preview" />
        <div class="opt-tol">
          Limiar
          <input type="range" min={1} max={254} value={threshold} onInput={(e) => setThreshold(Number((e.target as HTMLInputElement).value))} />
          <b>{threshold}</b>
        </div>
        <label class="trace-invert">
          <input type="checkbox" checked={invert} onChange={() => setInvert(!invert)} /> Inverter (desenho claro em fundo escuro)
        </label>
        <p class="muted small">{traced.loops.length} contorno(s)</p>
        <div class="dialog-actions">
          <button class="btn ghost" onClick={close}>
            Cancelar
          </button>
          <button
            class="btn primary"
            disabled={!traced.loops.length}
            onClick={() => {
              insertSvg(loopsToSvg(traced.loops, pixels.w, pixels.h));
              close();
            }}
          >
            Importar
          </button>
        </div>
      </div>
    </div>
  );
}
