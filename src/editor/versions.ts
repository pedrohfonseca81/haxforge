// Saved versions of the open project: automatic snapshots (when it is opened
// and every few minutes of editing) and named ones, any of which can be
// restored. Restoring first snapshots the current state, so nothing is lost.
import { exportText, importText } from "../doc/model";
import { tr } from "../i18n";
import { deleteVersion, listVersions, newProjectId, putVersion, type Version } from "../persist/db";
import { Store } from "../vendor/kickr/client/store";
import { editor, openDoc, view } from "./state";

const AUTO_EVERY = 5 * 60_000;
const MAX_AUTO = 40;

export const versionsOpen = new Store<boolean>(false);
let lastText = "";
let lastAt = 0;
let lastProject = "";

function currentText(): string | null {
  const s = editor.get();
  return s ? exportText(s.doc, s.source) : null;
}

export async function snapshot(label = ""): Promise<Version | null> {
  const s = editor.get();
  const text = currentText();
  if (!s || text === null) return null;
  // Automatic snapshots skip unchanged maps; named ones are always kept.
  if (!label && text === lastText) return null;
  const v: Version = { id: newProjectId(), projectId: s.projectId, createdAt: Date.now(), label, text };
  await putVersion(v);
  lastText = text;
  lastAt = v.createdAt;
  // Old automatic snapshots go first.
  const autos = (await listVersions(s.projectId)).filter((x) => !x.label);
  for (const old of autos.slice(MAX_AUTO)) await deleteVersion(old.id);
  return v;
}

export async function restore(v: Version): Promise<void> {
  const s = editor.get();
  if (!s) return;
  await snapshot(tr("Antes de restaurar", "Before restore"));
  const { doc, source } = importText(v.text);
  openDoc(s.projectId, doc, source, s.createdAt);
  view.needsFit = false;
  lastText = v.text;
}

// Snapshot on opening a project and after a while of editing.
editor.subscribe((s) => {
  if (!s) {
    lastProject = "";
    return;
  }
  if (s.projectId !== lastProject) {
    lastProject = s.projectId;
    lastText = "";
    lastAt = Date.now();
    void listVersions(s.projectId)
      .then((vs) => {
        lastText = vs[0]?.text ?? "";
        return snapshot("");
      })
      .catch(() => undefined);
    return;
  }
  if (s.saved === "saved" && Date.now() - lastAt > AUTO_EVERY) void snapshot("").catch(() => undefined);
});
