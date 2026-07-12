// external-modules/job-search/src/web/format.ts
// JS-06 (#935): pure display helpers, unit-tested. "Local due time" is the
// monitor's configured wall-clock + IANA zone verbatim — no cross-timezone
// HH:MM arithmetic (fragile without a tz library; flagged in the plan).
export const STEP_LABELS: Record<string, string> = {
  resume_intake: "Share your resume",
  resume_critique: "Review the critique",
  resume_approval: "Approve a resume revision",
  profile: "Build your search profile",
  sources_schedule: "Choose sources & schedule",
  review_enable: "Review & enable monitoring"
};

const STEP_ORDER = Object.keys(STEP_LABELS);

export function onboardingProgress(completed: Record<string, boolean>): {
  done: number;
  total: 6;
  percent: number;
} {
  const done = STEP_ORDER.filter((step) => completed[step] === true).length;
  return { done, total: 6, percent: Math.round((done / 6) * 100) };
}

export function dueLabel(dueTime: string, timezone: string): string {
  return `daily at ${dueTime} · ${timezone}`;
}

export function whenLabel(iso: string | undefined): string {
  if (!iso) return "never";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "never" : date.toLocaleString();
}
