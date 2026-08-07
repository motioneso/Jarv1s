// Classification logic for the #1441/#1456 display-string residue guard, extracted from
// tests/unit/display-string-residue.test.ts so the patterns below can be unit-tested directly
// (against synthetic literals) independent of whatever the real source tree currently contains.
// A synthetic-input test pins "this shape must never be swallowed again" even after the source
// file that originally leaked it has been fixed and no longer contains the offending literal.

/* Spellings that are NOT display strings. Each is a repository-level identifier tracked separately
   by #1442-#1444, and most would corrupt data or break a wire contract if renamed here:
   - `<!-- jarvis:...` markers are written into users' real note files on disk; renaming orphans
     every marker in every existing vault.
   - `jarvis.*` localStorage keys hold the user's saved view, theme and colour mode; renaming
     silently discards every existing preference. `jarvis.module.json` (module manifest filename)
     and `jarvis.commitments`/`jarvis.goals` (module/event ids) share the same dotted-namespace
     shape. The pattern below requires a literal "." immediately after "jarvis" followed by a
     lowercase letter — that shape never occurs in prose (a sentence-ending "Jarvis. " has a space
     after the period), so it is a safe, narrow way to allowlist the whole namespaced-identifier
     class without also allowlisting hyphenated user-visible strings (see the filename note below).
   - `jarvis-archive/v1` is stamped into every archive already exported; renaming makes those
     archives unreadable to a future importer that keys on the string.
   - `jarvis_*_runtime` are PostgreSQL roles, which are cluster-global. Postgres roles, tables,
     columns, migration file references and queue/event keys are always snake_case
     (`jarvis_migration_owner`, `app.jarvis_goals`, `jarvis_goal:<id>`) — prose display text is
     never written in snake_case, so a plain `jarvis_` substring match is a safe class to allowlist.
   - `mcp__jarvis__*`, `jarvis.module.json`, `x-jarvis-*`, `virtual:jarvis-*` and the
     `Jarvis-*` HTTP user-agents are contracts with clients, the bundler, and third-party servers.
   - `data-jarvis-capture-text` is the page-context opt-in attribute (#1438).
   - `sql/0127_jarvis_*.sql` are applied migration filenames, which are hash-checked and can
     never be edited (covered by the `jarvis_` snake_case pattern above).
   - `jarvis-google-consent` (apps/web/src/connectors/use-google-connect-flow.ts) is a
     `window.open` popup target name, never rendered. It shares the bare `jarvis-` hyphen prefix
     with the #1456 offender (`jarvis-export-<date>.json`, a real Downloads-folder filename) — the
     two are told apart mechanically by whether the literal ends in a file-extension shape
     (`.json`, `.csv`, ...). A hyphenated `jarvis-` literal WITH a dot-extension ending is exactly
     what a user-visible download filename looks like and must NOT be swallowed here; that is
     precisely how #1456 survived tier A (the prior blanket `/jarvis[._-]/` pattern's own comment
     named "filenames" among the things it exempted). One without an extension-shaped ending
     (`jarvis-google-consent`, `jarvis-archive/v1`) is the internal-identifier shape and stays
     allowlisted.
   Add to this list only with a reason, and only when the string genuinely never reaches a user. */
export const NON_DISPLAY_SPELLINGS: RegExp[] = [
  /@jarv1s\//,
  /[Jj]arvis[A-Z]/, // identifiers: MossModuleManifest, MossDatabase, jarvisPersonId
  /JsonJarvis/,
  /isJarvis|compareJarvis/,
  /JARVIS_/, // env vars and globals
  /virtual:jarvis-/,
  /x-jarvis-/,
  /data-jarvis-/,
  /mcp__jarvis__/, // MCP tool-name prefix
  /jarvis\.[a-z]/, // dotted namespace identifiers: storage keys, module/event ids, manifest filename
  /jarvis_/, // snake_case identifiers: Postgres roles/tables/columns, migration refs, queue keys
  /jarvis-(?!.*\.[a-z0-9]{1,5}$)/, // hyphenated identifiers WITHOUT a file-extension-shaped ending
  /jarvis:[a-z]/, // event names and note markers: "jarvis:open-command-palette", "jarvis:people:start"
  /\.jarvis\b/, // dot-directory names: ".jarvis", ".jarvis/cli-tokens"
  /Jarvis-[A-Z]/, // outward network identity: Jarvis-Upgrade-Checker, Jarvis-WebResearch
  /^jarvis$/ // bare identifier: DB role, MCP server name
];

