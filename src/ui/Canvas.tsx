// The drawing surface: sizes the canvas to its box (at device resolution),
// redraws when something changed, and forwards input to the tools.
import { useEffect, useRef, useState } from "preact/hooks";
import { draw } from "../editor/draw";
import { editor, prefs, requestDraw, view, type ToolId } from "../editor/state";
import { fitView, isSpaceDown, pointerDown, pointerMove, pointerUp, refreshOverlay, wheel } from "../editor/tools";

const CURSORS: Partial<Record<ToolId, string>> = { hand: "grab", select: "default" };

export function Canvas({ tool }: { tool: ToolId }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      view.width = r.width;
      view.height = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      if (view.needsFit && r.width > 0 && r.height > 0) {
        view.needsFit = false;
        fitView();
      }
      requestDraw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const unsub = [
      editor.subscribe(() => {
        refreshOverlay();
        requestDraw();
      }),
      prefs.subscribe(requestDraw),
    ];
    refreshOverlay();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const s = editor.get();
      if (!view.dirty || !s) return;
      view.dirty = false;
      draw(ctx, s, prefs.get());
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub.forEach((u) => u());
    };
  }, []);

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const cursor = panning ? "grabbing" : isSpaceDown() ? "grab" : (CURSORS[tool] ?? "crosshair");

  return (
    <canvas
      ref={ref}
      class="canvas"
      style={{ cursor }}
      tabIndex={0}
      onPointerDown={(e) => {
        ref.current!.focus();
        ref.current!.setPointerCapture(e.pointerId);
        if (e.button === 1 || tool === "hand" || isSpaceDown()) setPanning(true);
        pointerDown(e, ...local(e));
      }}
      onPointerMove={(e) => pointerMove(e, ...local(e))}
      onPointerUp={(e) => {
        setPanning(false);
        pointerUp(e, ...local(e));
      }}
      onPointerLeave={() => {
        if (view.hover) {
          view.hover = null;
          requestDraw();
        }
      }}
      onWheel={(e) => {
        e.preventDefault();
        wheel(e, ...local(e));
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
