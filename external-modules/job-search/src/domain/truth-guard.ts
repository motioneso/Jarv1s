// external-modules/job-search/src/domain/truth-guard.ts
//
// JS-03 (#932): the resume truth guard. A "material claim" is any factual
// assertion an AI critique makes about the user (employer, role, dates,
// skills, credentials, metrics, outcomes). The guard's contract: every
// material claim in an AI revision must carry an exact quote from a stored
// source revision OR reference a recorded user confirmation — anything else
// is returned to the user as a question and never persisted. Pure module:
// no kv access; callers load sources + confirmation ids and pass them in.
import { confirmationIdFor } from "./confirmations.js";

export type MaterialClaimKind =
  | "employer"
  | "role"
  | "date"
  | "skill"
  | "credential"
  | "metric"
  | "outcome";

export interface MaterialClaim {
  readonly kind: MaterialClaimKind;
  /** The claim as asserted, ≤ 500 chars (CONFIRMATION_TEXT_MAX_CHARS). */
  readonly text: string;
  /** Exact substring of a source revision backing the claim, ≤ 200 chars. */
  readonly quote?: string;
}

/** Provenance attached to a persisted AI revision for each material claim. */
export interface ResumeEvidence {
  readonly claimKind: MaterialClaimKind;
  readonly claimText: string;
  readonly status: "sourced" | "confirmed";
  readonly sourceRevisionId?: string;
  readonly quote?: string;
  readonly confirmationId?: string;
}

export interface TruthGuardVerdict {
  readonly ok: boolean;
  readonly evidence: readonly ResumeEvidence[];
  readonly unsupported: readonly MaterialClaim[];
}

// Exported so tool-input validation names the same seven kinds the guard
// enforces — a drift here would let a claim kind bypass verification.
export const MATERIAL_CLAIM_KINDS: readonly MaterialClaimKind[] = [
  "employer",
  "role",
  "date",
  "skill",
  "credential",
  "metric",
  "outcome"
];

export const CLAIM_TEXT_MAX_CHARS = 500;
export const CLAIM_QUOTE_MAX_CHARS = 200;
// Caps the per-revision evidence blob so it can't blow the 65_535-byte KV
// record cap sitting alongside up to 48 KB of resume content.
export const MATERIAL_CLAIMS_MAX = 64;
export const CRITIQUE_SUMMARY_MAX_CHARS = 2000;

// JSON Schema handed to the structured-AI seam. Mirrors parseCritique
// exactly; stays clear of the seam's forbidden keywords ($ref, pattern, …).
export const CRITIQUE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["critiqueSummary", "proposedMarkdown", "materialClaims"],
  properties: {
    critiqueSummary: { type: "string", maxLength: CRITIQUE_SUMMARY_MAX_CHARS },
    proposedMarkdown: { type: "string", maxLength: 49_152 },
    materialClaims: {
      type: "array",
      maxItems: MATERIAL_CLAIMS_MAX,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "text"],
        properties: {
          kind: { type: "string", enum: [...MATERIAL_CLAIM_KINDS] },
          text: { type: "string", maxLength: CLAIM_TEXT_MAX_CHARS },
          quote: { type: "string", maxLength: CLAIM_QUOTE_MAX_CHARS }
        }
      }
    }
  }
};

export interface ParsedCritique {
  readonly critiqueSummary: string;
  readonly proposedMarkdown: string;
  readonly materialClaims: readonly MaterialClaim[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseClaim(value: unknown): MaterialClaim | null {
  if (!isPlainObject(value)) {
    return null;
  }
  for (const key of Object.keys(value)) {
    if (key !== "kind" && key !== "text" && key !== "quote") {
      return null;
    }
  }
  const { kind, text, quote } = value;
  if (typeof kind !== "string" || !MATERIAL_CLAIM_KINDS.includes(kind as MaterialClaimKind)) {
    return null;
  }
  if (typeof text !== "string" || text.length === 0 || text.length > CLAIM_TEXT_MAX_CHARS) {
    return null;
  }
  if (quote !== undefined) {
    if (typeof quote !== "string" || quote.length === 0 || quote.length > CLAIM_QUOTE_MAX_CHARS) {
      return null;
    }
    return { kind: kind as MaterialClaimKind, text, quote };
  }
  return { kind: kind as MaterialClaimKind, text };
}

/**
 * Strict shape check over the provider's structured output — the seam
 * validates against CRITIQUE_SCHEMA, but the guard re-checks by hand so a
 * schema/validator gap can never smuggle an out-of-contract critique through.
 * Rebuilds the object (never returns the input reference).
 */
export function parseCritique(object: unknown): ParsedCritique | null {
  if (!isPlainObject(object)) {
    return null;
  }
  for (const key of Object.keys(object)) {
    if (key !== "critiqueSummary" && key !== "proposedMarkdown" && key !== "materialClaims") {
      return null;
    }
  }
  const { critiqueSummary, proposedMarkdown, materialClaims } = object;
  if (typeof critiqueSummary !== "string" || critiqueSummary.length > CRITIQUE_SUMMARY_MAX_CHARS) {
    return null;
  }
  if (typeof proposedMarkdown !== "string") {
    return null;
  }
  if (!Array.isArray(materialClaims) || materialClaims.length > MATERIAL_CLAIMS_MAX) {
    return null;
  }
  const claims: MaterialClaim[] = [];
  for (const raw of materialClaims) {
    const parsed = parseClaim(raw);
    if (parsed === null) {
      return null;
    }
    claims.push(parsed);
  }
  return { critiqueSummary, proposedMarkdown, materialClaims: claims };
}

/**
 * The guard itself. A claim is supported by an exact quote found verbatim in
 * a stored source revision (first match wins), or by a recorded user
 * confirmation of the same (kind, text). A quote that matches no source is
 * NOT testimony — it fails the claim rather than falling through to the
 * confirmation path (a fabricated quote must never look "almost right").
 */
export function verifyClaims(input: {
  claims: readonly MaterialClaim[];
  sources: readonly { revisionId: string; content: string }[];
  confirmationIds: ReadonlySet<string>;
}): TruthGuardVerdict {
  const { claims, sources, confirmationIds } = input;
  if (claims.length > MATERIAL_CLAIMS_MAX) {
    return { ok: false, evidence: [], unsupported: [...claims] };
  }
  const evidence: ResumeEvidence[] = [];
  const unsupported: MaterialClaim[] = [];
  for (const claim of claims) {
    if (claim.text.length > CLAIM_TEXT_MAX_CHARS) {
      unsupported.push(claim);
      continue;
    }
    if (claim.quote !== undefined) {
      if (claim.quote.length > CLAIM_QUOTE_MAX_CHARS) {
        unsupported.push(claim);
        continue;
      }
      const source = sources.find((s) => s.content.includes(claim.quote as string));
      if (source === undefined) {
        unsupported.push(claim);
        continue;
      }
      evidence.push({
        claimKind: claim.kind,
        claimText: claim.text,
        status: "sourced",
        sourceRevisionId: source.revisionId,
        quote: claim.quote
      });
      continue;
    }
    const confirmationId = confirmationIdFor(claim.kind, claim.text);
    if (confirmationIds.has(confirmationId)) {
      evidence.push({
        claimKind: claim.kind,
        claimText: claim.text,
        status: "confirmed",
        confirmationId
      });
      continue;
    }
    unsupported.push(claim);
  }
  return { ok: unsupported.length === 0, evidence, unsupported };
}
