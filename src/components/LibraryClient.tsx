"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SourceSummary } from "@/lib/sources";
import type { AiConfig } from "@/lib/ai";

type Props = { sources: SourceSummary[]; ai: AiConfig };

const KIND_LABEL: Record<string, string> = {
  pdf: "PDF",
  epub: "EPUB",
  markdown: "Markdown",
  text: "Text",
  notes: "Notes",
};

export default function LibraryClient({ sources, ai }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(form: FormData) {
    setBusy(true);
    setStatus(null);
    const response = await fetch("/api/sources", { method: "POST", body: form });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setStatus(data.error ?? "That import did not work.");
      return;
    }
    setStatus(
      data.questions > 0
        ? `${data.title}: ${data.questions} questions from ${data.chunks} passages.`
        : `${data.title} imported, but no clean questions came out of it. Try the AI pass or paste tighter notes.`,
    );
    setNotes("");
    setTitle("");
    if (fileInput.current) fileInput.current.value = "";
    router.refresh();
  }

  async function generate(id: string, useAi: boolean) {
    setBusy(true);
    setStatus(null);
    const response = await fetch(`/api/sources/${id}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useAi }),
    });
    const data = await response.json();
    setBusy(false);
    setStatus(response.ok ? `Added ${data.stored} new questions.` : (data.error ?? "That did not work."));
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    await fetch(`/api/sources/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <>
      <section className="panel mt-8 p-6 sm:p-7">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData();
            const file = fileInput.current?.files?.[0];
            if (file) form.set("file", file);
            if (notes.trim()) form.set("notes", notes.trim());
            if (title.trim()) form.set("title", title.trim());
            if (!file && !notes.trim()) {
              setStatus("Attach a file or paste some notes first.");
              return;
            }
            void upload(form);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2">
              <span className="text-[0.8125rem] text-faint">File</span>
              <input
                ref={fileInput}
                type="file"
                accept=".pdf,.epub,.txt,.md,.markdown"
                className="rounded-xl border border-edge bg-white/[0.02] px-3 py-2.5 text-[0.9rem] text-dim file:mr-3 file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-[0.8125rem] file:text-ink"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[0.8125rem] text-faint">Name it (optional)</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Grade 12 Economics, unit 3"
                className="rounded-xl border border-edge bg-white/[0.02] px-3.5 py-2.5 text-[0.9rem] placeholder:text-faint"
              />
            </label>
          </div>

          <label className="mt-4 flex flex-col gap-2">
            <span className="text-[0.8125rem] text-faint">Or paste notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="Paste a chapter, a set of definitions, lecture notes…"
              className="resize-y rounded-xl border border-edge bg-white/[0.02] px-3.5 py-3 text-[0.9rem] leading-relaxed placeholder:text-faint"
            />
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-ink px-5 py-2.5 text-[0.9rem] font-medium text-void transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              {busy ? "Working…" : "Import"}
            </button>
            <span className="text-[0.75rem] text-faint">
              Questions are built on your machine and stored locally. Playing never calls an API.
            </span>
          </div>
        </form>

        {status && <p className="mt-4 text-[0.9rem] text-dim">{status}</p>}
      </section>

      {sources.length > 0 ? (
        <section className="mt-8 flex flex-col gap-3">
          {sources.map((source) => (
            <article key={source.id} className="panel p-5 px-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="truncate font-[family-name:var(--font-display)] text-[1.15rem] font-semibold tracking-tight">
                    {source.title}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-2.5 text-[0.8125rem] text-faint">
                    <span className="text-dim">{KIND_LABEL[source.kind] ?? source.kind}</span>
                    <span>{source.chunks === 1 ? "1 passage" : `${source.chunks} passages`}</span>
                    <span>{source.questions === 1 ? "1 question" : `${source.questions} questions`}</span>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {source.questions > 0 && (
                    <Link
                      href={`/play?mode=source&sourceId=${source.id}`} prefetch={false}
                      className="rounded-full bg-ink px-4 py-2 text-[0.85rem] font-medium text-void"
                    >
                      Play
                    </Link>
                  )}
                  <button
                    onClick={() => void generate(source.id, false)}
                    disabled={busy}
                    className="rounded-full border border-edge px-4 py-2 text-[0.85rem] text-dim transition-colors hover:text-ink disabled:opacity-50"
                  >
                    Rebuild
                  </button>
                  {ai.enabled && (
                    <button
                      onClick={() => void generate(source.id, true)}
                      disabled={busy}
                      className="rounded-full border border-[var(--accent)] px-4 py-2 text-[0.85rem] text-[var(--accent)] disabled:opacity-50"
                    >
                      AI pass
                    </button>
                  )}
                  <button
                    onClick={() => void remove(source.id)}
                    disabled={busy}
                    className="rounded-full px-3 py-2 text-[0.85rem] text-faint transition-colors hover:text-false disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <p className="mt-8 max-w-[52ch] leading-relaxed text-dim">
          Nothing here yet. Import a textbook chapter, a set of notes or an EPUB and it becomes a round you can play.
        </p>
      )}

      <p className="mt-10 text-[0.8125rem] text-faint">
        {ai.enabled
          ? `AI pass available via ${ai.provider}. It runs once per passage and the results are stored.`
          : "AI generation is off. Set AI_ENABLED=true with a key to add an optional generation pass."}
      </p>
    </>
  );
}
