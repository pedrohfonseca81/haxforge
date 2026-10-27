// Inspector controls. Number fields can be scrubbed by dragging their label
// (one undo step per drag) and accept simple math ("370/2").
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { RotateCcw, ArrowUp } from "lucide-preact";
import { colorJson, colorValue, FLAG_LABELS, FLAG_NAMES, flagBits, flagNames, hexColor, type Origin } from "../doc/fields";
import type { Json } from "../doc/json";
import { Flag } from "../vendor/kickr/shared/flags";
import { beginGesture, endGesture } from "../editor/state";
import { tr } from "../i18n";

export const MIXED = Symbol("mixed");
export type Shown<T> = T | typeof MIXED | undefined;

export function evalNumber(text: string): number | null {
  const t = text.trim().replace(/,/g, ".");
  if (t === "") return null;
  if (!/^[\d+\-*/().\se]+$/i.test(t)) return null;
  try {
    const v = Function(`"use strict"; return (${t});`)() as unknown;
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  } catch {
    return null;
  }
}

const fmtNum = (n: number) => String(Math.round(n * 1e6) / 1e6);

export function NumberInput(props: { value: Shown<number>; onChange: (v: number) => void; step?: number; placeholder?: string; integer?: boolean; label?: string }) {
  const { value, step = 1 } = props;
  const shown = value === MIXED ? "" : value === undefined ? "" : fmtNum(value);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);

  const apply = () => {
    if (text === shown) return;
    const v = evalNumber(text);
    if (v === null) {
      setBad(text.trim() !== "");
      if (text.trim() === "") setText(shown);
      return;
    }
    setBad(false);
    props.onChange(props.integer ? Math.round(v) : v);
  };

  return (
    <div class="num">
      {props.label && <Scrub value={typeof value === "number" ? value : 0} step={step} integer={props.integer} onChange={props.onChange} label={props.label} />}
      <input
        class={bad ? "bad" : ""}
        value={text}
        placeholder={value === MIXED ? tr("misto", "mixed") : props.placeholder}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          apply();
        }}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            apply();
            (e.target as HTMLInputElement).select();
          } else if (e.key === "Escape") {
            setText(shown);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = typeof value === "number" ? value : 0;
            const k = (e.shiftKey ? 10 : 1) * step * (e.key === "ArrowUp" ? 1 : -1);
            props.onChange(Math.round((base + k) * 1e6) / 1e6);
          }
        }}
      />
    </div>
  );
}

// A label that changes the value when dragged sideways.
function Scrub(props: { value: number; step: number; integer?: boolean; label: string; onChange: (v: number) => void }) {
  const start = useRef<{ x: number; v: number } | null>(null);
  return (
    <span
      class="scrub"
      title={tr("Arraste para ajustar", "Drag to scrub")}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, v: props.value };
        beginGesture();
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        let v = start.current.v + Math.round((e.clientX - start.current.x) / 2) * props.step * k;
        v = props.integer ? Math.round(v) : Math.round(v * 1e6) / 1e6;
        if (v !== props.value) props.onChange(v);
      }}
      onPointerUp={() => {
        start.current = null;
        endGesture();
      }}
    >
      {props.label}
    </span>
  );
}

