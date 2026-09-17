import Link from "next/link";
import { activity, categoryStats, overview, recentSessions, topicStats } from "@/lib/stats";
import { categoryName } from "@/lib/categories";
import Wordmark from "@/components/Wordmark";
import Stat from "@/components/Stat";
import { tint } from "@/lib/tint";

export const dynamic = "force-dynamic";

const MODE_LABEL: Record<string, string> = {
  daily: "Daily",
  category: "Subject",
  mixed: "Mixed",
  weak: "Weak spots",
  source: "Your material",
  random: "Random",
};

export default async function Stats() {
  const stats = await overview();
  const categories = await categoryStats();
  const weak = await topicStats("weak", 6);
  const strong = await topicStats("strong", 4);
  const recent = await recentSessions(6);
  const days = await activity(28);
  const busiest = Math.max(1, ...days.map((d) => d.answered));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-7">
        <Link href="/">
          <Wordmark className="text-xl" />
        </Link>
        <Link href="/" className="text-[0.8125rem] text-faint transition-colors hover:text-ink">
          Home
        </Link>
      </header>

      <h1 className="font-[family-name:var(--font-display)] text-[clamp(2.2rem,5.5vw,3.2rem)] font-semibold leading-none tracking-[-0.04em]">
        Progress
      </h1>

      <section className="mt-9 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat value={String(stats.level)} label="Level" tone="accent" />
        <Stat value={stats.answered ? `${Math.round(stats.accuracy * 100)}%` : "—"} label="Accuracy" />
        <Stat value={stats.avgMs ? `${(stats.avgMs / 1000).toFixed(1)}s` : "—"} label="Average answer" />
        <Stat value={`${stats.questionsSeen}/${stats.questionsTotal}`} label="Bank seen" />
      </section>

      <section className="panel mt-8 p-6">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm text-faint">Last four weeks</h2>
          <span className="text-[0.8125rem] tabular-nums text-faint">{stats.answered} answered</span>
        </div>
        <div className="mt-5 flex h-20 items-end gap-[3px]">
          {days.map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${day.answered} answered`}
              className="flex-1 rounded-[2px] bg-[var(--accent)] transition-all"
              style={{
                height: `${Math.max(3, (day.answered / busiest) * 100)}%`,
                opacity: day.answered ? 0.35 + (day.answered / busiest) * 0.65 : 0.12,
              }}
            />
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-4 text-sm text-faint">By subject</h2>
        <div className="flex flex-col gap-3">
          {categories.map((c) => (
            <div key={c.id} style={tint(c.hue)} className="panel flex items-center gap-5 p-4 px-5">
              <div className="w-44 shrink-0 truncate font-[family-name:var(--font-display)] text-[1.05rem] font-medium tracking-tight">
                {c.name}
              </div>
              <div className="beam flex-1" style={{ height: 6 }}>
                <i style={{ transform: `scaleX(${c.answered ? c.accuracy : 0})` }} />
              </div>
              <div className="flex w-32 shrink-0 items-baseline justify-end gap-2 text-[0.8125rem] tabular-nums">
                {c.answered ? (
                  <>
                    <span className="text-dim">{Math.round(c.accuracy * 100)}%</span>
                    <span className="text-faint">of {c.answered}</span>
                  </>
                ) : (
                  <span className="text-faint">not played</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {weak.length > 0 && (
        <section className="mt-10 grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-sm text-faint">Needs work</h2>
              <Link href="/play?mode=weak" prefetch={false} className="text-[0.8125rem] text-[var(--accent)]">
                Train these
              </Link>
            </div>
            <ul className="flex flex-col gap-2">
              {weak.map((t) => (
                <li key={`${t.category}:${t.topic}`} className="panel flex items-center justify-between gap-3 p-4 px-5">
                  <div className="min-w-0">
                    <div className="truncate text-[0.95rem]">{t.topic}</div>
                    <div className="text-[0.75rem] text-faint">{categoryName(t.category)}</div>
                  </div>
                  <div className="shrink-0 text-[0.8125rem] tabular-nums text-false">{Math.round(t.accuracy * 100)}%</div>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-4 text-sm text-faint">Solid</h2>
            <ul className="flex flex-col gap-2">
              {strong.map((t) => (
                <li key={`${t.category}:${t.topic}`} className="panel flex items-center justify-between gap-3 p-4 px-5">
                  <div className="min-w-0">
                    <div className="truncate text-[0.95rem]">{t.topic}</div>
                    <div className="text-[0.75rem] text-faint">{categoryName(t.category)}</div>
                  </div>
                  <div className="shrink-0 text-[0.8125rem] tabular-nums text-true">{Math.round(t.accuracy * 100)}%</div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-sm text-faint">Recent rounds</h2>
          <div className="flex flex-col gap-2">
            {recent.map((s) => (
              <div key={s.id} className="panel flex items-center justify-between gap-4 p-4 px-5">
                <div className="min-w-0">
                  <div className="text-[0.95rem]">
                    {s.category ? categoryName(s.category) : MODE_LABEL[s.mode] ?? s.mode}
                  </div>
                  <div className="text-[0.75rem] text-faint">
                    {new Date(s.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {", "}
                    {(s.avgMs / 1000).toFixed(1)}s average
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums">{s.score}</div>
                  <div className="text-[0.75rem] tabular-nums text-faint">
                    {s.correct}/{s.total}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {stats.answered === 0 && (
        <p className="mt-12 text-dim">
          Nothing tracked yet.{" "}
          <Link href="/play?mode=mixed" prefetch={false} className="text-[var(--accent)]">
            Play a round
          </Link>{" "}
          and this fills in.
        </p>
      )}
    </main>
  );
}
