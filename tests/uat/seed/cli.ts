import { seedLevel } from "./levels.js";
import type { UatSeedChunk, UatSeedLevel } from "./types.js";

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

  const level = (process.env.JARVIS_UAT_SEED_LEVEL ?? "bare") as UatSeedLevel;
  const excludeChunks = (process.env.JARVIS_UAT_SEED_EXCLUDE_CHUNKS ?? "")
    .split(",")
    .map((chunk) => chunk.trim())
    .filter((chunk): chunk is UatSeedChunk => chunk.length > 0);

  await seedLevel({ level, excludeChunks });
  console.log(
    `[uat-seed] seeded level "${level}"${excludeChunks.length ? ` (excluding: ${excludeChunks.join(", ")})` : ""}`
  );
}

main().catch((error) => {
  console.error("[uat-seed] failed:", error);
  process.exitCode = 1;
});
