// The linter runs a moment after the map stops changing; the problems panel
// and the canvas read the result from here.
import { lint, type Issue } from "../doc/lint";
import type { Doc } from "../doc/model";
import { Store } from "../vendor/kickr/client/store";
import { editor, requestDraw } from "./state";

export const issues = new Store<{ doc: Doc | null; list: Issue[] }>({ doc: null, list: [] });
// The issue the user clicked: its marker and path are emphasized.
export const focusedIssue = new Store<string | null>(null);

let timer: ReturnType<typeof setTimeout> | undefined;
editor.subscribe((s) => {
  if (!s) {
    issues.set({ doc: null, list: [] });
    return;
  }
  if (s.doc === issues.get().doc) return;
  clearTimeout(timer);
  const doc = s.doc;
  timer = setTimeout(() => {
    issues.set({ doc, list: lint(doc) });
    requestDraw();
  }, 250);
});
focusedIssue.subscribe(requestDraw);
