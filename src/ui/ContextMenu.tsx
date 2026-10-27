import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  Scissors,
  Copy,
  ClipboardPaste,
  Trash2,
  BringToFront,
  SendToBack,
  FlipHorizontal2,
  FlipVertical2,
  Unlink,
  Tags,
  EyeOff,
  Lock,
  Circle,
  CircleDot,
  Type,
  LandPlot,
  Zap,
  Grid3x3,
  Maximize2,
  Layers,
  ArrowUp,
  ArrowDown,
} from "lucide-preact";
import { tr } from "../i18n";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicate,
  explodeSelection,
  extractTrait,
  hasClipboard,
  insertDiscAt,
  insertPattern,
  insertTextAt,
  insertVertexAt,
  mirrorSelection,
  moveSelection,
  optimizerOpen,
  paste,
  selectAll,
  toggleHidden,
  toggleLocked,
} from "../editor/actions";
import { ed, prefs, select } from "../editor/state";
import { fitView, zoomAt } from "../editor/tools";
import { smartSelected, smartOf } from "../smart/smart";

export interface ContextMenuState {
  x: number;
  y: number;
  worldPos: [number, number];
}

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const s = ed();
  const hasSel = s.selection.length > 0;
  const canPaste = hasClipboard();
  const sm = hasSel ? smartSelected(s.doc, s.selection) ?? (s.selection[0] ? smartOf(s.doc, s.selection[0]) : null) : null;

  useEffect(() => {
    const handleDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("touchstart", handleDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("touchstart", handleDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const [pos, setPos] = useState({ left: menu.x, top: menu.y });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 12;
    let left = menu.x;
    let top = menu.y;

    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (top + rect.height > window.innerHeight - pad) {
      if (menu.y - rect.height >= pad) {
        top = menu.y - rect.height;
      } else {
        top = Math.max(pad, window.innerHeight - rect.height - pad);
      }
    }
    setPos({ left, top });
  }, [menu.x, menu.y, hasSel]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={ref}
      class="context-menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasSel ? (
        <>
          <div class="context-menu-header">
            <span>
              {s.selection.length === 1
                ? tr("1 item selecionado", "1 item selected")
                : tr(`${s.selection.length} itens selecionados`, `${s.selection.length} items selected`)}
            </span>
          </div>

          <button class="context-menu-item" onClick={() => run(cutSelection)}>
            <Scissors size={14} />
            <span class="label">{tr("Recortar", "Cut")}</span>
            <kbd class="shortcut">Ctrl+X</kbd>
          </button>

          <button class="context-menu-item" onClick={() => run(copySelection)}>
            <Copy size={14} />
            <span class="label">{tr("Copiar", "Copy")}</span>
            <kbd class="shortcut">Ctrl+C</kbd>
          </button>

          <button
            class="context-menu-item"
            disabled={!canPaste}
            onClick={() => run(() => paste(false, menu.worldPos))}
          >
            <ClipboardPaste size={14} />
            <span class="label">{tr("Colar aqui", "Paste here")}</span>
            <kbd class="shortcut">Ctrl+V</kbd>
          </button>

          <button class="context-menu-item" onClick={() => run(duplicate)}>
            <Layers size={14} />
            <span class="label">{tr("Duplicar", "Duplicate")}</span>
            <kbd class="shortcut">Ctrl+D</kbd>
          </button>

          <button class="context-menu-item danger" onClick={() => run(deleteSelection)}>
            <Trash2 size={14} />
            <span class="label">{tr("Apagar", "Delete")}</span>
            <kbd class="shortcut">Del</kbd>
          </button>

          <div class="context-menu-sep" />

          <div class="context-menu-subgroup">
            <span class="context-menu-subgroup-title">{tr("Ordem", "Order")}</span>
            <button class="context-menu-item small" onClick={() => run(() => moveSelection("front"))}>
              <BringToFront size={13} />
              <span class="label">{tr("Trazer para a frente", "Bring to front")}</span>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => moveSelection("forward"))}>
              <ArrowUp size={13} />
              <span class="label">{tr("Avançar", "Bring forward")}</span>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => moveSelection("backward"))}>
              <ArrowDown size={13} />
              <span class="label">{tr("Recuar", "Send backward")}</span>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => moveSelection("back"))}>
              <SendToBack size={13} />
              <span class="label">{tr("Mandar para trás", "Send to back")}</span>
            </button>
          </div>

          <div class="context-menu-sep" />

          <div class="context-menu-subgroup">
            <span class="context-menu-subgroup-title">{tr("Simetria & Espelhar", "Symmetry & Mirror")}</span>
            <button class="context-menu-item small" onClick={() => run(() => mirrorSelection("x"))}>
              <FlipHorizontal2 size={13} />
              <span class="label">{tr("Espelhar horizontal (X)", "Mirror horizontal (X)")}</span>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => mirrorSelection("y"))}>
              <FlipVertical2 size={13} />
              <span class="label">{tr("Espelhar vertical (Y)", "Mirror vertical (Y)")}</span>
            </button>
          </div>

          <div class="context-menu-sep" />

          {sm && (
            <button class="context-menu-item" onClick={() => run(explodeSelection)}>
              <Unlink size={14} />
              <span class="label">{tr("Desvincular objeto inteligente", "Unlink smart object")}</span>
            </button>
          )}

          <button class="context-menu-item" onClick={() => run(extractTrait)}>
            <Tags size={14} />
            <span class="label">{tr("Extrair trait da seleção", "Extract trait")}</span>
          </button>

          <button class="context-menu-item" onClick={() => run(() => toggleHidden(s.selection))}>
            <EyeOff size={14} />
            <span class="label">{tr("Ocultar seleção", "Hide selection")}</span>
          </button>

          <button class="context-menu-item" onClick={() => run(() => toggleLocked(s.selection))}>
            <Lock size={14} />
            <span class="label">{tr("Bloquear seleção", "Lock selection")}</span>
          </button>

          <div class="context-menu-sep" />

          <button class="context-menu-item" onClick={() => run(selectAll)}>
            <span class="label">{tr("Selecionar tudo", "Select all")}</span>
            <kbd class="shortcut">Ctrl+A</kbd>
          </button>
          <button class="context-menu-item" onClick={() => run(() => select([]))}>
            <span class="label">{tr("Limpar seleção", "Deselect")}</span>
            <kbd class="shortcut">Esc</kbd>
          </button>
        </>
      ) : (
        <>
          <div class="context-menu-header">
            <span>{tr("Canvas & Inserção", "Canvas & Insert")}</span>
          </div>

          <button
            class="context-menu-item"
            disabled={!canPaste}
            onClick={() => run(() => paste(false, menu.worldPos))}
          >
            <ClipboardPaste size={14} />
            <span class="label">{tr("Colar aqui", "Paste here")}</span>
            <kbd class="shortcut">Ctrl+V</kbd>
          </button>

          <button class="context-menu-item" onClick={() => run(selectAll)}>
            <span class="label">{tr("Selecionar tudo", "Select all")}</span>
            <kbd class="shortcut">Ctrl+A</kbd>
          </button>

          <div class="context-menu-sep" />

          <div class="context-menu-subgroup">
            <span class="context-menu-subgroup-title">{tr("Inserir neste ponto", "Insert at point")}</span>
            <button class="context-menu-item small" onClick={() => run(() => insertVertexAt(menu.worldPos))}>
              <CircleDot size={13} />
              <span class="label">{tr("Vértice aqui", "Vertex here")}</span>
              <kbd class="shortcut">A</kbd>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => insertDiscAt(menu.worldPos))}>
              <Circle size={13} />
              <span class="label">{tr("Disco aqui", "Disc here")}</span>
              <kbd class="shortcut">D</kbd>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => insertTextAt(menu.worldPos))}>
              <Type size={13} />
              <span class="label">{tr("Letreiro aqui", "Banner text here")}</span>
              <kbd class="shortcut">T</kbd>
            </button>
          </div>

          <div class="context-menu-sep" />

          <div class="context-menu-subgroup">
            <span class="context-menu-subgroup-title">{tr("Padrão de Grama", "Pitch Pattern")}</span>
            <button class="context-menu-item small" onClick={() => run(() => insertPattern("stripes"))}>
              <LandPlot size={13} />
              <span class="label">{tr("Grama listrada", "Striped grass")}</span>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => insertPattern("grid"))}>
              <Grid3x3 size={13} />
              <span class="label">{tr("Grade", "Grid pattern")}</span>
            </button>
            <button class="context-menu-item small" onClick={() => run(() => insertPattern("dots"))}>
              <CircleDot size={13} />
              <span class="label">{tr("Pontos em arco", "Arc dots")}</span>
            </button>
          </div>

          <div class="context-menu-sep" />

          <button class="context-menu-item" onClick={() => run(() => optimizerOpen.set(true))}>
            <Zap size={14} />
            <span class="label">{tr("Otimizar mapa…", "Optimize stadium…")}</span>
          </button>

          <button class="context-menu-item" onClick={() => run(fitView)}>
            <Maximize2 size={14} />
            <span class="label">{tr("Ajustar à tela", "Fit to screen")}</span>
            <kbd class="shortcut">Shift+1</kbd>
          </button>

          <button class="context-menu-item" onClick={() => run(() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1))}>
            <span class="label">{tr("Zoom 100%", "Zoom 1:1")}</span>
            <kbd class="shortcut">Shift+0</kbd>
          </button>

          <button class="context-menu-item" onClick={() => run(() => prefs.update({ showGrid: !prefs.get().showGrid }))}>
            <Grid3x3 size={14} />
            <span class="label">{prefs.get().showGrid ? tr("Ocultar grade", "Hide grid") : tr("Mostrar grade", "Show grid")}</span>
            <kbd class="shortcut">Ctrl+'</kbd>
          </button>
        </>
      )}
    </div>
  );
}
