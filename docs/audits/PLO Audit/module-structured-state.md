# Module Audit: packages/structured-state

**Reviewer:** Automated PLO Security & Quality Audit
**Date:** 2026-06-10
**Scope:** All source files in `packages/structured-state/src/` and `packages/structured-state/sql/`

---

## Summary

The structured-state module is small and well-scoped. RLS is correctly enabled and FORCE'd on all
three tables. Module isolation is clean — no other module queries these tables directly. The
DataContextDb pattern is accepted everywhere. The most significant findings are: (1) owner-spoofing
is structurally possible because `ownerUserId` is caller-supplied rather than pinned to
`actorUserId`; (2) YAML frontmatter in `write-back.ts` is injectable via newline characters in
entity name/life_area; (3) all three list operations are unbounded with no pagination or row cap;
(4) no size constraints on JSONB columns (`attributes`, `connector_refs`, `value_json`) or
`surfaced_state`; (5) `assertDataContextDb` runtime brand checks are absent, which breaks the
DataContextDb invariant; (6) cross-user write operations (update/delete by non-owner) are untested.

---

## Findings

---

### [HIGH] Owner-spoofing: `ownerUserId` is caller-supplied, not pinned to `actorUserId`

- **File:** `packages/structured-state/src/commitments-repository.ts:26-41`, `entities-repository.ts:25-39`, `preferences-repository.ts:6-24`
- **Category:** Security
- **Finding:** `CreateCommitmentInput.ownerUserId`, `CreateEntityInput.ownerUserId`, and the
  `ownerUserId` parameter of `PreferencesRepository.upsert` are all caller-supplied strings. The
  repository writes them directly to `owner_user_id` in the INSERT, relying entirely on the RLS
  INSERT policy (`WITH CHECK (owner_user_id = app.current_actor_user_id())`) to reject spoofed
  values.  
  While RLS does provide a backstop, the defence is invisible at the application layer. Any future
  caller that constructs an input object with a foreign userId (e.g. parsing a request body that
  includes `ownerUserId`) will silently fail at the DB level with a policy violation error that
  surfaces as an opaque 500. More critically: if the repositories are ever called from a context
  where RLS is not active (e.g. a migration seeder, a test bootstrap, or a future worker path that
  uses a root Kysely handle), the INSERT succeeds with the wrong owner.
- **Evidence:**
  ```ts
  // commitments-repository.ts:30
  owner_user_id: input.ownerUserId,
  ```
  The caller of `repo.create(scopedDb, { ownerUserId: input.ownerUserId, ... })` must trust the
  incoming `ownerUserId`. No application-layer check enforces `input.ownerUserId ===
  accessContext.actorUserId`.
- **Impact:** If any route or service layer passes an untrusted `ownerUserId`, an actor can create
  records owned by another user. The RLS `WITH CHECK` prevents this today but the invariant is
  not visible or enforced at the TypeScript layer.
- **Recommendation:** Remove `ownerUserId` from `CreateCommitmentInput` and
  `CreateEntityInput`. Instead, accept `actorUserId` from the `DataContextDb` context (or pass it
  separately from the verified `AccessContext`). For preferences, derive the ownerUserId from the
  AccessContext, not from the caller. The canonical model is: the application layer derives
  `ownerUserId` from the authenticated `actorUserId` and passes it through; repos should never let
  arbitrary data determine ownership.

---

### [HIGH] YAML frontmatter injection via newline in entity name / life_area

- **File:** `packages/structured-state/src/write-back.ts:7-22`
- **Category:** Security
- **Finding:** `yamlStr` escapes backslashes and double-quotes but does not escape or reject
  newline characters (`\n`, `\r\n`). A `name` or `life_area` value containing a literal newline
  will break out of the double-quoted YAML string and inject arbitrary additional YAML keys into
  the frontmatter block.
- **Evidence:**
  ```ts
  function yamlStr(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  ```
  Given `entity.name = 'Alice\nmalicious_key: true'`, the emitted YAML becomes:
  ```yaml
  name: "Alice
  malicious_key: true"
  ```
  which is valid YAML with two keys — `name: "Alice"` and `malicious_key: true"` — corrupting
  the frontmatter structure and potentially injecting false machine-readable metadata into vault
  notes read back by Jarvis itself.
- **Impact:** Maliciously or accidentally crafted entity names can inject arbitrary YAML keys into
  vault notes. If Jarvis parses its own frontmatter back (present or future), this is a
  self-injection vector. The vault file content is user-visible, so this also degrades note
  integrity.
