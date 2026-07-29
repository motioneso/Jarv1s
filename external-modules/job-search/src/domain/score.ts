// external-modules/job-search/src/domain/score.ts
//
// Task 9 (#1293): two-axis scoring — prompt and result validation (stage 3).
//
// Fit and Want are two independent questions, never one number. "Could this person do this
// job" (Fit) and "would they still want it a year in" (Want) are judged separately, and there
// is no combined/overall/total/average/blended score anywhere below — not a field, not a
// helper, not a sort key. L9 is the reason this file exists in the shape it does.
//
// This is pure domain code: no SDK imports, no network, no database access. Task 15 is the
// caller that owns `ctx.ai` and wires `buildScorePrompt`/`SCORE_SCHEMA`/`parseScoreResult`
// together; this file only defines the shapes and the validation, never reaches for a model.
import type { Posting, SearchCriteria } from "./records.js";

/** JSON Schema handed to `ctx.ai.generateStructured`. `additionalProperties: false` is the
 * first of two layers that keep a blended score out of the system — the schema constrains
 * what the model can return; `parseScoreResult` below is the second layer, constraining what
 * becomes a row even if a model or a schema regression lets something extra through. */
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
} as const;

export interface ScoreResult {
  fit: number;
  want: number;
  fitReason: string;
  wantReason: string;
}

const ALLOWED_FIELDS = new Set<string>(["fit", "want", "fitReason", "wantReason"]);

/**
 * Builds the scoring prompt as one line-per-instruction template, joined with newlines with
 * every empty line dropped. The blank lines in the product copy below are spacer lines in the
 * source, not literal output — dropping them keeps the assembled prompt free of incidental
 * double-spacing and, as a side effect, silently omits any dynamic line that happens to render
 * empty (an empty posting body, an empty context string). `Dealbreakers:` is the one line that
 * would NOT come out empty on its own (it always has the label text), so it gets its own
 * explicit omit-when-empty check below rather than relying on the generic blank-line drop.
 */
export function buildScorePrompt(input: {
  posting: Posting;
  criteria: SearchCriteria;
  resume: string;
  /** Free-text profile context (goals, notes). Never credentials. */
  context: string;
}): string {
  const { posting, criteria, resume, context } = input;

  const dealbreakersLine =
    criteria.dealbreakers.length > 0 ? `Dealbreakers: ${criteria.dealbreakers.join("; ")}` : "";

  const lines = [
    "Read one job posting against one person and answer two separate questions.",
    "",
    "FIT (0-100): could this person do this job, and would this employer plausibly want them?",
    "Judge evidence in the résumé against what the posting asks for.",
    "",
    "WANT (0-100): would this person still want this job a year in?",
    "Judge the shape of the work — team size, autonomy, domain, process, trajectory —",
    "against what they have said they are looking for.",
    "",
    "These are independent. A job can be a perfect fit and a bad want, or the reverse.",
    "Do not average, combine, or blend them. Do not let one influence the other.",
    "Give each a short, concrete reason naming specific evidence, not a restatement of the score.",
    "",
    "--- POSTING ---",
    `${posting.title} at ${posting.company} — ${posting.location}`,
    posting.body,
    "",
    "--- RÉSUMÉ ---",
    // An empty résumé is an ordinary state, not a broken one — nothing gates the crawl on
    // having uploaded one. It has to be *said*, though. The generic blank-line drop below used
    // to delete the résumé line silently, leaving the model a heading with nothing under it and
    // the next heading straight after; it filled the gap by guessing. A live board came back
    // with four Fit reasons all reading "the résumé is entirely blank" beside the scores 5, 40,
    // 72 and 78 — the same non-evidence producing wildly different numbers, presented to the
    // user exactly like scores that were actually reasoned about. Naming the absence and fixing
    // the response makes the number mean one thing: nothing is known yet.
    resume.trim().length > 0 ? resume : "(none on file — this person has not added a résumé yet)",
    resume.trim().length > 0
      ? ""
      : "With no résumé, Fit is not knowable. The number you return for `fit` is thrown away " +
        "before anything is stored — the board shows an em dash, not a score — so return 0 as a " +
        "formality and say nothing about it. Write `fitReason` as a plain statement that there " +
        "is no résumé on file yet and that Fit will mean something once one is added: no score, " +
        "no number, no zero, no talk of placeholders, because the reader never sees a number " +
        "here to explain. Do not infer Fit from the title, the location, or the Want answer. " +
        "Score Want normally.",
    "",
    "--- WHAT THEY SAID THEY WANT ---",
    criteria.wantNarrative,
    dealbreakersLine,
    "",
    "--- OTHER CONTEXT ---",
    context
  ];

  return lines.filter((line) => line !== "").join("\n");
}

/**
 * Throws on anything the model got wrong. Never coerces, never clamps, never defaults — a
 * clamped 140 -> 100 is indistinguishable on the board from a score the model actually reasoned
 * about, and the user has no way to tell which they are looking at looking only at the number.
 * An out-of-range or non-integer score throws; an empty reason throws; an extra field —
 * `overall` most of all — throws. A bad score fails loudly instead of landing on the board.
 */
export function parseScoreResult(raw: unknown): ScoreResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("score result must be an object");
  }

  const record = raw as Record<string, unknown>;

  // Unknown-field rejection runs before any axis is validated: a model that helpfully adds
  // `overall` alongside two otherwise-valid axes must still fail, because a blended score is
  // the one number this product must never show (L9), however it arrives.
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw new Error(`unexpected field: ${key}`);
    }
  }

  return {
    fit: parseAxis(record.fit, "fit"),
    want: parseAxis(record.want, "want"),
    fitReason: parseReason(record.fitReason, "fitReason"),
    wantReason: parseReason(record.wantReason, "wantReason")
  };
}

function parseAxis(value: unknown, name: "fit" | "want"): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be an integer between 0 and 100`);
  }
  return value;
}

function parseReason(value: unknown, name: "fitReason" | "wantReason"): string {
  // An empty reason is a failure, not a blank cell: the board renders a reason beside every
  // score, and an unexplained number is not usable.
  if (typeof value !== "string" || value.length < 1 || value.length > 600) {
    throw new Error(`${name} must be a non-empty string of at most 600 characters`);
  }
  return value;
}
