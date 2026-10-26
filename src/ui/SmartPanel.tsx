// Parameters of a smart object: every change regenerates it in place.
import { useEffect, useRef, useState } from "preact/hooks";
import { addFont, fontNames, MissingFont } from "../smart/fonts";
import { putFont } from "../persist/db";
import { toast } from "../editor/toast";
import { useStore } from "../vendor/kickr/client/store";
import { Trash2, Unlink } from "lucide-preact";
import type { Json, JsonObject } from "../doc/json";
import type { Smart } from "../doc/model";
import { deleteRefs } from "../doc/ops";
import { beginGesture, commit, ed, endGesture, select, type EditorState } from "../editor/state";
import { explodeSelection } from "../editor/actions";
import { fitView } from "../editor/tools";
import { fieldParams, TEMPLATES } from "../smart/field";
import { refsOf, smartCost, updateSmart } from "../smart/smart";
import { textParams } from "../smart/text";
import { patternParams } from "../smart/pattern";
import { shapeParams } from "../smart/svg";
import { SUPPORTED } from "../smart/font";
import { ColorInput, Field, NumberInput, Segmented, Select, Toggle } from "./widgets";

interface PDef {
  key: string;
  label: string;
  kind: "range" | "number" | "textarea" | "select" | "segmented" | "bool" | "color";
  min?: number;
  max?: number;
  step?: number;
  options?: [string, string][];
  hint?: string;
  show?: (p: JsonObject) => boolean;
}

const TEXT: PDef[] = [
  { key: "text", label: "Texto", kind: "textarea", hint: `Letras, números e acentos (${SUPPORTED.length} caracteres). Enter quebra a linha.` },
  { key: "size", label: "Tamanho", kind: "range", min: 6, max: 240, step: 1, hint: "Altura das letras maiúsculas." },
  { key: "x", label: "X", kind: "number" },
  { key: "y", label: "Y", kind: "number" },
  { key: "angle", label: "Rotação (°)", kind: "range", min: -180, max: 180, step: 1 },
  { key: "bend", label: "Curvatura (°)", kind: "range", min: -300, max: 300, step: 1, hint: "Dobra a linha de base num arco. Positivo = arco para cima." },
  { key: "spacing", label: "Espaçamento", kind: "range", min: 0, max: 8, step: 0.1 },
  { key: "lineHeight", label: "Entre linhas", kind: "range", min: 8, max: 30, step: 0.5 },
  { key: "align", label: "Alinhamento", kind: "segmented", options: [["left", "Esq."], ["center", "Centro"], ["right", "Dir."]] },
  { key: "color", label: "Cor", kind: "color" },
  { key: "bold", label: "Negrito", kind: "bool", hint: "Traço duplo: dobra o custo.", show: (p) => !p.font },
  { key: "tolerance", label: "Simplificação", kind: "range", min: 0.1, max: 6, step: 0.1, hint: "Quanto o contorno pode se afastar da fonte: maior = menos segmentos.", show: (p) => !!p.font },
  { key: "solid", label: "Colisão", kind: "select", options: [["none", "Decorativo (não colide)"], ["ball", "Sólido para a bola"], ["all", "Sólido para todos"]] },
  { key: "bounce", label: "Quique", kind: "range", min: 0, max: 2, step: 0.05, show: (p) => p.solid !== "none" },
];

const PATTERN: PDef[] = [
  { key: "type", label: "Padrão", kind: "select", options: [["stripes", "Grama listrada"], ["grid", "Grade"], ["dots", "Pontos em arco"]] },
  { key: "x", label: "Centro X", kind: "number" },
  { key: "y", label: "Centro Y", kind: "number" },
  { key: "width", label: "Largura (½)", kind: "range", min: 10, max: 1600, step: 5, show: (p) => p.type !== "dots" },
  { key: "height", label: "Altura (½)", kind: "range", min: 10, max: 900, step: 5, show: (p) => p.type !== "dots" },
  { key: "bands", label: "Faixas", kind: "range", min: 2, max: 60, step: 1, show: (p) => p.type === "stripes" },
  { key: "direction", label: "Direção", kind: "segmented", options: [["vertical", "Vertical"], ["horizontal", "Horizontal"]], show: (p) => p.type === "stripes" },
  { key: "spacing", label: "Densidade", kind: "range", min: 2, max: 30, step: 0.5, hint: "Distância entre as linhas que pintam a faixa: 3 fica sólido, mais que isso fica rajado e custa menos.", show: (p) => p.type === "stripes" },
  { key: "cell", label: "Tamanho da célula", kind: "range", min: 5, max: 300, step: 1, show: (p) => p.type === "grid" },
  { key: "radius", label: "Raio", kind: "range", min: 5, max: 1200, step: 1, show: (p) => p.type === "dots" },
  { key: "from", label: "De (°)", kind: "range", min: -360, max: 360, step: 1, show: (p) => p.type === "dots" },
  { key: "to", label: "Até (°)", kind: "range", min: -360, max: 360, step: 1, show: (p) => p.type === "dots" },
  { key: "count", label: "Quantidade", kind: "range", min: 1, max: 120, step: 1, show: (p) => p.type === "dots" },
  { key: "dot", label: "Raio do ponto", kind: "range", min: 0.5, max: 20, step: 0.5, show: (p) => p.type === "dots" },
  { key: "color", label: "Cor", kind: "color" },
];

