// The optimizer: choose what to do, see what it saves, apply.
import { useMemo, useState } from "preact/hooks";
import { Zap } from "lucide-preact";
import { budget, LIMIT } from "../doc/resolve";
import { commit, editor } from "../editor/state";
import { toast } from "../editor/toast";
import { optimize, OPTIMIZE_DEFAULTS, type OptimizeOptions } from "../smart/optimize";
import { lang, tr } from "../i18n";
import { useStore } from "../vendor/haxball/client/store";

function getOptions(): [keyof OptimizeOptions, string, string][] {
  return [
    ["mergeVertexes", tr("Unificar vértices repetidos", "Merge duplicate vertexes"), tr("Mesma posição e mesmas propriedades viram um vértice só.", "Same position and properties become a single vertex.")],
    ["dropDuplicates", tr("Remover segmentos repetidos", "Remove duplicate segments"), tr("Inclusive o mesmo segmento desenhado ao contrário.", "Including the same segment drawn in reverse.")],
    ["mergeCollinear", tr("Fundir segmentos em linha reta", "Merge collinear segments"), tr("a — b — c vira a — c quando b só liga os dois.", "a — b — c becomes a — c when b only connects the two.")],
    ["fitArcs", tr("Trocar polilinhas por arcos", "Fit arcs to polylines"), tr("Sequências de 3+ segmentos sobre um círculo viram segmentos curvos.", "Chains of 3+ segments along a circle become curved segments.")],
    ["dropLoose", tr("Remover vértices soltos sem colisão", "Remove loose non-colliding vertexes"), tr("Pontos que não desenham nem colidem com nada.", "Points that neither draw nor collide with anything.")],
  ];
}

export function OptimizerDialog({ onClose }: { onClose: () => void }) {
  useStore(lang);
  const s = useStore(editor);
  const [opts, setOpts] = useState<OptimizeOptions>(OPTIMIZE_DEFAULTS);
  const l = lang.get();
  const result = useMemo(() => (s ? optimize(s.doc, opts) : null), [s?.doc, opts, l]);
  if (!s || !result) return null;
  const before = budget(s.doc);
  const after = budget(result.doc);
  const options = getOptions();
  return (
    <div class="modal-back" onPointerDown={onClose}>
      <div class="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>
          <Zap size={16} /> {tr("Otimizar mapa", "Optimize map")}
        </h3>
        <p class="muted small">
          {tr(
            "Economiza objetos sem mudar como o mapa aparece ou joga. Objetos inteligentes não são tocados (desvincule para otimizá-los).",
            "Saves objects without changing how the map looks or plays. Smart objects are untouched (unlink to optimize them).",
          )}
        </p>
        <div class="opt-list">
          {options.map(([key, label, hint]) => (
            <label>
              <input type="checkbox" checked={opts[key] as boolean} onChange={() => setOpts({ ...opts, [key]: !opts[key] })} />
              <span>
                {label}
                <span class="muted small">{hint}</span>
              </span>
            </label>
          ))}
          {opts.fitArcs && (
            <div class="opt-tol">
              {tr("Tolerância dos arcos", "Arc tolerance")}
              <input type="range" min={0.1} max={5} step={0.1} value={opts.tolerance} onInput={(e) => setOpts({ ...opts, tolerance: Number((e.target as HTMLInputElement).value) })} />
              <b>{opts.tolerance.toFixed(1)}</b>
            </div>
          )}
        </div>
        <div class="opt-result">
          {before.slice(0, 2).map((b, i) => (
            <div>
              <span class="muted">{b.label}</span>
              <b>
                {b.used} → {after[i].used}
              </b>
              <span class={after[i].used > LIMIT ? "over" : "muted"}>/ {LIMIT}</span>
            </div>
          ))}
        </div>
        {result.steps.length ? (
          <ul class="opt-steps">
            {result.steps.map((t) => (
              <li>{t}</li>
            ))}
          </ul>
        ) : (
          <p class="muted small">{tr("Nada para otimizar com essas opções.", "Nothing to optimize with these options.")}</p>
        )}
        <div class="dialog-actions">
          <button class="btn ghost" onClick={onClose}>
            {tr("Cancelar", "Cancel")}
          </button>
          <button
            class="btn primary"
            disabled={!result.steps.length}
            onClick={() => {
              commit(result.doc, []);
              onClose();
              toast(
                tr(
                  `Economizou ${result.saved.vertexes} vértice(s) e ${result.saved.segments} segmento(s). Ctrl+Z desfaz.`,
                  `Saved ${result.saved.vertexes} vertex(es) and ${result.saved.segments} segment(s). Ctrl+Z undoes.`,
                ),
              );
            }}
          >
            {tr("Aplicar", "Apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
