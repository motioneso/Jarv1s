import type { DataContextRunner } from "@jarv1s/db";
import { SettingsRepository } from "@jarv1s/settings";

/**
 * #1026: without this, the seeded bootstrap-owner has no "onboarding.state"
 * instance setting, so shouldShowOnboarding() (apps/web/src/onboarding/resume.ts)
 * defaults to "pending" and app.tsx renders OnboardingWizard instead of AppShell
 * on first load, hiding .jds-usermenu__trigger from every Playwright spec that
 * expects to land on the authenticated shell. This spec ladder's scope is
 * proving module install/settings flows, not onboarding, so mark it complete —
 * same "produce a ready-to-test instance" rationale as seedAiProviderChunk.
 * Goes through the real jarvis_app_runtime + DataContextDb path (not a raw
 * migrationDb insert): app.instance_settings has FORCE RLS scoped to
 * jarvis_app_runtime with an admin-gated INSERT policy (0059), and
 * jarvis_migration_owner is not a member of that role (tests/uat/seed/connections.ts)
 * — spec #1025 §4.1 reserves migrationDb for the app.users/app.auth_accounts
 * bootstrap only; every other table seeds through the real repository/runner.
 */
export async function seedOnboardingChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const repo = new SettingsRepository();
  await runner.withDataContext({ actorUserId }, async (scopedDb) => {
    await repo.setOnboardingState(scopedDb, {
      state: "completed",
      actorUserId,
      requestId: "uat-seed-onboarding-complete"
    });
  });
}
