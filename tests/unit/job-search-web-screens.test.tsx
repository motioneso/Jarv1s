// tests/unit/job-search-web-screens.test.tsx
// JS-06 (#935): renderToString view tests for the external surface. The
// runtime helper must be the first import (installs the host global before any
// module source captures it). Screens split container (hooks) from exported
// pure Views so fixtures render synchronously without fetch.
import "./helpers/install-module-runtime";

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Contribution from "../../external-modules/job-search/src/web/index.js";
import { STEP_LABELS, whenLabel } from "../../external-modules/job-search/src/web/format.js";
import { RootView } from "../../external-modules/job-search/src/web/root.js";
import { h } from "../../external-modules/job-search/src/web/runtime.js";
import { OnboardingView } from "../../external-modules/job-search/src/web/screens/onboarding.js";
import {
  bucketFromPath,
  hashFromPath,
  listInputForBucket,
  OpportunitiesScreen,
  OpportunitiesView,
  type OpportunityListResult
} from "../../external-modules/job-search/src/web/screens/opportunities.js";
import {
  OpportunityDetailView,
  type OpportunityDetailResult
} from "../../external-modules/job-search/src/web/screens/opportunity-detail.js";
import {
  OverviewView,
  type MonitorSummary,
  type OnboardingState
} from "../../external-modules/job-search/src/web/screens/overview.js";
import {
  MonitorsView,
  runStateLabel,
  type MonitorDetail
} from "../../external-modules/job-search/src/web/screens/monitors.js";
import {
  ProfileView,
  type ProfileResult,
  type ResumeResult
} from "../../external-modules/job-search/src/web/screens/profile.js";
import { starterDraftForStep } from "../../external-modules/job-search/src/web/starter-drafts.js";
import {
  DisabledState,
  EmptyState,
  ErrorState,
  LoadingState
} from "../../external-modules/job-search/src/web/states.js";

function render(node: unknown): string {
  return renderToString(node as never);
}

const onboardingFixture: OnboardingState = {
  step: "profile",
  completed: { resume_intake: true, resume_critique: true, resume_approval: true },
  gates: { resumeApproved: true, profileApproved: false, monitorEnabled: false }
};

const monitorsFixture: MonitorSummary[] = [
  {
    monitorId: "m1",
    adapterId: "greenhouse",
    enabled: true,
    timezone: "America/New_York",
    dueTime: "07:00"
  }
];

const noopHost = { openAssistant: () => undefined };

