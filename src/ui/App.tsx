// Screens, file drops anywhere on the page, and toasts.
import { useEffect, useState } from "preact/hooks";
import { importAsProject, readFile, screen } from "../app";
import { decodeMap, sharedCode } from "../persist/share";
import { toast } from "../editor/toast";
import { importImageFile } from "./ImageImport";
import { toasts } from "../editor/actions";
import { useStore } from "../vendor/kickr/client/store";
import { Editor } from "./Editor";
import { Home } from "./Home";

export function App() {
  const sc = useStore(screen);
  const ts = useStore(toasts);
  const [dropping, setDropping] = useState(false);

  // A share link (#map=...) opens as a new project.
  useEffect(() => {
    const code = sharedCode();
    if (!code) return;
    history.replaceState(null, "", location.pathname + location.search);
    void decodeMap(code).then(
      (text) => importAsProject(text, "link"),
      () => toast("O link do mapa está incompleto ou corrompido.", "error"),
    );
  }, []);

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      setDropping(false);
      if (!f) return;
      e.preventDefault();
      // Drawings dropped on an open map go into it; anything else opens as a project.
      if (screen.get().name === "editor" && /\.(svg|png|jpe?g|webp|gif)$/i.test(f.name)) void importImageFile(f);
      else void readFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <>
      {sc.name === "home" ? <Home /> : <Editor />}
      {dropping && <div class="drop-hint">{sc.name === "editor" ? "Solte um .hbs (novo projeto) ou um SVG/imagem (entra neste mapa)" : "Solte o .hbs para abrir como um novo projeto"}</div>}
      <div class="toasts">
        {ts.map((t) => (
          <div class={`toast ${t.kind}`} key={t.id}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
