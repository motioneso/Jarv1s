// tests/unit/external-module-job-search-truth-guard.test.ts
//
// JS-03 (#932) Tasks 2-3: the resume truth guard and its confirmation
// records. Confirmations are the ONLY way an unquoted material claim may
// survive the guard, so their identity derivation and owner-namespace
// round-trip are security surface, not plumbing: a forged or colliding
// confirmation id would let unverified AI output become ground truth.
import { describe, expect, it } from "vitest";

import {
  CONFIRMATION_TEXT_MAX_CHARS,
  confirmationIdFor,
  listConfirmationIds,
  saveConfirmation,
  type ConfirmationRecord
} from "../../external-modules/job-search/src/domain/confirmations.js";
import { JobSearchKvError } from "../../external-modules/job-search/src/domain/errors.js";
import {
  CLAIM_QUOTE_MIN_CHARS,
  CRITIQUE_SCHEMA,
  extractMaterialSegments,
  parseCritique,
  verifyClaims,
  verifyMarkdownCoverage,
  type MaterialClaim
} from "../../external-modules/job-search/src/domain/truth-guard.js";
import { keys } from "../../external-modules/job-search/src/domain/keys.js";
import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";

const HEX_32 = /^[0-9a-f]{32}$/;

function record(overrides: Partial<ConfirmationRecord> = {}): ConfirmationRecord {
  const claimKind = overrides.claimKind ?? "employer";
  const claimText = overrides.claimText ?? "Worked at Acme Corp 2019-2023";
  return {
    schemaVersion: 1,
    confirmationId: confirmationIdFor(claimKind, claimText),
    claimKind,
    claimText,
    confirmedAt: "2026-07-11T00:00:00.000Z",
    ...overrides
  };
}

describe("confirmationIdFor", () => {
  it("is deterministic 32-hex for the same kind + text", () => {
    const a = confirmationIdFor("employer", "Acme");
    const b = confirmationIdFor("employer", "Acme");
    expect(a).toMatch(HEX_32);
    expect(a).toBe(b);
  });

  it("differs across claim kinds for the same text", () => {
    expect(confirmationIdFor("employer", "Acme")).not.toBe(confirmationIdFor("role", "Acme"));
  });

  it("differs across texts for the same kind", () => {
    expect(confirmationIdFor("skill", "TypeScript")).not.toBe(confirmationIdFor("skill", "Rust"));
  });
});

