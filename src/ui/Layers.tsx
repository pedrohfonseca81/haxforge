// The layers panel: every list in its real order (HaxBall draws in this
// order). Dragging rows reorders the list, and indices are remapped.
import { memo } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import { ChevronDown, ChevronRight, Eye, EyeOff, FlipHorizontal2, LandPlot, Lock, LockOpen, ImageUp, Paintbrush, Repeat, Sparkles, Type } from "lucide-preact";
import { refsOf, smartCost } from "../smart/smart";
import { colorValue, hexColor } from "../doc/fields";
import { LIST_KEYS, type Item, type ListKey } from "../doc/model";
import { isDisc0, moveItems, obj, refOf } from "../doc/ops";
import { LIMIT } from "../doc/resolve";
import { commit, ed, select, type EditorState } from "../editor/state";
import { toggleHidden, toggleLocked } from "../editor/actions";
import { lang, tr } from "../i18n";
import { useStore } from "../vendor/haxball/client/store";
import { LIST_LABELS } from "./Inspector";

const LIMITED = new Set<ListKey>(["vertexes", "segments", "discs", "planes", "goals"]);

export function Layers({ s }: { s: EditorState }) {
  const l = useStore(lang);
  const [closed, setClosed] = useState<Set<ListKey>>(() => new Set(["vertexes"]));
  const selected = new Set(s.selection);
  const disc0 = isDisc0(s.doc);
  const ballRow = !disc0 && (
    <div class={`layer-row ${selected.has("ball") ? "sel" : ""}`} onClick={() => select(["ball"])}>
      <span class="idx">0</span>
      <span class="swatch-dot" style={{ background: "#fff" }} />
      <span class="desc">{tr("Bola (ballPhysics)", "Ball (ballPhysics)")}</span>
    </div>
  );

  return (
    <div class="layers">
      {s.doc.smart.length > 0 && (
        <div class="layer-group">
          <div class="layer-head static">
            <Sparkles size={14} />
            <span>{tr("Objetos inteligentes", "Smart objects")}</span>
            <span class="count">{s.doc.smart.length}</span>
          </div>
          <div class="layer-list">
            {s.doc.smart.map((sm) => {
              const refs = refsOf(sm.items);
              const on = refs.length > 0 && refs.every((r) => selected.has(r));
              const cost = smartCost(sm);
              const label = {
                text: () => `${tr("Letreiro", "Banner")} “${String(sm.params.text ?? "").split("\n")[0].slice(0, 18)}”`,
                field: () => `${tr("Campo", "Field")} ${String(sm.params.template ?? "classic")}`,
                shape: () => tr("Desenho (SVG/imagem)", "Drawing (SVG/image)"),
                pattern: () =>
                  `${tr("Padrão", "Pattern")} ${
                    (
                      {
                        stripes: tr("listras", "stripes"),
                        grid: tr("grade", "grid"),
                        dots: tr("pontos", "dots"),
                      } as Record<string, string>
                    )[String(sm.params.type ?? "stripes")]
                  }`,
                mirror: () =>
                  `${tr("Espelho", "Mirror")} ${sm.params.axis === "xy" ? "4×" : sm.params.axis === "y" ? "↕" : "↔"} ${tr("de", "of")} ${refsOf(sm.source).length} ${tr("itens", "items")}`,
                array: () => `${tr("Repetição", "Repeat")} ${sm.params.mode === "polar" ? tr("em círculo", "in circle") : tr("em linha", "in line")} ×${sm.params.count ?? 3}`,
              }[sm.kind]();
              return (
                <div class={`layer-row ${on ? "sel" : ""}`} onClick={() => select(refs)} key={sm.id}>
                  <span class="idx">{sm.kind === "text" ? <Type size={12} /> : sm.kind === "field" ? <LandPlot size={12} /> : sm.kind === "pattern" ? <Paintbrush size={12} /> : sm.kind === "shape" ? <ImageUp size={12} /> : sm.kind === "array" ? <Repeat size={12} /> : <FlipHorizontal2 size={12} />}</span>
                  <span class="desc">
                    <span class="desc-text">{label}</span>
                    <span class="tag cost-tag">
                      {cost.vertexes}v {cost.segments}s
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {LIST_KEYS.map((list) => {
        const items = s.doc.lists[list];
        const isClosed = closed.has(list);
        const count = list === "discs" && !disc0 ? items.length + 1 : items.length;
        if (items.length === 0 && list !== "discs" && list !== "segments" && list !== "vertexes") return null;
        return (
          <div class="layer-group" key={list}>
            <button
              class="layer-head"
              onClick={() => {
                const next = new Set(closed);
                isClosed ? next.delete(list) : next.add(list);
                setClosed(next);
              }}
            >
              {isClosed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span>{LIST_LABELS[list][1]}</span>
              <span class={`count ${LIMITED.has(list) && count > LIMIT ? "over" : ""}`}>
                {count}
                {LIMITED.has(list) && `/${LIMIT}`}
              </span>
            </button>
            {!isClosed && (
              <div class="layer-list">
                {list === "discs" && ballRow}
                {items.map((it, i) => (
                  <Row
                    key={it.id}
                    list={list}
                    item={it}
                    index={list === "discs" && !disc0 ? i + 1 : i}
                    position={i}
                    selected={selected.has(refOf(list, it.id))}
                    hidden={s.hidden.has(refOf(list, it.id))}
                    locked={s.locked.has(refOf(list, it.id))}
                    pinned={list === "discs" && disc0 && i === 0}
                    lang={l}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

let dragging: { list: ListKey; ids: number[] } | null = null;

const Row = memo(function Row(p: { list: ListKey; item: Item; index: number; position: number; selected: boolean; hidden: boolean; locked: boolean; pinned: boolean; lang: string }) {
  const ref = refOf(p.list, p.item.id);
  const el = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<"" | "above" | "below">("");
  useEffect(() => {
    if (p.selected && ed().selection[0] === ref) el.current?.scrollIntoView({ block: "nearest" });
  }, [p.selected]);

  return (
    <div
      ref={el}
      class={`layer-row ${p.selected ? "sel" : ""} ${p.hidden ? "dim" : ""} ${drop}`}
      draggable={!p.pinned}
      onClick={(e) => {
        const sel = ed().selection;
        if (e.shiftKey || e.ctrlKey || e.metaKey) select(sel.includes(ref) ? sel.filter((r) => r !== ref) : [...sel, ref]);
        else select([ref]);
      }}
      onDragStart={(e) => {
        const sel = ed().selection.filter((r) => r.startsWith(`${p.list}:`));
        const ids = sel.includes(ref) ? sel.map((r) => Number(r.split(":")[1])) : [p.item.id];
        dragging = { list: p.list, ids };
        e.dataTransfer?.setData("text/plain", ref);
      }}
      onDragOver={(e) => {
        if (!dragging || dragging.list !== p.list) return;
        e.preventDefault();
        const r = el.current!.getBoundingClientRect();
        setDrop(e.clientY < r.top + r.height / 2 ? "above" : "below");
      }}
      onDragLeave={() => setDrop("")}
      onDrop={(e) => {
        e.preventDefault();
        const where = drop;
        setDrop("");
        if (!dragging || dragging.list !== p.list) return;
        const target = p.position + (where === "below" ? 1 : 0);
        commit(moveItems(ed().doc, p.list, dragging.ids, target));
        dragging = null;
      }}
      onDragEnd={() => (dragging = null)}
      title={p.pinned ? tr("A bola (disc0) fica sempre em primeiro", "The ball (disc0) always stays first") : undefined}
    >
      <span class="idx">{p.index}</span>
      <Describe list={p.list} v={p.item.v} />
      <span class="row-actions">
        <button
          class={`icon-btn ${p.hidden ? "on" : ""}`}
          title={p.hidden ? tr("Mostrar", "Show") : tr("Ocultar no editor", "Hide in editor")}
          onClick={(e) => {
            e.stopPropagation();
            toggleHidden([ref]);
          }}
        >
          {p.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button
          class={`icon-btn ${p.locked ? "on" : ""}`}
          title={p.locked ? tr("Destravar", "Unlock") : tr("Travar (não seleciona no canvas)", "Lock (cannot select on canvas)")}
          onClick={(e) => {
            e.stopPropagation();
            toggleLocked([ref]);
          }}
        >
          {p.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      </span>
    </div>
  );
});

const n = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 100) / 100) : "?");
const pt = (v: unknown) => (Array.isArray(v) ? `(${n(v[0])}, ${n(v[1])})` : "(?)");

function Describe({ list, v }: { list: ListKey; v: unknown }) {
  const o = obj(v as never);
  const trait = typeof o.trait === "string" ? <span class="tag">{o.trait}</span> : null;
  const color = o.color !== undefined ? colorValue(o.color) : null;
  const dot = color !== null && color >= 0 ? <span class="swatch-dot" style={{ background: `#${hexColor(color)}` }} /> : null;
  let text: string;
  switch (list) {
    case "vertexes":
      text = `(${n(o.x)}, ${n(o.y)})`;
      break;
    case "segments":
      text = `v${n(o.v0)} → v${n(o.v1)}${typeof o.curve === "number" && o.curve ? ` · ${n(o.curve)}°` : ""}${o.vis === false ? ` · ${tr("invisível", "invisible")}` : ""}`;
      break;
    case "discs":
      text = `${pt(o.pos ?? [0, 0])}${typeof o.radius === "number" ? ` · r${n(o.radius)}` : ""}`;
      break;
    case "goals":
      text = `${o.team === "red" ? "red" : o.team === "blue" ? "blue" : "?"} · ${pt(o.p0)} → ${pt(o.p1)}`;
      break;
    case "planes":
      text = `normal ${pt(o.normal)} · dist ${n(o.dist)}`;
      break;
    case "joints":
      text = `d${n(o.d0)} ↔ d${n(o.d1)}`;
      break;
    default:
      text = pt(v);
  }
  return (
    <span class="desc">
      {dot}
      <span class="desc-text">{text}</span>
      {trait}
    </span>
  );
}
