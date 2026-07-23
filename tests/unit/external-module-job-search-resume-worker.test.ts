import { describe, expect, it, vi } from "vitest";

import { NS } from "../../external-modules/job-search/src/domain/kv-port.js";
import type { JobSearchKv } from "../../external-modules/job-search/src/domain/kv-port.js";
import type {
  JobSearchAi,
  JobSearchAiInput,
  WorkerPorts
} from "../../external-modules/job-search/src/worker/ports.js";
import { HANDLERS } from "../../external-modules/job-search/src/worker/registry.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";

const resumeText = "Led a migration from a legacy platform. Managed a team of six engineers.";

function makePorts(
  options: {
    readonly attachmentText?: string | null;
    readonly ai?: JobSearchAi | null;
  } = {}
): WorkerPorts {
  const records = new Map<string, Record<string, unknown>>();
  const kv: JobSearchKv = {
    get: async (namespace, key) => (namespace === NS.resume ? (records.get(key) ?? null) : null),
    set: async (namespace, key, value) => {
      if (namespace === NS.resume) records.set(key, value);
    },
    delete: async () => false,
    list: async (namespace) => (namespace === NS.resume ? [...records.keys()] : [])
  };
  return {
    kv,
    fetch: null,
    ai: options.ai ?? null,
    attachments: {
      readText: vi.fn(async () =>
        options.attachmentText === undefined || options.attachmentText === null
          ? null
          : { fileName: "resume.pdf", mimeType: "application/pdf", text: options.attachmentText }
      )
    },
    now: () => new Date("2026-07-23T12:00:00.000Z")
  } as unknown as WorkerPorts;
}

async function storedRecord(ports: WorkerPorts): Promise<Record<string, unknown> | null> {
  return ports.kv.get(NS.resume, "record");
}

describe("Job Search resume worker (#1233)", () => {
  it("intakes extracted attachment text through the host attachment seam", async () => {
    const ports = makePorts({ attachmentText: resumeText });

    const result = await wrap(HANDLERS["resume.intake"]!(ports))({
      source: "upload",
      attachmentId: "attachment-1"
    });

    expect(result).toMatchObject({ status: "ok", source: "upload", textLength: resumeText.length });
    expect(await storedRecord(ports)).toMatchObject({
      current: { source: "upload", status: "draft", text: resumeText },
      revisions: [{ version: 0, kind: "source", sourceText: resumeText }]
    });
  });

  it("returns a friendly retry result when an image or unavailable attachment has no text", async () => {
    const result = await wrap(HANDLERS["resume.intake"]!(makePorts()))({
      source: "upload",
      attachmentId: "image-1"
    });

    expect(result).toEqual({
      status: "error",
      code: "attachment_unavailable",
      message: "I couldn't read text from that file. Try a PDF or DOCX, or paste the resume here."
    });
  });

  it("supports paste and build-from-interview text doors", async () => {
    const pasted = makePorts();
    await expect(
      wrap(HANDLERS["resume.intake"]!(pasted))({ source: "paste", text: resumeText })
    ).resolves.toMatchObject({ status: "ok", source: "paste" });

    const interview = makePorts();
    await expect(
      wrap(HANDLERS["resume.intake"]!(interview))({
        source: "interview",
        text: "I led a migration and managed six engineers."
      })
    ).resolves.toMatchObject({ status: "ok", source: "interview" });
  });

  it("calls reasoning once and drops critique evidence absent from the source", async () => {
    const calls: JobSearchAiInput[] = [];
    const ports = makePorts({
      attachmentText: resumeText,
      ai: {
        generateStructured: vi.fn(async (input) => {
          calls.push(input);
          return {
            ok: true as const,
            object: {
              critique: [{ section: "Summary", text: "Lead with the migration outcome." }],
              revisions: [
                {
                  section: "Summary",
                  before: "Led a migration",
                  after: "Led a platform migration with clear outcomes.",
                  evidence: "Led a migration"
                },
                {
                  section: "Experience",
                  before: "Built a global team",
                  after: "Built a global team of 50.",
                  evidence: "Built a global team of 50."
                }
              ],
              strengths: [
                { text: "Migration leadership", evidence: "Led a migration" },
                { text: "Revenue growth", evidence: "Increased revenue by 40%." }
              ],
              gaps: [{ text: "Cloud certification", evidence: "AWS certification" }]
            }
          };
        })
      }
    });

    await wrap(HANDLERS["resume.intake"]!(ports))({
      source: "upload",
      attachmentId: "attachment-1"
    });
    const result = await wrap(HANDLERS["resume.critique"]!(ports))({});

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tierHint: "reasoning",
      prompt: expect.stringContaining(resumeText)
    });
    expect(calls[0]?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["critique", "revisions", "strengths", "gaps"]
    });
    expect(result).toMatchObject({
      status: "ok",
      artifact: {
        revisions: [{ evidence: "Led a migration" }],
        strengths: [{ evidence: "Led a migration" }]
      }
    });
    expect((result.artifact as { revisions: unknown[] }).revisions).toHaveLength(1);
    expect((result.artifact as { strengths: unknown[] }).strengths).toHaveLength(1);
  });

  it("applies only a revision id and rejects unknown revisions", async () => {
    const ports = makePorts({ attachmentText: resumeText });
    await wrap(HANDLERS["resume.intake"]!(ports))({
      source: "upload",
      attachmentId: "attachment-1"
    });
    const record = await storedRecord(ports);
    if (!record) throw new Error("expected resume record");
    const sourceRevisionId = (record.revisions[0] as { id: string }).id;
    const reviewRecord = {
      ...record,
      revisions: [
        ...record.revisions,
        {
          id: "review-1",
          version: 1,
          kind: "review",
          source: "upload",
          sourceText: resumeText,
          createdAt: "2026-07-23T12:01:00.000Z",
          diff: [],
          artifact: { critique: [], revisions: [], strengths: [], gaps: [] }
        }
      ]
    };
    await ports.kv.set(NS.resume, "record", reviewRecord);

    const approved = await wrap(HANDLERS["resume-revise"]!(ports))({ revisionId: "review-1" });
    expect(approved).toMatchObject({ state: "approved", appliedRevisionId: "review-1" });
    expect(await storedRecord(ports)).toMatchObject({
      current: { status: "approved" },
      revisions: [
        { id: sourceRevisionId, kind: "source" },
        { id: "review-1", kind: "review" },
        { kind: "approved" }
      ]
    });

    await expect(
      wrap(HANDLERS["resume-revise"]!(ports))({ revisionId: "missing" })
    ).resolves.toEqual({
      status: "error",
      code: "unknown_revision",
      message: "That resume revision is no longer available."
    });
  });
});
