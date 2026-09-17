"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import SignalLine from "./SignalLine";
import Wordmark from "./Wordmark";
import { categoryMeta } from "@/lib/categories";
import { tint } from "@/lib/tint";
import type { AnswerResult, CategoryId, Mode, ServedQuestion } from "@/lib/types";

type DeeperPayload = { level: 2 | 3; prompt: string; options: string[]; stepCount: number; step: number };
type DeeperResult = { correct: boolean; answerIndex: number; explanation: string; points: number; hasNext: boolean };

type Summary = {
  total: number; correct: number; score: number; bestStreak: number; avgMs: number;
  accuracy: number; xp: number; level: number; levelProgress: number;
  breakdown: { topic: string; category: string; correct: number; total: number }[];
  missed: { id: string; prompt: string; answer: string; explanation: string; topic: string }[];
};

type Opening = { sessionId: string; length: number; question: ServedQuestion };

type Props = {
  mode: Mode;
  category: CategoryId | null;
  sourceId: string | null;
  hue: number;
  opening: Opening | null;
  openingError: string | null;
};

const SPEED_WINDOW = 15000;
const DIFFICULTY_LABEL = ["", "recall", "understanding", "insight"];

function DifficultyBars({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="flex items-end gap-[3px]" title={DIFFICULTY_LABEL[level]}>
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className="w-[3px] rounded-[1px]"
          style={{
            height: `${4 + step * 3}px`,
            backgroundColor: step <= level ? "var(--accent)" : "var(--color-edge)",
          }}
        />
      ))}
      <span className="sr-only">{DIFFICULTY_LABEL[level]}</span>
    </span>
  );
}

