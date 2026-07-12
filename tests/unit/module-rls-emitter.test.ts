import { describe, expect, it } from "vitest";

import { generateModuleTableRlsSql } from "../../packages/db/src/module-rls-emitter.js";

describe("generateModuleTableRlsSql", () => {
  it("emits FORCE RLS, four per-verb policies, and a grant for one owned table", () => {
    const statements = generateModuleTableRlsSql("acme-widgets", ["app.acme_widgets"]);

    expect(statements).toEqual([
      "GRANT USAGE ON SCHEMA app TO jarvis_mod_acme_widgets_runtime;",
      "GRANT EXECUTE ON FUNCTION app.current_actor_user_id() TO jarvis_mod_acme_widgets_runtime;",
      "ALTER TABLE app.acme_widgets ENABLE ROW LEVEL SECURITY;",
      "ALTER TABLE app.acme_widgets FORCE ROW LEVEL SECURITY;",
      "DROP POLICY IF EXISTS acme_widgets_select ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_select ON app.acme_widgets FOR SELECT " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "USING (owner_user_id = app.current_actor_user_id());",
      "DROP POLICY IF EXISTS acme_widgets_insert ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_insert ON app.acme_widgets FOR INSERT " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "WITH CHECK (owner_user_id = app.current_actor_user_id());",
      "DROP POLICY IF EXISTS acme_widgets_update ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_update ON app.acme_widgets FOR UPDATE " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "USING (owner_user_id = app.current_actor_user_id()) " +
        "WITH CHECK (owner_user_id = app.current_actor_user_id());",
      "DROP POLICY IF EXISTS acme_widgets_delete ON app.acme_widgets;",
      "CREATE POLICY acme_widgets_delete ON app.acme_widgets FOR DELETE " +
        "TO jarvis_mod_acme_widgets_runtime " +
        "USING (owner_user_id = app.current_actor_user_id());",
      "GRANT SELECT, INSERT, UPDATE, DELETE ON app.acme_widgets TO jarvis_mod_acme_widgets_runtime;"
    ]);
  });

  it("rejects a table name outside app.<snake_case> (injection guard)", () => {
    expect(() =>
      generateModuleTableRlsSql("acme-widgets", ["app.acme_widgets; DROP TABLE app.users"])
    ).toThrow(/invalid module owned table name/i);
  });

  it("rejects a table name in a schema other than app", () => {
    expect(() => generateModuleTableRlsSql("acme-widgets", ["public.widgets"])).toThrow(
      /invalid module owned table name/i
    );
  });

  it("returns an empty array for a module with no owned tables", () => {
    expect(generateModuleTableRlsSql("acme-widgets", [])).toEqual([]);
  });
});
