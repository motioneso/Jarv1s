### Task 9: Two-axis scoring — prompt and result validation (stage 3)

Fit and Want are two questions, and this is the task that keeps them two. The prompt copy is carried
verbatim below because it is the product's judgement, not an implementation detail.

**Depends on:** Task 5 (`Posting`, `SearchCriteria`). Task 15 calls it with `ctx.ai`.

**Files**

- Create: `external-modules/job-search/src/domain/score.ts`
- Test: `tests/unit/job-search-score.test.ts`

**Contracts**

```ts
export const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fit", "want", "fitReason", "wantReason"],
  properties: {
    fit: { type: "integer", minimum: 0, maximum: 100 },
    want: { type: "integer", minimum: 0, maximum: 100 },
    fitReason: { type: "string", minLength: 1, maxLength: 600 },
    wantReason: { type: "string", minLength: 1, maxLength: 600 }
  }
} as const; // JSON Schema handed to ctx.ai.generateStructured

export function buildScorePrompt(input: {
  posting: Posting;
  criteria: SearchCriteria;
  resume: string;
  /** Free-text profile context (goals, notes). Never credentials. */
  context: string;
}): string;

export interface ScoreResult {
  fit: number;
  want: number;
  fitReason: string;
  wantReason: string;
}
/** Throws on anything the model got wrong. Never coerces, never defaults —
 * a bad score must fail loudly rather than land on the board as a number. */
export function parseScoreResult(raw: unknown): ScoreResult;
```

The prompt, verbatim — sections joined with newlines, empty lines dropped:

```
Read one job posting against one person and answer two separate questions.

FIT (0-100): could this person do this job, and would this employer plausibly want them?
Judge evidence in the résumé against what the posting asks for.

WANT (0-100): would this person still want this job a year in?
Judge the shape of the work — team size, autonomy, domain, process, trajectory —
against what they have said they are looking for.

These are independent. A job can be a perfect fit and a bad want, or the reverse.
Do not average, combine, or blend them. Do not let one influence the other.
Give each a short, concrete reason naming specific evidence, not a restatement of the score.

--- POSTING ---
{title} at {company} — {location}
{body}

--- RÉSUMÉ ---
{resume}

--- WHAT THEY SAID THEY WANT ---
{criteria.wantNarrative}
Dealbreakers: {criteria.dealbreakers joined with "; "}   ← omitted entirely when empty

--- OTHER CONTEXT ---
{context}
```

**Constraints**

- **`additionalProperties: false` plus an explicit unknown-key rejection in `parseScoreResult`.** Two
  layers on purpose: the schema constrains the model, the parser constrains what becomes a row. A
  model that helpfully returns `overall` must fail, because a blended score is the one number this
  product must never show (L9).
- **Never coerce, never clamp, never default.** A clamped 140 → 100 is indistinguishable on the board
  from a score the model actually reasoned about, and the user has no way to tell which they are
  looking at. Out-of-range throws.
- **An empty reason is a failure, not a blank cell.** An unexplained number is not usable, and the
  board renders reasons beside every score.
- **The two axes are described as answering different questions** — "could they do it" versus "would
  they still want it a year in". Drop that framing and the model collapses them into one number
  expressed twice, which passes every schema check and fails the product.
- **`context` and `resume` are user content, never credentials** (secrets-never-escape). This prompt
  is the module's largest outbound payload; nothing from `auth` or module KV secrets may reach it.
- **The prompt is built from records, never from prior model prose** (L9). `wantNarrative` and
  `dealbreakers` are user-confirmed fields from Task 10, not a transcript.

**Tests**

`tests/unit/job-search-score.test.ts`:

1. **The schema has exactly the two axes and their reasons** — `Object.keys(properties).sort()`
   deep-equals `["fit", "fitReason", "want", "wantReason"]`. A fifth property fails here first.
2. **The schema refuses unknown properties** — `additionalProperties === false`, so a model cannot
   invent an overall score.
3. **A well-formed result round-trips** unchanged.
4. **A score outside 0..100 throws rather than clamping** — `fit: 140` throws
   `/fit must be an integer between 0 and 100/`. The assertion is on the throw; a clamping
   implementation returns 100 and passes any test that only checks the range of the output.
5. **A non-integer score throws** — `fit: 82.5`.
6. **An empty reason throws** — `fitReason: ""`.
7. **An extra blended field throws** — `overall: 87` throws `/unexpected field: overall/`. The parser
   half of constraint 1; the schema does not run in this test.
8. **The prompt asks for the two axes independently and forbids averaging.** Contains the posting
   title, the résumé text and the want narrative verbatim; matches `/do not (average|combine|blend)/i`;
   and contains `"a year in"` — the phrase that makes Want a different question from Fit. Asserting
   on that phrase is deliberate: a prompt that keeps the ban but loses the distinction still produces
   two identical numbers.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-score.test.ts   # exit 0
```

---
