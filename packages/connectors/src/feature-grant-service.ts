import type { DataContextDb } from "@jarv1s/db";

import { featureGrantsPrefKey, resolveEffectiveGrants } from "./feature-grants.js";
import type { ConnectorsRepository } from "./repository.js";

/**
 * Read-only service that resolves which connected accounts have a given feature granted.
 * Declared here so callers (email, calendar, briefings, chat gateway) can use structural
 * typing without a runtime @jarv1s/connectors package dependency.
 *
 * Passed to read-tool execute calls via the services 4th argument so revoked-account
 * cached rows are dropped in all three read paths: chat, briefings, cross-tool reasoning.
 */
export interface FeatureGrantService {
  grantedAccountIds(
    scopedDb: DataContextDb,
    feature: "email" | "calendar"
  ): Promise<ReadonlySet<string>>;
}

/**
 * Build a FeatureGrantService backed by connectors' existing resolveEffectiveGrants logic.
 * One listAccounts query + per-account pref read per call — instant revoke semantics (no cache).
 */
export function buildFeatureGrantService(deps: {
  connectorsRepository: ConnectorsRepository;
  preferencesRepository: { get(scopedDb: DataContextDb, key: string): Promise<unknown> };
}): FeatureGrantService {
  return {
    async grantedAccountIds(scopedDb, feature) {
      const accounts = await deps.connectorsRepository.listAccounts(scopedDb);
      const ids = new Set<string>();
      for (const account of accounts) {
        const stored = await deps.preferencesRepository.get(
          scopedDb,
          featureGrantsPrefKey(account.id)
        );
        if (resolveEffectiveGrants(account.scopes, stored)[feature]) {
          ids.add(account.id);
        }
      }
      return ids;
    }
  };
}