const ARRAY: PDef[] = [
  { key: "mode", label: "Repetir", kind: "segmented", options: [["linear", "Em linha"], ["polar", "Em círculo"]] },
  { key: "count", label: "Cópias", kind: "range", min: 1, max: 60, step: 1 },
  { key: "dx", label: "Passo X", kind: "range", min: -800, max: 800, step: 1, show: (p) => p.mode !== "polar" },
  { key: "dy", label: "Passo Y", kind: "range", min: -800, max: 800, step: 1, show: (p) => p.mode !== "polar" },
  { key: "step", label: "Ângulo por cópia", kind: "range", min: -180, max: 180, step: 1, show: (p) => p.mode === "polar" },
  { key: "cx", label: "Centro X", kind: "number", show: (p) => p.mode === "polar" },
  { key: "cy", label: "Centro Y", kind: "number", show: (p) => p.mode === "polar" },
];

const SHAPE: PDef[] = [
  { key: "size", label: "Largura", kind: "range", min: 10, max: 2000, step: 1 },
  { key: "x", label: "X", kind: "number" },
  { key: "y", label: "Y", kind: "number" },
  { key: "angle", label: "Rotação (°)", kind: "range", min: -180, max: 180, step: 1 },
  { key: "tolerance", label: "Simplificação", kind: "range", min: 0.1, max: 15, step: 0.1, hint: "Quanto o resultado pode se afastar do desenho: maior = menos segmentos." },
  { key: "arcs", label: "Usar arcos", kind: "bool", hint: "Curvas viram segmentos curvos (bem mais barato)." },
  { key: "color", label: "Cor", kind: "color", hint: "Vazio = cores do próprio desenho." },
  { key: "solid", label: "Colisão", kind: "select", options: [["none", "Decorativo (não colide)"], ["ball", "Sólido para a bola"], ["all", "Sólido para todos"]] },
  { key: "bounce", label: "Quique", kind: "range", min: 0, max: 2, step: 0.05, show: (p) => p.solid !== "none" },
];

