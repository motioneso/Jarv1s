// external-modules/job-search/src/adapters/registry.ts
//
// JS-04 (#933): the only path from an adapter id to a fetchable adapter.
// Fail closed: an adapter resolves for FETCH only when its compliance review
// is "allowed" AND it is not kill-switched. KILL_SWITCHED is a release-flipped
// policy lever (a board changes its terms → ship a release with the id added);
// disablement stops new fetches but leaves stored captures and the metadata
// listing readable — users keep their own historical data.
import { ashbyAdapter } from "./ashby.js";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import type { ComplianceStatus, SourceAdapter } from "./types.js";

export interface SourceAdapterInfo {
  readonly adapterId: string;
  readonly displayName: string;
  readonly hosts: readonly string[];
  readonly policyUrl: string;
  readonly reviewedAt: string;
  // Coordinator mandate (plan approval 2026-07-11): surface the automated-
  // review attribution so nobody reads the listing as a human legal review.
  readonly reviewedBy: string;
  readonly status: ComplianceStatus;
  readonly courtesyMinutes: number;
  readonly configHint: string;
  readonly enabled: boolean;
}

export const SOURCE_ADAPTERS: readonly SourceAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter
];

export const KILL_SWITCHED: ReadonlySet<string> = new Set();

export function activeAdapters(
  adapters: readonly SourceAdapter[],
  killSwitched: ReadonlySet<string>
): readonly SourceAdapter[] {
  return adapters.filter((a) => a.compliance.status === "allowed" && !killSwitched.has(a.id));
}

export function getSourceAdapter(id: string): SourceAdapter | null {
  return activeAdapters(SOURCE_ADAPTERS, KILL_SWITCHED).find((a) => a.id === id) ?? null;
}

export function listSourceAdapters(): readonly SourceAdapterInfo[] {
  return SOURCE_ADAPTERS.map((a) => ({
    adapterId: a.id,
    displayName: a.displayName,
    hosts: a.fetchHosts,
    policyUrl: a.compliance.policyUrl,
    reviewedAt: a.compliance.reviewedAt,
    reviewedBy: a.compliance.reviewedBy,
    status: a.compliance.status,
    courtesyMinutes: Math.round(a.courtesyIntervalMs / 60_000),
    configHint: a.configHint,
    enabled: a.compliance.status === "allowed" && !KILL_SWITCHED.has(a.id)
  }));
}
