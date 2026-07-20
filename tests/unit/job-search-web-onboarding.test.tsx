import "./helpers/install-module-runtime";

import { renderToString } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AddInput,
  ChipToggle,
  CritiqueCard,
  MultiControl,
  ProfileAside,
  ResumeDropzone,
  SourcesControl,
  Summary
} from "../../external-modules/job-search/src/web/screens/onboarding/controls.js";
import {
  derivePhase,
  expectedTools,
  parseCompensation,
  sourceQuery,
  type OnboardingSnapshot
} from "../../external-modules/job-search/src/web/screens/onboarding/model.js";
import {
  advanceOnDurableEvent,
  bootstrapOnboarding,
  buildComposerSubmit,
  buildProfileSubmit,
  JobsOnboarding,
  type AssistantRecordMirror,
  type AssistantSurfaceHandleMirror,
  type AssistantSurfaceViewPropsMirror
} from "../../external-modules/job-search/src/web/screens/onboarding/index.js";
import { h } from "../../external-modules/job-search/src/web/runtime.js";
import type { HostActions } from "../../external-modules/job-search/src/web/root.js";

const hostActions: HostActions = {
  actorScopeKey: "actor-a",
  openAssistant: () => undefined
};

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  }));
  vi.stubGlobal("fetch", stub);
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeHandle(
  overrides: Partial<AssistantSurfaceHandleMirror> = {}
): AssistantSurfaceHandleMirror {
  return {
    Surface: () => null,
    seedOnboarding: vi.fn(async () => ({ ok: true })),
    submitTurn: vi.fn(async () => undefined),
    uploadAttachment: vi.fn(async () => ({ id: "a1", fileName: "resume.pdf", sizeBytes: 100 })),
    subscribeRecords: vi.fn(() => () => undefined),
    ...overrides
  };
}

function render(node: unknown): string {
  return renderToString(node as never);
}

const snapshot = (step: string, completed: readonly string[] = []): OnboardingSnapshot => ({
  onboarding: {
    status: "ok",
    step,
    completed: {},
    gates: { resumeApproved: false, profileApproved: false, monitorEnabled: false }
  },
  profileProgress: {
    fields: {},
    completed
  }
});

describe("Job Search onboarding phase model (#1198)", () => {
  it("maps worker checkpoints without duplicating durable flow truth", () => {
    expect(derivePhase(snapshot("resume_intake"))).toBe("resume_intake");
    expect(derivePhase(snapshot("resume_critique"))).toBe("resume_critique");
    expect(derivePhase(snapshot("resume_approval"))).toBe("resume_approval");
    expect(derivePhase(snapshot("sources_schedule"))).toBe("sources_schedule");
    expect(derivePhase(snapshot("review_enable"))).toBe("sources_schedule");
    expect(derivePhase(snapshot("done"))).toBe("done");
  });

  it("derives profile substeps only from the supplied local completion cursor", () => {
    expect(derivePhase(snapshot("profile"))).toBe("titles");
    expect(derivePhase(snapshot("profile", ["titles"]))).toBe("comp");
    expect(derivePhase(snapshot("profile", ["titles", "comp"]))).toBe("workmode");
    expect(derivePhase(snapshot("profile", ["titles", "comp", "workmode"]))).toBe("locations");
    expect(derivePhase(snapshot("profile", ["titles", "comp", "workmode", "locations"]))).toBe(
      "dealbreakers"
    );
  });

  it("names only tools that can advance the active phase", () => {
    expect(expectedTools("resume_intake")).toEqual([
      "job-search.resume.import-attachment",
      "job-search.resume.save-draft"
    ]);
    expect(expectedTools("titles")).toEqual([]);
    expect(expectedTools("dealbreakers")).toEqual([
      "job-search.profile.save-draft",
      "job-search.profile.approve"
    ]);
    expect(expectedTools("done")).toEqual(["job-search.onboarding.reset"]);
  });

  it("parses compensation chips and rejects ambiguous input", () => {
    expect(parseCompensation("$195k")).toEqual({ currency: "USD", minimum: 195000 });
    expect(parseCompensation("215,000")).toEqual({ currency: "USD", minimum: 215000 });
    expect(parseCompensation("about two hundred")).toBeNull();
    expect(parseCompensation("0")).toBeNull();
  });

  it("maps exactly one board token or URL without pretending to validate it", () => {
    expect(sourceQuery(" gitlab ")).toEqual({ board: "gitlab" });
    expect(sourceQuery("https://jobs.lever.co/acme")).toEqual({
      url: "https://jobs.lever.co/acme"
    });
    expect(sourceQuery("  ")).toBeNull();
  });
});

