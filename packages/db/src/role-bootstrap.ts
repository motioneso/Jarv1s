import pg from "pg";

import type { JarvisDatabaseUrls } from "./urls.js";

const { Client } = pg;

export interface RolePasswordEntry {
  readonly role: string;
  readonly password: string;
}

/**
 * The development-default role passwords historically committed in the bootstrap
 * SQL and still used as local fallbacks by `getJarvisDatabaseUrls`. A production
 * bootstrap must never run with any of these.
 */
export const RUNTIME_ROLE_PASSWORD_DEFAULTS: ReadonlySet<string> = new Set([
  "migration_password",
  "app_password",
  "worker_password",
  "auth_password"
]);

const ROLE_URL_SOURCES: ReadonlyArray<{
  readonly role: string;
  readonly url: keyof JarvisDatabaseUrls;
}> = [
  { role: "jarvis_migration_owner", url: "migration" },
  { role: "jarvis_app_runtime", url: "app" },
  { role: "jarvis_worker_runtime", url: "worker" },
  { role: "jarvis_auth_runtime", url: "auth" }
];

/**
 * Derive the bootstrap role-password plan from the configured connection URLs.
 *
 * The connection URLs are the single source of truth: the same password used to
 * connect as a runtime role is the password the bootstrap step assigns to it, so
 * the two can never drift. Outside production the local dev fallbacks (which carry
 * the development-default passwords) are accepted as-is. In production the plan
 * fails closed — it refuses when any role password is missing or is still a
 * development default. Error messages name the role only, never the password.
 */
export function buildRolePasswordPlan(
  urls: JarvisDatabaseUrls,
  env: NodeJS.ProcessEnv = process.env
): RolePasswordEntry[] {
  const isProduction = env.NODE_ENV === "production";

  return ROLE_URL_SOURCES.map(({ role, url }) => {
    const password = new URL(urls[url]).password;

    if (isProduction) {
      if (!password) {
        throw new Error(
          `Role ${role} has no password in its configured connection URL; ` +
            `production role bootstrap cannot proceed.`
        );
      }
      if (RUNTIME_ROLE_PASSWORD_DEFAULTS.has(password)) {
        throw new Error(
          `Role ${role} is configured with a development-default password; ` +
            `refusing to bootstrap it in production.`
        );
      }
    }

    return { role, password };
  });
}

/**
 * Build the idempotent `ALTER ROLE` statement that assigns one role's password.
 * The role name and password are escaped via the `pg` client's
 * `escapeIdentifier`/`escapeLiteral` so arbitrary configured secrets cannot break
 * out of the statement.
 */
export function buildAlterRoleStatement(client: pg.Client, entry: RolePasswordEntry): string {
  return (
    `ALTER ROLE ${client.escapeIdentifier(entry.role)} ` +
    `WITH LOGIN PASSWORD ${client.escapeLiteral(entry.password)}`
  );
}

/**
 * Apply a role-password plan against the bootstrap (superuser) connection.
 *
 * Roles are created without passwords by the bootstrap SQL; this step assigns
 * each role its configured password. It is idempotent — re-running re-applies the
 * same configured secret, so repeated `pnpm db:migrate` runs never reset a role to
 * a development default.
 */
export async function applyRolePasswords(
  connectionString: string,
  plan: RolePasswordEntry[]
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const entry of plan) {
      await client.query(buildAlterRoleStatement(client, entry));
    }
  } finally {
    await client.end();
  }
}