- **Recommendation:** Either (a) escape newlines in `yamlStr` (`\n` → `\n` escape sequence in
  the YAML string), or (b) add a CHECK constraint on `entities.name` and `entities.life_area`
  rejecting newlines at the DB layer, or (c) use a real YAML serializer instead of hand-rolled
  string building. The simplest safe fix: add `.replace(/\n/g, "\\n").replace(/\r/g, "\\r")` to
  `yamlStr`.

---

### [HIGH] `assertDataContextDb` runtime brand check absent from all repositories

- **File:** `packages/structured-state/src/commitments-repository.ts`, `entities-repository.ts`, `preferences-repository.ts`
- **Category:** Architecture
- **Finding:** Every repository in every other module that accepts `DataContextDb` calls
  `assertDataContextDb(scopedDb)` as its first statement to verify the brand symbol at runtime.
  None of the three structured-state repositories do this. The invariant "repositories accept only
  a branded DataContextDb handle, never a root Kysely instance" (CLAUDE.md Hard Invariant #3) is
  enforced structurally at TypeScript compile time, but the runtime defence is absent.
- **Evidence:**
  ```ts
  // commitments-repository.ts — no assertDataContextDb call
  async create(scopedDb: DataContextDb, input: CreateCommitmentInput): Promise<Commitment> {
    const result = await scopedDb.db.insertInto("app.commitments") ...
  ```
  Compare to the canonical pattern in `packages/db/src/sharing/shares-repository.ts:25`:
  ```ts
  assertDataContextDb(scopedDb);
  ```
- **Impact:** TypeScript `as DataContextDb` casts anywhere in the call chain would bypass
  compile-time safety. Without the runtime check, a raw `Kysely` instance (with RLS not yet
  active) could be passed and the repositories would silently operate without RLS enforcement.
- **Recommendation:** Add `assertDataContextDb(scopedDb)` as the first line of every public
  repository method, following the established pattern in `shares-repository.ts` and
  `chat/repository.ts`.

---

### [MEDIUM] Unbounded list operations — no pagination or row limit

- **File:** `packages/structured-state/src/commitments-repository.ts:44-51`, `entities-repository.ts:43-49`, `preferences-repository.ts:36-41`
- **Category:** Code Quality / Security
- **Finding:** All three `list*` methods issue `SELECT ... (no LIMIT)` queries that return the
  full result set for an actor. For commitments and entities, the owner can accumulate thousands
  of rows. For preferences, the full preferences map is loaded into a single in-memory object.
  There is no guard — no row cap, no pagination cursor, no hard `LIMIT`.
- **Evidence:**
  ```ts
  // commitments-repository.ts:44-50
  async listVisible(scopedDb: DataContextDb): Promise<Commitment[]> {
    const rows = await scopedDb.db
      .selectFrom("app.commitments")
      .selectAll()
      .orderBy("created_at", "desc")
      .execute();
    return rows as Commitment[];
  }
  ```
- **Impact:** A user with many commitments or entities (or an AI agent looping creates) will cause
  progressively larger memory allocations and query execution times on every list call. For shared
  resources, a grantee viewing a large owner's list also bears this cost.
- **Recommendation:** Add a `.limit(500)` (or configurable) cap as a safety floor for the current
  single-user scope. When the API layer is added, surface cursor-based pagination. For
  `preferences.list()`, the full-map pattern is acceptable given that preferences are expected to
  be few, but document this assumption explicitly.

---

### [MEDIUM] No size constraints on JSONB columns or `surfaced_state` text field

- **File:** `packages/structured-state/sql/0031_structured_state.sql:35,82,85,131`
- **Category:** Security / Code Quality
- **Finding:** The columns `entities.attributes` (jsonb), `entities.connector_refs` (jsonb),
  `preferences.value_json` (jsonb), and `commitments.surfaced_state` (text) have no size
  constraints. A caller can insert arbitrarily large JSONB blobs or text values with no rejection.
  Postgres JSONB rows exceeding 8 KB are transparently TOAST-compressed but there is still no
  upper bound.
- **Evidence:**
  ```sql
  -- sql/0031_structured_state.sql:82,85,131,35
  attributes jsonb NOT NULL DEFAULT '{}',
  connector_refs jsonb,
  value_json jsonb NOT NULL,
  surfaced_state text,
  ```
  None carry a `CHECK (pg_column_size(...) < N)` or application-layer length guard.
- **Impact:** An AI agent writing back large attribute payloads or a malicious actor (if any
  ingest path is exposed) can grow individual rows to multi-megabyte sizes, leading to slow
  queries, excessive TOAST churn, and effective DoS of the preferences or entity lookup paths.