export function TextInput(props: { value: Shown<string>; onChange: (v: string) => void; placeholder?: string }) {
  const shown = props.value === MIXED || props.value === undefined ? "" : props.value;
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  return (
    <input
      class="text"
      value={text}
      placeholder={props.value === MIXED ? tr("misto", "mixed") : props.placeholder}
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onBlur={() => text !== shown && props.onChange(text)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Toggle(props: { value: Shown<boolean>; onChange: (v: boolean) => void }) {
  const on = props.value === true;
  return (
    <button class={`switch ${on ? "on" : ""} ${props.value === MIXED ? "mixed" : ""}`} onClick={() => props.onChange(!on)} role="switch" aria-checked={on}>
      <span />
    </button>
  );
}

export function Select(props: { value: Shown<string>; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <select class="select" value={props.value === MIXED ? "" : (props.value ?? "")} onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
      {props.value === MIXED && <option value="">{tr("misto", "mixed")}</option>}
      {props.options.map(([v, l]) => (
        <option value={v}>{l}</option>
      ))}
    </select>
  );
}

export function Segmented(props: { value: Shown<string>; options: [string, string, string?][]; onChange: (v: string) => void }) {
  return (
    <div class="segmented">
      {props.options.map(([v, l, cls]) => (
        <button class={`${props.value === v ? "on" : ""} ${cls ?? ""}`} onClick={() => props.onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function FlagsInput(props: { value: Shown<Json>; onChange: (v: Json) => void }) {
  const mixed = props.value === MIXED;
  const bits = mixed ? 0 : flagBits(props.value as Json);
  const toggle = (b: number) => props.onChange(flagNames(bits ^ b));
  return (
    <div class="flags">
      {FLAG_NAMES.map((name) => {
        const b = Flag[name];
        return (
          <button class={bits & b ? "on" : ""} onClick={() => toggle(b)}>
            {FLAG_LABELS[name]}
          </button>
        );
      })}
      <button class="ghost" onClick={() => props.onChange(flagNames(Flag.all | (bits & ~Flag.all)))} title="ball, red, blue, redKO, blueKO, wall">
        all
      </button>
      <button class="ghost" onClick={() => props.onChange([])}>
        {tr("nenhum", "none")}
      </button>
    </div>
  );
}

export function ColorInput(props: { value: Shown<Json>; onChange: (v: Json) => void }) {
  const mixed = props.value === MIXED;
  const c = mixed ? null : colorValue(props.value as Json);
  const transparent = c === -1;
  const hex = c !== null && c >= 0 ? hexColor(c) : "";
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  const like = mixed ? undefined : (props.value as Json);
  return (
    <div class="color">
      <label class={`swatch ${transparent ? "transparent" : ""}`} style={!transparent && c !== null ? { background: `#${hex}` } : undefined}>
        <input type="color" value={`#${hex || "000000"}`} onInput={(e) => props.onChange(colorJson(parseInt((e.target as HTMLInputElement).value.slice(1), 16), like))} />
      </label>
      <input
        class="text mono"
        value={transparent ? tr("transparente", "transparent") : text}
        placeholder={mixed ? tr("misto", "mixed") : "RRGGBB"}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={() => {
          const v = parseInt(text.replace("#", ""), 16);
          if (/^#?[0-9a-f]{6}$/i.test(text) && v !== c) props.onChange(colorJson(v, like));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <button class={`chip ${transparent ? "on" : ""}`} title={tr("Transparente", "Transparent")} onClick={() => props.onChange(transparent ? colorJson(0, like) : "transparent")}>
        transp.
      </button>
    </div>
  );
}

export function VecInput(props: { value: Shown<Json>; onChange: (v: Json) => void; step?: number }) {
  const v = props.value === MIXED ? null : Array.isArray(props.value) ? (props.value as number[]) : null;
  const at = (i: number): Shown<number> => (props.value === MIXED ? MIXED : (v?.[i] ?? undefined));
  const set = (i: number, n: number) => {
    const next = [v?.[0] ?? 0, v?.[1] ?? 0];
    next[i] = n;
    props.onChange(next);
  };
  return (
    <div class="vec">
      <NumberInput label="X" value={at(0)} step={props.step} onChange={(n) => set(0, n)} />
      <NumberInput label="Y" value={at(1)} step={props.step} onChange={(n) => set(1, n)} />
    </div>
  );
}

function originTitle(o: Origin): string {
  switch (o) {
    case "own":
      return tr("Definido neste objeto", "Set on this object");
    case "trait":
      return tr("Herdado do trait", "Inherited from trait");
    case "default":
      return tr("Padrão do HaxBall", "HaxBall default");
  }
}

export function Field(props: {
  label: string;
  hint?: string;
  origin?: Origin | typeof MIXED;
  onReset?: () => void;
  onToTrait?: () => void;
  children: ComponentChildren;
  wide?: boolean;
}) {
  const o = props.origin;
  return (
    <div class={`field ${props.wide ? "wide" : ""}`}>
      <div class="field-head">
        <span class={`origin ${o === MIXED ? "mixed" : (o ?? "")}`} title={o && o !== MIXED ? originTitle(o) : undefined} />
        <span class="field-label" title={props.hint}>
          {props.label}
        </span>
        <span class="field-actions">
          {props.onToTrait && (
            <button class="icon-btn" title={tr("Aplicar este valor ao trait", "Push this value to trait")} onClick={props.onToTrait}>
              <ArrowUp size={13} />
            </button>
          )}
          {props.onReset && (
            <button class="icon-btn" title={tr("Resetar (usar o valor herdado)", "Reset (use inherited value)")} onClick={props.onReset}>
              <RotateCcw size={13} />
            </button>
          )}
        </span>
      </div>
      <div class="field-body">{props.children}</div>
    </div>
  );
}
