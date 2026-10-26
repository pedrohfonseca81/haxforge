// The versions dialog: name a version, browse snapshots, restore one.
import { useEffect, useRef, useState } from "preact/hooks";
import { History, RotateCcw, Trash2 } from "lucide-preact";
import { importText } from "../doc/model";
import { editor } from "../editor/state";
import { toast } from "../editor/toast";
import { restore, snapshot } from "../editor/versions";
import { drawThumb } from "../editor/thumb";
import { deleteVersion, listVersions, type Version } from "../persist/db";
import { useStore } from "../vendor/kickr/client/store";

function Thumb({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    try {
      const c = ref.current!;
      const dpr = window.devicePixelRatio || 1;
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      drawThumb(c, importText(text).doc);
    } catch {}
  }, [text]);
  return <canvas ref={ref} class="version-thumb" />;
}

const when = (t: number) => new Date(t).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  const s = useStore(editor);
  const [list, setList] = useState<Version[] | null>(null);
  const [label, setLabel] = useState("");
  const reload = () => {
    if (s) void listVersions(s.projectId).then(setList, () => setList([]));
  };
  useEffect(reload, [s?.projectId]);
  if (!s) return null;
  return (
    <div class="modal-back" onPointerDown={onClose}>
      <div class="dialog wide" onPointerDown={(e) => e.stopPropagation()}>
        <h3>
          <History size={16} /> Versões
        </h3>
        <p class="muted small">Snapshots automáticos ao abrir o projeto e a cada 5 minutos de edição, mais as versões que você nomear. Restaurar guarda o estado atual antes.</p>
        <div class="version-new">
          <input
            class="text"
            placeholder="Nome da versão (ex.: antes de mudar as redes)"
            value={label}
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click()}
          />
          <button
            class="btn primary"
            onClick={async () => {
              await snapshot(label.trim() || "Versão salva");
              setLabel("");
              reload();
              toast("Versão salva");
            }}
          >
            Salvar versão
          </button>
        </div>
        <div class="versions">
          {list?.length === 0 && <div class="empty">Nenhuma versão ainda.</div>}
          {list?.map((v) => (
            <div class="version">
              <Thumb text={v.text} />
              <div class="version-info">
                <b>{v.label || "Automática"}</b>
                <span class="muted small">{when(v.createdAt)}</span>
              </div>
              <button
                class="btn small"
                onClick={async () => {
                  await restore(v);
                  onClose();
                  toast(`Versão de ${when(v.createdAt)} restaurada (o estado anterior foi guardado).`);
                }}
              >
                <RotateCcw size={13} /> Restaurar
              </button>
              <button
                class="icon-btn danger"
                title="Apagar versão"
                onClick={async () => {
                  await deleteVersion(v.id);
                  reload();
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
