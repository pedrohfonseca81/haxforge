// Properties of the selection (or of the map when nothing is selected). Each
// value shows where it comes from: the object itself, its trait, or HaxBall's
// default; editing writes on the object, and can be reset or pushed to the trait.
import JSON5 from "json5";
import { useEffect, useState } from "preact/hooks";
import { BringToFront, SendToBack, Tags, Trash2, Copy, FlipHorizontal2, FlipVertical2, Grid2x2, Repeat, RotateCw } from "lucide-preact";
import { smartSelected } from "../smart/smart";
import { SmartPanel } from "./SmartPanel";
import { BALL_FIELDS, effective, flagBits, flagNames, ITEM_FIELDS, ROOT_SECTIONS, traitsOf, type FieldDef, type Origin } from "../doc/fields";
import { Flag } from "../vendor/kickr/shared/flags";
import { isObject, jsonEqual, type Json, type JsonObject } from "../doc/json";
import { LIST_KEYS, newId, type ListKey } from "../doc/model";
import { findItem, isDisc0, obj, setField, setProp, updateItems, refOf, deleteRefs, addItems, type Ref } from "../doc/ops";
import { resolve } from "../doc/resolve";
import { inlineText } from "../doc/style";
import { commit, ed, select, type EditorState } from "../editor/state";
import { arraySelection, deleteSelection, duplicate, extractTrait, mirrorSelection, moveSelection, toast } from "../editor/actions";
import { ColorInput, Field, FlagsInput, MIXED, NumberInput, Segmented, Select, TextInput, Toggle, VecInput, type Shown } from "./widgets";

export const LIST_LABELS: Record<ListKey, [string, string]> = {
  vertexes: ["Vértice", "Vértices"],
  segments: ["Segmento", "Segmentos"],
  goals: ["Gol", "Gols"],
  discs: ["Disco", "Discos"],
  planes: ["Plano", "Planos"],
  joints: ["Joint", "Joints"],
  redSpawnPoints: ["Spawn red", "Spawns red"],
  blueSpawnPoints: ["Spawn blue", "Spawns blue"],
};

export function Inspector({ s }: { s: EditorState }) {
  if (s.selection.length === 0) return <MapProps s={s} />;
  const smart = smartSelected(s.doc, s.selection);
  if (smart) return <SmartPanel s={s} smart={smart} />;
  if (s.selection.length === 1 && s.selection[0] === "ball") return <BallProps s={s} />;
  return <SelectionProps s={s} />;
}

// ---- Selection ------------------------------------------------------------------------