export default function PlayClient({ mode, category, sourceId, hue, opening, openingError }: Props) {
  const [sessionId] = useState<string | null>(opening?.sessionId ?? null);
  const [length] = useState(opening?.length ?? 0);
  const [idx, setIdx] = useState(0);
  const [question, setQuestion] = useState<ServedQuestion | null>(opening?.question ?? null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [deeper, setDeeper] = useState<DeeperPayload | null>(null);
  const [deeperResult, setDeeperResult] = useState<DeeperResult | null>(null);
  const [deeperChoice, setDeeperChoice] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const error = openingError;
  const [elapsed, setElapsed] = useState(0);

  const askedAt = useRef(Date.now());
  const busy = useRef(false);

  useEffect(() => {
    if (!question || result) return;
    const id = window.setInterval(() => setElapsed(Date.now() - askedAt.current), 100);
    return () => window.clearInterval(id);
  }, [question, result]);

  const send = useCallback(
    async (given: string) => {
      if (!sessionId || !question || result || busy.current) return;
      busy.current = true;
      const ms = Date.now() - askedAt.current;
      const response = await fetch(`/api/round/${sessionId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idx, given, ms }),
      });
      const data = (await response.json()) as AnswerResult;
      setResult(data);
      setScore((s) => s + data.points);
      setStreak(data.streak);
      busy.current = false;
    },
    [sessionId, question, result, idx],
  );

  const submit = useCallback(
    (choice: number) => {
      setChosen(choice);
      void send(String(choice));
    },
    [send],
  );

  const next = useCallback(async () => {
    if (!sessionId || busy.current) return;
    busy.current = true;
    const nextIdx = idx + 1;
    setDeeper(null);
    setDeeperResult(null);
    setDeeperChoice(null);

    if (nextIdx >= length) {
      const response = await fetch(`/api/round/${sessionId}/finish`, { method: "POST" });
      setSummary((await response.json()) as Summary);
      setQuestion(null);
      busy.current = false;
      return;
    }
    const response = await fetch(`/api/round/${sessionId}/question?idx=${nextIdx}`);
    const data = await response.json();
    setIdx(nextIdx);
    setQuestion(data.question);
    setResult(null);
    setChosen(null);
    setTyped("");
    setElapsed(0);
    askedAt.current = Date.now();
    busy.current = false;
  }, [sessionId, idx, length]);

  const openDeeper = useCallback(
    async (step = 0) => {
      if (!sessionId || !result?.hasDeeper) return;
      const response = await fetch(`/api/round/${sessionId}/deeper?idx=${idx}&step=${step}`);
      if (!response.ok) return;
      setDeeper((await response.json()) as DeeperPayload);
      setDeeperResult(null);
      setDeeperChoice(null);
      askedAt.current = Date.now();
    },
    [sessionId, result, idx],
  );

  const submitDeeper = useCallback(
    async (choice: number) => {
      if (!sessionId || !deeper || deeperResult) return;
      setDeeperChoice(choice);
      const response = await fetch(`/api/round/${sessionId}/deeper`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idx, step: deeper.step, given: choice, ms: Date.now() - askedAt.current }),
      });
      const data = (await response.json()) as DeeperResult;
      setDeeperResult(data);
      setScore((s) => s + data.points);
    },
    [sessionId, deeper, deeperResult, idx],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      if (deeper && !deeperResult) {
        const n = Number(key);
        if (n >= 1 && n <= deeper.options.length) {
          event.preventDefault();
          void submitDeeper(n - 1);
        }
        return;
      }
      if (!result && question) {
        if (question.kind !== "mc") return;
        const n = Number(key);
        if (n >= 1 && n <= question.options.length) {
          event.preventDefault();
          submit(n - 1);
        }
        return;
      }
      if (result) {
        if (key === "enter" || key === " ") {
          event.preventDefault();
          if (deeperResult?.hasNext) void openDeeper(deeper ? deeper.step + 1 : 0);
          else void next();
        }
        if (key === "d" && result.hasDeeper && !deeper) {
          event.preventDefault();
          void openDeeper(0);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [question, result, deeper, deeperResult, submit, submitDeeper, next, openDeeper]);

  if (error) {
    return (
      <Shell hue={hue}>
        <div className="panel mt-20 p-8 text-center">
          <p className="text-dim">{error}</p>
          <Link href="/" className="mt-5 inline-block rounded-full bg-ink px-5 py-2.5 text-sm text-void">
            Back
          </Link>
        </div>
      </Shell>
    );
  }

  if (summary) return <SummaryView summary={summary} mode={mode} category={category} sourceId={sourceId} hue={hue} />;

  if (!question) {
    return (
      <Shell hue={hue}>
        <div className="mt-24 text-center text-faint">Dealing the round…</div>
      </Shell>
    );
  }

  const beam = Math.max(0, 1 - elapsed / SPEED_WINDOW);
  const pulse = result ? (result.correct ? "right" : "wrong") : null;

  return (
    <Shell hue={categoryMeta(question.category).hue}>
      <header className="flex items-center justify-between gap-4 pt-6">
        <div className="flex flex-1 items-center gap-1.5">
          {Array.from({ length }, (_, i) => (
            <span
              key={i}
              className="tick"
              style={{
                flexGrow: i === idx ? 2.4 : 1,
                backgroundColor: i < idx ? "var(--accent)" : i === idx ? "var(--color-ink)" : undefined,
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-4 text-[0.8125rem] tabular-nums">
          {streak > 1 && <span className="text-[var(--accent)]">{streak} in a row</span>}
          <span className="text-dim">{score}</span>
          <Link href="/" className="text-faint transition-colors hover:text-ink" aria-label="Leave the round">
            Leave
          </Link>
        </div>
      </header>

      <SignalLine pulse={pulse} seed={idx + 1} />

      <div className="beam" data-urgent={!result && beam < 0.25}>
        <i style={{ transform: `scaleX(${result ? 0 : beam})` }} />
      </div>

      <div className="flex flex-1 flex-col justify-center pb-10">

      <div className="mt-7 flex items-center gap-3 text-[0.8125rem]">
        <span className="text-[var(--accent)]">{question.categoryName}</span>
        <span className="h-3 w-px bg-[var(--color-edge)]" />
        <span className="truncate text-faint">{question.topic}</span>
        {question.sourceRef && (
          <>
            <span className="h-3 w-px bg-[var(--color-edge)]" />
            <span className="truncate text-faint">{question.sourceRef}</span>
          </>
        )}
        <DifficultyBars level={question.difficulty} />
      </div>

      <h1
        key={question.id}
        className="rise mt-3 max-w-[22ch] font-[family-name:var(--font-display)] text-[clamp(1.7rem,4.6vw,2.7rem)] font-semibold leading-[1.08] tracking-[-0.032em]"
      >
        {question.prompt}
      </h1>

      {question.kind === "mc" ? (
        <div className="mt-8 flex flex-col gap-2.5">
          {question.options.map((option, i) => (
            <button
              key={option}
              className="choice"
              disabled={Boolean(result)}
              data-state={
                !result ? undefined : i === result.answerIndex ? "right" : i === chosen ? "wrong" : "muted"
              }
              onClick={() => submit(i)}
            >
              <span className="choice-key">{i + 1}</span>
              <span>{option}</span>
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-8 flex gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) void send(typed.trim());
          }}
        >
          <input
            autoFocus
            value={typed}
            disabled={Boolean(result)}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Type your answer"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-[14px] border border-edge bg-white/[0.022] px-5 py-4 text-[1.0625rem] placeholder:text-faint disabled:opacity-60"
            data-state={result ? (result.correct ? "right" : "wrong") : undefined}
            style={
              result
                ? {
                    borderColor: result.correct ? "var(--color-true)" : "var(--color-false)",
                    backgroundColor: result.correct
                      ? "color-mix(in oklab, var(--color-true) 12%, transparent)"
                      : "color-mix(in oklab, var(--color-false) 10%, transparent)",
                  }
                : undefined
            }
          />
          {!result && (
            <button
              type="submit"
              className="rounded-[14px] bg-ink px-6 text-[0.95rem] font-medium text-void transition-transform hover:scale-[1.02]"
            >
              Answer
            </button>
          )}
        </form>
      )}

      {result && (
        <section className="panel rise mt-6 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className={`font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight ${result.correct ? "text-true" : "text-false"}`}>
              {result.correct ? "Right" : "Not this time"}
            </p>
            {result.points > 0 && <span className="flash text-sm tabular-nums text-[var(--accent)]">+{result.points}</span>}
          </div>
          {question.kind === "short" && !result.correct && (
            <p className="mt-2 text-[1.05rem] text-true">{result.answerText}</p>
          )}
          <p className="mt-2 max-w-[62ch] leading-relaxed text-dim">{result.explanation}</p>

          {deeper && (
            <div className="hairline mt-5 pt-5">
              <div className="flex items-center gap-3 text-[0.8125rem]">
                <span className="text-[var(--accent)]">Going deeper</span>
                <span className="h-3 w-px bg-[var(--color-edge)]" />
                <span className="text-faint">{deeper.level === 2 ? "understanding" : "application"}</span>
              </div>
              <h2 className="mt-2 max-w-[44ch] font-[family-name:var(--font-display)] text-[1.35rem] font-semibold leading-tight tracking-tight">
                {deeper.prompt}
              </h2>
              <div className="mt-4 flex flex-col gap-2">
                {deeper.options.map((option, i) => (
                  <button
                    key={option}
                    className="choice"
                    disabled={Boolean(deeperResult)}
                    data-state={
                      !deeperResult
                        ? undefined
                        : i === deeperResult.answerIndex
                          ? "right"
                          : i === deeperChoice
                            ? "wrong"
                            : "muted"
                    }
                    onClick={() => void submitDeeper(i)}
                  >
                    <span className="choice-key">{i + 1}</span>
                    <span>{option}</span>
                  </button>
                ))}
              </div>
              {deeperResult && <p className="mt-4 max-w-[62ch] leading-relaxed text-dim">{deeperResult.explanation}</p>}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => void (deeperResult?.hasNext ? openDeeper(deeper ? deeper.step + 1 : 0) : next())}
              className="rounded-full bg-ink px-5 py-2.5 text-[0.9rem] font-medium text-void transition-transform hover:scale-[1.02] active:scale-100"
            >
              {deeperResult?.hasNext ? "Keep going" : idx + 1 >= length ? "See the round" : "Next"}
            </button>
            {result.hasDeeper && !deeper && (
              <button
                onClick={() => void openDeeper(0)}
                className="rounded-full border border-edge px-5 py-2.5 text-[0.9rem] text-dim transition-colors hover:border-[var(--accent)] hover:text-ink"
              >
                Go deeper
              </button>
            )}
            <span className="ml-auto hidden items-center gap-3 text-[0.75rem] text-faint sm:flex">
              <span>{question.kind === "mc" ? "1–4 to answer" : "Type to answer"}</span>
              <span className="h-3 w-px bg-[var(--color-edge)]" />
              <span>Enter to continue</span>
              {result.hasDeeper && !deeper && (
                <>
                  <span className="h-3 w-px bg-[var(--color-edge)]" />
                  <span>D to go deeper</span>
                </>
              )}
            </span>
          </div>
        </section>
      )}
      </div>
    </Shell>
  );
}

function Shell({ hue, children }: { hue: number; children: React.ReactNode }) {
  return (
    <main
      style={tint(hue)}
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-16 sm:px-6"
    >
      <div className="tint-field" aria-hidden="true" />
      {children}
    </main>
  );
}

function SummaryView({
  summary,
  mode,
  category,
  sourceId,
  hue,
}: {
  summary: Summary;
  mode: Mode;
  category: CategoryId | null;
  sourceId: string | null;
  hue: number;
}) {
  const again = `/play?mode=${mode}${category ? `&category=${category}` : ""}${sourceId ? `&sourceId=${sourceId}` : ""}`;
  return (
    <Shell hue={hue}>
      <header className="flex items-center justify-between py-6">
        <Wordmark className="text-xl" />
        <Link href="/" className="text-[0.8125rem] text-faint transition-colors hover:text-ink">
          Home
        </Link>
      </header>

      <SignalLine seed={9} pulse={summary.accuracy >= 0.6 ? "right" : null} />

      <p className="mt-8 text-[0.8125rem] text-faint">Round complete</p>
      <h1 className="rise font-[family-name:var(--font-display)] text-[clamp(3.2rem,12vw,6rem)] font-semibold leading-[0.9] tracking-[-0.05em] tabular-nums">
        {summary.score}
      </h1>

      <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Metric value={`${summary.correct}/${summary.total}`} label="Correct" />
        <Metric value={`${Math.round(summary.accuracy * 100)}%`} label="Accuracy" />
        <Metric value={String(summary.bestStreak)} label="Best streak" />
        <Metric value={`${(summary.avgMs / 1000).toFixed(1)}s`} label="Average" />
      </div>

      <div className="panel mt-8 p-6">
        <div className="flex items-baseline justify-between">
          <p className="text-[0.8125rem] text-faint">Level {summary.level}</p>
          <p className="text-[0.8125rem] tabular-nums text-faint">{summary.xp} XP</p>
        </div>
        <div className="beam mt-3" style={{ height: 6 }}>
          <i style={{ transform: `scaleX(${summary.levelProgress})` }} />
        </div>
      </div>

      {summary.missed.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm text-faint">Worth another look</h2>
          <div className="flex flex-col gap-2.5">
            {summary.missed.map((m) => (
              <div key={m.id} className="panel p-5">
                <p className="font-[family-name:var(--font-display)] text-[1.05rem] font-medium leading-snug tracking-tight">
                  {m.prompt}
                </p>
                <p className="mt-2 text-[0.95rem] text-true">{m.answer}</p>
                <p className="mt-1.5 max-w-[62ch] text-[0.9rem] leading-relaxed text-faint">{m.explanation}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href={again} prefetch={false}
          className="rounded-full bg-ink px-6 py-3 text-[0.95rem] font-medium text-void transition-transform hover:scale-[1.02]"
        >
          Play again
        </Link>
        <Link
          href="/stats"
          className="rounded-full border border-edge px-5 py-3 text-[0.95rem] text-dim transition-colors hover:border-[var(--accent)] hover:text-ink"
        >
          Progress
        </Link>
      </div>
    </Shell>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-[0.8125rem] text-faint">{label}</div>
    </div>
  );
}