- **Recommendation:** Add DB-level CHECK constraints on `attributes` and `connector_refs` (e.g.
  `CHECK (pg_column_size(attributes) < 65536)`), a character length limit on `surfaced_state`
  (e.g. `CHECK (length(surfaced_state) < 4096)`), and validate size of `value` before upsert in
  `PreferencesRepository.upsert`.

---

### [MEDIUM] `surfaced_state` column lacks text length constraint and has no schema definition

- **File:** `packages/structured-state/sql/0031_structured_state.sql:35`, `packages/structured-state/src/commitments-repository.ts:20,72`
- **Category:** Code Quality / TypeScript
- **Finding:** `surfaced_state` is a plain `text` column storing what appears to be AI-derived
  state summaries. It has no maximum length constraint, no schema definition in `types.ts`, and is
  typed as `string | null` with no validation in `UpdateCommitmentInput`. The semantic purpose of
  this field is undocumented in the SQL or TypeScript.
- **Evidence:**
  ```sql
  surfaced_state text,
  ```
  ```ts
  // commitments-repository.ts:20
  readonly surfacedState?: string | null;
  ```
- **Impact:** Unclear ownership of this field (AI-set vs user-set), no upper bound, and the
  absence of any schema documentation make it a silent accumulation point for arbitrarily large
  strings.
- **Recommendation:** Add a comment explaining the field's intended writer (AI worker vs route
  handler) and add a `CHECK (length(surfaced_state) <= 4096)` or similar upper bound.

---

### [MEDIUM] Cross-user update and delete are not tested

- **File:** `tests/integration/structured-state.test.ts`
- **Category:** Tests
- **Finding:** The integration test suite tests that User B cannot *see* User A's commitments and
  entities (SELECT RLS). It does not test that User B cannot *update* or *delete* User A's records.
  The RLS UPDATE and DELETE policies both check `owner_user_id = app.current_actor_user_id()`,
  but this is not verified in the test suite.
- **Evidence:** Search for `otherUserId` in the test file returns only SELECT-path tests:
  - `"other user cannot see owner's commitment"` — tests SELECT
  - `"other user cannot see owner's entity"` — tests SELECT
  - `"preferences are owner-only"` — tests SELECT
  No test calls `repo.update(scopedDb, c.id, ...)` or `repo.delete(scopedDb, c.id)` while acting
  as `otherUserId`.
- **Impact:** If the RLS UPDATE or DELETE policy had a bug (e.g. missing USING clause), the test
  suite would pass. Silently incorrect UPDATE policy would allow cross-user mutation.
- **Recommendation:** Add test cases:
  - User B attempts to update User A's commitment → update returns `undefined` (row not found
    under RLS) and no side-effect in the DB.
  - User B attempts to delete User A's entity → delete is a no-op.
  Identical tests for the preferences table.

---

### [MEDIUM] No test coverage for `PreferencesRepository.delete`

- **File:** `tests/integration/structured-state.test.ts`, `packages/structured-state/src/preferences-repository.ts:44-47`
- **Category:** Tests
- **Finding:** `PreferencesRepository.delete` is exported and implemented but there is no
  integration test covering it. The method deletes by `key` without filtering by `owner_user_id`
  at the application layer (relying entirely on the RLS DELETE policy).
- **Evidence:** `grep -n "delete" tests/integration/structured-state.test.ts` returns zero
  results. The method is:
  ```ts
  async delete(scopedDb: DataContextDb, key: string): Promise<void> {
    await scopedDb.db.deleteFrom("app.preferences").where("key", "=", key).execute();
  }
  ```
- **Impact:** The correctness of `preferences.delete` under RLS is unverified.
- **Recommendation:** Add a test that upserts a preference, deletes it, and confirms the key is
  gone. Also add a cross-user test that User B's delete attempt against a key only User A has set
  is a no-op.

---

### [MEDIUM] Frontmatter body-preservation regex is fragile with `---` in document body

- **File:** `packages/structured-state/src/write-back.ts:5,28-29`
- **Category:** Code Quality
- **Finding:** `FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/` uses a non-greedy `[\s\S]*?`
  to match the YAML frontmatter block. If the user's prose body begins with a horizontal rule or
  markdown section divider (`---\n`), the regex will stop at that occurrence, treating it as the
  end of the frontmatter. This causes `readExistingBody` to return a truncated body and the
  subsequent write will silently drop a portion of the user's prose.
