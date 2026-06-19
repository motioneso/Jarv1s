import { describe, expect, it } from "vitest";

import {
  RUNTIME_ROLE_PASSWORD_DEFAULTS,
  buildRolePasswordPlan,
  getJarvisDatabaseUrls
} from "@jarv1s/db";

describe("buildRolePasswordPlan", () => {
  it("derives runtime role passwords from local dev fallback URLs", () => {
    const plan = buildRolePasswordPlan(getJarvisDatabaseUrls({} as NodeJS.ProcessEnv));
    expect(plan).toEqual([
      { role: "jarvis_migration_owner", password: "migration_password" },
      { role: "jarvis_app_runtime", password: "app_password" },
      { role: "jarvis_worker_runtime", password: "worker_password" },
      { role: "jarvis_auth_runtime", password: "auth_password" }
    ]);
  });

  it("derives passwords from explicit production URLs", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://postgres:rootpw@db/prod",
      JARVIS_MIGRATION_DATABASE_URL: "postgres://jarvis_migration_owner:mig-secret@db/prod",
      JARVIS_APP_DATABASE_URL: "postgres://jarvis_app_runtime:app-secret@db/prod",
      JARVIS_AUTH_DATABASE_URL: "postgres://jarvis_auth_runtime:auth-secret@db/prod",
      JARVIS_WORKER_DATABASE_URL: "postgres://jarvis_worker_runtime:worker-secret@db/prod"
    } as NodeJS.ProcessEnv;
    const plan = buildRolePasswordPlan(getJarvisDatabaseUrls(env), env);
    expect(plan.map((e) => e.password)).toEqual([
      "mig-secret",
      "app-secret",
      "worker-secret",
      "auth-secret"
    ]);
  });

  it("refuses in production when a role password is missing", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://postgres:rootpw@db/prod",
      JARVIS_MIGRATION_DATABASE_URL: "postgres://migration.example/prod",
      JARVIS_APP_DATABASE_URL: "postgres://jarvis_app_runtime:app-secret@db/prod",
      JARVIS_AUTH_DATABASE_URL: "postgres://jarvis_auth_runtime:auth-secret@db/prod",
      JARVIS_WORKER_DATABASE_URL: "postgres://jarvis_worker_runtime:worker-secret@db/prod"
    } as NodeJS.ProcessEnv;
    expect(() => buildRolePasswordPlan(getJarvisDatabaseUrls(env), env)).toThrow(
      /jarvis_migration_owner/
    );
  });

  it("refuses in production when a role password is still a development default", () => {
    const env = {
      NODE_ENV: "production",
      JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://postgres:rootpw@db/prod",
      JARVIS_MIGRATION_DATABASE_URL:
        "postgres://jarvis_migration_owner:migration_password@db/prod",
      JARVIS_APP_DATABASE_URL: "postgres://jarvis_app_runtime:app-secret@db/prod",
      JARVIS_AUTH_DATABASE_URL: "postgres://jarvis_auth_runtime:auth-secret@db/prod",
      JARVIS_WORKER_DATABASE_URL: "postgres://jarvis_worker_runtime:worker-secret@db/prod"
    } as NodeJS.ProcessEnv;
    expect(() => buildRolePasswordPlan(getJarvisDatabaseUrls(env), env)).toThrow(
      /jarvis_migration_owner.*development-default/
    );
    expect(RUNTIME_ROLE_PASSWORD_DEFAULTS.has("app_password")).toBe(true);
  });
});
