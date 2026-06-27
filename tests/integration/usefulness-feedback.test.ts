import { beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  getBuiltInModuleManifests,
  getBuiltInModuleRegistrations
} from "@jarv1s/module-registry";

import { connectionStrings, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

describe("usefulness feedback foundation", () => {
  beforeAll(async () => {
    await resetFoundationDatabase();
  });

  it("registers the required module and applies owner-only RLS without runtime delete", async () => {
    expect(getBuiltInModuleManifests().map((manifest) => manifest.id)).toContain(
      "usefulness-feedback"
    );
    const registration = getBuiltInModuleRegistrations().find(
      (item) => item.manifest.id === "usefulness-feedback"
    );

    expect(registration?.manifest.database?.ownedTables).toEqual([
      "app.usefulness_feedback_signals",
      "app.usefulness_feedback_targets"
    ]);
    expect(registration?.manifest.routes?.map((route) => `${route.method} ${route.path}`)).toEqual([
      "POST /api/me/usefulness-feedback",
      "GET /api/me/usefulness-feedback",
      "POST /api/me/usefulness-feedback/:id/undo"
    ]);

    const client = new Client({ connectionString: connectionStrings.migration });
    await client.connect();
    try {
      const result = await client.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        app_can_delete: boolean;
        worker_can_delete: boolean;
      }>(`
        SELECT
          c.relname,
          c.relrowsecurity,
          c.relforcerowsecurity,
          has_table_privilege('jarvis_app_runtime', c.oid, 'DELETE') AS app_can_delete,
          has_table_privilege('jarvis_worker_runtime', c.oid, 'DELETE') AS worker_can_delete
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app'
          AND c.relname IN ('usefulness_feedback_signals', 'usefulness_feedback_targets')
        ORDER BY c.relname
      `);

      expect(result.rows).toEqual([
        {
          relname: "usefulness_feedback_signals",
          relrowsecurity: true,
          relforcerowsecurity: true,
          app_can_delete: false,
          worker_can_delete: false
        },
        {
          relname: "usefulness_feedback_targets",
          relrowsecurity: true,
          relforcerowsecurity: true,
          app_can_delete: false,
          worker_can_delete: false
        }
      ]);
    } finally {
      await client.end();
    }
  });
});
