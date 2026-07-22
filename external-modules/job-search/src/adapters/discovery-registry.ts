// external-modules/job-search/src/adapters/discovery-registry.ts
//
// JS-10 (#1229): the discovery sibling of registry.ts — the only path from an
// adapter id to a fetchable JobDiscoveryProvider. Same fail-closed contract as
// the board registry: a provider resolves for FETCH only when its compliance
// review is "allowed" AND it is not kill-switched. DISCOVERY_KILL_SWITCHED is a
// release-flipped policy lever (freehire.dev changes its terms → ship a release
// with "freehire" added); disablement stops new fetches but leaves stored
// captures and the metadata listing readable — users keep their own data.
//
// Names are deliberately distinct from registry.ts (DISCOVERY_* /
// activeDiscoveryProviders / getDiscoveryProvider) so the adapters barrel can
// re-export both registries without collision.
import { freehireProvider } from "./freehire.js";
import type { JobDiscoveryProvider } from "./discovery-types.js";
import type { ComplianceStatus } from "./types.js";

export interface DiscoveryProviderInfo {
  readonly adapterId: string;
  readonly displayName: string;
  readonly hosts: readonly string[];
  readonly policyUrl: string;
  readonly reviewedAt: string;
  // Surface the automated-review attribution so nobody reads the listing as a
  // human legal review (same mandate as SourceAdapterInfo.reviewedBy).
  readonly reviewedBy: string;
  readonly status: ComplianceStatus;
  readonly courtesyMinutes: number;
  readonly enabled: boolean;
}

export const DISCOVERY_PROVIDERS: readonly JobDiscoveryProvider[] = [freehireProvider];

export const DISCOVERY_KILL_SWITCHED: ReadonlySet<string> = new Set();

export function activeDiscoveryProviders(
  providers: readonly JobDiscoveryProvider[],
  killSwitched: ReadonlySet<string>
): readonly JobDiscoveryProvider[] {
  return providers.filter((p) => p.compliance.status === "allowed" && !killSwitched.has(p.id));
}

export function getDiscoveryProvider(id: string): JobDiscoveryProvider | null {
  return (
    activeDiscoveryProviders(DISCOVERY_PROVIDERS, DISCOVERY_KILL_SWITCHED).find(
      (p) => p.id === id
    ) ?? null
  );
}

export function listDiscoveryProviders(): readonly DiscoveryProviderInfo[] {
  return DISCOVERY_PROVIDERS.map((p) => ({
    adapterId: p.id,
    displayName: p.displayName,
    hosts: p.fetchHosts,
    policyUrl: p.compliance.policyUrl,
    reviewedAt: p.compliance.reviewedAt,
    reviewedBy: p.compliance.reviewedBy,
    status: p.compliance.status,
    courtesyMinutes: Math.round(p.courtesyIntervalMs / 60_000),
    enabled: p.compliance.status === "allowed" && !DISCOVERY_KILL_SWITCHED.has(p.id)
  }));
}
