// Everything saved in the browser (IndexedDB): projects (just their .hbs
// text, which keeps the formatting lossless across sessions), saved versions
// of each project, and font files uploaded for the letreiro.
export interface Project {
  id: string;
  name: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface Version {
  id: string;
  projectId: string;
  createdAt: number;
  // Empty for automatic snapshots.
  label: string;
  text: string;
}

export interface FontFile {
  name: string;
  data: ArrayBuffer;
}

const DB = "haxforge";
type StoreName = "projects" | "versions" | "fonts";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("versions")) db.createObjectStore("versions", { keyPath: "id" }).createIndex("project", "projectId");
      if (!db.objectStoreNames.contains("fonts")) db.createObjectStore("fonts", { keyPath: "name" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const listProjects = async (): Promise<Project[]> =>
  (await run<Project[]>("projects", "readonly", (s) => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const getProject = (id: string) => run<Project | undefined>("projects", "readonly", (s) => s.get(id));
export const putProject = (p: Project) => run("projects", "readwrite", (s) => s.put(p)).then(() => undefined);
export async function deleteProject(id: string): Promise<void> {
  await run("projects", "readwrite", (s) => s.delete(id));
  for (const v of await listVersions(id)) await deleteVersion(v.id);
}

export const listVersions = async (projectId: string): Promise<Version[]> =>
  (await run<Version[]>("versions", "readonly", (s) => s.index("project").getAll(projectId))).sort((a, b) => b.createdAt - a.createdAt);
export const putVersion = (v: Version) => run("versions", "readwrite", (s) => s.put(v)).then(() => undefined);
export const deleteVersion = (id: string) => run("versions", "readwrite", (s) => s.delete(id)).then(() => undefined);

export const listFonts = () => run<FontFile[]>("fonts", "readonly", (s) => s.getAll());
export const putFont = (f: FontFile) => run("fonts", "readwrite", (s) => s.put(f)).then(() => undefined);

export const newProjectId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