describe("saveConfirmation / listConfirmationIds", () => {
  it("round-trips under confirmation/<id> in the resume namespace", async () => {
    const kv = createMemoryKv();
    const rec = record();
    await saveConfirmation(kv, rec);
    const stored = kv.dump().get(`${NS.resume} ${keys.resumeConfirmation(rec.confirmationId)}`);
    expect(stored).toEqual(rec);
  });

  it("re-saving the same confirmation is idempotent", async () => {
    const kv = createMemoryKv();
    const rec = record();
    await saveConfirmation(kv, rec);
    await saveConfirmation(kv, rec);
    expect(kv.dump().size).toBe(1);
    const ids = await listConfirmationIds(kv);
    expect([...ids]).toEqual([rec.confirmationId]);
  });

  it("rejects claimText over the cap naming the cap, never the text", async () => {
    const kv = createMemoryKv();
    const longText = "x".repeat(CONFIRMATION_TEXT_MAX_CHARS + 1);
    const rec = record({
      claimText: longText,
      confirmationId: confirmationIdFor("employer", longText)
    });
    let error: unknown = null;
    try {
      await saveConfirmation(kv, rec);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
    expect((error as JobSearchKvError).message).toContain("500");
    expect((error as JobSearchKvError).message).not.toContain("x".repeat(20));
    expect(kv.dump().size).toBe(0);
  });

  it("rejects a confirmationId that does not match the (kind, text) derivation", async () => {
    // A caller-supplied id must not be able to alias a different claim —
    // the id IS the claim identity the truth guard checks against.
    const kv = createMemoryKv();
    const rec = record({ confirmationId: confirmationIdFor("employer", "Different Claim") });
    let error: unknown = null;
    try {
      await saveConfirmation(kv, rec);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(JobSearchKvError);
    expect((error as JobSearchKvError).code).toBe("invalid_record");
    expect(kv.dump().size).toBe(0);
  });

  it("lists confirmation ids only, ignoring revision/* keys in the namespace", async () => {
    const kv = createMemoryKv();
    const a = record();
    const b = record({
      claimKind: "metric",
      claimText: "Cut latency 40%",
      confirmationId: confirmationIdFor("metric", "Cut latency 40%")
    });
    await saveConfirmation(kv, a);
    await saveConfirmation(kv, b);
    await kv.set(NS.resume, "revision/0", { schemaVersion: 1, kind: "original" });
    const ids = await listConfirmationIds(kv);
    expect(ids.size).toBe(2);
    expect(ids.has(a.confirmationId)).toBe(true);
    expect(ids.has(b.confirmationId)).toBe(true);
  });

  it("returns an empty set on a fresh namespace", async () => {
    const kv = createMemoryKv();
    const ids = await listConfirmationIds(kv);
    expect(ids.size).toBe(0);
  });
});

const SOURCES = [
  { revisionId: "0", content: "Senior Engineer at Acme Corp\nLed migration to TypeScript" },
  { revisionId: "rev-b", content: "Cut deploy time by 40% at Beta LLC" }
] as const;

function claim(overrides: Partial<MaterialClaim> = {}): MaterialClaim {
  return { kind: "employer", text: "Worked at Acme Corp", ...overrides };
}

describe("verifyClaims", () => {
  it("marks a claim sourced when its quote is an exact substring of a source", () => {
    const verdict = verifyClaims({
      claims: [claim({ quote: "Senior Engineer at Acme Corp" })],
      sources: SOURCES,
      confirmationIds: new Set()
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.unsupported).toEqual([]);
    expect(verdict.evidence).toEqual([
      {
        claimKind: "employer",
        claimText: "Worked at Acme Corp",
        status: "sourced",
        sourceRevisionId: "0",
        quote: "Senior Engineer at Acme Corp"
      }
    ]);
  });

  it("attributes the quote to the first source containing it", () => {
    const verdict = verifyClaims({
      claims: [
        claim({ kind: "metric", text: "40% faster deploys", quote: "Cut deploy time by 40%" })
      ],
      sources: SOURCES,
      confirmationIds: new Set()
    });
    // The quote only appears in rev-b.
    expect(verdict.evidence[0]?.sourceRevisionId).toBe("rev-b");
  });

  it("rejects a quote under CLAIM_QUOTE_MIN_CHARS even when it IS a source substring", () => {
    // QA RED B1 fold-in (PR #956 issuecomment-4945986416 + issuecomment-4946000922):
    // a trivial token like "Acme Corp" (9 chars) must not source a whole claim.
    const short = claim({ quote: "Acme Corp" });
    const verdict = verifyClaims({
      claims: [short],
      sources: SOURCES,
      confirmationIds: new Set()
    });
    expect(CLAIM_QUOTE_MIN_CHARS).toBe(12);
    expect(verdict.ok).toBe(false);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.unsupported).toEqual([short]);
  });

  it("treats a quote that matches no source as unsupported — quotes are not testimony", () => {
    const bad = claim({ quote: "Principal Engineer at Acme Corp" });
    const verdict = verifyClaims({
      claims: [bad],
      sources: SOURCES,
      confirmationIds: new Set()
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.unsupported).toEqual([bad]);
  });

  it("accepts an unquoted claim carrying a recorded confirmation", () => {
    const c = claim({ kind: "credential", text: "AWS Certified", quote: undefined });
    const verdict = verifyClaims({
      claims: [c],
      sources: SOURCES,
      confirmationIds: new Set([confirmationIdFor("credential", "AWS Certified")])
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.evidence).toEqual([
      {
        claimKind: "credential",
        claimText: "AWS Certified",
        status: "confirmed",
        confirmationId: confirmationIdFor("credential", "AWS Certified")
      }
    ]);
  });

  it("a confirmation for a different kind does not vouch for the claim", () => {
    const c = claim({ kind: "credential", text: "AWS Certified", quote: undefined });
    const verdict = verifyClaims({
      claims: [c],
      sources: SOURCES,
      confirmationIds: new Set([confirmationIdFor("skill", "AWS Certified")])
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toEqual([c]);
  });

  it("rejects a claim with neither quote nor confirmation", () => {
    const c = claim({ quote: undefined });
    const verdict = verifyClaims({ claims: [c], sources: SOURCES, confirmationIds: new Set() });
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toEqual([c]);
  });

  it("ok requires every claim supported (mixed input fails)", () => {
    const good = claim({ quote: "Led migration to TypeScript", kind: "skill", text: "TypeScript" });
    const bad = claim({ kind: "outcome", text: "Doubled revenue", quote: undefined });
    const verdict = verifyClaims({
      claims: [good, bad],
      sources: SOURCES,
      confirmationIds: new Set()
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.evidence).toHaveLength(1);
    expect(verdict.unsupported).toEqual([bad]);
  });

  it("treats a critique with more than 64 claims as wholly unsupported", () => {
    const claims = Array.from({ length: 65 }, (_, i) =>
      claim({ text: `Claim ${i}`, quote: "Senior Engineer at Acme Corp" })
    );
    const verdict = verifyClaims({ claims, sources: SOURCES, confirmationIds: new Set() });
    expect(verdict.ok).toBe(false);
    expect(verdict.evidence).toEqual([]);
    expect(verdict.unsupported).toHaveLength(65);
  });

  it("rejects oversize quote (>200 chars) and oversize text (>500 chars) per claim", () => {
    const longQuote = claim({ quote: "q".repeat(201) });
    const longText = claim({
      text: "t".repeat(501),
      quote: "Senior Engineer at Acme Corp"
    });
    const verdict = verifyClaims({
      claims: [longQuote, longText],
      sources: [{ revisionId: "0", content: "q".repeat(300) }],
      confirmationIds: new Set()
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unsupported).toEqual([longQuote, longText]);
  });

  it("empty claim list is trivially ok", () => {
    const verdict = verifyClaims({ claims: [], sources: SOURCES, confirmationIds: new Set() });
    expect(verdict).toEqual({ ok: true, evidence: [], unsupported: [] });
  });
});

describe("parseCritique", () => {
  const valid = {
    critiqueSummary: "Tightened impact bullets.",
    proposedMarkdown: "# Resume\nSenior Engineer at Acme Corp",
    materialClaims: [{ kind: "employer", text: "Acme Corp", quote: "Acme Corp" }]
  };

  it("accepts a well-formed critique object", () => {
    expect(parseCritique(valid)).toEqual(valid);
  });

  it("accepts claims without a quote", () => {
    const input = {
      ...valid,
      materialClaims: [{ kind: "skill", text: "TypeScript" }]
    };
    expect(parseCritique(input)).toEqual(input);
  });

  it("rejects non-objects and null", () => {
    expect(parseCritique(null)).toBeNull();
    expect(parseCritique("text")).toBeNull();
    expect(parseCritique([valid])).toBeNull();
  });

  it("rejects missing or wrong-typed fields", () => {
    expect(parseCritique({ ...valid, critiqueSummary: 7 })).toBeNull();
    expect(parseCritique({ ...valid, proposedMarkdown: undefined })).toBeNull();
    expect(parseCritique({ ...valid, materialClaims: "none" })).toBeNull();
  });

  it("rejects extra keys at both levels", () => {
    expect(parseCritique({ ...valid, extra: true })).toBeNull();
    expect(
      parseCritique({
        ...valid,
        materialClaims: [{ kind: "employer", text: "Acme", note: "hi" }]
      })
    ).toBeNull();
  });

  it("rejects unknown claim kinds", () => {
    expect(
      parseCritique({ ...valid, materialClaims: [{ kind: "salary", text: "100k" }] })
    ).toBeNull();
  });

  it("rejects critiqueSummary over 2000 chars and more than 64 claims", () => {
    expect(parseCritique({ ...valid, critiqueSummary: "s".repeat(2001) })).toBeNull();
    expect(
      parseCritique({
        ...valid,
        materialClaims: Array.from({ length: 65 }, (_, i) => ({ kind: "skill", text: `s${i}` }))
      })
    ).toBeNull();
  });

  it("CRITIQUE_SCHEMA mirrors the parser: closed objects, seven-kind enum, caps", () => {
    // Structural view of exactly the paths this test asserts — no `any`.
    const schema = CRITIQUE_SCHEMA as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        critiqueSummary: { maxLength: number };
        materialClaims: {
          maxItems: number;
          items: {
            additionalProperties: boolean;
            properties: {
              kind: { enum: string[] };
              text: { maxLength: number };
              quote: { maxLength: number };
            };
          };
        };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["critiqueSummary", "proposedMarkdown", "materialClaims"]);
    expect(schema.properties.critiqueSummary.maxLength).toBe(2000);
    expect(schema.properties.materialClaims.maxItems).toBe(64);
    const claimSchema = schema.properties.materialClaims.items;
    expect(claimSchema.additionalProperties).toBe(false);
    expect(claimSchema.properties.kind.enum).toEqual([
      "employer",
      "role",
      "date",
      "skill",
      "credential",
      "metric",
      "outcome"
    ]);
    expect(claimSchema.properties.text.maxLength).toBe(500);
    expect(claimSchema.properties.quote.maxLength).toBe(200);
    // Forbidden structured-AI keywords must not appear anywhere in the schema.
    expect(JSON.stringify(schema)).not.toMatch(/\$ref|"pattern"/);
  });
});

// QA RED B1 fix cycle 2 (PR #956, Codex issuecomment-4946275153 + Opus
// issuecomment-4946268694): the cycle-1 token guard keyed on caps/digits, so
// all-lowercase spelled-number fabrications emitted ZERO spans and passed
// vacuously; separate corpus tokens also vouched for recombined relationships.
// The segment-phrase guard verifies each proposed line/sentence as a
// normalized contiguous phrase against ONE corpus segment, and rejects
// content-free markdown outright.
describe("extractMaterialSegments", () => {
  it("strips markdown syntax and yields raw text plus a normalized phrase", () => {
    expect(extractMaterialSegments("## **Improved** _delivery_ cadence")).toEqual([
      { raw: "Improved delivery cadence", phrase: "improved delivery cadence" }
    ]);
    expect(extractMaterialSegments("- Led migration at Initech")).toEqual([
      { raw: "Led migration at Initech", phrase: "led migration at initech" }
    ]);
  });

  it("splits on sentence punctuation but never on commas", () => {
    expect(
      extractMaterialSegments("Shipped v2. Cut costs; won award").map((s) => s.phrase)
    ).toEqual(["shipped v2", "cut costs", "won award"]);
    expect(extractMaterialSegments("Led migration, then shipped platform")).toEqual([
      { raw: "Led migration, then shipped platform", phrase: "led migration then shipped platform" }
    ]);
  });

  it("tokenizes non-ASCII letters instead of stripping them (École)", () => {
    expect(extractMaterialSegments("Studied at École Polytechnique")).toEqual([
      { raw: "Studied at École Polytechnique", phrase: "studied at école polytechnique" }
    ]);
  });

  it("yields nothing for blank or punctuation-only markdown", () => {
    expect(extractMaterialSegments("")).toEqual([]);
    expect(extractMaterialSegments("   \n \n")).toEqual([]);
    expect(extractMaterialSegments("---")).toEqual([]);
  });
});

describe("verifyMarkdownCoverage", () => {
  it("passes when every proposed segment is a contiguous sub-phrase of one corpus segment", () => {
    const verdict = verifyMarkdownCoverage({
      markdown: "Senior Engineer at Acme Corp\nCut deploy time by 40%",
      sources: SOURCES,
      confirmedTexts: []
    });
    expect(verdict).toEqual({ ok: true, unverifiedSpans: [] });
  });

  it("DEFEAT 1: all-lowercase spelled-out fabrication fails closed (Codex PoC)", () => {
    // Cycle-1 guard extracted zero caps/digit spans from this text → vacuous
    // pass → fabricated résumé persisted. Now every segment needs coverage.
    const verdict = verifyMarkdownCoverage({
      markdown:
        "vice president at initech from twenty twenty to twenty twenty four\nincreased revenue by tenfold",
      sources: SOURCES,
      confirmedTexts: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unverifiedSpans).toEqual([
      "vice president at initech from twenty twenty to twenty twenty four",
      "increased revenue by tenfold"
    ]);
  });

  it("DEFEAT 3: recombining tokens across corpus segments fails", () => {
    // Every token exists somewhere in SOURCES ("Senior Engineer at" in rev 0,
    // "Beta LLC" in rev-b) but the asserted relationship never appears
    // contiguously inside ONE corpus segment.
    const verdict = verifyMarkdownCoverage({
      markdown: "Senior Engineer at Beta LLC",
      sources: SOURCES,
      confirmedTexts: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unverifiedSpans).toEqual(["Senior Engineer at Beta LLC"]);
  });

  it("DEFEAT 2: empty, whitespace-only, or content-free markdown is rejected outright", () => {
    for (const markdown of ["", "   \n \n", "---"]) {
      expect(verifyMarkdownCoverage({ markdown, sources: SOURCES, confirmedTexts: [] })).toEqual({
        ok: false,
        unverifiedSpans: []
      });
    }
  });

  it("DEFEAT 4: word-per-line fragment decomposition fails at the singleton tier (Opus PoC)", () => {
    // Cycle-2 guard verified presence, not adjacency: splitting a fabricated
    // relationship into one-token lines let each token sub-match some larger
    // true segment ("Senior"/"Engineer"/"at" inside rev 0, "Beta"/"LLC"
    // inside rev-b) → ok:true. A single-token proposed segment now passes
    // ONLY by full equality with a whole corpus segment, never by
    // sub-containment (fix cycle 3, Opus issuecomment-4946829260).
    const verdict = verifyMarkdownCoverage({
      markdown: "Senior\nEngineer\nat\nBeta\nLLC",
      sources: SOURCES,
      confirmedTexts: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unverifiedSpans).toEqual(["Senior", "Engineer", "at", "Beta", "LLC"]);
  });

  it("DEFEAT 5: cross-context line recombination fails at the singleton tier (Codex PoC)", () => {
    // Each line is individually true in a DIFFERENT source context; stacked,
    // they assert a fabricated "Vice President at Initech 2020-2024". The
    // multi-token lines legitimately match their own source segments — the
    // interior singleton "Initech" is what must fail: it appears inside a
    // larger true segment but IS not a whole segment itself.
    const verdict = verifyMarkdownCoverage({
      markdown: "Vice President\nInitech\n2020-2024",
      sources: [
        { revisionId: "0", content: "Vice President of Sales at Globex" },
        { revisionId: "1", content: "Led work at Initech before that" },
        { revisionId: "2", content: "Stayed at Globex 2020-2024" }
      ],
      confirmedTexts: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unverifiedSpans).toEqual(["Initech"]);
  });

  it("GUARD-RAIL: a single-token line that IS a whole source segment still passes", () => {
    // The singleton tier must not over-block real content: a lone skill
    // that is a standalone source bullet is a whole corpus segment.
    const verdict = verifyMarkdownCoverage({
      markdown: "- TypeScript",
      sources: [{ revisionId: "0", content: "Skills\n- TypeScript\n- Kubernetes" }],
      confirmedTexts: []
    });
    expect(verdict).toEqual({ ok: true, unverifiedSpans: [] });
  });

  it("GUARD-RAIL: a genuine contiguous reorder of real source segments still passes", () => {
    const verdict = verifyMarkdownCoverage({
      markdown: "Led migration to TypeScript\nSenior Engineer at Acme Corp",
      sources: SOURCES,
      confirmedTexts: []
    });
    expect(verdict).toEqual({ ok: true, unverifiedSpans: [] });
  });

  it("a first-token proper noun no longer dodges the guard", () => {
    // Cycle-1 heuristic skipped the first word of each segment.
    const verdict = verifyMarkdownCoverage({
      markdown: "Initech promoted me twice",
      sources: SOURCES,
      confirmedTexts: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unverifiedSpans).toEqual(["Initech promoted me twice"]);
  });

  it("non-ASCII proper nouns participate in matching (École)", () => {
    const source = [{ revisionId: "0", content: "Studied at École Polytechnique" }];
    expect(
      verifyMarkdownCoverage({
        markdown: "Studied at École Polytechnique",
        sources: source,
        confirmedTexts: []
      })
    ).toEqual({ ok: true, unverifiedSpans: [] });
    expect(
      verifyMarkdownCoverage({
        markdown: "Studied at École Polytechnique",
        sources: SOURCES,
        confirmedTexts: []
      }).ok
    ).toBe(false);
  });

  it("matches whole words only — a token substring never vouches", () => {
    const verdict = verifyMarkdownCoverage({
      markdown: "Ace",
      sources: [{ revisionId: "0", content: "Acme Corp" }],
      confirmedTexts: []
    });
    expect(verdict.ok).toBe(false);
  });

  it("a confirmed claim text vouches only for contiguous phrases inside it", () => {
    const confirmed = ["Certified Kubernetes Administrator since 2021"];
    expect(
      verifyMarkdownCoverage({
        markdown: "Certified Kubernetes Administrator since 2021",
        sources: [],
        confirmedTexts: confirmed
      })
    ).toEqual({ ok: true, unverifiedSpans: [] });
    // Same tokens with the connective dropped — no longer contiguous, fails.
    expect(
      verifyMarkdownCoverage({
        markdown: "Certified Kubernetes Administrator 2021",
        sources: [],
        confirmedTexts: confirmed
      }).ok
    ).toBe(false);
  });

  it("deduplicates repeated unverified segments in the echo", () => {
    const verdict = verifyMarkdownCoverage({
      markdown: "Initech\nInitech",
      sources: [],
      confirmedTexts: []
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.unverifiedSpans).toEqual(["Initech"]);
  });

  it("caps echoed spans at 64 and truncates each to 200 chars without flipping the verdict", () => {
    const many = Array.from({ length: 70 }, (_, i) => `fabricated item ${String(i)}`).join("\n");
    const capped = verifyMarkdownCoverage({ markdown: many, sources: [], confirmedTexts: [] });
    expect(capped.ok).toBe(false);
    expect(capped.unverifiedSpans).toHaveLength(64);

    const long = `Initech ${"x".repeat(300)}`;
    const truncated = verifyMarkdownCoverage({ markdown: long, sources: [], confirmedTexts: [] });
    expect(truncated.ok).toBe(false);
    expect(truncated.unverifiedSpans[0]).toHaveLength(200);
  });

  it("BYPASS: AI-declared claim text does NOT whitelist markdown segments", () => {
    // The coverage corpus is sources + USER-confirmed texts only. If AI claim
    // texts vouched, the AI could attach a legitimate quote to a claim whose
    // `text` smuggles fabricated content and whitelist it — the exact bypass
    // the QA council flagged (issuecomment-4945986416, issuecomment-4946000922).
    const smuggler: MaterialClaim = {
      kind: "metric",
      text: "Led work at Initech",
      quote: "Cut deploy time by 40%"
    };
    const claimVerdict = verifyClaims({
      claims: [smuggler],
      sources: SOURCES,
      confirmationIds: new Set()
    });
    expect(claimVerdict.ok).toBe(true); // the self-reported claim is "sourced"…
    const coverage = verifyMarkdownCoverage({
      markdown: "Led work at Initech",
      sources: SOURCES,
      confirmedTexts: [] // …but its text never enters the coverage corpus
    });
    expect(coverage.ok).toBe(false);
    expect(coverage.unverifiedSpans).toEqual(["Led work at Initech"]);
  });
});
