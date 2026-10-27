// Parameters of a smart object: every change regenerates it in place.
import { useEffect, useRef, useState } from "preact/hooks";
import { ensureFont, fontLabel, MissingFont } from "../smart/fonts";
import { FontGallery } from "./FontGallery";
import { toast } from "../editor/toast";
import { useStore } from "../vendor/haxball/client/store";
import { ChevronDown, Trash2, Unlink } from "lucide-preact";
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
import { lang, tr } from "../i18n";
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

function getDefs(kind: Smart["kind"]): PDef[] {
  const area = (p: JsonObject) => p.area !== "none";
  switch (kind) {
    case "text":
      return [
        { key: "text", label: tr("Texto", "Text"), kind: "textarea", hint: tr(`Letras, números e acentos (${SUPPORTED.length} caracteres). Enter quebra a linha.`, `Letters, numbers, and accents (${SUPPORTED.length} characters). Enter starts a new line.`) },
        { key: "size", label: tr("Tamanho", "Size"), kind: "range", min: 6, max: 240, step: 1, hint: tr("Altura das letras maiúsculas.", "Capital letter height.") },
        { key: "x", label: "X", kind: "number" },
        { key: "y", label: "Y", kind: "number" },
        { key: "angle", label: tr("Rotação (°)", "Rotation (°)"), kind: "range", min: -180, max: 180, step: 1 },
        { key: "bend", label: tr("Curvatura (°)", "Bend (°)"), kind: "range", min: -300, max: 300, step: 1, hint: tr("Dobra a linha de base num arco. Positivo = arco para cima.", "Bends the baseline into an arc. Positive = arch upward.") },
        { key: "spacing", label: tr("Espaçamento", "Spacing"), kind: "range", min: 0, max: 8, step: 0.1 },
        { key: "lineHeight", label: tr("Entre linhas", "Line height"), kind: "range", min: 8, max: 30, step: 0.5 },
        { key: "align", label: tr("Alinhamento", "Alignment"), kind: "segmented", options: [["left", tr("Esq.", "Left")], ["center", tr("Centro", "Center")], ["right", tr("Dir.", "Right")]] },
        { key: "color", label: tr("Cor", "Color"), kind: "color" },
        { key: "bold", label: tr("Negrito", "Bold"), kind: "bool", hint: tr("Traço duplo: dobra o custo.", "Double stroke: doubles the segment cost."), show: (p) => !p.font || String(p.font).startsWith("stroke:") },
        { key: "tolerance", label: tr("Simplificação", "Simplification"), kind: "range", min: 0.1, max: 6, step: 0.1, hint: tr("Quanto o contorno pode se afastar da fonte: maior = menos segmentos.", "How far the outline can deviate from the font: higher = fewer segments."), show: (p) => !!p.font },
        { key: "solid", label: tr("Colisão", "Collision"), kind: "select", options: [["none", tr("Decorativo (não colide)", "Decorative (no collision)")], ["ball", tr("Sólido para a bola", "Solid for ball")], ["all", tr("Sólido para todos", "Solid for all")]] },
        { key: "bounce", label: tr("Quique", "Bounce"), kind: "range", min: 0, max: 2, step: 0.05, show: (p) => p.solid !== "none" },
      ];
    case "pattern":
      return [
        { key: "type", label: tr("Padrão", "Pattern"), kind: "select", options: [["stripes", tr("Grama listrada", "Striped grass")], ["grid", tr("Grade", "Grid")], ["dots", tr("Pontos em arco", "Dots on arc")]] },
        { key: "x", label: tr("Centro X", "Center X"), kind: "number" },
        { key: "y", label: tr("Centro Y", "Center Y"), kind: "number" },
        { key: "width", label: tr("Largura (½)", "Width (½)"), kind: "range", min: 10, max: 1600, step: 5, show: (p) => p.type !== "dots" },
        { key: "height", label: tr("Altura (½)", "Height (½)"), kind: "range", min: 10, max: 900, step: 5, show: (p) => p.type !== "dots" },
        { key: "bands", label: tr("Faixas", "Bands"), kind: "range", min: 2, max: 60, step: 1, show: (p) => p.type === "stripes" },
        { key: "direction", label: tr("Direção", "Direction"), kind: "segmented", options: [["vertical", tr("Vertical", "Vertical")], ["horizontal", tr("Horizontal", "Horizontal")]], show: (p) => p.type === "stripes" },
        { key: "spacing", label: tr("Densidade", "Density"), kind: "range", min: 2, max: 30, step: 0.5, hint: tr("Distância entre as linhas que pintam a faixa: 3 fica sólido, mais que isso fica rajado e custa menos.", "Spacing between lines that fill the stripe: 3 looks solid, higher looks hatched and costs fewer segments."), show: (p) => p.type === "stripes" },
        { key: "cell", label: tr("Tamanho da célula", "Cell size"), kind: "range", min: 5, max: 300, step: 1, show: (p) => p.type === "grid" },
        { key: "radius", label: tr("Raio", "Radius"), kind: "range", min: 5, max: 1200, step: 1, show: (p) => p.type === "dots" },
        { key: "from", label: tr("De (°)", "From (°)"), kind: "range", min: -360, max: 360, step: 1, show: (p) => p.type === "dots" },
        { key: "to", label: tr("Até (°)", "To (°)"), kind: "range", min: -360, max: 360, step: 1, show: (p) => p.type === "dots" },
        { key: "count", label: tr("Quantidade", "Count"), kind: "range", min: 1, max: 120, step: 1, show: (p) => p.type === "dots" },
        { key: "dot", label: tr("Raio do ponto", "Dot radius"), kind: "range", min: 0.5, max: 20, step: 0.5, show: (p) => p.type === "dots" },
        { key: "color", label: tr("Cor", "Color"), kind: "color" },
      ];
    case "array":
      return [
        { key: "mode", label: tr("Repetir", "Repeat"), kind: "segmented", options: [["linear", tr("Em linha", "Linear")], ["polar", tr("Em círculo", "Circular")]] },
        { key: "count", label: tr("Cópias", "Copies"), kind: "range", min: 1, max: 60, step: 1 },
        { key: "dx", label: tr("Passo X", "Step X"), kind: "range", min: -800, max: 800, step: 1, show: (p) => p.mode !== "polar" },
        { key: "dy", label: tr("Passo Y", "Step Y"), kind: "range", min: -800, max: 800, step: 1, show: (p) => p.mode !== "polar" },
        { key: "step", label: tr("Ângulo por cópia", "Angle per copy"), kind: "range", min: -180, max: 180, step: 1, show: (p) => p.mode === "polar" },
        { key: "cx", label: tr("Centro X", "Center X"), kind: "number", show: (p) => p.mode === "polar" },
        { key: "cy", label: tr("Centro Y", "Center Y"), kind: "number", show: (p) => p.mode === "polar" },
      ];
    case "shape":
      return [
        { key: "size", label: tr("Largura", "Width"), kind: "range", min: 10, max: 2000, step: 1 },
        { key: "x", label: "X", kind: "number" },
        { key: "y", label: "Y", kind: "number" },
        { key: "angle", label: tr("Rotação (°)", "Rotation (°)"), kind: "range", min: -180, max: 180, step: 1 },
        { key: "tolerance", label: tr("Simplificação", "Simplification"), kind: "range", min: 0.1, max: 15, step: 0.1, hint: tr("Quanto o resultado pode se afastar do desenho: maior = menos segmentos.", "How far the result can deviate from the drawing: higher = fewer segments.") },
        { key: "arcs", label: tr("Usar arcos", "Use arcs"), kind: "bool", hint: tr("Curvas viram segmentos curvos (bem mais barato).", "Curves become curved segments (much cheaper).") },
        { key: "color", label: tr("Cor", "Color"), kind: "color", hint: tr("Vazio = cores do próprio desenho.", "Empty = use drawing's own colors.") },
        { key: "solid", label: tr("Colisão", "Collision"), kind: "select", options: [["none", tr("Decorativo (não colide)", "Decorative (no collision)")], ["ball", tr("Sólido para a bola", "Solid for ball")], ["all", tr("Sólido para todos", "Solid for all")]] },
        { key: "bounce", label: tr("Quique", "Bounce"), kind: "range", min: 0, max: 2, step: 0.05, show: (p) => p.solid !== "none" },
      ];
    case "field":
      return [
        { key: "width", label: tr("Largura (½)", "Width (½)"), kind: "range", min: 100, max: 1600, step: 5 },
        { key: "height", label: tr("Altura (½)", "Height (½)"), kind: "range", min: 60, max: 900, step: 5 },
        { key: "goal", label: tr("Gol (½)", "Goal (½)"), kind: "range", min: 20, max: 250, step: 1 },
        { key: "depth", label: tr("Fundo da rede", "Net depth"), kind: "range", min: 10, max: 150, step: 1 },
        { key: "post", label: tr("Raio da trave", "Goalpost radius"), kind: "range", min: 1, max: 20, step: 0.5 },
        { key: "net", label: tr("Rede", "Net"), kind: "segmented", options: [["curve", tr("Curva", "Curved")], ["box", tr("Reta", "Box")]] },
        { key: "corner", label: tr("Cantos", "Corners"), kind: "range", min: 0, max: 300, step: 1, hint: tr("Raio dos cantos arredondados (bola e fundo).", "Radius of rounded corners (ball walls and background).") },
        { key: "kickoff", label: tr("Círculo central", "Center circle"), kind: "range", min: 20, max: 300, step: 1 },
        { key: "spawn", label: "Spawn", kind: "range", min: 30, max: 1400, step: 5 },
        { key: "inset", label: tr("Gol para dentro", "Goal inset"), kind: "range", min: 0, max: 300, step: 1, hint: tr("Hockey: gols dentro do campo, com jogo atrás deles.", "Hockey: goals inside the field, with play behind them.") },
        { key: "marginX", label: tr("Margem X", "Margin X"), kind: "range", min: 0, max: 300, step: 5, hint: tr("Espaço dos jogadores e da câmera além do campo.", "Player and camera room beyond the field.") },
        { key: "marginY", label: tr("Margem Y", "Margin Y"), kind: "range", min: 0, max: 300, step: 5 },
        { key: "bg", label: tr("Fundo", "Background"), kind: "select", options: [["grass", tr("Grama", "Grass")], ["hockey", "Hockey"], ["none", tr("Liso", "Plain")]] },
        { key: "lines", label: tr("Linhas", "Lines"), kind: "segmented", options: [["bg", tr("Do fundo", "From bg")], ["segments", tr("Segmentos", "Segments")]], hint: tr("Do fundo: o próprio HaxBall desenha borda, meio e círculo (não custa nada).", "From bg: HaxBall itself draws border, halfway line, and circle (costs zero segments).") },
        { key: "lineColor", label: tr("Cor das linhas", "Line color"), kind: "color" },
        { key: "netColor", label: tr("Cor da rede", "Net color"), kind: "color" },
        { key: "area", label: tr("Áreas", "Penalty areas"), kind: "select", options: [["none", tr("Sem área", "No area")], ["futsal", "Futsal (D)"], ["real", tr("Futebol (grande área)", "Soccer (penalty box)")]] },
        { key: "areaDepth", label: tr("Área: fundo", "Box: depth"), kind: "range", min: 20, max: 500, step: 1, show: area },
        { key: "areaWidth", label: tr("Área: largura (½)", "Box: width (½)"), kind: "range", min: 0, max: 500, step: 1, show: area },
        { key: "smallDepth", label: tr("Pequena: fundo", "Goal area: depth"), kind: "range", min: 10, max: 300, step: 1, show: (p) => p.area === "real" },
        { key: "smallWidth", label: tr("Pequena: larg. (½)", "Goal area: width (½)"), kind: "range", min: 10, max: 400, step: 1, show: (p) => p.area === "real" },
        { key: "spot", label: tr("Marca do pênalti", "Penalty spot"), kind: "range", min: 20, max: 400, step: 1, show: area },
        { key: "arc", label: tr("Meia-lua", "Penalty arc"), kind: "range", min: 20, max: 400, step: 1, show: (p) => p.area === "real" },
        { key: "bounce", label: tr("Quique das bordas", "Wall bounce"), kind: "range", min: 0, max: 2, step: 0.05 },
      ];
    case "mirror":
      return [];
  }
}

