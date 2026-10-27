// Editor state: the open document with its undo history, the selection and
// the current tool. UI components watch `editor`; the canvas reads it every
// frame and also reads `view` (camera, hover, tool previews), which changes
// too often to re-render panels.
import { exportText, type Doc, type Source } from "../doc/model";
import { findItem, type Ref } from "../doc/ops";
import { tr } from "../i18n";
import { putProject } from "../persist/db";
import { refsOf, smartSelected, syncMirrors } from "../smart/smart";
import { Store } from "../vendor/kickr/client/store";

export type ToolId = "select" | "hand" | "segment" | "vertex" | "disc" | "goal" | "plane" | "joint" | "redSpawn" | "blueSpawn" | "text";

export interface EditorState {
  projectId: string;
  createdAt: number;
  doc: Doc;
  source: Source | null;
  past: Doc[];
  future: Doc[];
  selection: Ref[];
  tool: ToolId;
  // Editor-only visibility and locking (not saved in the map).
  hidden: ReadonlySet<Ref>;
  locked: ReadonlySet<Ref>;
  panel: "props" | "traits" | "issues";
  // Trait applied to objects created with the drawing tools.
  drawTrait: string | null;
  saved: "saved" | "pending" | "error";
}

export const editor = new Store<EditorState | null>(null);

export const ed = (): EditorState => {
  const s = editor.get();
  if (!s) throw new Error("no open document");
  return s;
};
export const patch = (p: Partial<EditorState>) => editor.set({ ...ed(), ...p });

export function openDoc(projectId: string, doc: Doc, source: Source | null, createdAt = Date.now()): void {
  editor.set({
    projectId,
    createdAt,
    doc,
    source,
    past: [],
    future: [],
    selection: [],
    tool: "select",
    hidden: new Set(),
    locked: new Set(),
    panel: "props",
    drawTrait: null,
    saved: "saved",
  });
  gestureBase = null;
  requestDraw();
}

// ---- History ----------------------------------------------------------------

const MAX_HISTORY = 500;
let gestureBase: Doc | null = null;

const prune = (doc: Doc, sel: Ref[]) => sel.filter((r) => r === "ball" || findItem(doc, r));

// The selection after the doc changes. A selected smart object stays selected
// when it is regenerated (its items get new ids), including on undo/redo.
function carry(from: Doc, sel: Ref[], to: Doc): Ref[] {
  const sm = smartSelected(from, sel);
  if (sm) {
    const now = to.smart.find((x) => x.id === sm.id);
    if (now) return refsOf(now.items);
  }
  return prune(to, sel);
}

// Records an edit as one undo step.
export function commit(next: Doc, selection?: Ref[]): void {
  const s = ed();
  if (next === s.doc && !selection) return;
  // Mirror copies follow their originals on every edit.
  const doc = next === s.doc ? next : syncMirrors(next);
  if (gestureBase) {
    // Inside a gesture the whole gesture becomes one step (see endGesture).
    editor.set({ ...s, doc, selection: selection ? prune(doc, selection) : carry(s.doc, s.selection, doc), saved: "pending" });
  } else {
    const past = doc === s.doc ? s.past : [...s.past.slice(-MAX_HISTORY + 1), s.doc];
    editor.set({ ...s, doc, past, future: doc === s.doc ? s.future : [], selection: selection ? prune(doc, selection) : carry(s.doc, s.selection, doc), saved: doc === s.doc ? s.saved : "pending" });
  }
  requestDraw();
}

// Drags and other continuous edits: many intermediate docs, one undo step.
export function beginGesture(): void {
  gestureBase = ed().doc;
}
export function endGesture(): void {
  const base = gestureBase;
  gestureBase = null;
  const s = ed();
  if (base && base !== s.doc) editor.set({ ...s, past: [...s.past.slice(-MAX_HISTORY + 1), base], future: [] });
}
export const inGesture = () => gestureBase !== null;

export function undo(): void {
  const s = ed();
  const prev = s.past[s.past.length - 1];
  if (!prev) return;
  editor.set({ ...s, doc: prev, past: s.past.slice(0, -1), future: [s.doc, ...s.future], selection: carry(s.doc, s.selection, prev), saved: "pending" });
  requestDraw();
}
export function redo(): void {
  const s = ed();
  const next = s.future[0];
  if (!next) return;
  editor.set({ ...s, doc: next, past: [...s.past, s.doc], future: s.future.slice(1), selection: carry(s.doc, s.selection, next), saved: "pending" });
  requestDraw();
}

export function select(selection: Ref[]): void {
  patch({ selection });
  requestDraw();
}

// ---- View (camera, hover, previews) --------------------------------------------

export interface Camera {
  x: number;
  y: number;
  // CSS pixels per world unit.
  zoom: number;
}

export const view = {
  cam: { x: 0, y: 0, zoom: 1 } as Camera,
  hover: null as Ref | null,
  dirty: true,
  // Fit the map in the view as soon as the canvas has a size.
  needsFit: false,
  // Size of the canvas in CSS pixels.
  width: 0,
  height: 0,
};

export function requestDraw(): void {
  view.dirty = true;
}

// ---- Preferences (per browser) --------------------------------------------------

export interface Prefs {
  grid: number;
  showGrid: boolean;
  snapGrid: boolean;
  snapPoints: boolean;
  showInvisible: boolean;
  showVertices: boolean;
  // Physics overlays.
  physBias: boolean;
  physRoles: boolean;
  inflate: "none" | "ball" | "red" | "blue";
  showIssues: boolean;
}

const PREFS_KEY = "haxforge.prefs";
const DEFAULT_PREFS: Prefs = {
  grid: 10,
  showGrid: true,
  snapGrid: true,
  snapPoints: true,
  showInvisible: true,
  showVertices: true,
  physBias: false,
  physRoles: false,
  inflate: "none",
  showIssues: true,
};

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export const prefs = new Store<Prefs>(loadPrefs());
prefs.subscribe((p) => {
  requestDraw();
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
});

// ---- Autosave ---------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastSaved: Doc | null = null;
let waiting: Doc | null = null;

// Saves 700 ms after the last edit (selection changes do not delay it).
editor.subscribe((s) => {
  if (!s || s.saved !== "pending" || s.doc === lastSaved || s.doc === waiting) return;
  waiting = s.doc;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 700);
});

export async function saveNow(): Promise<void> {
  const s = editor.get();
  if (!s) return;
  clearTimeout(saveTimer);
  waiting = null;
  const doc = s.doc;
  try {
    await putProject({
      id: s.projectId,
      name: typeof doc.fields.name === "string" ? doc.fields.name : tr("Sem nome", "Untitled"),
      text: exportText(doc, s.source),
      createdAt: s.createdAt,
      updatedAt: Date.now(),
    });
    lastSaved = doc;
    const now = editor.get();
    if (now && now.projectId === s.projectId && now.doc === doc) editor.set({ ...now, saved: "saved" });
  } catch {
    const now = editor.get();
    if (now) editor.set({ ...now, saved: "error" });
  }
}
