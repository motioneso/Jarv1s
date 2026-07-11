// external-modules/job-search/src/worker/handlers/resume.ts
//
// JS-03 (#932) Task 7: resume.get. Read order is explicit revisionId >
// active pointer > the immutable original at revision "0" — the assistant
// always sees the user's approved truth by default, never a draft. A user
// with no resume gets a QUESTION inviting a paste (an empty fabricated
// resume would itself be an unsupported claim). Task 8 adds save-draft
// (manual + AI critique through the truth guard) to this file.
import type { DiffHunk, ResumeRevision } from "../../domain/index.js";
import {
  JobSearchKvError,
  NS,
  assertId,
  diffLines,
  getActiveResume,
  keys,
  readRecord
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { readBool, readString } from "../validate.js";

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
