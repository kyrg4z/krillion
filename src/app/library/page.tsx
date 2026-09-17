import Link from "next/link";
import { listSources } from "@/lib/sources";
import { aiConfig } from "@/lib/ai";
import Wordmark from "@/components/Wordmark";
import LibraryClient from "@/components/LibraryClient";

export const dynamic = "force-dynamic";

export default async function Library() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 sm:px-6">
      <header className="flex items-center justify-between py-7">
        <Link href="/">
          <Wordmark className="text-xl" />
        </Link>
        <Link href="/" className="text-[0.8125rem] text-faint transition-colors hover:text-ink">
          Home
        </Link>
      </header>

      <h1 className="font-[family-name:var(--font-display)] text-[clamp(2.2rem,5.5vw,3.2rem)] font-semibold leading-none tracking-[-0.04em]">
        Your material
      </h1>
      <p className="mt-3 max-w-[54ch] leading-relaxed text-dim">
        PDF, EPUB, Markdown, plain text or pasted notes. Each import is split into passages and turned into questions
        that keep their page or chapter reference.
      </p>

      <LibraryClient sources={await listSources()} ai={aiConfig()} />
    </main>
  );
}
