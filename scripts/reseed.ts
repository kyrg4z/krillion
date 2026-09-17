/**
 * Rebuilds the local question bank from the authored seed files.
 * Progress, sessions and imported material are untouched.
 *
 *   node --experimental-strip-types scripts/reseed.ts
 */
import { ensureSeeded } from "../src/lib/seed-loader.ts";

const count = await ensureSeeded(true);
console.log(`Seed bank synced: ${count} questions.`);
