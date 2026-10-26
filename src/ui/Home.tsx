// The projects screen: start blank, from a template, a file or pasted text,
// or reopen a project saved in this browser.
import { useEffect, useRef, useState } from "preact/hooks";
import { ClipboardPaste, Copy, LandPlot, Plus, Trash2, Upload } from "lucide-preact";
import { createBlank, createField, duplicateProject, importAsProject, openProject, readFile } from "../app";
import { TEMPLATES } from "../templates";
import { importText, type Doc } from "../doc/model";
import { drawThumb } from "../editor/thumb";
import { deleteProject, listProjects, type Project } from "../persist/db";

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
  if (d < 60_000) return "agora";
  if (d < 3_600_000) return `há ${Math.floor(d / 60_000)} min`;
  if (d < 86_400_000) return `há ${Math.floor(d / 3_600_000)} h`;
  return new Date(t).toLocaleDateString("pt-BR");
};

const nameOf = (text: string) => {
  const m = /["']?name["']?\s*:\s*["']([^"']*)["']/.exec(text);
  return m ? m[1] : "Sem nome";
};

export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [pasting, setPasting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const reload = () => void listProjects().then(setProjects, () => setProjects([]));
  useEffect(reload, []);

  return (
    <div class="home">
      <header class="home-head">
        <div>
          <h1>
            hax<span>forge</span>
          </h1>
          <p class="muted">Editor de mapas do HaxBall. Tudo fica salvo neste navegador.</p>
        </div>
        <div class="home-actions">
          <button class="btn primary" onClick={createBlank}>
            <Plus size={16} /> Novo mapa
          </button>
          <button class="btn" onClick={createField}>
            <LandPlot size={16} /> Gerar campo
          </button>
          <button class="btn" onClick={() => file.current?.click()}>
            <Upload size={16} /> Abrir .hbs
          </button>
          <button class="btn" onClick={() => setPasting(true)}>
            <ClipboardPaste size={16} /> Colar texto
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
        <h2>Seus mapas</h2>
        {projects && projects.length === 0 && <div class="empty big">Nenhum mapa ainda. Comece um do zero, abra um .hbs (ou arraste o arquivo para cá) ou parta de um modelo.</div>}
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
                    title="Duplicar"
                    onClick={(e) => {
                      e.stopPropagation();
                      void duplicateProject(p.id).then(reload);
                    }}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    class="icon-btn danger"
                    title="Apagar"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Apagar "${p.name}" deste navegador?`)) void deleteProject(p.id).then(reload);
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
        <h2>Começar de um modelo</h2>
        <div class="cards small">
          {TEMPLATES.map((t) => (
            <div class="card" onClick={() => importAsProject(t.text, "modelo")}>
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
        <h3>Colar o texto de um .hbs</h3>
        <textarea class="mono" autofocus value={text} placeholder='{ "name": "Meu mapa", ... }' onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        <div class="dialog-actions">
          <button class="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button class="btn primary" disabled={!text.trim()} onClick={() => importAsProject(text, "texto") && onClose()}>
            Abrir
          </button>
        </div>
      </div>
    </div>
  );
}
