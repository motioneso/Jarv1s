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
// QA RED B1 fold-in (PR #956, Codex issuecomment-4945986416 + Opus
// issuecomment-4946000922): a bare `includes` check let a trivial token like
// "40%" source a whole claim. Enforced in verifyClaims — deliberately NOT in
// CRITIQUE_SCHEMA/parseCritique, because a schema failure takes the seam-error
// path while a short quote should take the recoverable "question" path.
export const CLAIM_QUOTE_MIN_CHARS = 12;
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
      if (claim.quote.trim().length < CLAIM_QUOTE_MIN_CHARS) {
        // A short quote ("40%", "Acme Corp") is too weak to vouch for a whole
        // claim even when it IS a source substring — fail toward "question".
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

export interface MarkdownCoverageVerdict {
  readonly ok: boolean;
  readonly unverifiedSpans: readonly string[];
}

// Defensive response-size cap on the echoed spans. Truncation never flips the
// verdict — ok stays false regardless of how many spans are echoed back.
const UNVERIFIED_SPANS_MAX = 64;

// Segment boundaries within a line. Commas deliberately do NOT split: "Led
// migration, then shipped platform" is one asserted statement, and splitting
// on commas would let a fabricator smuggle relationships as comma fragments.
const SEGMENT_SPLIT = /[.!?;|]+/;

// Defensive echo cap per span — truncation never flips the verdict.
const UNVERIFIED_SPAN_ECHO_MAX_CHARS = 200;

/**
 * Canonical word run of a segment: Unicode letter/number tokens, lowercased,
 * single-space joined. \p{L} keeps non-ASCII proper nouns intact — the
 * cycle-1 ASCII regex stripped "École" down to "cole" (QA RED fix cycle 2,
 * Codex issuecomment-4946275153).
 */
function normalizePhrase(text: string): string {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  return tokens === null ? "" : tokens.join(" ");
}

/**
 * Material segments of a markdown revision, derived from the markdown ITSELF —
 * never from what the AI self-reports (QA RED B1, PR #956). Per line: strip
 * heading/quote prefixes, one list prefix, and emphasis markers; split into
 * sentence-level segments; keep each segment's raw text plus its normalized
 * phrase. Whole-segment matching replaces the cycle-1 caps/digit token
 * heuristic, which all-lowercase spelled-number fabrications defeated
 * outright (zero spans → vacuous pass; Codex issuecomment-4946275153).
 */
export function extractMaterialSegments(markdown: string): { raw: string; phrase: string }[] {
  const segments: { raw: string; phrase: string }[] = [];
  for (const line of markdown.split("\n")) {
    const stripped = line
      .replace(/^\s*(?:[#>]+\s*)+/, "")
      .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, "")
      .replace(/[*_`]/g, "");
    for (const piece of stripped.split(SEGMENT_SPLIT)) {
      const raw = piece.trim();
      const phrase = normalizePhrase(raw);
      if (phrase !== "") {
        segments.push({ raw, phrase });
      }
    }
  }
  return segments;
}

/**
 * The persist gate for AI-proposed markdown: every proposed segment must
 * appear as a contiguous, word-boundary-aligned phrase inside ONE segment of
 * the allowed corpus (stored source revisions + USER-confirmed claim texts
 * ONLY — AI-declared claim texts never vouch). Sub-phrases of a corpus
 * sentence pass; recombining tokens that only exist in separate segments
 * fails — the cycle-2 bypass where "Engineer at Acme in 2020" passed because
 * its tokens existed apart (Codex issuecomment-4946275153, Opus
 * issuecomment-4946268694). Content-free markdown (empty, whitespace,
 * punctuation-only) is rejected outright: an empty revision must never be
 * persistable or approvable. Fail CLOSED on every path.
 */
export function verifyMarkdownCoverage(input: {
  markdown: string;
  sources: readonly { revisionId: string; content: string }[];
  confirmedTexts: readonly string[];
}): MarkdownCoverageVerdict {
  const proposed = extractMaterialSegments(input.markdown);
  if (proposed.length === 0) {
    return { ok: false, unverifiedSpans: [] };
  }
  // Space-padded per corpus segment — padding keeps needle matches on word
  // boundaries, and per-segment strings (not one joined blob) prevent false
  // adjacency across line/sentence boundaries.
  const corpus = [...input.sources.map((source) => source.content), ...input.confirmedTexts]
    .flatMap((text) => extractMaterialSegments(text))
    .map((segment) => ` ${segment.phrase} `);
  const seen = new Set<string>();
  const unverified: string[] = [];
  for (const segment of proposed) {
    if (seen.has(segment.phrase)) {
      continue;
    }
    seen.add(segment.phrase);
    const needle = ` ${segment.phrase} `;
    if (!corpus.some((haystack) => haystack.includes(needle))) {
      unverified.push(segment.raw.slice(0, UNVERIFIED_SPAN_ECHO_MAX_CHARS));
    }
  }
  return {
    ok: unverified.length === 0,
    unverifiedSpans: unverified.slice(0, UNVERIFIED_SPANS_MAX)
  };
}
