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
  CRITIQUE_SCHEMA,
  parseCritique,
  verifyClaims,
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
      claims: [claim({ kind: "metric", text: "40% faster deploys", quote: "40%" })],
      sources: SOURCES,
      confirmationIds: new Set()
    });
    // "40%" only appears in rev-b.
    expect(verdict.evidence[0]?.sourceRevisionId).toBe("rev-b");
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
    const schema = CRITIQUE_SCHEMA as Record<string, any>;
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