describe("job-search authored states (#935)", () => {
  it("loading state announces via role=status", () => {
    const html = render(h(LoadingState, { label: "Loading monitors" }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading monitors");
    expect(html).toContain("jds-card");
  });

  it("error state uses role=alert", () => {
    expect(render(h(ErrorState, { message: "Request failed (500)" }))).toContain('role="alert"');
  });

  it("disabled state preserves-data copy and offers no actions", () => {
    const html = render(h(DisabledState, null));
    expect(html).toContain("turned off");
    expect(html).toContain("data is preserved");
    expect(html).not.toContain("<button");
  });

  it("empty state renders title and body", () => {
    const html = render(
      h(EmptyState, { title: "No monitors yet", body: "Set one up with Jarvis." })
    );
    expect(html).toContain("No monitors yet");
  });
});

describe("job-search starter drafts (#935)", () => {
  it("has a draft for every checkpoint and the done state, all under the host cap", () => {
    for (const step of [
      "resume_intake",
      "resume_critique",
      "resume_approval",
      "profile",
      "sources_schedule",
      "review_enable",
      "done"
    ]) {
      const draft = starterDraftForStep(step);
      expect(draft.length).toBeGreaterThan(10);
      expect(draft.length).toBeLessThan(1000);
      // Host sanitizer fail-closes on control characters — never ship one.
      // eslint-disable-next-line no-control-regex
      expect(draft).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    }
  });
});

describe("job-search Root contract (#935)", () => {
  it("default export keeps web contract v1 with a Root component", () => {
    expect(Contribution.contractVersion).toBe(1);
    expect(typeof Contribution.Root).toBe("function");
  });

  it("renders exactly the four approved tabs after onboarding", () => {
    const html = render(
      h(RootView, {
        path: "/",
        onboardingStep: "done",
        hostActions: { openAssistant: () => undefined }
      })
    );

    expect(html).toContain("Job Search");
    expect(html).toContain('aria-current="page"');
    for (const label of ["Overview", "Matches", "Monitors", "Profile"]) {
      expect(html).toContain(label);
    }
    for (const retired of ["Onboarding", "Profile &amp; resume", "Opportunities"]) {
      expect(html).not.toContain(retired);
    }
    expect(html).toContain('aria-live="polite"');
  });

  it("replaces the tab shell with the Lane E placeholder during first run", () => {
    const html = render(
      h(RootView, {
        path: "/",
        onboardingStep: "profile",
        hostActions: { openAssistant: () => undefined }
      })
    );

    expect(html).toContain("Setting up your job search");
    expect(html).toContain("Guided onboarding will appear here");
    expect(html).not.toContain("Job Search sections");
    expect(html).not.toContain('href="/m/job-search/matches"');
  });
});

describe("job-search overview view (#935)", () => {
  it("shows onboarding progress, approval gates, and monitor health", () => {
    const html = render(
      h(OverviewView, {
        onboarding: onboardingFixture,
        monitors: monitorsFixture,
        hostActions: noopHost
      })
    );
    expect(html).toContain("3 of 6");
    expect(html).toContain("Resume approved");
    expect(html).toContain("Profile pending");
    expect(html).toContain("1 enabled");
    expect(html).toContain("daily at 07:00 · America/New_York");
  });

  it("with no monitors, offers the assistant handoff instead of health", () => {
    const html = render(
      h(OverviewView, { onboarding: onboardingFixture, monitors: [], hostActions: noopHost })
    );
    expect(html).toContain("No monitors yet");
  });
});

describe("job-search onboarding view (#935)", () => {
  it("lists the six checkpoints with done/current/todo status", () => {
    const html = render(h(OnboardingView, { state: onboardingFixture, hostActions: noopHost }));
    for (const label of [
      "Share your resume",
      "Review the critique",
      "Approve a resume revision",
      "Build your search profile",
      "Choose sources & schedule",
      "Review & enable monitoring"
    ]) {
      // renderToString HTML-escapes text nodes ("&" → "&amp;").
      expect(html).toContain(label.replace(/&/g, "&amp;"));
    }
    expect(html).toContain("Done"); // completed steps
    expect(html).toContain("Current"); // the active step badge
    expect(html).toContain("Continue with Jarvis");
  });

  it("celebrates completion without a continue action", () => {
    const html = render(
      h(OnboardingView, {
        state: {
          step: "done",
          completed: Object.fromEntries(Object.keys(STEP_LABELS).map((s) => [s, true])),
          gates: { resumeApproved: true, profileApproved: true, monitorEnabled: true }
        },
        hostActions: noopHost
      })
    );
    expect(html).toContain("Onboarding complete");
    expect(html).not.toContain("Continue with Jarvis");
  });
});

const profileFixture: ProfileResult = {
  status: "ok",
  active: {
    revisionId: "rev-profile-1",
    createdAt: "2026-07-10T12:00:00.000Z",
    provenance: "user",
    // Hostile external string — must render escaped, never as markup.
    fields: { targetTitles: ["Staff Engineer", "<script>alert(1)</script>"] }
  },
  draftRevisionIds: []
};

const resumeFixture: ResumeResult = {
  status: "ok",
  revisionId: "rev-resume-12345678",
  kind: "markdown",
  createdAt: "2026-07-09T12:00:00.000Z",
  critiqueSummary: "Strong impact bullets; <b>tighten</b> the summary."
};

describe("job-search profile view (#935)", () => {
  it("shows approved revision metadata and return-to-assistant actions", () => {
    const html = render(
      h(ProfileView, { profile: profileFixture, resume: resumeFixture, hostActions: noopHost })
    );
    expect(html).toContain("rev-resu"); // short revision id
    expect(html).toContain("Staff Engineer");
    expect(html).toContain("Refine with Jarvis");
    expect(html).toContain("Update with Jarvis");
  });

  it("renders external strings as text, never markup", () => {
    const html = render(
      h(ProfileView, { profile: profileFixture, resume: resumeFixture, hostActions: noopHost })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>tighten</b>");
  });

  it("without a resume, prompts the assistant handoff", () => {
    const html = render(
      h(ProfileView, {
        profile: { status: "ok", active: null, draftRevisionIds: [] },
        resume: { status: "question" },
        hostActions: noopHost
      })
    );
    expect(html).toContain("No resume yet");
    expect(html).toContain("No profile yet");
  });
});

const monitorDetail: MonitorDetail = {
  monitorId: "m1",
  adapterId: "greenhouse",
  enabled: true,
  timezone: "America/New_York",
  dueTime: "07:00",
  lastCheckedAt: "2026-07-10T11:00:00.000Z",
  lastSuccessAt: "2026-07-10T11:00:00.000Z"
};

describe("job-search monitors view (#935)", () => {
  it("shows adapter, schedule, enabled state, and last success", () => {
    const html = render(h(MonitorsView, { monitors: [monitorDetail] }));
    expect(html).toContain("greenhouse");
    expect(html).toContain("daily at 07:00 · America/New_York");
    expect(html).toContain("Enabled");
    expect(html).toContain("Last success");
    expect(html).toContain("Run now");
  });

  it("maps run-now outcomes to announced labels", () => {
    expect(runStateLabel({ kind: "queued" })).toBe("Run queued");
    expect(runStateLabel({ kind: "already-queued" })).toBe("Already queued");
    expect(runStateLabel({ kind: "disabled" })).toBe("Module is turned off");
    expect(runStateLabel({ kind: "error", message: "Request failed (503)" })).toBe(
      "Could not queue the run"
    );
  });

  it("with no monitors renders the authored empty state", () => {
    expect(render(h(MonitorsView, { monitors: [] }))).toContain("No monitors yet");
  });
});

describe("job-search opportunities shell (#935)", () => {
  it("parses bucket routes with a new default", () => {
    expect(bucketFromPath("/opportunities")).toBe("new");
    expect(bucketFromPath("/opportunities/saved")).toBe("saved");
    expect(bucketFromPath("/opportunities/passed")).toBe("passed");
    expect(bucketFromPath("/opportunities/stale")).toBe("stale");
    expect(bucketFromPath("/opportunities/bogus")).toBe("new");
  });

  it("renders bucket tabs as focusable anchors and gates the list on loading", () => {
    // Cold store → server snapshot is "loading"; the nav must render anyway so
    // buckets stay reachable while the list fetches.
    const html = render(h(OpportunitiesScreen, { path: "/opportunities/saved" }));
    for (const label of ["New", "Saved", "Passed", "Stale"]) expect(html).toContain(label);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/m/job-search/opportunities/saved"');
    expect(html).toContain("Loading opportunities");
  });
});

// JS-08 (#937): feed cards over opportunities.list. Fixture strings are
// hostile on purpose (#960 pattern): posting titles/evidence are external,
// adversary-controlled content and must only ever render as literal text.
const feedFixture: OpportunityListResult = {
  status: "ok",
  view: "new",
  total: 2,
  limit: 20,
  offset: 0,
  opportunities: [
    {
      identityHash: "hash-aaa",
      status: "new",
      title: "Platform Engineer",
      company: "Nimbus Labs",
      location: "Remote, EU",
      workMode: "remote",
      source: "greenhouse",
      publishedAt: "2026-07-09T08:00:00.000Z",
      firstSeenAt: "2026-07-10T07:00:00.000Z",
      freshness: "fresh",
      fitBand: "strong",
      confidence: "high",
      topEvidence: "Six years of TypeScript platform work match the posting.",
      topGap: "Needs <script>alert(1)</script> review."
    },
    {
      identityHash: "hash-bbb",
      status: "new",
      title: "<img src=x onerror=alert(1)> Engineer",
      company: "Acme",
      source: "lever",
      firstSeenAt: "2026-07-11T07:00:00.000Z",
      freshness: "stale",
      evaluationPending: true
    }
  ]
};

describe("js-08 opportunity feed cards (#937)", () => {
  it("bucket filter drives the list tool input", () => {
    expect(listInputForBucket("new")).toEqual({ view: "new" });
    expect(listInputForBucket("saved")).toEqual({ view: "saved" });
  });

  it("renders cards with detail links, meta, badges, and evidence lines", () => {
    const html = render(
      h(OpportunitiesView, { bucket: "new", result: feedFixture, hasMonitors: true })
    );
    // Card title is an anchor into the detail route (keyboard reachable).
    expect(html).toContain('href="/m/job-search/opportunities/new/hash-aaa"');
    expect(html).toContain('href="/m/job-search/opportunities/new/hash-bbb"');
    expect(html).toContain("Platform Engineer");
    expect(html).toContain("Nimbus Labs");
    expect(html).toContain("Remote, EU");
    expect(html).toContain("remote");
    // Mono eyebrow: source + published/first-seen timestamp.
    expect(html).toContain("greenhouse");
    expect(html).toContain(whenLabel("2026-07-09T08:00:00.000Z"));
    // Evaluated card badges vs the pending card.
    expect(html).toContain("fresh");
    expect(html).toContain("Fit: strong");
    expect(html).toContain("Confidence: high");
    expect(html).toContain("Evaluation pending");
    expect(html).toContain("Six years of TypeScript platform work match the posting.");
    expect(html).toContain("Gap");
  });

  it("renders hostile posting strings as literal text, never markup (#960)", () => {
    const html = render(
      h(OpportunitiesView, { bucket: "new", result: feedFixture, hasMonitors: true })
    );
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; Engineer");
  });

  it("distinguishes monitors-running emptiness from unconfigured emptiness", () => {
    const empty: OpportunityListResult = { status: "ok", view: "new", opportunities: [] };
    const monitored = render(
      h(OpportunitiesView, { bucket: "new", result: empty, hasMonitors: true })
    );
    expect(monitored).toContain("No new opportunities yet");
    expect(monitored).toContain("monitoring runs");
    const unconfigured = render(
      h(OpportunitiesView, { bucket: "new", result: empty, hasMonitors: false })
    );
    expect(unconfigured).toContain("Set up monitoring with Jarvis");
  });

  it("degrades safely when the list result is not ok", () => {
    const html = render(
      h(OpportunitiesView, {
        bucket: "new",
        result: { status: "error", message: "boom" },
        hasMonitors: true
      })
    );
    expect(html).toContain('role="alert"');
  });
});

// JS-08 (#937): detail view over opportunities.get. Description and every
// posting field are external content — literal text only; the posting URL is
// additionally scheme-guarded (a javascript: URL must never become an href).
const detailFixture: OpportunityDetailResult = {
  status: "ok",
  opportunity: {
    identityHash: "hash-aaa",
    status: "saved",
    statusAt: "2026-07-11T09:00:00.000Z",
    decisionReason: "Great platform overlap.",
    firstSeenAt: "2026-07-10T07:00:00.000Z",
    lastSeenAt: "2026-07-11T07:00:00.000Z",
    freshness: "fresh",
    posting: {
      title: "Platform Engineer",
      company: "Nimbus Labs",
      location: "Remote, EU",
      url: "https://boards.example.com/jobs/123",
      workMode: "remote",
      employmentType: "full-time",
      compensation: "90k-110k EUR",
      publishedAt: "2026-07-09T08:00:00.000Z",
      description: "First line.\n\n<script>alert(1)</script> requirements follow.",
      descriptionTruncated: true,
      descriptionClipped: true
    },
    evaluation: {
      fitBand: "strong",
      recommendation: "apply",
      postingConfidence: "high",
      overallConfidence: "medium",
      summary: "Strong platform match.",
      evidence: [
        { requirement: "TypeScript", evidence: "Six years of platform work", source: "resume" }
      ],
      blockers: [],
      gaps: ["No Kubernetes operations experience"],
      unknowns: ["Visa sponsorship"],
      preferenceMatches: ["Remote-first"],
      preferenceConflicts: [],
      outdated: true,
      inputs: {
        opportunityContentHash: "content-hash-1",
        profileRevisionId: "rev-profile-1",
        resumeRevisionId: "rev-resume-1"
      }
    }
  }
};

describe("js-08 opportunity detail (#937)", () => {
  it("parses the detail hash from the path", () => {
    expect(hashFromPath("/opportunities/new/hash-aaa")).toBe("hash-aaa");
    expect(hashFromPath("/opportunities/saved")).toBeNull();
    expect(hashFromPath("/opportunities")).toBeNull();
  });

  it("renders posting header, truncation notices, and decision state with no write actions", () => {
    const html = render(h(OpportunityDetailView, { bucket: "new", result: detailFixture }));
    expect(html).toContain("<h2");
    expect(html).toContain("Platform Engineer");
    expect(html).toContain("Nimbus Labs");
    expect(html).toContain('href="https://boards.example.com/jobs/123"');
    expect(html).toContain('rel="noreferrer noopener"');
    // Both truncation flags surface: stored-side and response-side.
    expect(html).toContain("truncated at capture");
    expect(html).toContain("Shortened for display");
    // Decision state incl. owner-private reason (owner-only surface), and the
    // assistant handoff copy instead of any save/pass button.
    expect(html).toContain("saved");
    expect(html).toContain(whenLabel("2026-07-11T09:00:00.000Z"));
    expect(html).toContain("Great platform overlap.");
    expect(html).toContain("Ask the assistant to save or pass this opportunity");
    expect(html).not.toContain("<button");
    // Back link to the bucket list lives in the screen container (asserted in
    // the routing test below) so it stays reachable during loading/error too.
  });

  it("renders the evaluation block with evidence, lists, outdated banner, and inputs footnote", () => {
    const html = render(h(OpportunityDetailView, { bucket: "new", result: detailFixture }));
    expect(html).toContain("Fit: strong");
    expect(html).toContain("Recommendation: apply");
    expect(html).toContain("high");
    expect(html).toContain("medium");
    expect(html).toContain("Strong platform match.");
    expect(html).toContain("TypeScript");
    expect(html).toContain("Six years of platform work");
    expect(html).toContain("resume");
    expect(html).toContain("No Kubernetes operations experience");
    expect(html).toContain("Visa sponsorship");
    expect(html).toContain("Remote-first");
    expect(html).toContain("Evaluation outdated");
    expect(html).toContain("rev-profile-1");
    expect(html).toContain("rev-resume-1");
  });

  it("renders the description as pre-wrap literal text (#960)", () => {
    const html = render(h(OpportunityDetailView, { bucket: "new", result: detailFixture }));
    expect(html).toContain("jsm-prewrap");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("refuses to link a non-http(s) posting URL", () => {
    const hostile: OpportunityDetailResult = JSON.parse(JSON.stringify(detailFixture));
    hostile.opportunity!.posting.url = "javascript:alert(1)";
    const html = render(h(OpportunityDetailView, { bucket: "new", result: hostile }));
    expect(html).not.toContain("javascript:");
  });

  it("shows evaluation-pending copy when no evaluation exists", () => {
    const pending: OpportunityDetailResult = JSON.parse(JSON.stringify(detailFixture));
    delete pending.opportunity!.evaluation;
    const html = render(h(OpportunityDetailView, { bucket: "new", result: pending }));
    expect(html).toContain("Evaluation pending");
  });

  it("degrades to an alert when the result is not ok", () => {
    const html = render(
      h(OpportunityDetailView, {
        bucket: "new",
        result: { status: "error", message: "not found" }
      })
    );
    expect(html).toContain('role="alert"');
  });

  it("routes a hash path to the detail screen with its own loading state and back link", () => {
    const html = render(h(OpportunitiesScreen, { path: "/opportunities/saved/hash-zzz" }));
    expect(html).toContain("Loading opportunity");
    expect(html).toContain('href="/m/job-search/opportunities/saved"');
  });
});
