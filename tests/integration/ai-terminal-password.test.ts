import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import {
  hasTerminalPassword,
  setTerminalPassword,
  verifyTerminalPassword
} from "../../packages/ai/src/terminal-password-repository.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// #1059: owner step-up terminal password storage. RLS on app.ai_terminal_password is admin-only
// for every verb (FOR ALL USING/WITH CHECK current_actor_is_admin()), so this suite must run under
// a real admin AccessContext — mirrors tests/integration/chat-multiplexer-admin.test.ts's harness
// (probe-seeded adminUser, DataContextRunner.withDataContext).
describe("terminal password storage (#1059)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  const adminCtx = { actorUserId: ids.adminUser, requestId: "test:ai-terminal-password" };

  beforeAll(() => {
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
  });

  beforeEach(async () => {
    await resetFoundationDatabase();
  });

  afterAll(async () => {
    await appDb?.destroy();
  });

  it("has no password until set, then set/verify round-trips the scrypt hash", async () => {
    await dataContext.withDataContext(adminCtx, async (db) => {
      // Nothing set yet — the singleton row does not exist.
      expect(await hasTerminalPassword(db)).toBe(false);

      await setTerminalPassword(db, "s3cret-1059");

      // Row now exists...
      expect(await hasTerminalPassword(db)).toBe(true);
      // ...and verifies against the correct plaintext via better-auth's scrypt compare...
      expect(await verifyTerminalPassword(db, "s3cret-1059")).toBe(true);
      // ...but never against the wrong plaintext (the stored value is a hash, not the password).
      expect(await verifyTerminalPassword(db, "wrong")).toBe(false);
    });
  });
});
