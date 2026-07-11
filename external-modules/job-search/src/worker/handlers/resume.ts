// external-modules/job-search/src/worker/handlers/resume.ts
//
// JS-03 (#932) Tasks 7+8: resume.get + resume.save-draft. Read order is
// explicit revisionId > active pointer > the immutable original at revision
// "0" — the assistant always sees the user's approved truth by default,
// never a draft. A user with no resume gets a QUESTION inviting a paste (an
// empty fabricated resume would itself be an unsupported claim).
//
// save-draft is the truth-guard seam. Manual mode stores the pasted original
// at "0" (later saves become markdown revisions) and records user claim
// confirmations. Critique mode runs the structured-AI call and persists a
// revision ONLY when verifyClaims vouches for every material claim — an
// unsupported claim comes back as a question with NOTHING written.
import type { MaterialClaimKind, ResumeRevision, DiffHunk } from "../../domain/index.js";
import {
  CRITIQUE_SCHEMA,
  JobSearchKvError,
  MATERIAL_CLAIM_KINDS,
  NS,
  RESUME_INPUT_MAX_BYTES,
  RESUME_TOO_LARGE_MESSAGE,
  approveResume,
  assertId,
  confirmationIdFor,
  contentHash,
  diffLines,
  getActiveResume,
  keys,
  listConfirmationIds,
  parseCritique,
  readRecord,
  saveConfirmation,
  saveOriginalResume,
  saveResumeRevision,
  verifyClaims
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { InputError, readBool, readEnum, readString } from "../validate.js";
import { updateOnboarding } from "./flow.js";

const ORIGINAL_REVISION_ID = "0";

async function readRevision(
  ports: WorkerPorts,
  revisionId: string
): Promise<ResumeRevision | null> {
  return (await readRecord(
    ports.kv,
    NS.resume,
    keys.resumeRevision(revisionId)
  )) as ResumeRevision | null;
}

export function getResumeHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const revisionId = readString(input, "revisionId");
    const includeDiff = readBool(input, "includeDiff");

    let revision: ResumeRevision | null;
    if (revisionId !== undefined) {
      assertId(revisionId);
      revision = await readRevision(ports, revisionId);
      if (revision === null) {
        throw new JobSearchKvError("missing_revision", `resume revision ${revisionId} not found`);
      }
    } else {
      // Nothing approved yet is a normal mid-onboarding state — fall back to
      // the pasted original so critique can proceed before first approval.
      revision =
        (await getActiveResume(ports.kv)) ?? (await readRevision(ports, ORIGINAL_REVISION_ID));
    }
    if (revision === null) {
      return {
        status: "question",
        question:
          "I don't have a resume for you yet. Paste your current resume text and " +
          "I'll store it as the original to work from."
      };
    }

    const response: Record<string, unknown> = {
      status: "ok",
      revisionId: revision.revisionId,
      kind: revision.kind,
      content: revision.content,
      createdAt: revision.createdAt
    };
    if (revision.parentRevisionId !== undefined) {
      response.parentRevisionId = revision.parentRevisionId;
    }
    if (revision.critiqueSummary !== undefined) {
      response.critiqueSummary = revision.critiqueSummary;
    }
    if (revision.evidence !== undefined) {
      // Verbatim pass-through: evidence is the truth-guard provenance record
      // the user approves against; the handler never edits or summarizes it.
      response.evidence = revision.evidence;
    }
    if (includeDiff === true && revision.parentRevisionId !== undefined) {
      const parent = await readRevision(ports, revision.parentRevisionId);
      if (parent === null) {
        throw new JobSearchKvError(
          "missing_revision",
          `parent resume revision ${revision.parentRevisionId} not found`
        );
      }
      response.diff = diffLines(parent.content, revision.content) as readonly DiffHunk[];
    }
    return response;
  };
}

// ---------------------------------------------------------------------------
// resume.save-draft (Task 8)
// ---------------------------------------------------------------------------

interface ConfirmedClaimInput {
  readonly kind: MaterialClaimKind;
  readonly text: string;
}

/**
 * confirmedClaims items must name one of the guard's seven kinds — a kind
 * outside MATERIAL_CLAIM_KINDS could store a confirmation the guard would
 * never look up, silently wasting the user's vouching.
 */
