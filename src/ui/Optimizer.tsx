// The optimizer: choose what to do, see what it saves, apply.
import { useMemo, useState } from "preact/hooks";
import { Zap } from "lucide-preact";
import { budget, LIMIT } from "../doc/resolve";
import { commit, editor } from "../editor/state";
import { toast } from "../editor/toast";
import { optimize, OPTIMIZE_DEFAULTS, type OptimizeOptions } from "../smart/optimize";
import { useStore } from "../vendor/kickr/client/store";

const OPTIONS: [keyof OptimizeOptions, string, string][] = [
  ["mergeVertexes", "Unificar vértices repetidos", "Mesma posição e mesmas propriedades viram um vértice só."],
  ["dropDuplicates", "Remover segmentos repetidos", "Inclusive o mesmo segmento desenhado ao contrário."],
  ["mergeCollinear", "Fundir segmentos em linha reta", "a — b — c vira a — c quando b só liga os dois."],
  ["fitArcs", "Trocar polilinhas por arcos", "Sequências de 3+ segmentos sobre um círculo viram segmentos curvos."],
  ["dropLoose", "Remover vértices soltos sem colisão", "Pontos que não desenham nem colidem com nada."],
];

export function OptimizerDialog({ onClose }: { onClose: () => void }) {
  const s = useStore(editor);
  const [opts, setOpts] = useState<OptimizeOptions>(OPTIMIZE_DEFAULTS);
  const result = useMemo(() => (s ? optimize(s.doc, opts) : null), [s?.doc, opts]);
  if (!s || !result) return null;
  const before = budget(s.doc);
  const after = budget(result.doc);
  return (
    <div class="modal-back" onPointerDown={onClose}>
      <div class="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <h3>
          <Zap size={16} /> Otimizar mapa
        </h3>
        <p class="muted small">Economiza objetos sem mudar como o mapa aparece ou joga. Objetos inteligentes não são tocados (desvincule para otimizá-los).</p>
        <div class="opt-list">
          {OPTIONS.map(([key, label, hint]) => (
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
              Tolerância dos arcos
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
          <p class="muted small">Nada para otimizar com essas opções.</p>
        )}
        <div class="dialog-actions">
          <button class="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            class="btn primary"
            disabled={!result.steps.length}
            onClick={() => {
              commit(result.doc, []);
              onClose();
              toast(`Economizou ${result.saved.vertexes} vértice(s) e ${result.saved.segments} segmento(s). Ctrl+Z desfaz.`);
            }}
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}
