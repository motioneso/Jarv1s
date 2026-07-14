/**
 * #1025/#1000: fixed epoch every seed chunk derives "recent" dates from. Never
 * replace with `new Date()` / `Date.now()` — the UAT seed must produce byte-identical
 * rows on every run so Playwright fixtures (#1026) don't flake against wall-clock drift.
 */
export const UAT_SEED_BASE_TIMESTAMP: Date = new Date("2026-01-15T12:00:00.000Z");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBefore(base: Date, days: number): Date {
  return new Date(base.getTime() - days * MS_PER_DAY);
}

export function daysAfter(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}
