import { randomUUID } from "node:crypto";

import {
  appendReviewRevision,
  appendSourceRevision,
  approveRevision,
  createEmptyResume,
  parseResumeRecord,
  sanitizeReviewArtifact,
  type ResumeReviewModelOutput,
  type ResumeSource
} from "../../domain/resume.js";
import { JobSearchKvError } from "../../domain/errors.js";
import { NS, type JobSearchKv } from "../../domain/kv-port.js";
import type { JobSearchAiInput, WorkerPorts } from "../ports.js";
import type { ToolFactory } from "../registry.js";
import type { ToolHandler } from "../wrap.js";
import { InputError, readString } from "../validate.js";

export const RESUME_RECORD_KEY = "record";
const MAX_RESUME_BYTES = 120_000;

export const RESUME_CRITIQUE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["critique", "revisions", "strengths", "gaps"],
  properties: {
    critique: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "text"],
        properties: { section: { type: "string" }, text: { type: "string" } }
      }
    },
    revisions: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "before", "after", "evidence"],
        properties: {
          section: { type: "string" },
          before: { type: "string" },
          after: { type: "string" },
          evidence: { type: "string" }
        }
      }
    },
    strengths: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence"],
        properties: { text: { type: "string" }, evidence: { type: "string" } }
      }
    },
    gaps: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text"],
        properties: { text: { type: "string" }, evidence: { type: "string" } }
      }
    }
  }
};

export const resumeIntakeHandler: ToolFactory = (ports) => async (input) => {
  const source = readSource(input);
  const attachmentId = readString(input, "attachmentId");
  const textInput = readString(input, "text", { maxBytes: MAX_RESUME_BYTES });
  let sourceText: string;

  if (source === "upload") {
    if (!attachmentId || textInput !== undefined) {
      throw new InputError("upload intake requires only attachmentId");
    }
    const attachment = await ports.attachments.readText(attachmentId);
    if (!attachment?.text.trim()) {
      return {
        status: "error",
        code: "attachment_unavailable",
        message: "I couldn't read text from that file. Try a PDF or DOCX, or paste the resume here."
      };
    }
    sourceText = attachment.text;
  } else {
    if (attachmentId || textInput === undefined || !textInput.trim()) {
      throw new InputError(`${source} intake requires text`);
    }
    sourceText = textInput;
  }

  const existing = await loadResume(ports.kv, true);
  const result = appendSourceRevision(existing, {
    id: randomUUID(),
    source,
    sourceText,
    createdAt: ports.now().toISOString()
  });
  await saveResume(ports.kv, result.record);
  return {
    status: "ok",
    revisionId: result.revision.id,
    source,
    textLength: sourceText.length
  };
};

export const resumeCritiqueHandler: ToolFactory = (ports) => async () => {
  const record = await loadResume(ports.kv, false);
  const current = record.current;
  if (!current) throw new JobSearchKvError("missing_record", "resume source is missing");
  if (!ports.ai) throw new InputError("resume critique is unavailable", "ai_unavailable");

  const aiInput: JobSearchAiInput = {
    schema: RESUME_CRITIQUE_SCHEMA,
    tierHint: "reasoning",
    maxOutputTokens: 4_096,
    prompt: [
      "Review the supplied resume for a job search.",
      "Return only the requested structured shape.",
      "Never invent a skill, title, date, metric, or outcome.",
      "Every strengths and revisions evidence value must be copied literally from the source resume.",
      "Gaps may flag missing evidence honestly; do not turn a gap into a claim.",
      "SOURCE RESUME:",
      current.text
    ].join("\n\n")
  };
  const result = await ports.ai.generateStructured(aiInput);
  if (!result.ok) {
    return {
      status: "error",
      code: "critique_unavailable",
      message: "I couldn't review the resume right now. Try again in a moment."
    };
  }

  const artifact = sanitizeReviewArtifact(current.text, result.object as ResumeReviewModelOutput);
  const review = appendReviewRevision(record, {
    id: randomUUID(),
    source: current.source,
    sourceText: current.text,
    artifact,
    createdAt: ports.now().toISOString()
  });
  await saveResume(ports.kv, review.record);
  return { status: "ok", revisionId: review.revision.id, artifact };
};

export const resumeReviseHandler: ToolFactory = (ports) => async (input) => {
  const revisionId = readString(input, "revisionId", { required: true });
  if (!revisionId) throw new InputError("revisionId is required");
  const record = await loadResume(ports.kv, false);
  let approved;
  try {
    approved = approveRevision(record, revisionId, randomUUID(), ports.now().toISOString());
  } catch {
    throw new InputError("That resume revision is no longer available.", "unknown_revision");
  }
  await saveResume(ports.kv, approved.record);
  return {
    status: "ok",
    revisionId: approved.revision.id,
    appliedRevisionId: revisionId,
    state: "approved"
  };
};

async function loadResume(kv: JobSearchKv, allowEmpty: boolean) {
  const stored = parseResumeRecord(await kv.get(NS.resume, RESUME_RECORD_KEY));
  if (stored) return stored;
  if (allowEmpty) return createEmptyResume();
  throw new JobSearchKvError("missing_record", "resume record is missing");
}

async function saveResume(kv: JobSearchKv, record: ReturnType<typeof createEmptyResume>) {
  await kv.set(NS.resume, RESUME_RECORD_KEY, record as unknown as Record<string, unknown>);
}

function readSource(input: Record<string, unknown>): ResumeSource {
  const source = readString(input, "source", { required: true });
  if (source !== "upload" && source !== "paste" && source !== "interview") {
    throw new InputError("source must be upload, paste, or interview");
  }
  return source;
}
