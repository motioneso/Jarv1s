import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";

import { DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { getJarvisDatabaseUrls } from "@jarv1s/db";

/**
 * #1025 hard invariant (tier=sensitive): dev-only privileged connection for the
 * app.users / app.auth_accounts bootstrap ONLY (spec §4.1). jarvis_migration_owner
 * is migration-class tooling — NOSUPERUSER/NOBYPASSRLS, member of jarvis_auth_runtime
 * only (infra/postgres/bootstrap/0000_roles.sql) — never grant it BYPASSRLS or widen
 * it to jarvis_app_runtime; that would violate the "no BYPASSRLS on runtime roles"
 * hard invariant (CLAUDE.md) by turning migration-owner into a de facto bypass role.
 */
export function createMigrationOwnerDb(): Kysely<JarvisDatabase> {
  const { migration } = getJarvisDatabaseUrls();
  return new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: migration }) })
  });
}

/**
 * #1025: every feature chunk (news/sports/tasks/calendar/notes) writes through this
 * connection + DataContextRunner.withDataContext, exactly the path production
 * requests take. jarvis_migration_owner cannot write these tables — every
 * feature table in this codebase has FORCE ROW LEVEL SECURITY scoped
 * `TO jarvis_app_runtime` (confirmed via `grep -rn "FORCE ROW LEVEL SECURITY"
 * packages/*\/sql/*.sql`), and jarvis_migration_owner is not a member of that
 * role. Using the real app_runtime connection + real repository methods means
 * every seeded row is written exactly the way a real request would write it —
 * no RLS carve-out, no bypass.
 */
export function createAppRuntimeRunner(): DataContextRunner {
  const { app } = getJarvisDatabaseUrls();
  const rootDb = new Kysely<JarvisDatabase>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: app }) })
  });
  return new DataContextRunner(rootDb);
}