- **Evidence:**
  ```
  Input: "---\nkey: val\n---\n\n---\n# Section\n---\nBody\n"
  FRONTMATTER_RE matches: "---\nkey: val\n---\n"  ← correct
  Body returned: "\n---\n# Section\n---\nBody\n"  ← correct here
  BUT if the user's body is:
  "---\nkey: val\n---\n---\n# Section"
  regex stops at first \n---\n making body start at "---\n# Section"
  ```
  The regex is anchored at the very start and uses non-greedy, so in practice the risk is only
  when `\n---\n` appears *inside* the frontmatter block itself (malformed frontmatter). Confirmed
  safe for well-formed frontmatter. However, the case where the body immediately starts with `---`
  (no blank line gap) is still ambiguous.
- **Impact:** Silent data loss of user prose in vault notes. Low probability in practice but
  non-zero — any Markdown heading divider immediately after the closing frontmatter fence without a
  blank line would be misinterpreted.
- **Recommendation:** Require a blank line after the closing `---` or process the frontmatter
  boundary more strictly (e.g. require `\n---\n` for the closing fence only when the opening was
  also `---\n`). Alternatively, switch to a battle-tested YAML frontmatter parser such as
  `gray-matter`.

---

### [LOW] `updates: Record<string, unknown>` cast loses Kysely type safety in update methods

- **File:** `packages/structured-state/src/commitments-repository.ts:67`, `entities-repository.ts:66`
- **Category:** TypeScript
- **Finding:** Both `update` methods build a dynamic update object typed as
  `Record<string, unknown>` and pass it to `.set(updates)`. This bypasses Kysely's type-checked
  update builder and allows arbitrary string keys to be passed as column names. A typo in a column
  name string literal (e.g. `"provnance"` instead of `"provenance"`) would fail at runtime rather
  than at compile time.
- **Evidence:**
  ```ts
  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (input.title !== undefined) updates["title"] = input.title;
  ...
  scopedDb.db.updateTable("app.commitments").set(updates)
  ```
- **Impact:** Type safety erosion; column name typos silently produce no-ops (Postgres ignores
  unknown SET columns? No — Kysely would throw at runtime, but the error message is obscure).
- **Recommendation:** Use a typed partial update object. Kysely supports passing a typed
  `Updateable<CommitmentsTable>` object. Build the conditional assignments into a typed object
  instead of a string-keyed record:
  ```ts
  const updates: Updateable<CommitmentsTable> = { updated_at: new Date() };
  ```

---

### [LOW] `preferences.get` returns raw `value_json` without deserialization note / type

- **File:** `packages/structured-state/src/preferences-repository.ts:27-34`
- **Category:** TypeScript
- **Finding:** `get` returns `Promise<unknown>`. The column is named `value_json` (a Kysely JSONB
  column returns the parsed JS value, not a JSON string), but the return type is `unknown` with no
  documentation of what callers can safely assume. The `list` method returns `Record<string,
  unknown>`, which is consistent but similarly untyped.
- **Evidence:**
  ```ts
  async get(scopedDb: DataContextDb, key: string): Promise<unknown> {
    const row = await scopedDb.db
      .selectFrom("app.preferences")
      .select("value_json")
      .where("key", "=", key)
      .executeTakeFirst();
    return row?.value_json ?? null;
  }
  ```
- **Impact:** Every caller of `get` must cast or narrow unsafely. This is acceptable for a generic
  key-value store, but the API surface should document this expectation.
- **Recommendation:** Add a JSDoc comment explaining that the return is the deserialized JSONB
  value; consider a typed generic overload `get<T>(scopedDb, key): Promise<T | null>` if callers
  always know the expected type.

---

### [LOW] `serializeFrontmatter` includes `vault_note_path` in the frontmatter, creating a self-referential loop

- **File:** `packages/structured-state/src/write-back.ts:20`
- **Category:** Code Quality
- **Finding:** `serializeFrontmatter` emits `vault_note_path` as a frontmatter key. This field
  stores the path to the vault note that the frontmatter is being written into — it is the same
  file. This is circular and wasteful: the vault note already knows its own path by virtue of
  existing at that path.
- **Evidence:**
  ```ts
  if (entity.vault_note_path) lines.push(`vault_note_path: ${yamlStr(entity.vault_note_path)}`);
  ```
- **Impact:** Minor: adds a redundant key to every vault note frontmatter. Could cause confusion
  if a future importer reads the frontmatter and re-links the entity via this path, creating
  duplicate or mis-linked records if the file is moved.
- **Recommendation:** Remove `vault_note_path` from the emitted frontmatter. The path is a DB
  column, not a property of the note itself. The note's location is already canonical.

