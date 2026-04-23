"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type AppState = "idle" | "preview" | "solving" | "done" | "error";

interface SavedProblem {
  id: string;
  savedAt: string;
  title: string;
  answer: string;
}

const STORAGE_KEY = "ledgersnap_saved";

function loadSaved(): SavedProblem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function persistSaved(items: SavedProblem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function deriveTitle(answer: string): string {
  const lines = answer.split("\n");
  for (const line of lines) {
    const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
    if (clean.length > 4) return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
  }
  return "Saved answer";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Icons ──────────────────────────────────────────────────────────────────

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function BookmarkIcon({ filled }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} className="w-5 h-5" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
    </svg>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <div className="w-12 h-12 rounded-full border-4 border-purple-500/30 border-t-purple-500 animate-spin" />
      <p className="text-purple-300 text-sm font-medium animate-pulse">Analyzing your problem…</p>
    </div>
  );
}

// ── Markdown + LaTeX renderer ──────────────────────────────────────────────

function SolutionRenderer({ text }: { text: string }) {
  const renderKaTeX = (latex: string, display: boolean): string => {
    if (typeof window === "undefined") return latex;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const katex = (window as any).katex;
      if (!katex) return `<span class="text-purple-300">${latex}</span>`;
      return katex.renderToString(latex, { displayMode: display, throwOnError: false });
    } catch {
      return latex;
    }
  };

  const renderInline = (raw: string, key: string | number): React.ReactNode => {
    const parts = raw.split(/(\\\(.*?\\\)|\$[^$]+\$)/g);
    return parts.map((part, i) => {
      if ((part.startsWith("\\(") && part.endsWith("\\)")) || (part.startsWith("$") && part.endsWith("$"))) {
        const latex = part.startsWith("\\(") ? part.slice(2, -2) : part.slice(1, -1);
        return <span key={`${key}-${i}`} dangerouslySetInnerHTML={{ __html: renderKaTeX(latex, false) }} />;
      }
      const boldParts = part.split(/(\*\*.*?\*\*)/g);
      return boldParts.map((bp, j) => {
        if (bp.startsWith("**") && bp.endsWith("**")) return <strong key={`${key}-${i}-${j}`}>{bp.slice(2, -2)}</strong>;
        const codeParts = bp.split(/(`[^`]+`)/g);
        return codeParts.map((cp, k) => {
          if (cp.startsWith("`") && cp.endsWith("`")) return <code key={`${key}-${i}-${j}-${k}`}>{cp.slice(1, -1)}</code>;
          return cp || null;
        });
      });
    });
  };

  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("\\[") || line.trim() === "$$") {
      const closeDelim = line.trim().startsWith("\\[") ? "\\]" : "$$";
      const mathLines: string[] = [];
      if (line.trim() !== "\\[" && line.trim() !== "$$") mathLines.push(line.trim().slice(2));
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(closeDelim)) { mathLines.push(lines[i]); i++; }
      elements.push(<div key={i} className="katex-display my-3 text-center" dangerouslySetInnerHTML={{ __html: renderKaTeX(mathLines.join("\n"), true) }} />);
      i++; continue;
    }
    if (line.startsWith("### ")) { elements.push(<h3 key={i}>{renderInline(line.slice(4), i)}</h3>); i++; continue; }
    if (line.startsWith("## ")) { elements.push(<h2 key={i}>{renderInline(line.slice(3), i)}</h2>); i++; continue; }
    if (line.startsWith("# ")) { elements.push(<h2 key={i} className="text-lg font-bold text-purple-300 mt-4 mb-2">{renderInline(line.slice(2), i)}</h2>); i++; continue; }
    if (line.trim() === "---" || line.trim() === "***") { elements.push(<hr key={i} />); i++; continue; }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && (lines[i].startsWith("- ") || lines[i].startsWith("* "))) { items.push(<li key={i}>{renderInline(lines[i].slice(2), i)}</li>); i++; }
      elements.push(<ul key={`ul-${i}`}>{items}</ul>); continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(<li key={i}>{renderInline(lines[i].replace(/^\d+\.\s/, ""), i)}</li>); i++; }
      elements.push(<ol key={`ol-${i}`}>{items}</ol>); continue;
    }
    if (line.trim() === "") { i++; continue; }
    elements.push(<p key={i}>{renderInline(line, i)}</p>);
    i++;
  }

  return <div className="solution-prose">{elements}</div>;
}

// ── Saved Problems Panel ───────────────────────────────────────────────────

function SavedPanel({
  items,
  onDelete,
  onClose,
}: {
  items: SavedProblem[];
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0f1a]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-10 pb-4 border-b border-purple-500/20">
        <div>
          <h2 className="text-lg font-bold text-white">Saved Problems</h2>
          <p className="text-xs text-purple-400/60 mt-0.5">{items.length} saved</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl border border-purple-500/30 text-purple-300 hover:bg-purple-900/20 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-center py-16">
            <span className="text-4xl">📂</span>
            <p className="text-purple-300/60 text-sm">No saved problems yet.</p>
            <p className="text-purple-400/40 text-xs">After solving a problem, tap Save to keep it here.</p>
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} className="rounded-2xl border border-purple-500/20 bg-purple-950/20 overflow-hidden">
            {/* Row */}
            <button
              className="w-full flex items-start justify-between gap-3 p-4 text-left"
              onClick={() => setExpanded(expanded === item.id ? null : item.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-200 leading-snug truncate">{item.title}</p>
                <p className="text-xs text-purple-400/50 mt-1">{formatDate(item.savedAt)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                  className="p-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-950/30 transition-colors"
                  aria-label="Delete"
                >
                  <TrashIcon />
                </button>
                <span className="text-purple-400/50"><ChevronIcon open={expanded === item.id} /></span>
              </div>
            </button>
            {/* Expanded answer */}
            {expanded === item.id && (
              <div className="px-4 pb-4 border-t border-purple-500/10 pt-3 text-sm text-gray-300">
                <SolutionRenderer text={item.answer} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────

export default function Home() {
  const [state, setState] = useState<AppState>("idle");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [solution, setSolution] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [saved, setSaved] = useState<SavedProblem[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Load saved on mount
  useEffect(() => { setSaved(loadSaved()); }, []);

  const handleFile = useCallback((file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImagePreview(dataUrl);
      setImageData(dataUrl.split(",")[1]);
      setState("preview");
    };
    reader.readAsDataURL(file);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => handleFile(e.target.files?.[0] ?? null),
    [handleFile]
  );

  const handleSolve = useCallback(async () => {
    if (!imageData) return;
    setState("solving");
    setSolution("");
    setErrorMsg("");
    setJustSaved(false);

    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imageData }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");

      setState("done");
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setSolution(accumulated);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setState("error");
    }
  }, [imageData]);

  const handleSave = useCallback(() => {
    if (!solution) return;
    const entry: SavedProblem = {
      id: Date.now().toString(),
      savedAt: new Date().toISOString(),
      title: deriveTitle(solution),
      answer: solution,
    };
    const updated = [entry, ...saved];
    setSaved(updated);
    persistSaved(updated);
    setJustSaved(true);
  }, [solution, saved]);

  const handleDelete = useCallback((id: string) => {
    const updated = saved.filter((s) => s.id !== id);
    setSaved(updated);
    persistSaved(updated);
  }, [saved]);

  const handleReset = useCallback(() => {
    setState("idle");
    setImageData(null);
    setImagePreview(null);
    setSolution("");
    setErrorMsg("");
    setJustSaved(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  }, []);

  const alreadySaved = justSaved;

  return (
    <>
      <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js" crossOrigin="anonymous" />

      {showSaved && (
        <SavedPanel
          items={saved}
          onDelete={handleDelete}
          onClose={() => setShowSaved(false)}
        />
      )}

      <main className="flex flex-col min-h-screen max-w-md mx-auto px-4 pb-8">
        {/* Header */}
        <header className="pt-10 pb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📒</span>
              <h1 className="text-xl font-bold tracking-tight text-white">LedgerSnap</h1>
            </div>
            <p className="text-xs text-purple-300/50 mt-0.5 ml-0.5">Snap an accounting problem. Get the answer.</p>
          </div>
          <button
            onClick={() => setShowSaved(true)}
            className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-500/30 bg-purple-950/30 text-purple-300 text-sm font-medium hover:bg-purple-900/30 transition-colors"
          >
            <BookmarkIcon />
            Saved
            {saved.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-purple-600 text-white text-[10px] font-bold px-1">
                {saved.length}
              </span>
            )}
          </button>
        </header>

        <div className="flex-1 flex flex-col gap-4">

          {/* IDLE */}
          {state === "idle" && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 w-full rounded-2xl border-2 border-dashed border-purple-500/40 bg-purple-950/30 py-12 text-purple-300 transition-all active:scale-95 hover:border-purple-400/60 hover:bg-purple-900/20"
              >
                <div className="p-3 rounded-xl bg-purple-600/20 border border-purple-500/30">
                  <CameraIcon />
                </div>
                <span className="text-base font-semibold">Take a Photo</span>
                <span className="text-xs text-purple-400/60">Use your camera to capture a problem</span>
              </button>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInputChange} />

              <div className="flex items-center gap-3 my-1">
                <div className="flex-1 h-px bg-purple-500/20" />
                <span className="text-xs text-purple-400/50 font-medium">or</span>
                <div className="flex-1 h-px bg-purple-500/20" />
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-purple-500/30 bg-purple-950/20 py-3.5 text-sm font-medium text-purple-300 transition-all active:scale-95 hover:bg-purple-900/20"
              >
                <UploadIcon />
                Upload from Gallery
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />

              <p className="text-center text-xs text-purple-400/40 mt-2">
                Journal Entries · Financial Statements · Ratios · GAAP · IFRS
              </p>
            </div>
          )}

          {/* PREVIEW / SOLVING */}
          {(state === "preview" || state === "solving") && (
            <div className="flex flex-col gap-4">
              <div className="relative rounded-2xl overflow-hidden border border-purple-500/30 bg-black/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview!} alt="Problem to solve" className="w-full object-contain max-h-72" />
                {state === "preview" && (
                  <button
                    onClick={handleReset}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 border border-white/10 text-white/70 hover:text-white transition-colors"
                    aria-label="Remove image"
                  >
                    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {state === "preview" && (
                <button
                  onClick={handleSolve}
                  className="w-full py-4 rounded-2xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-semibold text-base transition-all shadow-lg shadow-purple-900/40"
                >
                  ✨ Solve It
                </button>
              )}
              {state === "solving" && <Spinner />}
            </div>
          )}

          {/* Solution */}
          {(state === "done" || state === "solving") && solution && (
            <div className="rounded-2xl border border-purple-500/20 bg-purple-950/20 p-4">
              <div className="flex items-center gap-2 mb-3 pb-3 border-b border-purple-500/20">
                <span className="text-base">📒</span>
                <span className="text-sm font-semibold text-purple-300">Answer</span>
              </div>
              <div className="text-sm text-gray-200 leading-relaxed">
                <SolutionRenderer text={solution} />
              </div>
            </div>
          )}

          {/* Action buttons after done */}
          {state === "done" && (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={alreadySaved}
                className={`flex items-center justify-center gap-2 flex-1 py-3.5 rounded-2xl text-sm font-medium transition-all active:scale-95 border ${
                  alreadySaved
                    ? "border-purple-500/50 bg-purple-900/30 text-purple-400 cursor-default"
                    : "border-purple-500/40 bg-purple-950/30 text-purple-300 hover:bg-purple-900/30"
                }`}
              >
                <BookmarkIcon filled={alreadySaved} />
                {alreadySaved ? "Saved" : "Save Answer"}
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-3.5 rounded-2xl border border-purple-500/30 bg-transparent hover:bg-purple-900/20 active:scale-95 text-purple-300 font-medium text-sm transition-all"
              >
                + New Problem
              </button>
            </div>
          )}

          {/* ERROR */}
          {state === "error" && (
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-4">
                <div className="flex items-start gap-3">
                  <span className="text-lg mt-0.5">⚠️</span>
                  <div>
                    <p className="text-sm font-semibold text-red-300 mb-1">Something went wrong</p>
                    <p className="text-xs text-red-400/80">{errorMsg}</p>
                  </div>
                </div>
              </div>
              <button
                onClick={handleReset}
                className="w-full py-3.5 rounded-2xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-medium text-sm transition-all"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        <footer className="pt-8 text-center text-xs text-purple-400/30">
          Powered by Claude Sonnet · GAAP &amp; IFRS
        </footer>
      </main>
    </>
  );
}