describe("Job Search onboarding controls (#1198)", () => {
  it("renders chip, add, and multi-select controls with approved labels", () => {
    const html = render(
      h(
        "div",
        null,
        h(ChipToggle, { on: true, inferred: true, onClick: () => undefined }, "Design Engineer"),
        h(AddInput, { placeholder: "Add a title", onAdd: () => undefined }),
        h(MultiControl, {
          options: ["Staff Product Designer", "Principal Designer"],
          initial: ["Staff Product Designer"],
          addPlaceholder: "Add a title",
          cta: "Track these titles",
          min: 1,
          onSubmit: () => undefined
        })
      )
    );
    expect(html).toContain("Design Engineer");
    expect(html).toContain("inferred");
    expect(html).toContain("Add a title");
    expect(html).toContain("Track these titles");
  });

  it("renders the real 5 MiB PDF/DOCX dropzone and paste fallback without emoji", () => {
    const html = render(
      h(ResumeDropzone, {
        showPaste: true,
        error: "Could not extract that file.",
        onFile: () => undefined,
        onPaste: () => undefined
      })
    );
    expect(html).toContain("Drop your resume, or browse");
    expect(html).toContain("PDF · DOCX · up to 5 MB");
    expect(html).toContain(
      'accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,.docx"'
    );
    expect(html).toContain("Paste resume text instead");
    expect(html).not.toContain("📄");
  });

  it("requires source config values and uses adapter config hints", () => {
    const html = render(
      h(SourcesControl, {
        sources: [
          {
            adapterId: "greenhouse",
            displayName: "Greenhouse job board",
            enabled: true,
            configHint: 'Greenhouse board token (e.g. "gitlab")'
          },
          {
            adapterId: "workday",
            displayName: "Workday",
            enabled: true,
            configHint: "Unsupported"
          }
        ],
        onSubmit: () => undefined
      })
    );
    expect(html).toContain("Greenhouse job board");
    expect(html).toContain("Greenhouse board token");
    expect(html).toContain("Watch these 1 boards");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Workday");
  });

  it("renders critique and aside as escaped text, never resume content", () => {
    const html = render(
      h(
        "div",
        null,
        h(CritiqueCard, {
          summary: "Strong systems narrative <script>alert(1)</script>",
          strengths: ["Built a design system end to end"],
          cautions: ["Two metrics need sources"]
        }),
        h(ProfileAside, {
          values: {
            resume: "Approved · rev 7c22a1",
            titles: "Staff Product Designer, Principal Designer"
          }
        })
      )
    );
    expect(html).toContain("Read your resume · draft");
    expect(html).toContain("Strengths I’ll cite");
    expect(html).toContain("I’d source before citing");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("2/8");
    expect(html).toContain("Not yet");
  });

  it("renders final monitoring summary actions", () => {
    const html = render(
      h(Summary, {
        runTime: "7:00 AM daily",
        onContinue: () => undefined,
        onReset: () => undefined
      })
    );
    expect(html).toContain("Monitoring on · first run 7:00 AM daily");
    expect(html).toContain("Go to Job Search");
    expect(html).toContain("Start over");
  });
});

