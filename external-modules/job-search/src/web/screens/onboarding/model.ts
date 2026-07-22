// #1198: pure UI cursor over worker-owned durable checkpoints. Keeping this
// free of React and persistence makes a future richer rehydration contract a
// data change, not a state-machine rewrite.

export type ProfileSubstep = "titles" | "comp" | "workmode" | "locations" | "dealbreakers";

export type OnboardingPhase =
  | "resume_intake"
  | "resume_critique"
  | "resume_approval"
  | ProfileSubstep
  | "sources_schedule"
  | "done";

export interface ProfileFields {
  readonly targetTitles?: readonly string[];
  readonly compensation?: { readonly currency: "USD"; readonly minimum: number };
  readonly remotePreference?: readonly string[];
  readonly locations?: readonly string[];
  readonly dealbreakers?: readonly string[];
}

export interface ProfileProgress {
  readonly fields: ProfileFields;
  readonly completed: readonly string[];
}

export interface DurableOnboardingState extends Record<string, unknown> {
  readonly status: string;
  readonly step: string;
  readonly completed: Readonly<Record<string, boolean>>;
  readonly gates: {
    readonly resumeApproved: boolean;
    readonly profileApproved: boolean;
    readonly monitorEnabled: boolean;
  };
}

export interface OnboardingSnapshot {
  readonly onboarding: DurableOnboardingState;
  readonly profileProgress: ProfileProgress;
}

export interface SourceInfo {
  readonly adapterId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly configHint: string;
}

const PROFILE_ORDER: readonly ProfileSubstep[] = [
  "titles",
  "comp",
  "workmode",
  "locations",
  "dealbreakers"
];

const EXPECTED_TOOLS: Readonly<Record<OnboardingPhase, readonly string[]>> = {
  resume_intake: ["job-search.resume.import-attachment", "job-search.resume.save-draft"],
  resume_critique: ["job-search.resume.save-draft"],
  resume_approval: ["job-search.resume.approve"],
  titles: [],
  comp: [],
  workmode: [],
  locations: [],
  dealbreakers: ["job-search.profile.save-draft", "job-search.profile.approve"],
  sources_schedule: ["job-search.monitor.save"],
  done: ["job-search.onboarding.reset"]
};

export function derivePhase(snapshot: OnboardingSnapshot): OnboardingPhase {
  const step = snapshot.onboarding.step;
  if (step === "profile") {
    const completed = new Set(snapshot.profileProgress.completed);
    return PROFILE_ORDER.find((phase) => !completed.has(phase)) ?? "dealbreakers";
  }
  if (step === "sources_schedule" || step === "review_enable") return "sources_schedule";
  if (
    step === "resume_intake" ||
    step === "resume_critique" ||
    step === "resume_approval" ||
    step === "done"
  ) {
    return step;
  }
  return "resume_intake";
}

export function expectedTools(phase: OnboardingPhase): readonly string[] {
  return EXPECTED_TOOLS[phase];
}

export function parseCompensation(
  input: string
): { readonly currency: "USD"; readonly minimum: number } | null {
  const normalized = input.trim().toLowerCase().replace(/[$,]/g, "");
  const match = /^(\d+(?:\.\d+)?)\s*(k)?$/.exec(normalized);
  if (!match) return null;
  const amount = Number(match[1]) * (match[2] ? 1000 : 1);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { currency: "USD", minimum: Math.round(amount) };
}

/** Shape only; each adapter remains the authoritative token/URL validator. */
export function sourceQuery(
  value: string
): { readonly board: string } | { readonly url: string } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("https://") ? { url: trimmed } : { board: trimmed };
}

// JS-10 (#1229): broad-discovery derivation. DEFAULT_BROAD_MAX_RESULTS mirrors
// MAX_BROAD_POSTINGS_PER_RUN (fetch-discovery.ts) — kept as a literal here so
// this pure UI module never imports worker internals (see file header).
const DEFAULT_BROAD_COUNTRY = "us";
const DEFAULT_BROAD_MAX_RESULTS = 50;

export interface BroadSearchSummary {
  readonly titles: readonly string[];
  readonly locations: readonly string[];
  readonly remote: boolean;
  readonly country: string;
  readonly maxResults: number;
}

/**
 * Pure derivation of the broad-discovery query summary from the approved
 * profile — no React, so it's unit-testable without rendering. ProfileFields
 * has no country field, so country always defaults "us" (the same default
 * parseBroadQuery applies server-side). remote is a coarse true/false: any
 * remotePreference answer containing "remote" (e.g. "Remote-first") counts.
 * Only titles/locations/remote/country/maxResults are read from fields —
 * compensation and dealbreakers never reach the broad query (outbound
 * minimization, same rule the worker's parseBroadQuery enforces).
 */
export function deriveBroadSearch(fields: ProfileFields): BroadSearchSummary {
  return {
    titles: fields.targetTitles ?? [],
    locations: fields.locations ?? [],
    remote: (fields.remotePreference ?? []).some((value) => /remote/i.test(value)),
    country: DEFAULT_BROAD_COUNTRY,
    maxResults: DEFAULT_BROAD_MAX_RESULTS
  };
}