function SelectionProps({ s }: { s: EditorState }) {
  const found = s.selection.map((r) => findItem(s.doc, r)).filter((f) => f !== null);
  if (!found.length) return <div class="empty">Nada selecionado.</div>;
  const lists = [...new Set(found.map((f) => f.list))];
  const traits = traitsOf(s.doc.fields);
  const geo = resolve(s.doc);

  const title =
    found.length === 1
      ? `${LIST_LABELS[found[0].list][0]} #${found[0].index}`
      : lists.length === 1
        ? `${found.length} ${LIST_LABELS[lists[0]][1].toLowerCase()}`
        : `${found.length} objetos`;

  // Fields shared by every selected kind.
  let defs: FieldDef[] = ITEM_FIELDS[lists[0]];
  for (const l of lists.slice(1)) defs = defs.filter((d) => ITEM_FIELDS[l].some((o) => o.key === d.key && o.kind === d.kind));
  if (found.length > 1) defs = defs.filter((d) => d.kind !== "index" && d.key !== "p0" && d.key !== "p1" && d.key !== "x" && d.key !== "y" && d.key !== "pos");

  const byList = new Map<ListKey, number[]>();
  for (const f of found) byList.set(f.list, [...(byList.get(f.list) ?? []), f.item.id]);
  const setAll = (key: string, value: Json | undefined) => {
    let doc = s.doc;
    for (const [list, ids] of byList) doc = setProp(doc, list, ids, key, value);
    commit(doc);
  };

  const spawn = lists.length === 1 && (lists[0] === "redSpawnPoints" || lists[0] === "blueSpawnPoints");
  const error = found.length === 1 ? geo.errors.get(refOf(found[0].list, found[0].item.id)) : undefined;

  return (
    <div class="inspector">
      <div class="insp-head">
        <h3>{title}</h3>
        <div class="insp-tools">
          <button class="icon-btn" title="Trazer para a frente (Ctrl+Shift+])" onClick={() => moveSelection("front")}>
            <BringToFront size={15} />
          </button>
          <button class="icon-btn" title="Mandar para trás (Ctrl+Shift+[)" onClick={() => moveSelection("back")}>
            <SendToBack size={15} />
          </button>
          <button class="icon-btn" title="Duplicar (Ctrl+D)" onClick={duplicate}>
            <Copy size={15} />
          </button>
          <button class="icon-btn" title="Espelhar ↔ (cópia que acompanha o original)" onClick={() => mirrorSelection("x")}>
            <FlipHorizontal2 size={15} />
          </button>
          <button class="icon-btn" title="Espelhar ↕ (cópia que acompanha o original)" onClick={() => mirrorSelection("y")}>
            <FlipVertical2 size={15} />
          </button>
          <button class="icon-btn" title="Espelhar nos 4 quadrantes" onClick={() => mirrorSelection("xy")}>
            <Grid2x2 size={15} />
          </button>
          <button class="icon-btn" title="Repetir em linha (cópias que acompanham o original)" onClick={() => arraySelection("linear")}>
            <Repeat size={15} />
          </button>
          <button class="icon-btn" title="Repetir em círculo" onClick={() => arraySelection("polar")}>
            <RotateCw size={15} />
          </button>
          <button class="icon-btn" title="Extrair trait com as propriedades em comum" onClick={extractTrait}>
            <Tags size={15} />
          </button>
          <button class="icon-btn danger" title="Apagar (Del)" onClick={deleteSelection}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {error && <div class="error-box">{error}</div>}
      {lists.length > 1 && (
        <div class="kinds">
          {lists.map((l) => {
            const count = found.filter((f) => f.list === l).length;
            return (
              <button class="chip" title="Selecionar só estes" onClick={() => select(found.filter((f) => f.list === l).map((f) => refOf(l, f.item.id)))}>
                {count} {LIST_LABELS[l][count === 1 ? 0 : 1].toLowerCase()}
              </button>
            );
          })}
        </div>
      )}
      {lists.length > 1 && defs.length === 0 && <p class="muted small pad">Esses tipos não têm propriedades em comum. Filtre por um tipo acima.</p>}
      {found.length === 1 && found[0].list === "segments" && <SegmentInfo s={s} index={found[0].index} />}
      {spawn ? (
        <SpawnProps s={s} list={lists[0] as "redSpawnPoints" | "blueSpawnPoints"} ids={found.map((f) => f.item.id)} />
      ) : (
        defs.map((def) => {
          const vals = found.map((f) => effective(obj(f.item.v), def.key, traits, def.def));
          const same = vals.every((v) => jsonEqual(v.value, vals[0].value));
          const origins = new Set(vals.map((v) => v.origin));
          const origin: Origin | typeof MIXED = origins.size === 1 ? vals[0].origin : MIXED;
          const value: Shown<Json> = same ? vals[0].value : MIXED;
          const traitNames = new Set(found.map((f) => obj(f.item.v).trait));
          const sharedTrait = traitNames.size === 1 ? [...traitNames][0] : undefined;
          const canToTrait = typeof sharedTrait === "string" && traits[sharedTrait] && origins.has("own") && same && def.key !== "trait";
          return (
            <Field
              key={def.key}
              label={def.label}
              hint={def.hint}
              origin={def.key === "trait" ? undefined : origin}
              wide={def.kind === "flags"}
              onReset={origins.has("own") && def.key !== "trait" ? () => setAll(def.key, undefined) : undefined}
              onToTrait={canToTrait ? () => pushToTrait(s, sharedTrait as string, def.key, vals[0].value as Json, byList) : undefined}
            >
              <Control def={def} value={value} traits={Object.keys(traits)} onChange={(v) => setAll(def.key, v)} />
            </Field>
          );
        })
      )}
      {found.length === 1 && !spawn && <RawJson s={s} list={found[0].list} id={found[0].item.id} value={found[0].item.v} />}
    </div>
  );
}