describe("Job Search onboarding orchestration (#1198 Task 3)", () => {
  it("builds the profile titles submit turn with exact text and control context", () => {
    const submit = buildProfileSubmit("titles", {
      targetTitles: ["Staff Product Designer", "Principal Designer"]
    });
    expect(submit).toEqual({
      text: "Staff Product Designer · Principal Designer",
      controlContext: {
        step: "profile",
        action: "titles",
        values: { targetTitles: ["Staff Product Designer", "Principal Designer"] }
      }
    });
  });

  it("wires a profile submit through submitTurn", async () => {
    const handle = fakeHandle();
    const submit = buildProfileSubmit("titles", {
      targetTitles: ["Staff Product Designer", "Principal Designer"]
    });
    await handle.submitTurn(submit);
    expect(handle.submitTurn).toHaveBeenCalledWith({
      text: "Staff Product Designer · Principal Designer",
      controlContext: {
        step: "profile",
        action: "titles",
        values: { targetTitles: ["Staff Product Designer", "Principal Designer"] }
      }
    });
  });

  it("composer submit returns handled and posts free text under the profile step", () => {
    const handle = fakeHandle();
    const onSubmitText = buildComposerSubmit("titles", handle);
    expect(onSubmitText("I prefer remote only")).toBe("handled");
    expect(handle.submitTurn).toHaveBeenCalledWith({
      text: "I prefer remote only",
      controlContext: { step: "profile", action: "freeform" }
    });
  });

  it("composer submit uses the phase itself as step outside the profile substeps", () => {
    const handle = fakeHandle();
    const onSubmitText = buildComposerSubmit("resume_intake", handle);
    onSubmitText("here is context");
    expect(handle.submitTurn).toHaveBeenCalledWith({
      text: "here is context",
      controlContext: { step: "resume_intake", action: "freeform" }
    });
  });

  it("advances on a matching executed result and clears the pending id", () => {
    const onAdvance = vi.fn();
    const records: AssistantRecordMirror[] = [
      {
        kind: "action_request",
        actionRequestId: "req-1",
        toolName: "job-search.profile.save-draft"
      },
      { kind: "action_result", actionRequestId: "req-1", outcome: "executed" }
    ];
    const result = advanceOnDurableEvent(records, new Set(), "dealbreakers", onAdvance);
    expect(onAdvance).toHaveBeenCalledOnce();
    expect(result.pendingIds.has("req-1")).toBe(false);
    expect(result.retry).toBe(false);
  });

  it("advances on a fresh standalone executed result for the active phase", () => {
    const onAdvance = vi.fn();
    const result = advanceOnDurableEvent(
      [
        {
          kind: "action_result",
          actionRequestId: "auto-1",
          toolName: "job-search.resume.import-attachment",
          outcome: "executed"
        }
      ],
      new Set(),
      "resume_intake",
      onAdvance,
      new Set()
    );

    expect(onAdvance).toHaveBeenCalledOnce();
    expect(result.processedIds.has("auto-1")).toBe(true);
  });

  it.each([
    ["error", "job-search.resume.import-attachment", new Set<string>()],
    ["allowed", "job-search.resume.import-attachment", new Set<string>()],
    ["executed", "job-search.monitor.save", new Set<string>()],
    ["executed", "job-search.resume.import-attachment", new Set(["standalone-1"])]
  ] as const)(
    "does not advance a standalone %s result when it is failed, unmatched, or stale",
    (outcome, toolName, processedIds) => {
      const onAdvance = vi.fn();
      advanceOnDurableEvent(
        [
          {
            kind: "action_result",
            actionRequestId: "standalone-1",
            toolName,
            outcome
          }
        ],
        new Set(),
        "resume_intake",
        onAdvance,
        processedIds
      );

      expect(onAdvance).not.toHaveBeenCalled();
    }
  );

  it("deduplicates repeated standalone terminal results", () => {
    const onAdvance = vi.fn();
    const record: AssistantRecordMirror = {
      kind: "action_result",
      actionRequestId: "auto-duplicate",
      toolName: "job-search.resume.import-attachment",
      outcome: "executed"
    };

    const result = advanceOnDurableEvent(
      [record, record],
      new Set(),
      "resume_intake",
      onAdvance,
      new Set()
    );

    expect(onAdvance).toHaveBeenCalledOnce();
    expect(result.processedIds.has("auto-duplicate")).toBe(true);
  });

  it("marks retry on denied without advancing", () => {
    const onAdvance = vi.fn();
    const records: AssistantRecordMirror[] = [
      {
        kind: "action_request",
        actionRequestId: "req-2",
        toolName: "job-search.profile.save-draft"
      },
      { kind: "action_result", actionRequestId: "req-2", outcome: "denied" }
    ];
    const result = advanceOnDurableEvent(records, new Set(), "dealbreakers", onAdvance);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(result.retry).toBe(true);
    expect(result.pendingIds.has("req-2")).toBe(false);
  });

  it("ignores requests for tools the active phase does not expect", () => {
    const onAdvance = vi.fn();
    const records: AssistantRecordMirror[] = [
      { kind: "action_request", actionRequestId: "req-3", toolName: "job-search.monitor.save" },
      { kind: "action_result", actionRequestId: "req-3", outcome: "executed" }
    ];
    const result = advanceOnDurableEvent(records, new Set(), "titles", onAdvance);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(result.pendingIds.size).toBe(0);
  });

  it("ignores allowed results and keeps the id pending", () => {
    const onAdvance = vi.fn();
    const records: AssistantRecordMirror[] = [
      {
        kind: "action_request",
        actionRequestId: "req-4",
        toolName: "job-search.profile.save-draft"
      },
      { kind: "action_result", actionRequestId: "req-4", outcome: "allowed" }
    ];
    const result = advanceOnDurableEvent(records, new Set(), "dealbreakers", onAdvance);
    expect(onAdvance).not.toHaveBeenCalled();
    expect(result.retry).toBe(false);
    expect(result.pendingIds.has("req-4")).toBe(true);
  });

  it("bootstraps by seeding once then reading onboarding, profile, resume, sources", async () => {
    const handle = fakeHandle();
    stubFetch(200, {
      invocation: { status: "succeeded", blockedReason: null, result: { status: "ok" } }
    });
    const outcome = await bootstrapOnboarding(handle);
    expect(handle.seedOnboarding).toHaveBeenCalledOnce();
    expect(outcome.kind).toBe("ok");
  });

  it("bootstraps to disabled when any read reports the module is off", async () => {
    const handle = fakeHandle();
    stubFetch(404, { error: "Assistant tool is not declared" });
    const outcome = await bootstrapOnboarding(handle);
    expect(outcome.kind).toBe("disabled");
  });

  it("renders the initial loading state before effects run", () => {
    const html = render(h(JobsOnboarding, { handle: fakeHandle(), hostActions }));
    expect(html).toContain("Loading");
  });

  it("serializes overlapping terminal-result refreshes and waits for durable phase change", async () => {
    let onboardingRead = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.includes("onboarding.get-state")
            ? onboardingStateBody(
                ["resume_intake", "resume_intake", "resume_critique"][onboardingRead++] ??
                  "resume_critique"
              )
            : onboardingStateBody("resume_intake")
      }))
    );
    let listener: ((records: readonly AssistantRecordMirror[]) => void) | undefined;
    const releaseSeed: Array<() => void> = [];
    let seedCalls = 0;
    let seedsInFlight = 0;
    let maxSeedsInFlight = 0;
    let captured: AssistantSurfaceViewPropsMirror | null = null;
    const handle = fakeHandle({
      Surface: (props) => {
        captured = props;
        return null;
      },
      seedOnboarding: vi.fn(async () => {
        seedCalls += 1;
        if (seedCalls === 1) return { ok: true };
        seedsInFlight += 1;
        maxSeedsInFlight = Math.max(maxSeedsInFlight, seedsInFlight);
        await new Promise<void>((resolve) =>
          releaseSeed.push(() => {
            seedsInFlight -= 1;
            resolve();
          })
        );
        return { ok: true };
      }),
      subscribeRecords: vi.fn((next) => {
        listener = next;
        return () => undefined;
      })
    });

    await act(async () => {
      create(h(JobsOnboarding, { handle, hostActions }) as never);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((captured?.activeControl as { type?: unknown } | null)?.type).toBe(ResumeDropzone);

    await act(async () => {
      listener?.([
        {
          kind: "action_result",
          actionRequestId: "auto-overlap-1",
          toolName: "job-search.resume.import-attachment",
          outcome: "executed"
        }
      ]);
      listener?.([
        {
          kind: "action_result",
          actionRequestId: "auto-overlap-2",
          toolName: "job-search.resume.import-attachment",
          outcome: "executed"
        }
      ]);
      await Promise.resolve();
    });
    expect(maxSeedsInFlight).toBe(1);

    await act(async () => {
      releaseSeed.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((captured?.activeControl as { type?: unknown } | null)?.type).toBe(ResumeDropzone);

    await act(async () => {
      releaseSeed.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(captured?.activeControl).toBeNull();
    expect(captured?.typing).toBe(true);
  });
});

function onboardingStateBody(step: string): unknown {
  return {
    invocation: {
      status: "succeeded",
      blockedReason: null,
      result: {
        status: "ok",
        step,
        completed: {},
        gates: { resumeApproved: false, profileApproved: false, monitorEnabled: false }
      }
    }
  };
}

async function mountComposed(step: string): Promise<AssistantSurfaceViewPropsMirror | null> {
  stubFetch(200, onboardingStateBody(step));
  let captured: AssistantSurfaceViewPropsMirror | null = null;
  const handle = fakeHandle({
    Surface: (props: AssistantSurfaceViewPropsMirror) => {
      captured = props;
      return null;
    }
  });
  await act(async () => {
    create(h(JobsOnboarding, { handle, hostActions }) as never);
  });
  // Bootstrap resolves through several microtask hops (fetch -> json -> the
  // module's Promise.all). A macrotask boundary guarantees every microtask
  // in that chain has drained before we inspect what Surface received.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return captured;
}

// #1198 Task 4 Step 0: JobsOnboarding must compute the phase from the
// bootstrapped snapshot and hand Surface a real activeControl/localRows/
// composer.onSubmitText — not just a bare composer placeholder.
describe("Job Search onboarding composition (#1198 Task 4 Step 0)", () => {
  it("wires the resume-intake phase to the dropzone control and scripted intro rows", async () => {
    const captured = await mountComposed("resume_intake");
    expect(captured).not.toBeNull();
    expect((captured?.activeControl as { type?: unknown } | null)?.type).toBe(ResumeDropzone);
    expect(captured?.localRows?.length ?? 0).toBeGreaterThan(0);
    expect(typeof captured?.composer?.onSubmitText).toBe("function");
  });
});
