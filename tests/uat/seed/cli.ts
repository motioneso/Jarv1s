import { createMigrationOwnerDb } from "./connections.js";
import { assertTargetIsEphemeral } from "./guard.js";
import { parseUatExcludeChunks, parseUatSeedLevel } from "./level-validation.js";
import { seedLevel } from "./levels.js";

/**
 * #1025: entrypoint for the new `seed` ops-profile compose service (see
 * infra/docker-compose.prod.yml) — runs inside the compose network since
 * postgres publishes no host port, so this can never be invoked as a plain
 * host-side script (see plan's "Architecture decisions" section).
 */
async function main(): Promise<void> {
  // #1025/#1000 (Coordinator ruling, binding): hard-refuse unless the caller
  // proves this is the ephemeral UAT compose stack. composeSeedHook is the
  // ONLY caller that sets this token (Task 7 Step 3) — a real prod deploy
  // never does, so a stray `docker compose --profile ops run seed` against a
  // prod-shaped stack fails closed instead of seeding fixture data into it.
  if (process.env.JARVIS_UAT_SEED_CONFIRM !== "1") {
    throw new Error(
      "[uat-seed] refusing to run: JARVIS_UAT_SEED_CONFIRM=1 not set — this entrypoint only runs " +
        "inside the ephemeral UAT compose stack (see tests/uat/provisioner.ts composeSeedHook)"
    );
  }

  // #1082: the env token is necessary-not-sufficient. Inspect the target itself
  // before any fixture write so an exported token cannot turn this CLI into a
  // production bootstrap-owner backdoor.
  const db = createMigrationOwnerDb();
  try {
    await assertTargetIsEphemeral(db);
  } finally {
    await db.destroy();
  }

  // #1087 finding 5: fail closed on an unrecognized level/chunk name rather than
  // silently falling through — a typo like "solo_admin" used to cast clean and
  // seed FULL admin+data (max data, exit 0). Runs after the #1082 ephemeral-target
  // guard above (never reorder/remove that guard); wasting its DB round-trip on a
  // request we're about to reject anyway is an acceptable cost for keeping the
  // guard first.
  const level = parseUatSeedLevel(process.env.JARVIS_UAT_SEED_LEVEL ?? "bare");
  const excludeChunks = parseUatExcludeChunks(process.env.JARVIS_UAT_SEED_EXCLUDE_CHUNKS ?? "");
  const withoutNewsJsonBinding = process.env.JARVIS_UAT_WITHOUT_NEWS_JSON_BINDING === "1";

  await seedLevel({ level, excludeChunks, withoutNewsJsonBinding });
  console.log(
    `[uat-seed] seeded level "${level}"${excludeChunks.length ? ` (excluding: ${excludeChunks.join(", ")})` : ""}`
  );
}

main().catch((error) => {
  console.error("[uat-seed] failed:", error);
  process.exitCode = 1;
});