---

### [LOW] `updated_at` is set by application code, not a DB trigger — clock skew risk

- **File:** `packages/structured-state/src/commitments-repository.ts:67`, `entities-repository.ts:66`, `preferences-repository.ts:16,21`
- **Category:** Code Quality
- **Finding:** All three repositories manually set `updated_at: new Date()` in the application
  layer. There is no DB-side `BEFORE UPDATE` trigger to set `updated_at = now()` automatically.
  If multiple application instances run (or in future multi-node deployments), application-side
  clock skew between nodes could produce inconsistent timestamps.
- **Evidence:**
  ```ts
  const updates: Record<string, unknown> = { updated_at: new Date() };
  ```
- **Impact:** Low risk in the current single-node deployment. Medium risk if/when horizontally
  scaled. Also, a raw SQL UPDATE that bypasses the repository (e.g. in a migration) will not
  auto-update `updated_at`.
- **Recommendation:** Add a `BEFORE UPDATE` trigger (`SET NEW.updated_at = now()`) to all three
  tables, or use `DEFAULT now()` + application-controlled update as-is with explicit documentation
  that `updated_at` is app-managed.

---

### [INFO] No `jarvis_worker_runtime` grants on structured-state tables

- **File:** `packages/structured-state/sql/0031_structured_state.sql:71,121,162`
- **Category:** Architecture
- **Finding:** The SQL migration grants access to `jarvis_app_runtime` only. The
  `jarvis_worker_runtime` role (used by pg-boss workers) has no grants on `app.commitments`,
  `app.entities`, or `app.preferences`. This is correct for the current design (workers should not
  touch these tables), but note that if any future worker job needs to read or write structured
  state, an explicit migration will be required. This is documented here as a positive constraint
  to preserve.
- **Evidence:**
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON app.commitments TO jarvis_app_runtime;
  -- no jarvis_worker_runtime grant
  ```
- **Impact:** None currently. Keeps the worker role appropriately lean.
- **Recommendation:** No action required. Document in the module manifest that worker access is
  intentionally withheld.

---

### [INFO] `shareableResources` in manifest declares `contribute` and `manage` grant levels, but no policy enforces them

- **File:** `packages/structured-state/src/manifest.ts:28-31`, `packages/structured-state/sql/0031_structured_state.sql:48-53,98-103`
- **Category:** Architecture
- **Finding:** The manifest declares three grant levels for commitments and entities:
  `['view', 'contribute', 'manage']`. The RLS SELECT policies check
  `app.has_share('commitment', id, 'view')` — only the `view` level. There is no RLS UPDATE or
  DELETE policy that grants access to a `contribute`/`manage` grantee. The UPDATE and DELETE
  policies are owner-only. This means `contribute` and `manage` grant levels are declared but
  never enforced — they are dead configuration that misleads callers about what sharing actually
  permits.
- **Evidence:**
  ```sql
  CREATE POLICY commitments_select ON app.commitments
    USING (owner_user_id = app.current_actor_user_id()
           OR app.has_share('commitment', id, 'view'));
  CREATE POLICY commitments_update ON app.commitments
    USING (owner_user_id = app.current_actor_user_id());
  -- No has_share check for 'contribute' or 'manage'
  ```
- **Impact:** Callers that create `contribute`-level shares expecting grantees to be able to edit
  commitments will find that grantees cannot update anything. This is a silent capability gap. The
  manifest is also misleading documentation.
- **Recommendation:** Either (a) implement contribute/manage RLS policies on UPDATE/DELETE
  (requires a spec for the sharing model), or (b) reduce the manifest `grantLevels` to `['view']`
  only until full sharing is designed and implemented.

---

## Positive Observations

- RLS is `ENABLED` and `FORCE`d on all three tables. Policies use `USING` + `WITH CHECK` correctly.
- The `preferences` table is correctly marked owner-only (no `has_share` in SELECT).
- `VaultWriteBackService` correctly delegates all file I/O to `VaultContext` / `@jarv1s/vault` — no raw `fs` calls.
- `resolveVaultPath` in `@jarv1s/vault` provides traversal protection (`..` and out-of-root paths are rejected).
- Module isolation is clean: no other module queries `app.commitments`, `app.entities`, or `app.preferences` directly.
- The DataContextDb type is accepted at all repository entry points (compile-time brand).
- File sizes are well within the 1000-line limit (largest file: 162 lines in the SQL migration).
- Integration tests cover the happy path and the basic RLS SELECT isolation correctly.
- The `listVisible` name accurately signals that RLS-filtered visibility applies (including shares).
