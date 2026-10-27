// Ctrl+K: every action by name.
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Search } from "lucide-preact";
import type { Command } from "../editor/actions";
import { tr } from "../i18n";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// All words of the query appear in the label (or group), in any order.
function matches(c: Command, q: string): boolean {
  const hay = norm(`${c.label} ${c.group}`);
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => commands.filter((c) => matches(c, q)), [commands, q]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setI(0), [q]);
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };
  return (
    <div class="modal-back" onPointerDown={onClose}>
      <div class="palette" onPointerDown={(e) => e.stopPropagation()}>
        <div class="palette-input">
          <Search size={16} />
          <input
            ref={input}
            autofocus
            value={q}
            placeholder={tr("Buscar ação…", "Search action…")}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI(Math.min(list.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setI(Math.max(0, i - 1));
              } else if (e.key === "Enter") run(list[i]);
              else if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div class="palette-list">
          {list.length === 0 && <div class="empty">{tr("Nada encontrado.", "Nothing found.")}</div>}
          {list.map((c, j) => (
            <button class={`palette-item ${j === i ? "on" : ""}`} onPointerEnter={() => setI(j)} onClick={() => run(c)}>
              <span class="group">{c.group}</span>
              <span class="label">{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