function pushToTrait(s: EditorState, trait: string, key: string, value: Json, byList: Map<ListKey, number[]>): void {
  const traits = isObject(s.doc.fields.traits) ? (s.doc.fields.traits as JsonObject) : {};
  let doc = setField(s.doc, "traits", { ...traits, [trait]: { ...obj(traits[trait]), [key]: value } });
  for (const [list, ids] of byList) doc = setProp(doc, list, ids, key, undefined);
  commit(doc);
  toast(`"${key}" agora vem do trait "${trait}" (afeta todos que usam esse trait).`);
}

function SegmentInfo({ s, index }: { s: EditorState; index: number }) {
  const g = resolve(s.doc).segments[index];
  if (!g) return null;
  const chord = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
  let len = chord;
  if (g.curved) {
    const half = Math.asin(Math.min(1, chord / 2 / g.radius));
    len = 2 * half * g.radius;
  }
  return (
    <div class="info-row">
      <span>Comprimento</span>
      <b>{Math.round(len * 10) / 10}</b>
      {g.curved && (
        <>
          <span>Raio</span>
          <b>{Math.round(g.radius * 10) / 10}</b>
        </>
      )}
    </div>
  );
}

function SpawnProps({ s, list, ids }: { s: EditorState; list: "redSpawnPoints" | "blueSpawnPoints"; ids: number[] }) {
  const items = s.doc.lists[list].filter((it) => ids.includes(it.id));
  const single = items.length === 1 ? (items[0].v as number[]) : null;
  const switchTeam = () => {
    const other = list === "redSpawnPoints" ? "blueSpawnPoints" : "redSpawnPoints";
    let doc = deleteRefs(s.doc, ids.map((id) => refOf(list, id)));
    const r = addItems(doc, other, items.map((it) => it.v));
    doc = r.doc;
    commit(doc, r.ids.map((id) => refOf(other, id)));
  };
  return (
    <>
      {single && (
        <Field label="Posição">
          <VecInput value={single} onChange={(v) => commit(updateItems(s.doc, list, ids, () => v))} />
        </Field>
      )}
      <Field label="Time">
        <Segmented
          value={list === "redSpawnPoints" ? "red" : "blue"}
          options={[
            ["red", "Red", "red"],
            ["blue", "Blue", "blue"],
          ]}
          onChange={(v) => (v === "red") !== (list === "redSpawnPoints") && switchTeam()}
        />
      </Field>
    </>
  );
}

// Edits one object as JSON5, for anything the form does not cover.
function RawJson({ list, id, value }: { s: EditorState; list: ListKey; id: number; value: Json }) {
  const text = inlineText(value);
  const [draft, setDraft] = useState(text);
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setDraft(text);
    setBad(false);
  }, [text]);
  const apply = () => {
    if (draft === text) return;
    try {
      const v = JSON5.parse(draft) as Json;
      setBad(false);
      commit(updateItems(ed().doc, list, [id], () => v));
    } catch {
      setBad(true);
    }
  };
  return (
    <details class="raw" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>JSON do objeto</summary>
      <textarea
        class={`mono ${bad ? "bad" : ""}`}
        value={draft}
        spellcheck={false}
        onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && apply()}
      />
      <p class="muted small">Campos desconhecidos são mantidos. Ctrl+Enter aplica.</p>
    </details>
  );
}

// ---- One control per field kind ---------------------------------------------------------------

