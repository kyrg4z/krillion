# Carrier

A fast knowledge game. A question appears, you have a few seconds, you answer, you find out why.
Physics, radio and RF, computer engineering, Grade 12 economics, history, geography and general knowledge —
plus anything you import yourself.

Rounds are short on purpose: 5–10 questions, answered on recall and understanding rather than arithmetic.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

The question bank loads itself into SQLite (`data/krillion.db`) the first time the app touches the database.
Nothing else is needed to play.

## Playing

| Mode | What it does |
| --- | --- |
| Daily | The same eight questions for the whole day |
| Subject | One category |
| Mixed | Everything, including your imported material |
| Weak spots | Whatever your accuracy says you are worst at |
| Your material | Questions built from a PDF, EPUB, Markdown, text file or pasted notes |
| Surprise me | Random pull from the bank |

Most questions are multiple choice; some ask you to type the answer, and those accept aliases, different
capitalisation and a typo or two before they mark you wrong. No model is involved in that judgement.

Keyboard: `1`–`4` to answer, `Enter` to continue, `D` to go deeper on a question that has a follow-up.

**Go deeper** takes one concept from recall to understanding to application without turning into a
calculation. It is available on questions that were authored with a follow-up chain.

## Difficulty

Difficulty means how hard the idea is to recall or see, never how long the arithmetic takes.

- *recall* — "Which planet is known as the Red Planet?"
- *understanding* — "A wave's speed stays fixed and its frequency increases. What happens to its wavelength?"
- *insight* — "Why does raising antenna gain not increase the power your transmitter puts out?"

## Your own material

Library → import a `.pdf`, `.epub`, `.md`, `.txt` or paste notes. The file is split into passages and turned
into questions locally, keeping the page or chapter reference so you can find the source again.

## AI

**The game never calls a model.** Question selection, scoring, timing, streaks, mastery and statistics are all
plain code against SQLite. The only place a model can be used at all is an optional extra pass over imported
documents, and it is off unless you turn it on:

```bash
AI_ENABLED=true
ANTHROPIC_API_KEY=sk-...
AI_MODEL=claude-sonnet-5
```

When enabled it batches several passages per request, never re-sends a passage it has already used, and stores
every question it produces so nothing is generated twice. Deleting the key or setting `AI_ENABLED=false`
removes the layer entirely; everything else keeps working.

`src/lib/ai/` holds the provider interface. Adding another provider means one file implementing `complete()`.

## Progress tracking

Every answer records whether it was right, how long it took, the difficulty and the topic. From that the app
keeps a per-topic mastery score and a lightweight review schedule, and uses both to bias later rounds toward
what you keep getting wrong.

## Layout

```
src/lib/questions/   the authored question bank, one file per category (plus short.ts for typed answers)
src/lib/grade.ts     answer matching: normalise, alias, then one typo per five characters
src/lib/engine.ts    round construction, scoring, streaks, mastery, spaced review
src/lib/stats.ts     progress read models
src/lib/extract.ts   PDF / EPUB / Markdown / text parsing
src/lib/generate-local.ts   deterministic question generation from imported text
src/lib/ai/          optional, disabled provider layer
src/app/             pages and API routes
```

## Editing the bank

Questions live in `src/lib/questions/*.ts`. The correct option is written first; the app shuffles it on load
and again per round. After editing, re-sync:

```bash
npm run seed
```
