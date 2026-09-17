import Link from "next/link";
import { categoryStats, overview, topicStats, weakTopicAvailable } from "@/lib/stats";
import { listSources } from "@/lib/sources";
import Wordmark from "@/components/Wordmark";
import ProgressArc from "@/components/ProgressArc";
import SignalLine from "@/components/SignalLine";
import { tint } from "@/lib/tint";

export const dynamic = "force-dynamic";

export default async function Home() {
  const stats = overview();
  const categories = categoryStats();
  const weak = topicStats("weak", 3);
  const hasWeak = weakTopicAvailable();
  const sources = listSources();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between gap-4 py-7">
        <Wordmark className="text-[1.75rem]" />
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/library" className="rounded-full px-3 py-1.5 text-dim transition-colors hover:text-ink">
            Library
          </Link>
          <Link href="/stats" className="rounded-full px-3 py-1.5 text-dim transition-colors hover:text-ink">
            Progress
          </Link>
          <span className="ml-1 flex items-center gap-2 whitespace-nowrap rounded-full border border-edge px-3 py-1.5 text-dim">
            <ProgressArc value={stats.levelProgress} size={18} />
            <span className="tabular-nums">Level {stats.level}</span>
          </span>
        </nav>
      </header>

      <SignalLine seed={3} height={54} />

      <section className="panel mt-4 overflow-hidden rise">
        <div className="grid gap-8 p-7 sm:p-9 md:grid-cols-[1.4fr_1fr] md:items-end">
          <div>
            <p className="text-sm text-dim">
              {stats.dailyDoneToday
                ? "You have played today's round."
                : "Eight questions. One shot. Everyone gets the same set."}
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-[clamp(2.4rem,6vw,3.9rem)] font-semibold leading-[0.98] tracking-[-0.04em]">
              Today&rsquo;s round
            </h1>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href="/play?mode=daily" prefetch={false}
                className="rounded-full bg-ink px-6 py-3 text-[0.95rem] font-medium text-void transition-transform hover:scale-[1.02] active:scale-100"
              >
                {stats.dailyDoneToday ? "Play it again" : "Start"}
              </Link>
              <Link
                href="/play?mode=random" prefetch={false}
                className="rounded-full border border-edge px-5 py-3 text-[0.95rem] text-dim transition-colors hover:border-[var(--accent)] hover:text-ink"
              >
                Surprise me
              </Link>
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-5 text-sm md:border-l md:border-edge md:pl-8">
            <div>
              <dt className="text-faint">Day streak</dt>
              <dd className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
                {stats.dailyStreak}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Accuracy</dt>
              <dd className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
                {stats.answered ? `${Math.round(stats.accuracy * 100)}%` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Answered</dt>
              <dd className="mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums">
                {stats.answered}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="mt-3 grid gap-3 sm:grid-cols-3">
        <ModeCard
          href="/play?mode=mixed"
          title="Mixed"
          detail="Every subject, shuffled"
        />
        <ModeCard
          href={hasWeak ? "/play?mode=weak" : "/play?mode=mixed"}
          title="Weak spots"
          detail={
            hasWeak && weak.length
              ? weak.map((w) => w.topic).slice(0, 2).join(", ")
              : "Play a few rounds to unlock"
          }
          dimmed={!hasWeak}
        />
        <ModeCard
          href={sources.length ? `/play?mode=source&sourceId=${sources[0].id}` : "/library"}
          title={sources.length ? sources[0].title : "Your material"}
          detail={sources.length ? `${sources[0].questions} questions` : "Import a PDF, EPUB or notes"}
          dimmed={!sources.length}
        />
      </section>

      <h2 className="mt-12 mb-4 text-sm text-faint">Pick a subject</h2>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/play?mode=category&category=${c.id}`} prefetch={false}
            style={tint(c.hue)}
            className="panel group flex items-center justify-between gap-4 p-5 transition-colors hover:border-[var(--accent)]"
          >
            <div className="min-w-0">
              <div className="font-[family-name:var(--font-display)] text-[1.15rem] font-semibold tracking-tight">
                {c.name}
              </div>
              <div className="mt-1 flex items-center gap-2.5 text-[0.8125rem]">
                {c.answered ? (
                  <>
                    <span className="text-dim">{Math.round(c.accuracy * 100)}% right</span>
                    <span className="text-faint">
                      {c.seen} of {c.bankSize} seen
                    </span>
                  </>
                ) : (
                  <span className="text-faint">{c.bankSize} questions</span>
                )}
              </div>
            </div>
            <ProgressArc value={c.bankSize ? c.seen / c.bankSize : 0} />
          </Link>
        ))}
      </section>
    </main>
  );
}

function ModeCard({
  href,
  title,
  detail,
  dimmed = false,
}: {
  href: string;
  title: string;
  detail: string;
  dimmed?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`panel p-5 transition-colors hover:border-[var(--accent)] ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="font-[family-name:var(--font-display)] text-[1.05rem] font-semibold tracking-tight">{title}</div>
      <div className="mt-1 truncate text-[0.8125rem] text-faint">{detail}</div>
    </Link>
  );
}
