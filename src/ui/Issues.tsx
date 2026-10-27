// The problems panel: what the linter found, with a click to look at it and
// a quick fix when there is an obvious one.
import { CircleAlert, Info, TriangleAlert, Wrench } from "lucide-preact";
import type { Issue } from "../doc/lint";
import { findItem } from "../doc/ops";
import { resolve } from "../doc/resolve";
import { focusedIssue, issues } from "../editor/lintState";
import { commit, ed, requestDraw, select, view, type EditorState } from "../editor/state";
import { lang, tr } from "../i18n";
import { useStore } from "../vendor/kickr/client/store";

const ICON = { error: CircleAlert, warn: TriangleAlert, info: Info };

// Centers the view on the issue and selects what it is about.
function focus(is: Issue): void {
  focusedIssue.set(is.id);
  if (is.refs.length) select(is.refs);
  let at = is.at;
  if (!at && is.refs.length) {
    const s = ed();
    const geo = resolve(s.doc);
    const pts: [number, number][] = [];
    for (const r of is.refs) {
      const f = findItem(s.doc, r);
      if (!f) continue;
      if (f.list === "segments") {
        const g = geo.segments[f.index];
        if (g) pts.push([(g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2]);
      } else if (f.list === "vertexes") {
        const v = geo.vertexes[f.index];
        if (v) pts.push([v.x, v.y]);
      }
    }
    if (pts.length) at = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  }
  if (at) {
    view.cam.x = at[0];
    view.cam.y = at[1];
    requestDraw();
  }
}

export function Issues({ s }: { s: EditorState }) {
  useStore(lang);
  const { list, doc } = useStore(issues);
  const focused = useStore(focusedIssue);
  const stale = doc !== s.doc;
  return (
    <div class="inspector">
      <div class="insp-head">
        <h3>{tr("Problemas", "Issues")}</h3>
        {stale && <span class="muted small">{tr("verificando…", "checking…")}</span>}
      </div>
      {list.length === 0 && !stale && <div class="empty">{tr("Nenhum problema encontrado. A bola e os jogadores ficam dentro do mapa.", "No issues found. The ball and players stay inside the map.")}</div>}
      <div class="issues">
        {list.map((is) => {
          const Icon = ICON[is.level];
          return (
            <div class={`issue ${is.level} ${focused === is.id ? "on" : ""}`} onClick={() => focus(is)}>
              <Icon size={15} />
              <span class="issue-text">{is.text}</span>
              {is.fix && (
                <button
                  class="chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    commit(is.fix!.apply(ed().doc));
                  }}
                >
                  <Wrench size={11} /> {is.fix.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p class="muted small pad">
        {tr(
          "O caminho tracejado mostra por onde a bola ou o jogador sai. Os testes usam o raio real de cada um e as mesmas regras de colisão da física.",
          "The dashed path shows where the ball or player escapes. Checks use each body's actual radius and the same collision rules as the physics engine.",
        )}
      </p>
    </div>
  );
}