/* File-scoped exceptions for a spelling that would otherwise be flagged, kept out of the pattern
   list above because the string it allows is a bare "Jarvis" — the exact shape a missed display
   string takes. A global pattern for it would silently swallow every future one, which is how the
   seven external-modules strings survived six phases of this rename in the first place.
   Currently empty: #1456 removed the last entry (Plaid `client_name`) by renaming the string
   instead of exempting it, after confirming `client_name` is free-form Link display text with no
   Plaid Dashboard registration requirement. Prefer fixing the string over adding here. */
export const FILE_SCOPED_EXCEPTIONS: ReadonlyArray<{ file: string; literal: string }> = [];

/* Walks the source once, returning the text of every string literal — double-quoted,
   single-quoted, and the literal chunks of a template. Three reasons this is a walker rather
   than a regex over `label:`/`description:` fields:
   - It skips comments. Two comments legitimately quote the former name: a GitHub issue title in
     `apps/web/src/chat/page-context.ts`, and Ben's verbatim 2026-07-26 ruling in
     `packages/email/src/manifest.ts`. Editing a quotation to fit a rename falsifies the record,
     so the guard must not ask anyone to.
   - It sees single-quoted strings. Prettier switches to single quotes when a string contains a
     double quote, which is exactly what `TASKS_FIRST_RUN_NOTICE` does — a regex over `"..."`
     cannot see that string at all.
   - It sees templates. `` `Jarvis ${version} is available` `` is a shipped notification title.
   Inside `${...}` the walker skips to the matching brace and keeps whatever text it passes over;
   that text is expression source, not copy, so anything it contributes is an identifier the
   allowlist above already filters. Over-scanning is safe here; under-scanning is not. */
export function extractStringLiterals(source: string): string[] {
  const out: string[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      let value = "";
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") {
          value += source[j + 1] ?? "";
          j += 2;
        } else if (source[j] === "\n") {
          break; // unterminated: not a literal, bail rather than swallow the file
        } else {
          value += source[j];
          j += 1;
        }
      }
      out.push(value);
      i = j + 1;
    } else if (ch === "`") {
      let j = i + 1;
      let value = "";
      while (j < source.length && source[j] !== "`") {
        if (source[j] === "\\") {
          value += source[j + 1] ?? "";
          j += 2;
        } else if (source[j] === "$" && source[j + 1] === "{") {
          let depth = 1;
          j += 2;
          while (j < source.length && depth > 0) {
            if (source[j] === "{") depth += 1;
            else if (source[j] === "}") depth -= 1;
            j += 1;
          }
        } else {
          value += source[j];
          j += 1;
        }
      }
      out.push(value);
      i = j + 1;
    } else {
      i += 1;
    }
  }

  return out;
}

/** True if `literal` is an identifier the guard should never flag, regardless of file. */
export function isAllowedNonDisplaySpelling(literal: string): boolean {
  return NON_DISPLAY_SPELLINGS.some((pattern) => pattern.test(literal));
}

/** True if `literal` in `relativePath` matches a deliberate, file-scoped exception. */
export function isFileScopedException(relativePath: string, literal: string): boolean {
  return FILE_SCOPED_EXCEPTIONS.some(
    (exception) => exception.file === relativePath && exception.literal === literal
  );
}
