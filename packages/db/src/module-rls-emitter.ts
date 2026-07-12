// Slice 3 (#914): pure SQL generator for module-owned-table RLS. Mirrors the hand-written
// packages/sports/sql/0133_sports_follows.sql pattern exactly (FORCE RLS + four per-verb
// owner-only policies + one combined grant) — generated so external modules never author
// security SQL themselves; `scripts/module-install.ts` Phase B executes this output inside the
// same transaction as the module's own DDL.
import { moduleRuntimeRoleName } from "./module-role-broker.js";

// Table names come from a module manifest, which for external modules is untrusted input read
// from disk — validate strictly before splicing into generated DDL to prevent SQL injection.
// Exported so other call sites that splice manifest-declared table names into SQL (e.g. Task 9's
// export-row reader) reuse the same guard rather than re-deriving it.
const QUALIFIED_TABLE_RE = /^app\.[a-z][a-z0-9_]*$/;

export function assertQualifiedTableName(table: string): void {
  if (!QUALIFIED_TABLE_RE.test(table)) {
    throw new Error(`invalid module owned table name "${table}" (must match app.<snake_case>)`);
  }
}

function policyBaseName(table: string): string {
  return table.slice("app.".length);
}

export function generateModuleTableRlsSql(
  moduleId: string,
  ownedTables: readonly string[]
): string[] {
  const role = moduleRuntimeRoleName(moduleId);
  const statements: string[] = [];

  // The per-table GRANTs below are useless without schema-level USAGE: the runtime role runs
  // under SET LOCAL ROLE with INHERIT FALSE (module-storage-rpc.ts), so it needs this granted
  // directly rather than inheriting it from a parent runtime role's own schema access. Likewise
  // the owner-check policy predicates call app.current_actor_user_id(), which is REVOKEd from
  // PUBLIC (0002_app_rls.sql) and only granted per-role — the module runtime role needs its own
  // EXECUTE grant or every policy evaluation 403s (see 0051_fix_current_actor_user_id_grant.sql
  // for the same class of bug against jarvis_auth_runtime).
  if (ownedTables.length > 0) {
    statements.push(`GRANT USAGE ON SCHEMA app TO ${role};`);
    statements.push(`GRANT EXECUTE ON FUNCTION app.current_actor_user_id() TO ${role};`);
  }

  for (const table of ownedTables) {
    assertQualifiedTableName(table);
    const base = policyBaseName(table);
    const ownerCheck = "owner_user_id = app.current_actor_user_id()";

    statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
    statements.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);

    statements.push(`DROP POLICY IF EXISTS ${base}_select ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_select ON ${table} FOR SELECT TO ${role} USING (${ownerCheck});`
    );

    statements.push(`DROP POLICY IF EXISTS ${base}_insert ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_insert ON ${table} FOR INSERT TO ${role} WITH CHECK (${ownerCheck});`
    );

    statements.push(`DROP POLICY IF EXISTS ${base}_update ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_update ON ${table} FOR UPDATE TO ${role} ` +
        `USING (${ownerCheck}) WITH CHECK (${ownerCheck});`
    );

    statements.push(`DROP POLICY IF EXISTS ${base}_delete ON ${table};`);
    statements.push(
      `CREATE POLICY ${base}_delete ON ${table} FOR DELETE TO ${role} USING (${ownerCheck});`
    );

    statements.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO ${role};`);
  }

  return statements;
}
