import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DataContextRunner, createDatabase, type MossDatabase } from "@moss/db";
import { PreferencesRepository } from "@moss/structured-state";
import {
  LEGACY_AGENCY_AUTO_EXECUTE_KEY,
  TASK_CHANGES_POLICY_KEY,
  TasksCompatibilityHelper
} from "../../packages/tasks/src/action-policy.js";
import type { Kysely } from "kysely";
import pg from "pg";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

const legacyOnlyUserId = "00000000-0000-4000-8000-000000000005";
const tieBreakUserId = "00000000-0000-4000-8000-000000000006";

describe("tasks action policy self-heal (getResolvedTaskChangesPolicy, #1311 tasks-side fix)", () => {
  let appDb: Kysely<MossDatabase>;
  let runner: DataContextRunner;
  let prefs: PreferencesRepository;
  let helper: TasksCompatibilityHelper;

  beforeAll(async () => {
    await resetFoundationDatabase();
    const client = new Client({ connectionString: connectionStrings.bootstrap });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1, 'tasks-legacy@example.test', false)`,
        [legacyOnlyUserId]
      );
      await client.query(
        `INSERT INTO app.users (id, email, is_instance_admin) VALUES ($1, 'tasks-tiebreak@example.test', false)`,
        [tieBreakUserId]
      );
    } finally {
      await client.end();
    }
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 2 });
    runner = new DataContextRunner(appDb);
    prefs = new PreferencesRepository();
    helper = new TasksCompatibilityHelper(prefs);
  });

  afterAll(async () => {
    await appDb.destroy();
  });

  it("neither canonical nor legacy set: heals to trusted_auto and persists the canonical key", async () => {
    const actorUserId = ids.userA;
    const tier = await runner.withDataContext(
      { actorUserId, requestId: "req-neither" },
      (scopedDb) => helper.getResolvedTaskChangesPolicy(scopedDb)
    );
    expect(tier).toBe("trusted_auto");

    const stored = await runner.withDataContext(
      { actorUserId, requestId: "req-neither-check" },
      (scopedDb) => prefs.getWithMetadata<string>(scopedDb, TASK_CHANGES_POLICY_KEY)
    );
    expect(stored?.value).toBe("trusted_auto");
  });

  it("revocation survives: explicit always_confirm is never overwritten by the install heal", async () => {
    const actorUserId = ids.userB;
    await runner.withDataContext({ actorUserId, requestId: "req-revoke-seed" }, (scopedDb) =>
      helper.setTaskChangesPolicy(scopedDb, "always_confirm")
    );

    const tier = await runner.withDataContext(
      { actorUserId, requestId: "req-revoke-check" },
      (scopedDb) => helper.getResolvedTaskChangesPolicy(scopedDb)
    );
    expect(tier).toBe("always_confirm");
  });

  it("re-read, not assert: a row that lands between the neither-check and the heal wins", async () => {
    const actorUserId = ids.adminUser;
    // Simulate a concurrent write racing the install-time heal: seed an explicit always_confirm
    // choice directly, then invoke the exact same code path getResolvedTaskChangesPolicy's
    // neither-branch calls. grantInstallTimeTrustIfUnset's NOT-EXISTS guard must no-op against
    // the pre-seeded row, and the re-read must return what's actually stored, not "trusted_auto".
    await runner.withDataContext({ actorUserId, requestId: "req-race-seed" }, (scopedDb) =>
      prefs.upsert(scopedDb, TASK_CHANGES_POLICY_KEY, "always_confirm")
    );

    const tier = await runner.withDataContext(
      { actorUserId, requestId: "req-race-heal" },
      (scopedDb) => helper.healInstallGrantAndReread(scopedDb)
    );
    expect(tier).toBe("always_confirm");
  });

  it("both keys exist: canonical always_confirm wins even when legacy is written more recently", async () => {
    // Regression test for the tie-break bug found by the "revocation survives" test above:
    // setTaskChangesPolicy always writes canonical then legacy, so legacy's updated_at is
    // essentially always >= canonical's. A timestamp-based tie-break would pick legacy's boolean
    // here -- which can only encode trusted_auto/ask_each_time -- and silently drop
    // always_confirm back to ask_each_time. Seed canonical first, legacy second (so legacy is
    // unambiguously newer), and confirm the resolver returns canonical's value regardless.
    const actorUserId = tieBreakUserId;
    await runner.withDataContext({ actorUserId, requestId: "req-tiebreak-canonical" }, (scopedDb) =>
      prefs.upsert(scopedDb, TASK_CHANGES_POLICY_KEY, "always_confirm")
    );
    await runner.withDataContext({ actorUserId, requestId: "req-tiebreak-legacy" }, (scopedDb) =>
      prefs.upsert(scopedDb, LEGACY_AGENCY_AUTO_EXECUTE_KEY, false)
    );

    const tier = await runner.withDataContext(
      { actorUserId, requestId: "req-tiebreak-check" },
      (scopedDb) => helper.getResolvedTaskChangesPolicy(scopedDb)
    );
    expect(tier).toBe("always_confirm");
  });

  it("legacy-only branch is unchanged: a legacy revocation resolves to ask_each_time", async () => {
    const actorUserId = legacyOnlyUserId;
    await runner.withDataContext({ actorUserId, requestId: "req-legacy-seed" }, (scopedDb) =>
      prefs.upsert(scopedDb, LEGACY_AGENCY_AUTO_EXECUTE_KEY, false)
    );

    const tier = await runner.withDataContext(
      { actorUserId, requestId: "req-legacy-check" },
      (scopedDb) => helper.getResolvedTaskChangesPolicy(scopedDb)
    );
    expect(tier).toBe("ask_each_time");
  });
});
