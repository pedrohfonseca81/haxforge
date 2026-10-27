// The projects screen: start blank, from a template, a file or pasted text,
// or reopen a project saved in this browser.
import { useEffect, useRef, useState } from "preact/hooks";
import { ClipboardPaste, Copy, Globe, LandPlot, Plus, Trash2, Upload } from "lucide-preact";
import { createBlank, createField, duplicateProject, importAsProject, openProject, readFile } from "../app";
import { lang, locale, toggleLang, tr } from "../i18n";
import { TEMPLATES } from "../templates";
import { importText, type Doc } from "../doc/model";
import { drawThumb } from "../editor/thumb";
import { deleteProject, listProjects, type Project } from "../persist/db";
import { useStore } from "../vendor/kickr/client/store";

function Thumb({ text }: { text: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let doc: Doc;
    try {
      doc = importText(text).doc;
    } catch {
      return;
    }
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    drawThumb(c, doc);
  }, [text]);
  return <canvas ref={ref} class="thumb" />;
}

const when = (t: number) => {
  const d = Date.now() - t;
  if (d < 60_000) return tr("agora", "just now");
  if (d < 3_600_000) return tr(`há ${Math.floor(d / 60_000)} min`, `${Math.floor(d / 60_000)}m ago`);
  if (d < 86_400_000) return tr(`há ${Math.floor(d / 3_600_000)} h`, `${Math.floor(d / 3_600_000)}h ago`);
  return new Date(t).toLocaleDateString(locale());
};

const nameOf = (text: string) => {
  const m = /["']?name["']?\s*:\s*["']([^"']*)["']/.exec(text);
  return m ? m[1] : tr("Sem nome", "Untitled");
};

export function Home() {
  const l = useStore(lang);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [pasting, setPasting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const reload = () => void listProjects().then(setProjects, () => setProjects([]));
  useEffect(reload, []);

  return (
    <div class="home">
      <header class="home-head">
        <div class="home-title-wrap">
          <img src="./logo.svg" alt="haxforge logo" class="home-logo" width="48" height="48" />
          <div>
            <h1>
              hax<span>forge</span>
            </h1>
            <p class="muted">{tr("Editor de mapas do HaxBall. Tudo fica salvo neste navegador.", "HaxBall map editor. Everything is saved in this browser.")}</p>
          </div>
        </div>
        <div class="home-actions">
          <button class="btn primary" onClick={createBlank}>
            <Plus size={16} /> {tr("Novo mapa", "New map")}
          </button>
          <button class="btn" onClick={createField}>
            <LandPlot size={16} /> {tr("Gerar campo", "Generate field")}
          </button>
          <button class="btn" onClick={() => file.current?.click()}>
            <Upload size={16} /> {tr("Abrir .hbs", "Open .hbs")}
          </button>
          <button class="btn" onClick={() => setPasting(true)}>
            <ClipboardPaste size={16} /> {tr("Colar texto", "Paste text")}
          </button>
          <button class="btn ghost" title={tr("Mudar para inglês (EN)", "Mudar para português (PT-BR)")} onClick={toggleLang}>
            <Globe size={15} /> {l.toUpperCase()}
          </button>
          <input
            ref={file}
            type="file"
            accept=".hbs,.json,.json5,.txt"
            hidden
            onChange={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void readFile(f);
              (e.target as HTMLInputElement).value = "";
            }}
          />
        </div>
      </header>

      <section>
        <h2>{tr("Seus mapas", "Your maps")}</h2>
        {projects && projects.length === 0 && (
          <div class="empty big">
            {tr(
              "Nenhum mapa ainda. Comece um do zero, abra um .hbs (ou arraste o arquivo para cá) ou parta de um modelo.",
              "No maps yet. Start from scratch, open a .hbs file (or drag it here), or pick a template below.",
            )}
          </div>
        )}
        <div class="cards">
          {projects?.map((p) => (
            <div class="card" onClick={() => void openProject(p.id)}>
              <Thumb text={p.text} />
              <div class="card-foot">
                <div>
                  <b>{p.name}</b>
                  <span class="muted small">{when(p.updatedAt)}</span>
                </div>
                <span class="card-actions">
                  <button
                    class="icon-btn"
                    title={tr("Duplicar", "Duplicate")}
                    onClick={(e) => {
                      e.stopPropagation();
                      void duplicateProject(p.id).then(reload);
                    }}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    class="icon-btn danger"
                    title={tr("Apagar", "Delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(tr(`Apagar "${p.name}" deste navegador?`, `Delete "${p.name}" from this browser?`))) void deleteProject(p.id).then(reload);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>{tr("Começar de um modelo", "Start from a template")}</h2>
        <div class="cards small">
          {TEMPLATES.map((t) => (
            <div class="card" onClick={() => importAsProject(t.text, tr("modelo", "template"))}>
              <Thumb text={t.text} />
              <div class="card-foot">
                <b>{nameOf(t.text)}</b>
              </div>
            </div>
          ))}
        </div>
      </section>

      {pasting && <PasteDialog onClose={() => setPasting(false)} />}
    </div>
  );
}

function PasteDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  return (
    <div class="modal-back" onPointerDown={onClose}>
      <div class="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>{tr("Colar o texto de um .hbs", "Paste .hbs text")}</h3>
        <textarea class="mono" autofocus value={text} placeholder={tr('{ "name": "Meu mapa", ... }', '{ "name": "My map", ... }')} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <div class="dialog-actions">
          <button class="btn ghost" onClick={onClose}>
            {tr("Cancelar", "Cancel")}
          </button>
          <button class="btn primary" disabled={!text.trim()} onClick={() => importAsProject(text, tr("texto", "text")) && onClose()}>
            {tr("Abrir", "Open")}
          </button>
        </div>
      </div>
    </div>
  );
}
