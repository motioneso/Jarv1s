// tests/unit/external-module-job-search-handlers-resume.test.ts
//
// JS-03 (#932) Tasks 7+8: resume.get + resume.save-draft. The get suite pins
// the read order (explicit revisionId > active pointer > immutable original
// "0"), the no-resume question (never a fabricated empty resume), the
// parent→child diff projection, and verbatim evidence pass-through. The
// save-draft suites pin the truth-guard seam: manual intake (original at "0",
// deterministic draft ids, confirmations) and AI critique where an
// unsupported claim is ALWAYS a question and NEVER persisted.
import { describe, expect, it } from "vitest";

import type {
  DiffHunk,
  ResumeEvidence
} from "../../external-modules/job-search/src/domain/index.js";
import {
  CRITIQUE_SCHEMA,
  approveResume,
  confirmationIdFor,
  contentHash,
  getOnboardingState,
  listConfirmationIds,
  RESUME_TOO_LARGE_MESSAGE,
  saveConfirmation,
  saveOriginalResume,
  saveResumeRevision
} from "../../external-modules/job-search/src/domain/index.js";
import type {
  JobSearchAi,
  JobSearchAiInput,
  JobSearchAiResult,
  WorkerPorts
} from "../../external-modules/job-search/src/worker/ai-port.js";
import {
  approveResumeHandler,
  getResumeHandler,
  saveResumeDraftHandler
} from "../../external-modules/job-search/src/worker/handlers/resume.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");

const portsFor = (kv: MemoryKv): WorkerPorts => ({
  kv,
  ai: null,
  now: () => NOW
});

const portsWith = (kv: MemoryKv, ai: JobSearchAi): WorkerPorts => ({
  kv,
  ai,
  now: () => NOW
});

/** Canned structured-AI seam that records every call it receives. */
function fakeAi(result: JobSearchAiResult): { ai: JobSearchAi; calls: JobSearchAiInput[] } {
  const calls: JobSearchAiInput[] = [];
  return {
    calls,
    ai: {
      generateStructured: async (input) => {
        calls.push(input);
        return result;
      }
    }
  };
}

/** Deterministic draft id contract: contentHash("rev\0<parent>\0<content>"). */
const draftIdFor = (parentRevisionId: string, content: string): string =>
  contentHash(["rev", parentRevisionId, content].join("\0"));

const ORIGINAL = "Line one\nLine two\nLine three";
const REVISED = "Line one\nLine 2 revised\nLine three\nLine four";

async function seedRevised(kv: MemoryKv, evidence?: readonly ResumeEvidence[]): Promise<void> {
  await saveOriginalResume(kv, ORIGINAL, NOW);
  await saveResumeRevision(kv, {
    schemaVersion: 1,
    revisionId: "r1",
    kind: "markdown",
    content: REVISED,
    parentRevisionId: "0",
    critiqueSummary: "tightened the middle",
    ...(evidence !== undefined ? { evidence } : {}),
    createdAt: NOW.toISOString()
  });
}

describe("resume.get handler", () => {
  it("no resume at all: a question inviting a paste, not a fabricated record", async () => {
    const kv = createMemoryKv();
    const result = await getResumeHandler(portsFor(kv))({});
    expect(result.status).toBe("question");
    expect(typeof result.question).toBe("string");
    expect(result.question).toMatch(/paste/i);
  });

  it("falls back to the original revision 0 when nothing is approved yet", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const result = await getResumeHandler(portsFor(kv))({});
    expect(result.status).toBe("ok");
    expect(result.revisionId).toBe("0");
    expect(result.kind).toBe("original");
    expect(result.content).toBe(ORIGINAL);
  });

  it("default read is the active revision once one is approved", async () => {
    const kv = createMemoryKv();
    await seedRevised(kv);
    await approveResume(kv, "r1", NOW);
    const result = await getResumeHandler(portsFor(kv))({});
    expect(result.revisionId).toBe("r1");
    expect(result.content).toBe(REVISED);
    expect(result.critiqueSummary).toBe("tightened the middle");
  });

  it("explicit revisionId wins over the active pointer", async () => {
    const kv = createMemoryKv();
    await seedRevised(kv);
    await approveResume(kv, "r1", NOW);
    const result = await getResumeHandler(portsFor(kv))({ revisionId: "0" });
    expect(result.revisionId).toBe("0");
    expect(result.content).toBe(ORIGINAL);
  });

  it("errors on an unknown explicit revisionId", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const result = await wrap(getResumeHandler(portsFor(kv)))({ revisionId: "nope" });
    expect(result.status).toBe("error");
    expect(result.code).toBe("missing_revision");
  });

  it("includeDiff reconstructs parent→child from the hunks", async () => {
    const kv = createMemoryKv();
    await seedRevised(kv);
    const result = await getResumeHandler(portsFor(kv))({ revisionId: "r1", includeDiff: true });
    const diff = result.diff as readonly DiffHunk[];
    expect(Array.isArray(diff)).toBe(true);
    const parentLines = diff.filter((h) => h.type !== "added").flatMap((h) => [...h.lines]);
    const childLines = diff.filter((h) => h.type !== "removed").flatMap((h) => [...h.lines]);
    expect(parentLines).toEqual(ORIGINAL.split("\n"));
    expect(childLines).toEqual(REVISED.split("\n"));
  });

  it("includeDiff on the parentless original is simply omitted", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const result = await getResumeHandler(portsFor(kv))({ revisionId: "0", includeDiff: true });
    expect(result.status).toBe("ok");
    expect(result.diff).toBeUndefined();
  });

  it("passes the evidence array through verbatim", async () => {
    const kv = createMemoryKv();
    const evidence: ResumeEvidence[] = [
      {
        claimKind: "employer",
        claimText: "worked at Initech",
        status: "sourced",
        sourceRevisionId: "0",
        quote: "Line one"
      }
    ];
    await seedRevised(kv, evidence);
    const result = await getResumeHandler(portsFor(kv))({ revisionId: "r1" });
    expect(result.evidence).toEqual(evidence);
  });
});