export function SmartPanel({ s, smart }: { s: EditorState; smart: Smart }) {
  useStore(lang);
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
      if (!(e instanceof MissingFont)) return toast((e as Error).message, "error");
      // Stroke and Google fonts can be fetched; then try again.
      const font = e.font;
      if (font.startsWith("stroke:") || font.startsWith("google:")) {
        void ensureFont(font).then(
          () => commit(updateSmart(ed().doc, smart.id, params)),
          (err) => toast((err as Error).message, "error"),
        );
      } else
        toast(
          tr(
            `A fonte "${fontLabel(font)}" não está neste navegador: envie o arquivo dela para editar este letreiro.`,
            `Font "${fontLabel(font)}" is not in this browser: upload its font file to edit this banner.`,
          ),
          "error",
        );
    }
  };
  const title = {
    text: tr("Letreiro", "Text banner"),
    field: tr("Campo gerado", "Generated field"),
    pattern: tr("Padrão", "Pattern"),
    shape: tr("Desenho (SVG/imagem)", "Drawing (SVG/image)"),
    mirror: tr("Cópia espelhada", "Mirrored copy"),
    array: tr("Repetição", "Repeat"),
  }[smart.kind];
  const defs = getDefs(smart.kind);

  return (
    <div class="inspector">
      <div class="insp-head">
        <h3>{title}</h3>
        <div class="insp-tools">
          <button class="icon-btn" title={tr("Desvincular: vira primitivas comuns, sem parâmetros", "Unlink: turns into regular primitives without parameters")} onClick={explodeSelection}>
            <Unlink size={15} />
          </button>
          <button class="icon-btn danger" title={tr("Apagar", "Delete")} onClick={() => commit(deleteRefs(s.doc, refsOf(smart.items)), [])}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div class="cost">
        <span>
          <b>{cost.vertexes}</b> {tr("vértices", "vertexes")}
        </span>
        <span>
          <b>{cost.segments}</b> {tr("segmentos", "segments")}
        </span>
        {cost.discs > 0 && (
          <span>
            <b>{cost.discs}</b> {tr("discos", "discs")}
          </span>
        )}
      </div>
      {smart.kind === "field" && (
        <>
          <Field label={tr("Modelo", "Template")}>
            <Select value={values.template as string} options={Object.entries(TEMPLATES).map(([k, t]) => [k, t.label])} onChange={(t) => {
                commit(updateSmart(ed().doc, smart.id, { template: t }));
                fitView();
              }}
            />
          </Field>
          <p class="muted small pad">{tr("Também controla largura, altura, spawn e fundo do mapa. Trocar o modelo volta aos valores dele.", "Also controls map width, height, spawn, and background. Switching template resets to its values.")}</p>
        </>
      )}
      {smart.kind === "mirror" && (
        <>
          <Field label={tr("Eixo", "Axis")}>
            <Segmented
              value={(smart.params.axis as string) ?? "x"}
              options={[
                ["x", "↔ X"],
                ["y", "↕ Y"],
                ["xy", tr("4 quadrantes", "4 quadrants")],
              ]}
              onChange={(v) => set("axis", v)}
            />
          </Field>
          <p class="muted small pad">{tr("Estas cópias acompanham o original a cada edição. Times trocam ao cruzar o meio (gols, spawns).", "These copies follow the original on every edit. Teams swap when crossing the center (goals, spawns).")}</p>
        </>
      )}
      {smart.kind === "array" && <p class="muted small pad">{tr("As cópias acompanham o original a cada edição.", "Copies follow the original on every edit.")}</p>}
      {smart.source && (
        <div class="pad">
          <button class="btn small" onClick={() => select(refsOf(smart.source))}>
            {tr("Selecionar os originais", "Select originals")} ({refsOf(smart.source).length})
          </button>
        </div>
      )}
      {smart.kind === "text" && <FontPicker value={String(values.font ?? "")} sample={String(values.text ?? "")} onChange={(f) => set("font", f)} />}
      {defs.filter((d) => !d.show || d.show(values)).map((d) => (
        <Field key={d.key} label={d.label} hint={d.hint} wide={d.kind === "textarea"}>
          <ParamControl def={d} value={values[d.key]} onChange={(v) => set(d.key, v)} />
        </Field>
      ))}
      <p class="muted small pad">
        {tr(
          "Clique num item com Ctrl para editar só ele. Edições à mão são refeitas se você mudar os parâmetros; desvincule para mantê-las.",
          "Ctrl-click an item to edit only that item. Manual edits are overwritten when parameters change; unlink to keep them.",
        )}
      </p>
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
          {def.hint && value !== "" && (
            <button class="chip" onClick={() => onChange("")}>
              {tr("usar as cores do desenho", "use drawing colors")}
            </button>
          )}
        </div>
      );
  }
}

function FontPicker({ value, sample, onChange }: { value: string; sample: string; onChange: (font: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Field label={tr("Fonte", "Font")} hint={tr("Traço único é barato; fontes de contorno (Google ou enviadas) custam mais.", "Single-stroke fonts are cheap; outline fonts (Google or uploaded) cost more segments.")}>
      <button class="font-button" onClick={() => setOpen(true)}>
        <span>{fontLabel(value)}</span>
        <ChevronDown size={14} />
      </button>
      {open && <FontGallery current={value} sample={sample} onPick={onChange} onClose={() => setOpen(false)} />}
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
