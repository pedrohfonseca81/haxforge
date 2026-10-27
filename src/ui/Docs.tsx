import { useState, useMemo } from "preact/hooks";
import {
  ArrowLeft,
  ChevronRight,
  ChevronLeft,
  Search,
  Globe,
  Copy,
  Check,
  Lightbulb,
  TriangleAlert,
  Info,
  Compass,
  Keyboard,
  Atom,
  Sparkles,
  Wrench,
  Share2,
} from "lucide-preact";
import { lang, toggleLang, tr } from "../i18n";
import { closeDocs } from "../app";
import { useStore } from "../vendor/haxball/client/store";
import { DOC_CATEGORIES, DOC_ARTICLES, type DocArticle } from "./docsData";

const CATEGORY_ICONS: Record<string, typeof Compass> = {
  Compass,
  Keyboard,
  Atom,
  Sparkles,
  Wrench,
  Share2,
};

export function Docs({ initialTopic }: { initialTopic?: string }) {
  const l = useStore(lang);
  const [activeId, setActiveId] = useState<string>(() => {
    if (initialTopic && DOC_ARTICLES.some((a) => a.id === initialTopic)) {
      return initialTopic;
    }
    return "overview";
  });
  const [search, setSearch] = useState("");

  const filteredArticles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return DOC_ARTICLES;
    return DOC_ARTICLES.filter((a) => {
      const title = a.title[l].toLowerCase();
      const summary = a.summary[l].toLowerCase();
      const id = a.id.toLowerCase();
      return title.includes(q) || summary.includes(q) || id.includes(q);
    });
  }, [search, l]);

  const activeArticle = useMemo(() => {
    return DOC_ARTICLES.find((a) => a.id === activeId) || DOC_ARTICLES[0];
  }, [activeId]);

  const activeIndex = DOC_ARTICLES.findIndex((a) => a.id === activeArticle.id);
  const prevArticle = activeIndex > 0 ? DOC_ARTICLES[activeIndex - 1] : null;
  const nextArticle = activeIndex < DOC_ARTICLES.length - 1 ? DOC_ARTICLES[activeIndex + 1] : null;

  const selectArticle = (id: string) => {
    setActiveId(id);
    history.replaceState(null, "", `#docs/${id}`);
    const content = document.querySelector(".docs-body");
    if (content) content.scrollTop = 0;
  };

  return (
    <div class="docs-page">
      <header class="docs-topbar">
        <div class="docs-topbar-left">
          <button class="btn ghost small" onClick={closeDocs} title={tr("Voltar", "Back")}>
            <ArrowLeft size={16} />
            <span>{tr("Voltar", "Back")}</span>
          </button>
          <div class="docs-brand" onClick={() => selectArticle("overview")}>
            <img src="./logo.svg" alt="haxforge logo" width="22" height="22" class="topbar-logo" />
            <span class="brand">haxforge</span>
            <span class="docs-tag">docs</span>
          </div>
        </div>

        <div class="docs-search-box">
          <Search size={14} class="docs-search-icon" />
          <input
            type="text"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder={tr("Pesquisar tópicos, ferramentas ou atalhos...", "Search topics, tools or shortcuts...")}
          />
          {search && (
            <button class="docs-search-clear" onClick={() => setSearch("")}>
              ✕
            </button>
          )}
        </div>

        <div class="docs-topbar-right">
          <button class="btn ghost small" title={tr("Mudar idioma", "Switch language")} onClick={toggleLang}>
            <Globe size={14} /> {l.toUpperCase()}
          </button>
          <a href="https://discord.gg/ZTu7zwgvhm" target="_blank" rel="noopener noreferrer" class="btn ghost small">
            Discord
          </a>
          <a href="https://github.com/pedrohfonseca81/haxforge" target="_blank" rel="noopener noreferrer" class="btn ghost small">
            GitHub
          </a>
        </div>
      </header>

      <div class="docs-layout">
        <aside class="docs-sidebar">
          {search ? (
            <div class="docs-search-results">
              <div class="docs-nav-category-title">{tr(`Resultados (${filteredArticles.length})`, `Results (${filteredArticles.length})`)}</div>
              {filteredArticles.length === 0 ? (
                <div class="docs-empty-search">{tr("Nenhum tópico encontrado.", "No topics found.")}</div>
              ) : (
                filteredArticles.map((art) => (
                  <button key={art.id} class={`docs-nav-item ${art.id === activeId ? "on" : ""}`} onClick={() => selectArticle(art.id)}>
                    <span class="docs-nav-title">{art.title[l]}</span>
                    <span class="docs-nav-badge">{art.badge[l]}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            DOC_CATEGORIES.map((cat) => {
              const IconComp = CATEGORY_ICONS[cat.icon] || Compass;
              const catArticles = DOC_ARTICLES.filter((a) => a.category === cat.id);
              if (!catArticles.length) return null;
              return (
                <div key={cat.id} class="docs-category-group">
                  <div class="docs-category-header">
                    <IconComp size={15} />
                    <span>{cat.title[l]}</span>
                  </div>
                  <nav class="docs-category-items">
                    {catArticles.map((art) => (
                      <button key={art.id} class={`docs-nav-item ${art.id === activeId ? "on" : ""}`} onClick={() => selectArticle(art.id)}>
                        <span class="docs-nav-title">{art.title[l]}</span>
                        <span class="docs-nav-badge">{art.badge[l]}</span>
                      </button>
                    ))}
                  </nav>
                </div>
              );
            })
          )}
        </aside>

        <main class="docs-body">
          <div class="docs-article-wrapper">
            <div class="docs-breadcrumb">
              <span>docs</span>
              <ChevronRight size={12} />
              <span>{DOC_CATEGORIES.find((c) => c.id === activeArticle.category)?.title[l]}</span>
              <ChevronRight size={12} />
              <b>{activeArticle.title[l]}</b>
            </div>

            <header class="docs-article-head">
              <div class="docs-badge-row">
                <span class="docs-pill">{activeArticle.badge[l]}</span>
              </div>
              <h1 class="docs-title">{activeArticle.title[l]}</h1>
              <p class="docs-lead">{activeArticle.summary[l]}</p>
            </header>

            {activeArticle.media && (
              <figure class="docs-media-figure">
                <div class="docs-media-card">
                  {activeArticle.media.type === "video" ? (
                    <video src={activeArticle.media.src} controls autoplay loop muted playsinline />
                  ) : (
                    <img src={activeArticle.media.src} alt={activeArticle.title[l]} loading="lazy" />
                  )}
                </div>
                {activeArticle.media.caption && <figcaption class="docs-caption">{activeArticle.media.caption[l]}</figcaption>}
              </figure>
            )}

            <div class="docs-sections">
              {activeArticle.sections.map((sec, idx) => (
                <section key={idx} class="docs-section">
                  {sec.heading && <h2 class="docs-heading">{sec.heading[l]}</h2>}
                  {sec.text && <p class="docs-text">{sec.text[l]}</p>}

                  {sec.items && (
                    <div class="docs-items-grid">
                      {sec.items.map((it, i) => (
                        <div key={i} class="docs-item-card">
                          <dt class="docs-item-term">{it.term[l]}</dt>
                          <dd class="docs-item-desc">{it.desc[l]}</dd>
                        </div>
                      ))}
                    </div>
                  )}

                  {sec.table && (
                    <div class="docs-table-wrapper">
                      <table class="docs-table">
                        <thead>
                          <tr>
                            {sec.table.headers[l].map((h, i) => (
                              <th key={i}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sec.table.rows.map((row, i) => (
                            <tr key={i}>
                              {row[l].map((cell, j) => (
                                <td key={j}>{renderFormattedText(cell)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {sec.callout && (
                    <aside class={`docs-callout ${sec.callout.type}`}>
                      <div class="docs-callout-icon">
                        {sec.callout.type === "warning" ? <TriangleAlert size={18} /> : sec.callout.type === "tip" ? <Lightbulb size={18} /> : <Info size={18} />}
                      </div>
                      <div class="docs-callout-body">
                        {sec.callout.title && <div class="docs-callout-title">{sec.callout.title[l]}</div>}
                        <div class="docs-callout-text">{sec.callout.text[l]}</div>
                      </div>
                    </aside>
                  )}

                  {sec.code && <CodeBlock language={sec.code.language} code={sec.code.code} />}
                </section>
              ))}
            </div>

            <footer class="docs-footer-nav">
              {prevArticle ? (
                <button class="docs-nav-link prev" onClick={() => selectArticle(prevArticle.id)}>
                  <ChevronLeft size={16} />
                  <div>
                    <span class="label">{tr("Anterior", "Previous")}</span>
                    <span class="title">{prevArticle.title[l]}</span>
                  </div>
                </button>
              ) : (
                <div />
              )}

              {nextArticle ? (
                <button class="docs-nav-link next" onClick={() => selectArticle(nextArticle.id)}>
                  <div>
                    <span class="label">{tr("Próximo", "Next")}</span>
                    <span class="title">{nextArticle.title[l]}</span>
                  </div>
                  <ChevronRight size={16} />
                </button>
              ) : (
                <div />
              )}
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function CodeBlock({ code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="docs-code-card">
      <div class="docs-code-head">
        <span class="docs-code-lang">JSON5 / .hbs</span>
        <button class="btn ghost small" onClick={copy} title={tr("Copiar código", "Copy code")}>
          {copied ? <Check size={14} class="text-ok" /> : <Copy size={14} />}
          <span>{copied ? tr("Copiado!", "Copied!") : tr("Copiar", "Copy")}</span>
        </button>
      </div>
      <pre class="docs-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderFormattedText(text: string) {
  // If text contains hotkeys like 'Ctrl + K' or 'Shift + 1', render <kbd> tags
  const parts = text.split(/(\b(?:Ctrl\s*\+\s*[A-Za-z0-9]+|Shift\s*\+\s*[A-Za-z0-9]+|Alt\s*\+\s*[A-Za-z0-9]+|[VASDGPTM]|Esc|Delete|Backspace|Enter)\b)/g);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      return <kbd key={i}>{part}</kbd>;
    }
    return part;
  });
}