const area = (p: JsonObject) => p.area !== "none";
const FIELD: PDef[] = [
  { key: "width", label: "Largura (½)", kind: "range", min: 100, max: 1600, step: 5 },
  { key: "height", label: "Altura (½)", kind: "range", min: 60, max: 900, step: 5 },
  { key: "goal", label: "Gol (½)", kind: "range", min: 20, max: 250, step: 1 },
  { key: "depth", label: "Fundo da rede", kind: "range", min: 10, max: 150, step: 1 },
  { key: "post", label: "Raio da trave", kind: "range", min: 1, max: 20, step: 0.5 },
  { key: "net", label: "Rede", kind: "segmented", options: [["curve", "Curva"], ["box", "Reta"]] },
  { key: "corner", label: "Cantos", kind: "range", min: 0, max: 300, step: 1, hint: "Raio dos cantos arredondados (bola e fundo)." },
  { key: "kickoff", label: "Círculo central", kind: "range", min: 20, max: 300, step: 1 },
  { key: "spawn", label: "Spawn", kind: "range", min: 30, max: 1400, step: 5 },
  { key: "inset", label: "Gol para dentro", kind: "range", min: 0, max: 300, step: 1, hint: "Hockey: gols dentro do campo, com jogo atrás deles." },
  { key: "marginX", label: "Margem X", kind: "range", min: 0, max: 300, step: 5, hint: "Espaço dos jogadores e da câmera além do campo." },
  { key: "marginY", label: "Margem Y", kind: "range", min: 0, max: 300, step: 5 },
  { key: "bg", label: "Fundo", kind: "select", options: [["grass", "Grama"], ["hockey", "Hockey"], ["none", "Liso"]] },
  { key: "lines", label: "Linhas", kind: "segmented", options: [["bg", "Do fundo"], ["segments", "Segmentos"]], hint: "Do fundo: o próprio HaxBall desenha borda, meio e círculo (não custa nada)." },
  { key: "lineColor", label: "Cor das linhas", kind: "color" },
  { key: "netColor", label: "Cor da rede", kind: "color" },
  { key: "area", label: "Áreas", kind: "select", options: [["none", "Sem área"], ["futsal", "Futsal (D)"], ["real", "Futebol (grande área)"]] },
  { key: "areaDepth", label: "Área: fundo", kind: "range", min: 20, max: 500, step: 1, show: area },
  { key: "areaWidth", label: "Área: largura (½)", kind: "range", min: 0, max: 500, step: 1, show: area },
  { key: "smallDepth", label: "Pequena: fundo", kind: "range", min: 10, max: 300, step: 1, show: (p) => p.area === "real" },
  { key: "smallWidth", label: "Pequena: larg. (½)", kind: "range", min: 10, max: 400, step: 1, show: (p) => p.area === "real" },
  { key: "spot", label: "Marca do pênalti", kind: "range", min: 20, max: 400, step: 1, show: area },
  { key: "arc", label: "Meia-lua", kind: "range", min: 20, max: 400, step: 1, show: (p) => p.area === "real" },
  { key: "bounce", label: "Quique das bordas", kind: "range", min: 0, max: 2, step: 0.05 },
];

export function SmartPanel({ s, smart }: { s: EditorState; smart: Smart }) {
  const cost = smartCost(smart);
  const values: JsonObject =
    smart.kind === "text"
      ? (textParams(smart.params) as unknown as JsonObject)
      : smart.kind === "field"
        ? (fieldParams(smart.params) as unknown as JsonObject)
        : smart.kind === "pattern"
          ? (patternParams(smart.params) as unknown as JsonObject)
          : smart.kind === "shape"
            ? (shapeParams(smart.params) as unknown as JsonObject)
          : smart.kind === "array"
            ? { mode: "linear", count: 3, dx: 50, dy: 0, step: 90, cx: 0, cy: 0, ...smart.params }
            : smart.params;
  const set = (key: string, v: Json | undefined) => {
    const params = { ...smart.params };
    if (v === undefined) delete params[key];
    else params[key] = v;
    try {
      commit(updateSmart(ed().doc, smart.id, params));
    } catch (e) {
      toast(e instanceof MissingFont ? `A fonte "${e.font}" não está neste navegador: envie o arquivo dela para editar este letreiro.` : (e as Error).message, "error");
    }
  };
  const title = { text: "Letreiro", field: "Campo gerado", pattern: "Padrão", shape: "Desenho (SVG/imagem)", mirror: "Cópia espelhada", array: "Repetição" }[smart.kind];
  const defs = { text: TEXT, field: FIELD, pattern: PATTERN, shape: SHAPE, mirror: [], array: ARRAY }[smart.kind];

  return (
    <div class="inspector">
      <div class="insp-head">
        <h3>{title}</h3>
        <div class="insp-tools">
          <button class="icon-btn" title="Desvincular: vira primitivas comuns, sem parâmetros" onClick={explodeSelection}>
            <Unlink size={15} />
          </button>
          <button class="icon-btn danger" title="Apagar" onClick={() => commit(deleteRefs(s.doc, refsOf(smart.items)), [])}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div class="cost">
        <span>
          <b>{cost.vertexes}</b> vértices
        </span>
        <span>
          <b>{cost.segments}</b> segmentos
        </span>
        {cost.discs > 0 && (
          <span>
            <b>{cost.discs}</b> discos
          </span>
        )}
      </div>
      {smart.kind === "field" && (
        <>
          <Field label="Modelo">
            <Select value={values.template as string} options={Object.entries(TEMPLATES).map(([k, t]) => [k, t.label])} onChange={(t) => {
                commit(updateSmart(ed().doc, smart.id, { template: t }));
                fitView();
              }}
            />
          </Field>
          <p class="muted small pad">Também controla largura, altura, spawn e fundo do mapa. Trocar o modelo volta aos valores dele.</p>
        </>
      )}
      {smart.kind === "mirror" && (
        <>
          <Field label="Eixo">
            <Segmented
              value={(smart.params.axis as string) ?? "x"}
              options={[
                ["x", "↔ X"],
                ["y", "↕ Y"],
                ["xy", "4 quadrantes"],
              ]}
              onChange={(v) => set("axis", v)}
            />
          </Field>
          <p class="muted small pad">Estas cópias acompanham o original a cada edição. Times trocam ao cruzar o meio (gols, spawns).</p>
        </>
      )}
      {smart.kind === "array" && <p class="muted small pad">As cópias acompanham o original a cada edição.</p>}
      {smart.source && (
        <div class="pad">
          <button class="btn small" onClick={() => select(refsOf(smart.source))}>
            Selecionar os originais ({refsOf(smart.source).length})
          </button>
        </div>
      )}
      {smart.kind === "text" && <FontPicker value={String(values.font ?? "")} onChange={(f) => set("font", f)} />}
      {defs.filter((d) => !d.show || d.show(values)).map((d) => (
        <Field key={d.key} label={d.label} hint={d.hint} wide={d.kind === "textarea"}>
          <ParamControl def={d} value={values[d.key]} onChange={(v) => set(d.key, v)} />
        </Field>
      ))}
      <p class="muted small pad">Clique num item com Ctrl para editar só ele. Edições à mão são refeitas se você mudar os parâmetros; desvincule para mantê-las.</p>
    </div>
  );
}

