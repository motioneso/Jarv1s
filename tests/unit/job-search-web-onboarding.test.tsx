import "./helpers/install-module-runtime";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
import { h } from "../../external-modules/job-search/src/web/runtime.js";

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