function readConfirmedClaims(
  input: Record<string, unknown>
): readonly ConfirmedClaimInput[] | undefined {
  const raw = input["confirmedClaims"];
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new InputError("confirmedClaims must be an array");
  }
  return raw.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new InputError(`confirmedClaims[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    return {
      kind: readEnum(record, "kind", MATERIAL_CLAIM_KINDS, { required: true }),
      text: readString(record, "text", { required: true })
    };
  });
}

async function saveConfirmations(
  ports: WorkerPorts,
  claims: readonly ConfirmedClaimInput[]
): Promise<readonly string[]> {
  const confirmedAt = ports.now().toISOString();
  const ids: string[] = [];
  for (const claim of claims) {
    const confirmationId = confirmationIdFor(claim.kind, claim.text);
    await saveConfirmation(ports.kv, {
      schemaVersion: 1,
      confirmationId,
      claimKind: claim.kind,
      claimText: claim.text,
      confirmedAt
    });
    ids.push(confirmationId);
  }
  return ids;
}

/** Deterministic draft identity — retries of the same parent+content converge. */
function draftRevisionId(parentRevisionId: string, content: string): string {
  return contentHash(`rev\0${parentRevisionId}\0${content}`);
}

/**
 * Write-if-absent: the id already commits to parent+content, so an existing
 * record IS this draft — skip the write to keep retries idempotent even when
 * the clock moved (a rewrite with a fresh createdAt would trip the JS-02
 * immutable-revision conflict). Same pattern as profile.save-draft.
 */
async function persistDraftRevision(ports: WorkerPorts, rev: ResumeRevision): Promise<void> {
  const existing = await readRevision(ports, rev.revisionId);
  if (existing === null) {
    await saveResumeRevision(ports.kv, rev);
  }
}

async function manualSave(
  ports: WorkerPorts,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const content = readString(input, "content");
  const confirmedClaims = readConfirmedClaims(input);
  // Confirm-only saves are legal (that's how a fabricated-claim question gets
  // answered), but a save carrying neither payload is a caller mistake.
  if (content === undefined && confirmedClaims === undefined) {
    throw new InputError("at least one of content or confirmedClaims is required");
  }
  // Handler-level early gate BEFORE the confirmation writes so a rejected
  // save persists nothing at all (the domain gate alone would fire after
  // confirmations already landed).
  if (content !== undefined && Buffer.byteLength(content, "utf8") > RESUME_INPUT_MAX_BYTES) {
    throw new JobSearchKvError("resume_input_too_large", RESUME_TOO_LARGE_MESSAGE);
  }

  const response: Record<string, unknown> = { status: "ok" };
  if (confirmedClaims !== undefined && confirmedClaims.length > 0) {
    response.confirmationIds = await saveConfirmations(ports, confirmedClaims);
  }
  if (content !== undefined) {
    const original = await readRevision(ports, ORIGINAL_REVISION_ID);
    if (original === null) {
      // First paste is the immutable original — the ground truth every later
      // critique quotes against.
      await saveOriginalResume(ports.kv, content, ports.now());
      response.revisionId = ORIGINAL_REVISION_ID;
    } else {
      const explicitParent = readString(input, "parentRevisionId");
      let parentRevisionId: string;
      if (explicitParent !== undefined) {
        assertId(explicitParent);
        if ((await readRevision(ports, explicitParent)) === null) {
          throw new JobSearchKvError(
            "missing_revision",
            `resume revision ${explicitParent} not found`
          );
        }
        parentRevisionId = explicitParent;
      } else {
        parentRevisionId = (await getActiveResume(ports.kv))?.revisionId ?? ORIGINAL_REVISION_ID;
      }
      const revisionId = draftRevisionId(parentRevisionId, content);
      await persistDraftRevision(ports, {
        schemaVersion: 1,
        revisionId,
        kind: "markdown",
        content,
        parentRevisionId,
        createdAt: ports.now().toISOString()
      });
      response.revisionId = revisionId;
    }
    await updateOnboarding(ports.kv, { complete: ["resume_intake"] });
  }
  return response;
}

// Fixed instruction block (plan 8.3): names the seven material-claim kinds
// and the quote requirement so the guard's contract is stated to the model
// up front, not just enforced after the fact. No provider/model names.
const CRITIQUE_INSTRUCTIONS =
  "You are critiquing the resume below. Return critiqueSummary (what you " +
  "changed and why) and proposedMarkdown (the full improved resume as " +
  "markdown). In materialClaims, list every factual claim the proposal makes " +
  "about the candidate — employer, role, date, skill, credential, metric, or " +
  "outcome — each with an exact quote copied verbatim from the provided " +
  "resume that backs it. NEVER invent employers, roles, dates, skills, " +
  "credentials, metrics, or outcomes the resume does not contain.";

async function critiqueSave(
  ports: WorkerPorts,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (ports.ai === null) {
    // Graceful-degrade seam (coordinator-approved): no worker AI bridge yet.
    // Copy must stay provider-agnostic.
    return {
      status: "question",
      question:
        "AI critique is unavailable — this module has no AI capability " +
        "connected yet. You can paste your own edits as a manual draft, or " +
        "try again once AI access is set up."
    };
  }
  const instructions = readString(input, "instructions", { maxBytes: 2000 });
  const original = await readRevision(ports, ORIGINAL_REVISION_ID);
  if (original === null) {
    return {
      status: "question",
      question:
        "I don't have your original resume yet. Paste your current resume " +
        "text first, then I can critique it."
    };
  }
  const active = await getActiveResume(ports.kv);

  const explicitBase = readString(input, "baseRevisionId");
  let base: ResumeRevision;
  if (explicitBase !== undefined) {
    assertId(explicitBase);
    const loaded =
      explicitBase === ORIGINAL_REVISION_ID ? original : await readRevision(ports, explicitBase);
    if (loaded === null) {
      throw new JobSearchKvError("missing_revision", `resume revision ${explicitBase} not found`);
    }
    base = loaded;
  } else {
    base = active ?? original;
  }

  // Quote sources: unique [original, base, active] — everything the user has
  // pasted or approved; drafts never vouch for claims.
  const sources: { revisionId: string; content: string }[] = [];
  for (const rev of [original, base, active]) {
    if (rev !== null && !sources.some((s) => s.revisionId === rev.revisionId)) {
      sources.push({ revisionId: rev.revisionId, content: rev.content });
    }
  }

  const prompt =
    CRITIQUE_INSTRUCTIONS +
    "\n\nRESUME:\n" +
    base.content +
    (instructions !== undefined ? "\n\nUSER INSTRUCTIONS:\n" + instructions : "");
  const result = await ports.ai.generateStructured({
    schema: CRITIQUE_SCHEMA,
    prompt,
    maxOutputTokens: 16_384
  });
  if (!result.ok) {
    // The error union is provider-agnostic by construction, but the user copy
    // stays generic regardless.
    return {
      status: "question",
      question:
        "The AI critique didn't complete. Try again in a moment, or paste " +
        "your own edits as a manual draft."
    };
  }
  const critique = parseCritique(result.object);
  if (critique === null) {
    return {
      status: "question",
      question:
        "The AI critique came back in an unexpected shape and was discarded. " +
        "Try again, or paste your own edits as a manual draft."
    };
  }

  const confirmationIds = await listConfirmationIds(ports.kv);
  const verdict = verifyClaims({ claims: critique.materialClaims, sources, confirmationIds });
  if (!verdict.ok) {
    // The truth guard's whole point: unsupported claims are questions, and
    // NOTHING is persisted — not the revision, not partial evidence.
    return {
      status: "question",
      question:
        "The critique makes claims I can't verify against your resume, so " +
        "nothing was saved. Confirm the ones that are true (or correct your " +
        "resume) and run the critique again.",
      unsupportedClaims: verdict.unsupported
    };
  }

  const revisionId = draftRevisionId(base.revisionId, critique.proposedMarkdown);
  // Oversize proposedMarkdown needs no special code: saveResumeRevision
  // enforces the 48 KB gate before any write, and wrap maps the error.
  await persistDraftRevision(ports, {
    schemaVersion: 1,
    revisionId,
    kind: "markdown",
    content: critique.proposedMarkdown,
    parentRevisionId: base.revisionId,
    critiqueSummary: critique.critiqueSummary,
    evidence: verdict.evidence,
    createdAt: ports.now().toISOString()
  });
  await updateOnboarding(ports.kv, { complete: ["resume_critique"] });
  return {
    status: "ok",
    revisionId,
    critiqueSummary: critique.critiqueSummary,
    evidence: verdict.evidence
  };
}

export function saveResumeDraftHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const mode = readEnum(input, "mode", ["manual", "critique"] as const, { required: true });
    return mode === "manual" ? manualSave(ports, input) : critiqueSave(ports, input);
  };
}

// ---------------------------------------------------------------------------
// resume.approve (Task 9)
// ---------------------------------------------------------------------------

export function approveResumeHandler(ports: WorkerPorts) {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const revisionId = readString(input, "revisionId", { required: true });
    assertId(revisionId);
    // approveResume verifies the revision exists (missing_revision otherwise)
    // and moves the active pointer — history stays append-only.
    await approveResume(ports.kv, revisionId, ports.now());
    // Flags are monotonic: approval marks all three resume checkpoints, so a
    // user who pasted and approved without ever running a critique still
    // clears the checkpoint (flow-engine design from Task 4).
    await updateOnboarding(ports.kv, {
      complete: ["resume_intake", "resume_critique", "resume_approval"],
      approvedResumeRevisionId: revisionId
    });
    return { status: "ok", revisionId };
  };
}