function ParamControl({ def, value, onChange }: { def: PDef; value: Json; onChange: (v: Json) => void }) {
  switch (def.kind) {
    case "textarea":
      return <TextArea value={String(value ?? "")} onChange={onChange} />;
    case "range":
      return (
        <div class="range">
          <input
            type="range"
            min={def.min}
            max={def.max}
            step={def.step}
            value={Number(value)}
            onPointerDown={beginGesture}
            onPointerUp={endGesture}
            onInput={(e) => onChange(Number((e.target as HTMLInputElement).value))}
          />
          <NumberInput value={Number(value)} step={def.step} onChange={onChange} />
        </div>
      );
    case "number":
      return <NumberInput label="↔" value={Number(value)} onChange={onChange} />;
    case "select":
      return <Select value={String(value)} options={def.options!} onChange={onChange} />;
    case "segmented":
      return <Segmented value={String(value)} options={def.options!} onChange={onChange} />;
    case "bool":
      return <Toggle value={!!value} onChange={onChange} />;
    case "color":
      return (
        <div class="stack">
          <ColorInput value={value || "FFFFFF"} onChange={(v) => onChange(v === "transparent" ? "FFFFFF" : v)} />
          {def.hint?.startsWith("Vazio") && value !== "" && (
            <button class="chip" onClick={() => onChange("")}>
              usar as cores do desenho
            </button>
          )}
        </div>
      );
  }
}

function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const names = useStore(fontNames);
  const input = useRef<HTMLInputElement>(null);
  const options: [string, string][] = [["", "Haxforge Sans (traço, barato)"], ...names.map((n): [string, string] => [n, n])];
  if (value && !names.includes(value)) options.push([value, `${value} (não carregada)`]);
  return (
    <Field label="Fonte" hint="Fontes enviadas (TTF, OTF, WOFF) desenham o contorno das letras: ficam fiéis à fonte, mas custam bem mais.">
      <div class="stack">
        <Select value={value} options={options} onChange={onChange} />
        <button class="chip" onClick={() => input.current?.click()}>
          Enviar fonte…
        </button>
        <input
          ref={input}
          type="file"
          accept=".ttf,.otf,.woff"
          hidden
          onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = "";
            if (!f) return;
            try {
              const data = await f.arrayBuffer();
              const name = await addFont(data, f.name.replace(/\.[^.]+$/, ""));
              await putFont({ name, data });
              onChange(name);
            } catch {
              toast("Não consegui ler essa fonte (use TTF, OTF ou WOFF).", "error");
            }
          }}
        />
      </div>
    </Field>
  );
}

// Text that regenerates as you type; the whole edit is one undo step.
function TextArea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      class="smart-text"
      value={draft}
      rows={Math.min(5, draft.split("\n").length + 1)}
      onFocus={beginGesture}
      onBlur={endGesture}
      onInput={(e) => {
        const v = (e.target as HTMLTextAreaElement).value;
        setDraft(v);
        onChange(v);
      }}
    />
  );
}
