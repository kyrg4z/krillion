/** Deterministic answer matching. No AI, no network — normalise, alias, then fuzz. */
export function normaliseAnswer(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/** True when a typed answer should be accepted. Tolerates one typo per five characters. */
export function answerMatches(given: string, canonical: string, aliases: string[] = []): boolean {
  const g = normaliseAnswer(given);
  if (!g) return false;
  for (const candidate of [canonical, ...aliases]) {
    const c = normaliseAnswer(candidate);
    if (!c) continue;
    if (g === c) return true;
    const budget = Math.floor(c.length / 5);
    if (budget > 0 && editDistance(g, c) <= budget) return true;
  }
  return false;
}
