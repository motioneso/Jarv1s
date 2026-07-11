// tests/unit/external-module-job-search-handlers-resume.test.ts
//
// JS-03 (#932) Task 7: resume.get — read path only. Pins the read order
// (explicit revisionId > active pointer > immutable original "0"), the
// no-resume question (never a fabricated empty resume), the parent→child
// diff projection, and verbatim evidence pass-through. Task 8 extends this
// file with the save-draft (truth-guard) suite.
import { describe, expect, it } from "vitest";

import type {
  DiffHunk,
  ResumeEvidence
} from "../../external-modules/job-search/src/domain/index.js";
import {
  approveResume,
  saveOriginalResume,
  saveResumeRevision
} from "../../external-modules/job-search/src/domain/index.js";
import type { WorkerPorts } from "../../external-modules/job-search/src/worker/ai-port.js";
import { getResumeHandler } from "../../external-modules/job-search/src/worker/handlers/resume.js";
import { wrap } from "../../external-modules/job-search/src/worker/wrap.js";
import { createMemoryKv } from "./helpers/job-search-memory-kv.js";
import type { MemoryKv } from "./helpers/job-search-memory-kv.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");

const portsFor = (kv: MemoryKv): WorkerPorts => ({
  kv,
  ai: null,
  now: () => NOW
});

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