export function Control({ def, value, traits, onChange }: { def: FieldDef; value: Shown<Json>; traits: string[]; onChange: (v: Json | undefined) => void }) {
  switch (def.kind) {
    case "number":
    case "index":
      return (
        <NumberInput
          label="↔"
          value={value === MIXED ? MIXED : typeof value === "number" ? value : undefined}
          step={def.kind === "index" ? 1 : (def.step ?? 1)}
          integer={def.kind === "index"}
          placeholder={def.def === undefined ? "—" : String(def.def)}
          onChange={onChange}
        />
      );
    case "text":
      return <TextInput value={value === MIXED ? MIXED : typeof value === "string" ? value : undefined} onChange={onChange} />;
    case "bool":
      return <Toggle value={value === MIXED ? MIXED : value !== false && value != null ? !!value : false} onChange={onChange} />;
    case "flags":
      return <FlagsInput value={value} onChange={onChange} />;
    case "color":
      return <ColorInput value={value} onChange={onChange} />;
    case "vec":
      return <VecInput value={value} onChange={onChange} />;
    case "team":
      return (
        <Segmented
          value={value === MIXED ? MIXED : (value as string)}
          options={[
            ["red", "Red", "red"],
            ["blue", "Blue", "blue"],
          ]}
          onChange={onChange}
        />
      );
    case "trait":
      return (
        <Select
          value={value === MIXED ? MIXED : typeof value === "string" ? value : ""}
          options={[["", "(nenhum)"], ...traits.map((t): [string, string] => [t, t])]}
          onChange={(v) => onChange(v || undefined)}
        />
      );
    case "enum":
      return <Select value={value === MIXED ? MIXED : String(value ?? def.def ?? "")} options={def.options ?? []} onChange={(v) => onChange(v === def.def ? undefined : v)} />;
    case "jointLength":
      return <JointLength value={value} onChange={onChange} />;
    case "jointStrength":
      return <JointStrength value={value} onChange={onChange} />;
  }
}

function JointLength({ value, onChange }: { value: Shown<Json>; onChange: (v: Json | undefined) => void }) {
  const mode = value === MIXED ? "" : Array.isArray(value) ? "range" : typeof value === "number" ? "fixed" : "auto";
  return (
    <div class="stack">
      <Segmented
        value={mode}
        options={[
          ["auto", "Automático"],
          ["fixed", "Fixo"],
          ["range", "Faixa"],
        ]}
        onChange={(m) => onChange(m === "auto" ? undefined : m === "fixed" ? 100 : [50, 100])}
      />
      {mode === "fixed" && <NumberInput label="↔" value={value as number} onChange={onChange} />}
      {mode === "range" && (
        <div class="vec">
          <NumberInput label="mín" value={(value as number[])[0]} onChange={(n) => onChange([n, (value as number[])[1]])} />
          <NumberInput label="máx" value={(value as number[])[1]} onChange={(n) => onChange([(value as number[])[0], n])} />
        </div>
      )}
    </div>
  );
}

function JointStrength({ value, onChange }: { value: Shown<Json>; onChange: (v: Json | undefined) => void }) {
  const rigid = value == null || value === "rigid";
  return (
    <div class="stack">
      <Segmented
        value={value === MIXED ? MIXED : rigid ? "rigid" : "spring"}
        options={[
          ["rigid", "Rígido"],
          ["spring", "Mola"],
        ]}
        onChange={(m) => onChange(m === "rigid" ? undefined : 0.1)}
      />
      {!rigid && value !== MIXED && <NumberInput label="↔" value={value as number} step={0.01} onChange={onChange} />}
    </div>
  );
}

// ---- The map itself --------------------------------------------------------------------------

