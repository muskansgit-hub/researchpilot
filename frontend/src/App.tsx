import { useEffect, useState } from "react";
import {
  Atom,
  BookOpen,
  Search,
  Network,
  Columns3,
  History,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Download,
  FileText,
  Check,
  Loader2,
  Trash2,
  X,
} from "lucide-react";

type Paper = {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  source_url: string | null;
  text: string;
  source_type: string;
};
type Evidence = {
  id: string;
  paper_id: string;
  title: string;
  text: string;
  score: number;
};
type Claim = {
  text: string;
  quote: string;
  title: string;
  source_url: string | null;
  verification: string;
  paper_id: string;
};
type Review = {
  id: string;
  question: string;
  created_at: string;
  mode: string;
  claims: Claim[];
  evidence: Evidence[];
  warnings: string[];
  trace: { step: string; detail: string }[];
};
type Graph = {
  nodes: { id: string; label: string; type: string }[];
  edges: { source: string; target: string }[];
  method: string;
};
const tabs = [
  ["Research", Search],
  ["Paper library", BookOpen],
  ["Compare papers", Columns3],
  ["Knowledge graph", Network],
  ["Review history", History],
] as const;
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    "/api" + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err.detail === "string"
        ? err.detail
        : "The request failed. Check your input and try again.",
    );
  }
  return res.json();
}
function exportReview(r: Review) {
  const text = `# ${r.question}\n\nGenerated ${r.created_at} · ${r.mode}\n\n${r.claims.map((c, i) => `## Finding ${i + 1}\n${c.text}\n\n> ${c.quote}\n\nSource: ${c.title}${c.source_url ? " — " + c.source_url : ""}\nVerification: ${c.verification}`).join("\n\n")}\n\n## Limitations\nQuote matching verifies provenance, not semantic entailment. ${r.warnings.join(" ")}`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "researchpilot-review.md";
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [tab, setTab] = useState("Research"),
    [papers, setPapers] = useState<Paper[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [question, setQuestion] = useState(
      "How does retrieval improve the reliability of language models?",
    ),
    [review, setReview] = useState<Review | null>(null),
    [history, setHistory] = useState<Review[]>([]),
    [graph, setGraph] = useState<Graph | null>(null),
    [comparison, setComparison] = useState<
      { paper: Paper; passages: Evidence[] }[]
    >([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [modal, setModal] = useState(false),
    [discover, setDiscover] = useState(""),
    [results, setResults] = useState<Paper[]>([]),
    [mode, setMode] = useState("extractive"),
    [filter, setFilter] = useState("");
  async function refresh() {
    setPapers(await api<Paper[]>("/papers"));
  }
  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }
  useEffect(() => {
    act("Loading workspace", async () => {
      await refresh();
      setMode((await api<{ synthesis: string }>("/health")).synthesis);
    });
  }, []);
  useEffect(() => {
    if (!modal) return;
    const before = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(false);
      if (e.key === "Tab") {
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".modal button:not(:disabled),.modal input:not(:disabled),.modal textarea,.modal a",
          ),
        );
        const first = elements[0],
          last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (tab === "Review history")
      act("Loading history", async () =>
        setHistory(await api<Review[]>("/reviews")),
      );
    if (tab === "Knowledge graph")
      act("Building graph", async () => setGraph(await api<Graph>("/graph")));
  }, [tab]);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  async function add(p: unknown) {
    await api("/papers", p);
    await refresh();
  }
  const loaded = papers.length > 0;
  return (
    <div className="app">
      <aside>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("Research");
          }}
        >
          <span className="brand-icon">
            <Atom size={25} />
          </span>
          ResearchPilot<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav>
          {tabs.map(([name, Icon]) => (
            <button
              key={name}
              disabled={!!busy}
              className={tab === name ? "active" : ""}
              onClick={() => setTab(name)}
            >
              <Icon size={19} />
              {name}
              {name === "Paper library" && <small>{papers.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine">
            <span className="status-dot" />
            <strong>Local research workspace</strong>
          </div>
          <p>Stored locally. Optional model synthesis sends selected passages to your provider.</p>
          <div className="avatar">RP</div>
          <span>
            My workspace<small>Personal research</small>
          </span>
        </div>
      </aside>
      <main>
        <header>
          <div>
            Workspace <span>/</span> <strong>{tab}</strong>
          </div>
          <span className="mode">
            <span className="status-dot" />
            {mode === "extractive"
              ? "Extractive mode"
              : "Model synthesis enabled"}
          </span>
        </header>
        <div className="content">
          <div className="page-heading">
            <div className="eyebrow">YOUR RESEARCH, CONNECTED</div>
            <div className="heading-row">
              <div>
                <h1>
                  {tab === "Research" ? "From questions to evidence." : tab}
                </h1>
                <p>
                  {tab === "Research"
                    ? "Explore the literature. Follow every finding back to its source."
                    : tab === "Paper library"
                      ? "Your source material, ready for a closer read."
                      : tab === "Compare papers"
                        ? "Look at the evidence side by side."
                        : tab === "Knowledge graph"
                          ? "Discover concepts shared across your library."
                          : "Pick up where your research left off."}
                </p>
              </div>
              <button className="secondary" onClick={() => setModal(true)}>
                <Plus size={17} /> Add papers
              </button>
            </div>
          </div>
          {error && (
            <div role="alert" className="error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div className="activity" role="status">
              <Loader2 size={16} className="spin" />
              {busy}…
            </div>
          )}
          {tab === "Research" && (
            <>
              <section className="question-card">
                <div className="card-label">
                  <Search size={18} /> RESEARCH QUESTION{" "}
                  <span>01 — EXPLORE</span>
                </div>
                <textarea
                  aria-label="Research question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What would you like to investigate?"
                />
                <div className="question-footer">
                  <span>
                    <BookOpen size={16} />
                    {selected.length ? selected.length : papers.length} papers
                    in scope
                  </span>
                  <button
                    className="primary"
                    disabled={!!busy || !loaded || question.trim().length < 5}
                    onClick={() =>
                      act("Retrieving and verifying evidence", async () =>
                        setReview(
                          await api<Review>("/reviews", {
                            question,
                            paper_ids: selected.length ? selected : null,
                          }),
                        ),
                      )
                    }
                  >
                    Generate review <ArrowRight size={17} />
                  </button>
                </div>
              </section>
              <div className="suggestions">
                <span>TRY A QUESTION</span>
                {[
                  "How is evidence verified?",
                  "What are the limitations of retrieval?",
                ].map((q) => (
                  <button key={q} onClick={() => setQuestion(q)}>
                    {q}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
              <div className="research-grid">
                <div>
                  {review ? (
                    <>
                      <div className="section-heading">
                        <h2>Research brief</h2>
                        <button
                          className="text-button"
                          onClick={() => exportReview(review)}
                        >
                          <Download size={16} /> Export
                        </button>
                      </div>
                      <div className="report">
                        <div className="report-meta">
                          {review.mode} · {review.claims.length} sourced
                          findings
                        </div>
                        <h2>{review.question}</h2>
                        {review.warnings.map((w) => (
                          <p className="notice" key={w}>
                            {w}
                          </p>
                        ))}
                        {review.claims.map((c, i) => (
                          <article className="finding" key={i}>
                            <span className="finding-number">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <div>
                              <p>{c.text}</p>
                              <details>
                                <summary>
                                  <Check size={14} /> {c.verification}{" "}
                                  <span>[{i + 1}]</span>
                                </summary>
                                <blockquote>{c.quote}</blockquote>
                                <p className="source-label">{c.title}</p>
                                {c.source_url && (
                                  <a
                                    target="_blank"
                                    rel="noreferrer"
                                    href={c.source_url}
                                  >
                                    Open source <ArrowUpRight size={14} />
                                  </a>
                                )}
                              </details>
                            </div>
                          </article>
                        ))}
                        <p className="footnote">
                          Verification checks quoted text against imported
                          passages. It does not independently establish
                          scientific truth or semantic entailment. Demo notes
                          and abstracts are not full papers.
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="section-heading">
                        <h2>Research starts with good sources</h2>
                        <span className="subtle">YOUR LIBRARY</span>
                      </div>
                      {!loaded ? (
                        <div className="empty">
                          <BookOpen size={32} />
                          <h3>Build your reading collection</h3>
                          <p>
                            Import a paper, search arXiv, or explore a small
                            demo about retrieval-augmented generation.
                          </p>
                          <button
                            className="primary"
                            disabled={!!busy}
                            onClick={() =>
                              act("Loading demo notes", async () => {
                                await api("/demo", {});
                                await refresh();
                              })
                            }
                          >
                            Explore demo <ArrowRight size={16} />
                          </button>
                          <small>
                            3 clearly labeled explanatory notes. No API key
                            needed.
                          </small>
                        </div>
                      ) : (
                        papers.slice(0, 4).map((p) => (
                          <div className="paper-card" key={p.id}>
                            <div className="paper-icon">
                              <FileText size={21} />
                            </div>
                            <div>
                              <span className="tag">{p.source_type}</span>
                              <h3>{p.title}</h3>
                              <p>
                                {p.authors || "Imported paper"}{" "}
                                <span>· {p.year}</span>
                              </p>
                            </div>
                            <input
                              type="checkbox"
                              aria-label={"Include " + p.title}
                              checked={selected.includes(p.id)}
                              onChange={() => toggle(p.id)}
                            />
                          </div>
                        ))
                      )}
                    </>
                  )}
                </div>
                <div>
                  <div className="section-heading">
                    <h2>Research workflow</h2>
                    <span className="tiny-tag">LANGGRAPH</span>
                  </div>
                  <section className="workflow">
                    {[
                      {
                        name: "Retrieve",
                        text: "Find relevant passages in your library.",
                      },
                      {
                        name: "Synthesize",
                        text: "Build findings from source evidence.",
                      },
                      {
                        name: "Verify",
                        text: "Check every quote against its source.",
                      },
                    ].map((s, i) => (
                      <div className="step" key={s.name}>
                        <span className={review ? "done" : ""}>
                          {review ? <Check size={16} /> : i + 1}
                        </span>
                        <div>
                          <strong>{s.name}</strong>
                          <p>{review?.trace[i]?.detail || s.text}</p>
                        </div>
                      </div>
                    ))}
                    <div className="workflow-note">
                      <Atom size={18} />
                      <p>
                        {mode === "extractive"
                          ? "No model key configured. Reviews use exact source extracts."
                          : "Model-generated interpretations include matched source quotes."}
                      </p>
                    </div>
                  </section>
                  <div className="scope-card">
                    <span className="eyebrow">AT A GLANCE</span>
                    <div>
                      <strong>{papers.length}</strong>
                      <span>papers in your library</span>
                    </div>
                    <div>
                      <strong>{review?.evidence.length || 0}</strong>
                      <span>passages in this review</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          {tab === "Paper library" && (
            <>
              <div className="toolbar">
                <input
                  placeholder="Filter your library…"
                  aria-label="Filter library"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <span>{selected.length} selected</span>
              </div>
              {papers
                .filter((p) =>
                  (p.title + " " + p.authors)
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .map((p) => (
                  <div className="paper-card" key={p.id}>
                    <input
                      type="checkbox"
                      aria-label={"Select " + p.title}
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <div>
                      <span className="tag">{p.source_type}</span>
                      <h3>{p.title}</h3>
                      <p>
                        {p.authors} · {p.year}
                      </p>
                      <details>
                        <summary>Read imported text</summary>
                        <p className="paper-text">{p.text}</p>
                      </details>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={"Delete " + p.title}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remove this paper from your library? Saved reviews retain their evidence.",
                          )
                        )
                          act("Removing paper", async () => {
                            await fetch("/api/papers/" + p.id, {
                              method: "DELETE",
                            }).then((r) => {
                              if (!r.ok) throw Error("Unable to delete paper");
                            });
                            setSelected((s) => s.filter((id) => id !== p.id));
                            await refresh();
                          });
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              {!papers.length && (
                <div className="empty">
                  No papers yet. Add your first source to get started.
                </div>
              )}
            </>
          )}
          {tab === "Compare papers" && (
            <>
              <div className="selection-list">
                {papers.map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    {p.title}
                  </label>
                ))}
              </div>
              <div className="toolbar">
                <input
                  aria-label="Comparison focus"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <button
                  className="primary"
                  disabled={
                    !!busy || selected.length < 2 || selected.length > 4
                  }
                  onClick={() =>
                    act("Comparing papers", async () =>
                      setComparison(
                        await api("/compare", {
                          paper_ids: selected,
                          question,
                        }),
                      ),
                    )
                  }
                >
                  Compare {selected.length} papers
                </button>
              </div>
              <p className="footnote">
                Select 2–4 papers. The comparison shows retrieved evidence for
                your question; missing evidence is left explicit.
              </p>
              <div className="comparison">
                {comparison.map((c) => (
                  <article className="report" key={c.paper.id}>
                    <span className="tag">{c.paper.source_type}</span>
                    <h2>{c.paper.title}</h2>
                    <p>
                      {c.paper.authors} · {c.paper.year}
                    </p>
                    {c.passages.map((p) => (
                      <blockquote key={p.id}>{p.text}</blockquote>
                    ))}
                    {!c.passages.length && (
                      <p>No matching passages for this question.</p>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
          {tab === "Knowledge graph" && graph && <GraphView graph={graph} />}
          {tab === "Review history" && (
            <>
              {history.length === 0 && (
                <div className="empty">
                  No saved reviews yet. Generate your first review from the
                  Research tab.
                </div>
              )}
              {history.map((r) => (
                <button
                  className="history-card"
                  key={r.id}
                  onClick={() => {
                    setReview(r);
                    setTab("Research");
                  }}
                >
                  <FileText size={24} />
                  <div>
                    <h3>{r.question}</h3>
                    <p>
                      {new Date(r.created_at).toLocaleString()} ·{" "}
                      {r.claims.length} findings · {r.mode}
                    </p>
                  </div>
                  <ArrowRight size={19} />
                </button>
              ))}
            </>
          )}
        </div>
        <footer>
          RESEARCHPILOT{" "}
          <span>Built for curious minds. Grounded in evidence.</span>
          <span>v1.0</span>
        </footer>
      </main>
      {modal && (
        <div className="overlay">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <div className="section-heading">
              <h2 id="import-title">Add to your library</h2>
              <button
                autoFocus
                className="icon-button"
                aria-label="Close import"
                onClick={() => setModal(false)}
              >
                <X />
              </button>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <h3>Discover on arXiv</h3>
            <form
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                act("Searching arXiv", async () =>
                  setResults(
                    await api<Paper[]>(
                      "/discover?query=" + encodeURIComponent(discover),
                    ),
                  ),
                );
              }}
            >
              <input
                required
                minLength={3}
                placeholder="Search a topic or paper title"
                aria-label="Search arXiv"
                value={discover}
                onChange={(e) => setDiscover(e.target.value)}
              />
              <button className="primary" disabled={!!busy}>
                Search
              </button>
            </form>
            {results.map((p, i) => (
              <div className="search-result" key={i}>
                <span>
                  {p.title}
                  <small>
                    {p.authors} · {p.year} · abstract only
                  </small>
                </span>
                <button
                  className="secondary"
                  disabled={!!busy || papers.some((x) => x.title === p.title)}
                  onClick={() => act("Importing abstract", () => add(p))}
                >
                  {papers.some((x) => x.title === p.title) ? "Added" : "Add"}
                </button>
              </div>
            ))}
            <hr />
            <h3>Upload a PDF</h3>
            <input
              aria-label="Upload PDF"
              type="file"
              accept="application/pdf"
              disabled={!!busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  act("Extracting PDF", async () => {
                    const form = new FormData();
                    form.append("file", file);
                    const r = await fetch("/api/papers/pdf", {
                      method: "POST",
                      body: form,
                    });
                    if (!r.ok) throw Error((await r.json()).detail);
                    await refresh();
                    setModal(false);
                  });
              }}
            />
            <p className="footnote">
              Text PDFs up to 15 MB / 300 pages. Scans need OCR first.
            </p>
            <hr />
            <h3>Paste paper text</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                act("Adding paper", async () => {
                  await add({
                    title: d.get("title"),
                    authors: d.get("authors"),
                    text: d.get("text"),
                    year: Number(d.get("year")),
                    source_url: d.get("url") || null,
                  });
                  setModal(false);
                });
              }}
            >
              <div className="form-grid">
                <label>
                  Title
                  <input name="title" required minLength={3} />
                </label>
                <label>
                  Authors
                  <input name="authors" />
                </label>
                <label>
                  Year
                  <input
                    name="year"
                    type="number"
                    min="1800"
                    max="2100"
                    defaultValue="2026"
                  />
                </label>
                <label>
                  Source URL (optional)
                  <input name="url" type="url" />
                </label>
              </div>
              <label>
                Source text
                <textarea name="text" required minLength={40} rows={5} />
              </label>
              <button className="primary" disabled={!!busy}>
                Add paper <Plus size={16} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function GraphView({ graph }: { graph: Graph }) {
  const [focus, setFocus] = useState<string | null>(null);
  const nodes = graph.nodes;
  const positions = new Map(
    nodes.map((n, i) => [
      n.id,
      {
        x: 420 + Math.cos((i / nodes.length) * 2 * Math.PI) * 290,
        y: 300 + Math.sin((i / nodes.length) * 2 * Math.PI) * 225,
      },
    ]),
  );
  return (
    <div className="report">
      <p className="footnote">{graph.method}</p>
      {nodes.length ? (
        <>
          <svg
            viewBox="0 0 840 600"
            className="graph"
            role="img"
            aria-label="Paper and concept connections"
          >
            {graph.edges.map((e, i) => {
              const a = positions.get(e.source)!,
                b = positions.get(e.target)!;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={
                    focus === e.source || focus === e.target
                      ? "#315efb"
                      : "#d9dfeb"
                  }
                  strokeWidth={focus === e.source || focus === e.target ? 3 : 1}
                />
              );
            })}
            {nodes.map((n) => {
              const p = positions.get(n.id)!;
              return (
                <g key={n.id} onClick={() => setFocus(n.id)}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={n.type === "paper" ? 17 : 10}
                    fill={n.type === "paper" ? "#315efb" : "#19a395"}
                  />
                  <text
                    x={p.x}
                    y={p.y + 34}
                    textAnchor="middle"
                    fontSize="12"
                    fill="#334155"
                  >
                    {n.label.length > 29 ? n.label.slice(0, 28) + "…" : n.label}
                  </text>
                  <title>{n.label}</title>
                </g>
              );
            })}
          </svg>
          <div className="graph-legend">
            <span>● Paper</span>
            <span>● Concept mention</span>
          </div>
          <label>
            Inspect connections
            <select
              value={focus || ""}
              onChange={(e) => setFocus(e.target.value)}
            >
              <option value="">Choose a paper or concept</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          {focus && (
            <div className="notice">
              <strong>{nodes.find((n) => n.id === focus)?.label}</strong>
              {graph.edges
                .filter((e) => e.source === focus || e.target === focus)
                .map((e, i) => (
                  <p key={i}>
                    {
                      nodes.find(
                        (n) =>
                          n.id === (e.source === focus ? e.target : e.source),
                      )?.label
                    }
                  </p>
                ))}
            </div>
          )}
        </>
      ) : (
        <div className="empty">Import papers to build a concept graph.</div>
      )}
    </div>
  );
}
