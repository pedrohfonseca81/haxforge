// The traits panel: presets defined in the file, how many objects use each,
// and their properties (edited as JSON5, since any object property fits).
import JSON5 from "json5";
import { useEffect, useState } from "preact/hooks";
import { Plus, Trash2 } from "lucide-preact";
import { traitsOf } from "../doc/fields";
import type { Json } from "../doc/json";
import { inlineText } from "../doc/style";
import { LIST_KEYS } from "../doc/model";
import { obj, refOf } from "../doc/ops";
import { select, type EditorState } from "../editor/state";
import { deleteTrait, renameTrait, setTrait, traitUsage, uniqueTraitName } from "../editor/actions";

export function Traits({ s }: { s: EditorState }) {
  const traits = traitsOf(s.doc.fields);
  const usage = traitUsage();
  const names = Object.keys(traits);
  return (
    <div class="inspector">
      <div class="insp-head">
        <h3>Traits</h3>
        <button class="btn small" onClick={() => setTrait(uniqueTraitName("novo", traits), {})}>
          <Plus size={14} /> Novo
        </button>
      </div>
      <p class="muted small pad">Um trait preenche os campos que o objeto não define. Mudar o trait muda todos os objetos que o usam.</p>
      {names.length === 0 && <div class="empty">Este mapa não tem traits.</div>}
      {names.map((name) => (
        <TraitCard key={name} s={s} name={name} value={traits[name]} uses={usage.get(name) ?? 0} />
      ))}
    </div>
  );
}

function TraitCard({ s, name, value, uses }: { s: EditorState; name: string; value: Json; uses: number }) {
  const text = inlineText(value);
  const [draft, setDraft] = useState(text);
  const [title, setTitle] = useState(name);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(text), [text]);
  useEffect(() => setTitle(name), [name]);
  const selectUsers = () => {
    const refs: string[] = [];
    for (const list of LIST_KEYS) for (const it of s.doc.lists[list]) if (obj(it.v).trait === name) refs.push(refOf(list, it.id));
    select(refs);
  };
  return (
    <div class="trait-card">
      <div class="trait-head">
        <input
          class="text trait-name"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          onBlur={() => (title.trim() && title !== name ? renameTrait(name, title.trim()) : setTitle(name))}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button class="chip" title="Selecionar os objetos que usam este trait" onClick={selectUsers} disabled={!uses}>
          {uses} uso{uses === 1 ? "" : "s"}
        </button>
        <button
          class="icon-btn danger"
          title={uses ? "Apagar (os objetos perdem o trait)" : "Apagar"}
          onClick={() => {
            if (!uses || confirm(`Apagar o trait "${name}"? ${uses} objeto(s) deixam de usá-lo.`)) deleteTrait(name);
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <textarea
        class={`mono ${bad ? "bad" : ""}`}
        value={draft}
        spellcheck={false}
        onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        onBlur={() => {
          if (draft === text) return;
          try {
            setTrait(name, JSON5.parse(draft) as Json);
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
    </div>
  );
}