function MapProps({ s }: { s: EditorState }) {
  const doc = s.doc;
  return (
    <div class="inspector">
      <div class="insp-head">
        <h3>Mapa</h3>
      </div>
      {ROOT_SECTIONS.map((sec) => {
        const holder = sec.path ? doc.fields[sec.path] : doc.fields;
        const o = isObject(holder) ? (holder as JsonObject) : {};
        const set = (key: string, v: Json | undefined) => {
          if (!sec.path) return commit(setField(doc, key, v));
          const next: JsonObject = { ...o };
          if (v === undefined) delete next[key];
          else next[key] = v;
          commit(setField(doc, sec.path, next));
        };
        return (
          <section class="insp-section">
            <h4>{sec.title}</h4>
            {sec.fields.map((def) => {
              const has = o[def.key] != null;
              return (
                <Field key={def.key} label={def.label} hint={def.hint} origin={has ? "own" : "default"} wide={def.kind === "flags"} onReset={has && def.key !== "name" && def.key !== "width" && def.key !== "height" ? () => set(def.key, undefined) : undefined}>
                  <Control def={def} value={has ? o[def.key] : def.def} traits={[]} onChange={(v) => set(def.key, v)} />
                </Field>
              );
            })}
          </section>
        );
      })}
      <section class="insp-section">
        <h4>Bola</h4>
        <Field label="A bola é" hint='"disc0" usa o primeiro disco do mapa como bola.'>
          <Segmented
            value={isDisc0(doc) ? "disc0" : "own"}
            options={[
              ["own", "ballPhysics"],
              ["disc0", "Disco 0"],
            ]}
            onChange={(m) => setBallMode(m === "disc0")}
          />
        </Field>
        <p class="muted small">{isDisc0(doc) ? "A bola é o primeiro disco da lista (fixo no topo das camadas)." : "Clique na bola no canvas para editar a física dela."}</p>
      </section>
    </div>
  );
}

// Switches between a ballPhysics ball and "disc0". Joint indices stay valid
// both ways: the ball is joint index 0 either way, and every other disc keeps
// its joint index.
function setBallMode(disc0: boolean): void {
  const s = ed();
  if (disc0 === isDisc0(s.doc)) return;
  let doc = s.doc;
  if (disc0) {
    const bp = obj(doc.fields.ballPhysics);
    const cGroup = flagNames(flagBits(bp.cGroup ?? ["ball"]) | Flag.kick | Flag.score);
    doc = { ...doc, lists: { ...doc.lists, discs: [{ id: newId(), v: { ...bp, cGroup } }, ...doc.lists.discs] } };
    doc = setField(doc, "ballPhysics", "disc0");
  } else {
    const first = doc.lists.discs[0];
    if (!first) return toast("Não há disco para virar a bola.", "error");
    doc = setField(doc, "ballPhysics", { ...obj(first.v) });
    doc = { ...doc, lists: { ...doc.lists, discs: doc.lists.discs.slice(1) } };
  }
  commit(doc, []);
}

function BallProps({ s }: { s: EditorState }) {
  const bp = isObject(s.doc.fields.ballPhysics) ? (s.doc.fields.ballPhysics as JsonObject) : {};
  const traits = traitsOf(s.doc.fields);
  const set = (key: string, v: Json | undefined) => {
    const next: JsonObject = { ...bp };
    if (v === undefined) delete next[key];
    else next[key] = v;
    commit(setField(s.doc, "ballPhysics", next));
  };
  return (
    <div class="inspector">
      <div class="insp-head">
        <h3>Bola</h3>
      </div>
      <p class="muted small pad">Definida em ballPhysics. Ela sempre começa no centro e ganha kick e score.</p>
      {BALL_FIELDS.map((def) => {
        const e = effective(bp, def.key, traits, def.def);
        return (
          <Field key={def.key} label={def.label} hint={def.hint} origin={def.key === "trait" ? undefined : e.origin} wide={def.kind === "flags"} onReset={e.origin === "own" && def.key !== "trait" ? () => set(def.key, undefined) : undefined}>
            <Control def={def} value={e.value} traits={Object.keys(traits)} onChange={(v) => set(def.key, v)} />
          </Field>
        );
      })}
    </div>
  );
}

export const listOfRef = (r: Ref): ListKey | null => (r === "ball" ? null : (LIST_KEYS.find((k) => r.startsWith(`${k}:`)) ?? null));
