import type { DataContextRunner } from "@jarv1s/db";
import { SettingsRepository } from "@jarv1s/settings";

/**
 * #1025 spec §4.4: job-search is an external module — "not installed" is the
 * admin+data DEFAULT (proves the UI's absent-module path); this function only
 * runs when the level composition explicitly wants the installed-module path
 * proven instead. "Installed" means the app.external_modules row shows
 * status='enabled' with matching manifest/package hashes (the module-registry
 * activation check, packages/module-registry) — NOT running the full
 * privileged module-reconcile download flow, which is out of scope for a seed.
 * Hashes are fake/deterministic (mirrors tests/integration/external-module-job-search-kv-isolation.test.ts's
 * 'sha256:job-search' fixture) since no real package is downloaded here.
 */
export async function seedJobSearchChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const repo = new SettingsRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    await repo.setExternalModuleEnabled(scopedDb, {
      id: "job-search",
      manifestHash: "sha256:uat-seed-job-search-manifest",
      packageHash: "sha256:uat-seed-job-search-package",
      actorUserId,
      requestId: "uat-seed-job-search-enable"
    });
  });
}
