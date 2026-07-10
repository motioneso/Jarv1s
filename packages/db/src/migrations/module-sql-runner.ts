// Slice 1 (#914): wire-contract validator for external-module migration files. Every module
// migration must be exactly one statement whose first command is on a narrow allowlist — this is
// the ONLY security-relevant SQL a module author ever writes; everything else (RLS, policies,
// grants) is platform-generated (module-rls-emitter.ts) so a module can never grant itself access
// it shouldn't have.

const FIRST_COMMAND_ALLOWLIST: readonly RegExp[] = [
  /^CREATE\s+TABLE\b/i,
  /^CREATE\s+(UNIQUE\s+)?INDEX\b/i,
  /^ALTER\s+TABLE\b/i,
  /^DROP\s+INDEX\b/i,
  /^COMMENT\s+ON\b/i,
];

export interface ModuleMigrationValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateModuleMigrationSql(sql: string): ModuleMigrationValidation {
  const errors: string[] = [];
  const stripped = stripSqlComments(sql).trim();

  if (stripped.length === 0) {
    return { ok: false, errors: ["migration file is empty"] };
  }

  const statementCount = countTopLevelStatements(stripped);
  if (statementCount !== 1) {
    errors.push(`expected exactly one SQL statement, found ${statementCount}`);
  }

  if (!FIRST_COMMAND_ALLOWLIST.some((pattern) => pattern.test(stripped))) {
    errors.push(
      "first command must be one of: CREATE TABLE, CREATE [UNIQUE] INDEX, ALTER TABLE, " +
        "DROP INDEX, COMMENT ON"
    );
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

/**
 * Strips `--` line comments and block comments,
 * passing string literals through untouched.
 */
function stripSqlComments(sql: string): string {
  let result = "";
  let i = 0;
  while (i < sql.length) {
    const twoChar = sql.slice(i, i + 2);
    if (twoChar === "--") {
      const newlineIndex = sql.indexOf("\n", i);
      i = newlineIndex === -1 ? sql.length : newlineIndex + 1;
      continue;
    }
    if (twoChar === "/*") {
      const endIndex = sql.indexOf("*/", i + 2);
      i = endIndex === -1 ? sql.length : endIndex + 2;
      continue;
    }
    if (sql[i] === "'") {
      const end = findStringLiteralEnd(sql, i);
      result += sql.slice(i, end);
      i = end;
      continue;
    }
    result += sql[i];
    i += 1;
  }
  return result;
}

/**
 * `start` must index the opening `'`.
 * Returns the index just past the closing `'` (handles `''` escapes).
 */
function findStringLiteralEnd(sql: string, start: number): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

function countTopLevelStatements(sql: string): number {
  let count = 0;
  let i = 0;
  let sawContentSinceSemicolon = false;
  while (i < sql.length) {
    if (sql[i] === "'") {
      const end = findStringLiteralEnd(sql, i);
      sawContentSinceSemicolon = true;
      i = end;
      continue;
    }
    if (sql[i] === ";") {
      if (sawContentSinceSemicolon) count += 1;
      sawContentSinceSemicolon = false;
      i += 1;
      continue;
    }
    if (!/\s/.test(sql[i])) sawContentSinceSemicolon = true;
    i += 1;
  }
  if (sawContentSinceSemicolon) count += 1;
  return count;
}
