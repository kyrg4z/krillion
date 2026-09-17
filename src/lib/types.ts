export type CategoryId =
  | "physics"
  | "rf"
  | "compeng"
  | "economics"
  | "history"
  | "geography"
  | "general";

export type Mode = "daily" | "category" | "mixed" | "weak" | "source" | "random";

export type QuestionKind = "mc" | "short";

/** A follow-up that pushes one concept from recall toward application. */
export type DeeperStep = {
  level: 2 | 3;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type Question = {
  id: string;
  category: CategoryId;
  topic: string;
  difficulty: 1 | 2 | 3;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  /** mc: index into options. short: canonical answer text. */
  answer: number | string;
  aliases: string[];
  explanation: string;
  deeper: DeeperStep[];
  sourceId: string | null;
  sourceRef: string | null;
  origin: "seed" | "import" | "ai";
};

/** Authoring shape for the seed bank: terse on purpose. */
export type SeedQuestion = {
  id: string;
  topic: string;
  d: 1 | 2 | 3;
  q: string;
  /** First option is the correct one; the engine shuffles at serve time. */
  a: [string, string, string, string];
  why: string;
  deeper?: { level: 2 | 3; q: string; a: [string, string, string, string]; why: string }[];
};

export type ShortSeedQuestion = {
  id: string;
  topic: string;
  d: 1 | 2 | 3;
  q: string;
  answer: string;
  alias?: string[];
  why: string;
};

export type ServedQuestion = {
  id: string;
  category: CategoryId;
  categoryName: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  sourceRef: string | null;
  hasDeeper: boolean;
};

export type AnswerResult = {
  correct: boolean;
  answerIndex: number;
  answerText: string;
  explanation: string;
  points: number;
  streak: number;
  hasDeeper: boolean;
};