describe("resume.save-draft handler — manual mode", () => {
  it("first manual save writes the immutable original at 0 and completes resume_intake", async () => {
    const kv = createMemoryKv();
    const result = await saveResumeDraftHandler(portsFor(kv))({
      mode: "manual",
      content: ORIGINAL
    });
    expect(result.status).toBe("ok");
    expect(result.revisionId).toBe("0");
    const read = await getResumeHandler(portsFor(kv))({ revisionId: "0" });
    expect(read.kind).toBe("original");
    expect(read.content).toBe(ORIGINAL);
    const state = await getOnboardingState(kv);
    expect(state?.completed["resume_intake"]).toBe(true);
  });

  it("oversize content rejects verbatim with NOTHING persisted — not even confirmations", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveResumeDraftHandler(portsFor(kv)))({
      mode: "manual",
      content: "a".repeat(49_153),
      confirmedClaims: [{ kind: "employer", text: "Acme Corp" }]
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("resume_input_too_large");
    expect(result.message).toBe(RESUME_TOO_LARGE_MESSAGE);
    expect(kv.dump().size).toBe(0);
  });

  it("second manual save creates a markdown revision with deterministic id and parent 0", async () => {
    const kv = createMemoryKv();
    await saveResumeDraftHandler(portsFor(kv))({ mode: "manual", content: ORIGINAL });
    const draft = "Line one\nLine two (edited)\nLine three";
    const result = await saveResumeDraftHandler(portsFor(kv))({ mode: "manual", content: draft });
    expect(result.status).toBe("ok");
    expect(result.revisionId).toBe(draftIdFor("0", draft));
    const read = await getResumeHandler(portsFor(kv))({ revisionId: result.revisionId as string });
    expect(read.kind).toBe("markdown");
    expect(read.content).toBe(draft);
    expect(read.parentRevisionId).toBe("0");
  });

  it("manual parent defaults to the active revision once one is approved", async () => {
    const kv = createMemoryKv();
    await saveResumeDraftHandler(portsFor(kv))({ mode: "manual", content: ORIGINAL });
    const first = "Line one\nLine two (edited)\nLine three";
    const firstId = draftIdFor("0", first);
    await saveResumeDraftHandler(portsFor(kv))({ mode: "manual", content: first });
    await approveResume(kv, firstId, NOW);
    const second = "Line one\nLine two (edited twice)\nLine three";
    const result = await saveResumeDraftHandler(portsFor(kv))({ mode: "manual", content: second });
    expect(result.revisionId).toBe(draftIdFor(firstId, second));
    const read = await getResumeHandler(portsFor(kv))({ revisionId: result.revisionId as string });
    expect(read.parentRevisionId).toBe(firstId);
  });

  it("confirmedClaims without content writes retrievable confirmation records", async () => {
    const kv = createMemoryKv();
    const result = await saveResumeDraftHandler(portsFor(kv))({
      mode: "manual",
      confirmedClaims: [{ kind: "employer", text: "Acme Corp" }]
    });
    expect(result.status).toBe("ok");
    const ids = await listConfirmationIds(kv);
    expect(ids.has(confirmationIdFor("employer", "Acme Corp"))).toBe(true);
  });

  it("requires at least one of content or confirmedClaims", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveResumeDraftHandler(portsFor(kv)))({ mode: "manual" });
    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(kv.dump().size).toBe(0);
  });

  it("rejects a confirmed claim whose kind is outside the guard's seven kinds", async () => {
    const kv = createMemoryKv();
    const result = await wrap(saveResumeDraftHandler(portsFor(kv)))({
      mode: "manual",
      confirmedClaims: [{ kind: "vibe", text: "great culture fit" }]
    });
    expect(result.status).toBe("error");
    expect(result.code).toBe("invalid_input");
    expect(kv.dump().size).toBe(0);
  });
});

