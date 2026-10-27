// The versions dialog: name a version, browse snapshots, restore one.
import { useEffect, useRef, useState } from "preact/hooks";
import { History, RotateCcw, Trash2 } from "lucide-preact";
import { importText } from "../doc/model";
import { editor } from "../editor/state";
import { toast } from "../editor/toast";
import { restore, snapshot } from "../editor/versions";
import { drawThumb } from "../editor/thumb";
import { deleteVersion, listVersions, type Version } from "../persist/db";
import { lang, locale, tr } from "../i18n";
import { useStore } from "../vendor/haxball/client/store";

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

const when = (t: number) => new Date(t).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function VersionsDialog({ onClose }: { onClose: () => void }) {
  useStore(lang);
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
          <History size={16} /> {tr("Versões", "Versions")}
        </h3>
        <p class="muted small">
          {tr(
            "Snapshots automáticos ao abrir o projeto e a cada 5 minutos de edição, mais as versões que você nomear. Restaurar guarda o estado atual antes.",
            "Automatic snapshots when opening the project and every 5 minutes of editing, plus any versions you name. Restoring saves the current state first.",
          )}
        </p>
        <div class="version-new">
          <input
            class="text"
            placeholder={tr("Nome da versão (ex.: antes de mudar as redes)", "Version name (e.g. before changing the nets)")}
            value={label}
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.nextElementSibling as HTMLButtonElement)?.click()}
          />
          <button
            class="btn primary"
            onClick={async () => {
              await snapshot(label.trim() || tr("Versão salva", "Saved version"));
              setLabel("");
              reload();
              toast(tr("Versão salva", "Version saved"));
            }}
          >
            {tr("Salvar versão", "Save version")}
          </button>
        </div>
        <div class="versions">
          {list?.length === 0 && <div class="empty">{tr("Nenhuma versão ainda.", "No versions yet.")}</div>}
          {list?.map((v) => (
            <div class="version">
              <Thumb text={v.text} />
              <div class="version-info">
                <b>{v.label || tr("Automática", "Auto")}</b>
                <span class="muted small">{when(v.createdAt)}</span>
              </div>
              <button
                class="btn small"
                onClick={async () => {
                  await restore(v);
                  onClose();
                  toast(tr(`Versão de ${when(v.createdAt)} restaurada (o estado anterior foi guardado).`, `Version from ${when(v.createdAt)} restored (previous state was saved).`));
                }}
              >
                <RotateCcw size={13} /> {tr("Restaurar", "Restore")}
              </button>
              <button
                class="icon-btn danger"
                title={tr("Apagar versão", "Delete version")}
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
