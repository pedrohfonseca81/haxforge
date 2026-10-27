// Which screen is open, and the ways a project starts: blank, from a
// template, from a file or pasted text, or reopened from the browser.
import { importText, newDoc } from "./doc/model";
import { createSmart, refsOf } from "./smart/smart";
import { editor, openDoc, saveNow, view } from "./editor/state";
import { toast } from "./editor/toast";
import { tr } from "./i18n";
import { playMode } from "./play/mode";
import { getProject, newProjectId, putProject } from "./persist/db";
import { Store } from "./vendor/haxball/client/store";

export type Screen = { name: "home" } | { name: "editor" } | { name: "docs"; topic?: string };
export const screen = new Store<Screen>({ name: "home" });

let prevScreenBeforeDocs: "home" | "editor" = "home";

function show(): void {
  playMode.set(null);
  // The canvas fits the map once it knows its size.
  view.needsFit = true;
  screen.set({ name: "editor" });
  if (location.hash.startsWith("#docs")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export function openDocs(topic?: string): void {
  playMode.set(null);
  const current = screen.get().name;
  if (current !== "docs") {
    prevScreenBeforeDocs = current === "editor" ? "editor" : "home";
  }
  screen.set({ name: "docs", topic });
  const hash = topic ? `#docs/${topic}` : "#docs";
  if (location.hash !== hash) {
    history.pushState(null, "", hash);
  }
}

export function closeDocs(): void {
  if (prevScreenBeforeDocs === "editor" && editor.get()) {
    show();
  } else {
    screen.set({ name: "home" });
  }
  if (location.hash.startsWith("#docs")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export function createBlank(): void {
  openDoc(newProjectId(), newDoc(), null);
  void saveNow();
  show();
}

// A new map made by the field generator (template and sizes editable after).
export function createField(): void {
  const made = createSmart(newDoc(tr("Campo gerado", "Generated field")), "field", { template: "classic" });
  openDoc(newProjectId(), made.doc, null);
  editor.set({ ...editor.get()!, selection: refsOf(made.smart.items) });
  void saveNow();
  show();
}

export function importAsProject(text: string, what = tr("arquivo", "file")): boolean {
  try {
    const { doc, source } = importText(text);
    openDoc(newProjectId(), doc, source);
    void saveNow();
    show();
    return true;
  } catch (e) {
    toast(tr(`Não consegui ler o ${what}: ${(e as Error).message}`, `Could not read ${what}: ${(e as Error).message}`), "error");
    return false;
  }
}

export async function openProject(id: string): Promise<void> {
  const p = await getProject(id);
  if (!p) return;
  try {
    const { doc, source } = importText(p.text);
    openDoc(p.id, doc, source, p.createdAt);
    show();
  } catch (e) {
    toast(tr(`Projeto corrompido: ${(e as Error).message}`, `Corrupted project: ${(e as Error).message}`), "error");
  }
}

export async function duplicateProject(id: string): Promise<void> {
  const p = await getProject(id);
  if (!p) return;
  const now = Date.now();
  await putProject({ ...p, id: newProjectId(), name: `${p.name} (${tr("cópia", "copy")})`, createdAt: now, updatedAt: now });
}

export async function goHome(): Promise<void> {
  playMode.set(null);
  if (editor.get()) await saveNow();
  // Leave the editor screen first, so nothing on it reacts to the map going away.
  screen.set({ name: "home" });
  editor.set(null);
  if (location.hash.startsWith("#docs")) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

export async function readFile(file: File): Promise<void> {
  importAsProject(await file.text(), file.name);
}
