import type { CategoryId, SeedQuestion } from "../types";
import { physics } from "./physics";
import { rf } from "./rf";
import { compeng } from "./compeng";
import { economics } from "./economics";
import { history } from "./history";
import { geography } from "./geography";
import { general } from "./general";
import { shortQuestions } from "./short";

/** Bump when the bank changes so the loader re-syncs. */
export const SEED_VERSION = "2";

export { shortQuestions };

export const SEED_BANK: Record<CategoryId, SeedQuestion[]> = {
  physics,
  rf,
  compeng,
  economics,
  history,
  geography,
  general,
};
