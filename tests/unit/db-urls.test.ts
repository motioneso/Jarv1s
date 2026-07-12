import { describe, expect, it } from "vitest";

import { DEFAULT_JARVIS_DATABASE_NAME, getJarvisDatabaseUrls } from "@jarv1s/db";

describe("getJarvisDatabaseUrls", () => {
  it("keeps local development fallbacks parameterized by host, port, and database", () => {
    const urls = getJarvisDatabaseUrls({
      JARVIS_PGHOST: "postgres.local",
      JARVIS_PGPORT: "55434",
      JARVIS_PGDATABASE: "jarvis_build_test"
    } as NodeJS.ProcessEnv);

    expect(urls.app).toBe(
      "postgres://jarvis_app_runtime:app_password@postgres.local:55434/jarvis_build_test"
    );
  });

  it("throws in production when an explicit connection URL is absent", () => {
    expect(() =>
      getJarvisDatabaseUrls({
        NODE_ENV: "production",
        JARVIS_PGHOST: "postgres.local",
        JARVIS_PGPORT: "5432",
        JARVIS_PGDATABASE: "jarvis_prod"
      } as NodeJS.ProcessEnv)
    ).toThrow("JARVIS_BOOTSTRAP_DATABASE_URL is required in production");
  });

  it("accepts production configuration when every connection URL is explicit", () => {
    const urls = getJarvisDatabaseUrls({
      NODE_ENV: "production",
      JARVIS_BOOTSTRAP_DATABASE_URL: "postgres://bootstrap.example/prod",
      JARVIS_MIGRATION_DATABASE_URL: "postgres://migration.example/prod",
      JARVIS_APP_DATABASE_URL: "postgres://app.example/prod",
      JARVIS_AUTH_DATABASE_URL: "postgres://auth.example/prod",
      JARVIS_WORKER_DATABASE_URL: "postgres://worker.example/prod"
    } as NodeJS.ProcessEnv);

    expect(urls).toEqual({
      bootstrap: "postgres://bootstrap.example/prod",
      migration: "postgres://migration.example/prod",
      app: "postgres://app.example/prod",
      auth: "postgres://auth.example/prod",
      worker: "postgres://worker.example/prod"
    });
  });

  it("falls back to DEFAULT_JARVIS_DATABASE_NAME when JARVIS_PGDATABASE is unset", () => {
    const urls = getJarvisDatabaseUrls({} as NodeJS.ProcessEnv);

    expect(urls.app).toBe(
      `postgres://jarvis_app_runtime:app_password@localhost:55433/${DEFAULT_JARVIS_DATABASE_NAME}`
    );
    expect(DEFAULT_JARVIS_DATABASE_NAME).toBe("jarv1s");
  });
});