describe("resume.save-draft handler — critique mode", () => {
  const GOOD_MARKDOWN = "# Resume\nLine one, improved\nLine three, kept";
  const GOOD_CRITIQUE = {
    critiqueSummary: "sharpened the opener",
    proposedMarkdown: GOOD_MARKDOWN,
    materialClaims: [
      { kind: "employer", text: "employed on line one", quote: "Line one" },
      { kind: "skill", text: "skill from line three", quote: "Line three" }
    ]
  };

  it("ai unavailable → question that names NO provider", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const result = await saveResumeDraftHandler(portsFor(kv))({ mode: "critique" });
    expect(result.status).toBe("question");
    expect(result.question).toMatch(/unavailable/i);
    expect(result.question).not.toMatch(/anthropic|openai|claude|gpt|gemini/i);
  });

  it("requires the pasted original before any critique", async () => {
    const kv = createMemoryKv();
    const { ai } = fakeAi({ ok: true, object: GOOD_CRITIQUE });
    const result = await saveResumeDraftHandler(portsWith(kv, ai))({ mode: "critique" });
    expect(result.status).toBe("question");
    expect(kv.dump().size).toBe(0);
  });

  it("ai error result → question, nothing persisted", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const before = kv.dump();
    const { ai } = fakeAi({ ok: false, error: "needs_config" });
    const result = await saveResumeDraftHandler(portsWith(kv, ai))({ mode: "critique" });
    expect(result.status).toBe("question");
    expect(result.question).not.toMatch(/anthropic|openai|claude|gpt|gemini/i);
    expect(kv.dump()).toEqual(before);
  });

  it("fully-sourced critique persists with evidence and completes resume_critique", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const { ai, calls } = fakeAi({ ok: true, object: GOOD_CRITIQUE });
    const result = await saveResumeDraftHandler(portsWith(kv, ai))({ mode: "critique" });
    expect(result.status).toBe("ok");
    expect(result.revisionId).toBe(draftIdFor("0", GOOD_MARKDOWN));
    expect(result.critiqueSummary).toBe("sharpened the opener");
    expect(result.evidence).toEqual([
      {
        claimKind: "employer",
        claimText: "employed on line one",
        status: "sourced",
        sourceRevisionId: "0",
        quote: "Line one"
      },
      {
        claimKind: "skill",
        claimText: "skill from line three",
        status: "sourced",
        sourceRevisionId: "0",
        quote: "Line three"
      }
    ]);
    const read = await getResumeHandler(portsFor(kv))({ revisionId: result.revisionId as string });
    expect(read.content).toBe(GOOD_MARKDOWN);
    expect(read.parentRevisionId).toBe("0");
    const state = await getOnboardingState(kv);
    expect(state?.completed["resume_critique"]).toBe(true);
    // Seam contract: the guard's schema object, the base content in the
    // prompt, and the fixed token budget.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.schema).toBe(CRITIQUE_SCHEMA);
    expect(calls[0]?.prompt).toContain(ORIGINAL);
    expect(calls[0]?.maxOutputTokens).toBe(16_384);
  });

  it("ADVERSARIAL: a fabricated claim is a question, never a revision, never approvable", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const before = kv.dump();
    const fabricated = { kind: "metric", text: "Raised revenue 40%" };
    const { ai } = fakeAi({
      ok: true,
      object: {
        critiqueSummary: "boosted impact",
        proposedMarkdown: GOOD_MARKDOWN,
        materialClaims: [fabricated]
      }
    });
    const result = await saveResumeDraftHandler(portsWith(kv, ai))({ mode: "critique" });
    expect(result.status).toBe("question");
    expect(result.unsupportedClaims).toEqual([fabricated]);
    // The kv is byte-identical: no revision, no evidence, no onboarding tick.
    expect(kv.dump()).toEqual(before);
    // The revision the critique WOULD have created can never be approved.
    await expect(approveResume(kv, draftIdFor("0", GOOD_MARKDOWN), NOW)).rejects.toMatchObject({
      code: "missing_revision"
    });
  });

  it("the same fabricated claim persists as confirmed evidence AFTER the user confirms it", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    await saveResumeDraftHandler(portsFor(kv))({
      mode: "manual",
      confirmedClaims: [{ kind: "metric", text: "Raised revenue 40%" }]
    });
    const { ai } = fakeAi({
      ok: true,
      object: {
        critiqueSummary: "boosted impact",
        proposedMarkdown: GOOD_MARKDOWN,
        materialClaims: [{ kind: "metric", text: "Raised revenue 40%" }]
      }
    });
    const result = await saveResumeDraftHandler(portsWith(kv, ai))({ mode: "critique" });
    expect(result.status).toBe("ok");
    expect(result.evidence).toEqual([
      {
        claimKind: "metric",
        claimText: "Raised revenue 40%",
        status: "confirmed",
        confirmationId: confirmationIdFor("metric", "Raised revenue 40%")
      }
    ]);
  });

  it("shape garbage from the ai → question, nothing persisted", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const before = kv.dump();
    const { ai } = fakeAi({ ok: true, object: { totally: "unexpected" } });
    const result = await saveResumeDraftHandler(portsWith(kv, ai))({ mode: "critique" });
    expect(result.status).toBe("question");
    expect(kv.dump()).toEqual(before);
  });

  it("oversize proposedMarkdown → resume_input_too_large, nothing persisted", async () => {
    const kv = createMemoryKv();
    await saveOriginalResume(kv, ORIGINAL, NOW);
    const before = kv.dump();
    const { ai } = fakeAi({
      ok: true,
      object: {
        critiqueSummary: "puffed up",
        proposedMarkdown: "a".repeat(49_153),
        materialClaims: []
      }
    });
    const result = await wrap(saveResumeDraftHandler(portsWith(kv, ai)))({ mode: "critique" });
    expect(result.status).toBe("error");
    expect(result.code).toBe("resume_input_too_large");
    expect(result.message).toBe(RESUME_TOO_LARGE_MESSAGE);
    expect(kv.dump()).toEqual(before);
  });
});

describe("resume.approve handler", () => {
  it("approve existing revision: active pointer set, three flags complete, id recorded", async () => {
    const kv = createMemoryKv();
    await seedRevised(kv);
    const result = await approveResumeHandler(portsFor(kv))({ revisionId: "r1" });
    expect(result).toEqual({ status: "ok", revisionId: "r1" });

    // Default get now resolves through the active pointer, not the original.
    const active = await getResumeHandler(portsFor(kv))({});
    expect(active.revisionId).toBe("r1");

    // Approval is the third checkpoint — a paste+approve user (no critique)
    // still passes all three flags; that monotonic jump is the flow-engine
    // design from Task 4, not an accident.
    const state = await getOnboardingState(kv);
    expect(state?.completed["resume_intake"]).toBe(true);
    expect(state?.completed["resume_critique"]).toBe(true);
    expect(state?.completed["resume_approval"]).toBe(true);
    expect(state?.approvedResumeRevisionId).toBe("r1");
  });

  it("unknown revision id: missing_revision error via wrap", async () => {
    const kv = createMemoryKv();
    await seedRevised(kv);
    const result = await wrap(approveResumeHandler(portsFor(kv)))({ revisionId: "nope" });
    expect(result.status).toBe("error");
    expect(result.code).toBe("missing_revision");
  });

  it("backward movement: approving an older revision keeps every revision and confirmation", async () => {
    const kv = createMemoryKv();
    await seedRevised(kv);
    await saveConfirmation(kv, {
      schemaVersion: 1,
      confirmationId: confirmationIdFor("metric", "Raised revenue 40%"),
      claimKind: "metric",
      claimText: "Raised revenue 40%",
      confirmedAt: NOW.toISOString()
    });
    await approveResumeHandler(portsFor(kv))({ revisionId: "r1" });
    const afterForward = kv.dump();

    // Roll back to the original. History is append-only: only the active
    // pointer and onboarding record may differ — nothing disappears.
    const result = await approveResumeHandler(portsFor(kv))({ revisionId: "0" });
    expect(result).toEqual({ status: "ok", revisionId: "0" });
    const active = await getResumeHandler(portsFor(kv))({});
    expect(active.revisionId).toBe("0");

    const afterBack = kv.dump();
    expect(afterBack.size).toBe(afterForward.size);
    for (const key of afterForward.keys()) {
      expect(afterBack.has(key)).toBe(true);
    }
    const state = await getOnboardingState(kv);
    expect(state?.approvedResumeRevisionId).toBe("0");
    expect(await listConfirmationIds(kv)).toEqual(
      new Set([confirmationIdFor("metric", "Raised revenue 40%")])
    );
  });
});
