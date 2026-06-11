## Phase 17 — Module structured-state

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 4
- LOW: 3
- INFO: 3

### Findings

#### [HIGH] Declared `contribute`/`manage` share levels are unenforceable — RLS grants no write path to grantees
**File:** `packages/structured-state/src/manifest.ts:28-31` (with `packages/structured-state/sql/0031_structured_state.sql:60-69,110-119`)  
**Invariant violated / concern:** Hard invariant #2 (Private by default — cross-user access requires *explicit grants*) and #9 (modules collaborate only through declared public APIs); the manifest's public contract advertises capabilities the storage layer cannot deliver.  
**Detail:** The manifest declares `shareableResources` for `commitment` and `entity` with `grantLevels: ["view", "contribute", "manage"]`. But the SQL only ever consults `app.has_share('commitment', id, 'view')` / `app.has_share('entity', id, 'view')` in the **SELECT** policy. The UPDATE and DELETE policies are strictly `owner_user_id = app.current_actor_user_id()` — they never call `has_share` at any level. A grantee holding `contribute` or `manage` therefore gets exactly the same access as `view` (read-only), and the higher levels are silently inert. This is a contract lie: callers reading the manifest will reasonably believe a `manage` grant lets a grantee mutate the row; it does not. It is also a latent security trap — the moment someone "fixes" this by adding `OR has_share(..., 'contribute')` to the UPDATE policy, they must also constrain the `WITH CHECK` (a contributor must not be able to reassign `owner_user_id` to themselves), and the current policy shape gives no scaffolding for that. The repository layer compounds the gap: `update`/`delete` accept any `id` and lean entirely on RLS, so there is no application-level intent to distinguish owner-write from grantee-write.  
**Suggested fix:** Either (a) narrow the manifest to `grantLevels: ["view"]` for both resources until write-sharing is actually specced and implemented (preferred — delete the unenforceable surface), or (b) implement and **test** UPDATE policies of the form `USING (owner = current_actor OR has_share('entity', id, 'contribute'))` with a `WITH CHECK` that pins `owner_user_id` to the existing owner so a contributor cannot steal ownership. Do not leave the declared/enforced split as-is.

#### [MED] No `assertDataContextDb` guard on any public repository method
**File:** `packages/structured-state/src/commitments-repository.ts:26,44,53,62,85`; `packages/structured-state/src/entities-repository.ts:25,43,52,61,84`; `packages/structured-state/src/preferences-repository.ts:4,27,36,44`  
**Invariant violated / concern:** Hard invariant #3 (DataContextDb only) — defense-in-depth contract that every repo entry point validates the branded handle.  
**Detail:** Every public method in all three repositories takes `scopedDb: DataContextDb` and immediately calls `scopedDb.db...`, but none calls `assertDataContextDb(scopedDb)` first. The sibling `tasks` module calls `assertDataContextDb` at the top of every public method (`packages/tasks/src/tools.ts:20,67,95,...`, `breakdown.ts:28`, `drift.ts:17,51,93`, `preferences.ts:7,23`). The brand is a compile-time-only marker (`assertDataContextDb` checks `[dataContextBrand] !== true` at runtime, `packages/db/src/data-context.ts:52-60`); without the runtime assertion, a caller that defeats the type system (a cast, an `any`, JS interop) can hand in a *root* Kysely instance and bypass RLS entirely, because nothing forces the `withDataContext` session-variable setup. This module is the canonical place that guard exists for.  
**Suggested fix:** Add `assertDataContextDb(scopedDb)` as the first statement of every public method in all three repositories, matching the `tasks` module convention.

#### [MED] Module ships unwired — repositories and write-back have no consumer (dead public surface)
**File:** `packages/structured-state/src/index.ts:1-17`  
**Invariant violated / concern:** Quality bar — feature logic with no integration path; incidental complexity preserved ahead of an approved API surface (relates to invariant #8, spec-before-build for the consuming feature).  
**Detail:** A repo-wide grep for `CommitmentsRepository`, `EntitiesRepository`, `VaultWriteBackService`, and `@jarv1s/structured-state` finds zero importers in `apps/` or `packages/api`; the only cross-package references are `module-registry` (manifest registration) and `tasks/src/preferences.ts` (which uses its *own* `TaskPreferences`, not this module's `PreferencesRepository`). So commitments/entities/preferences storage and the entire vault write-back service are reachable only from tests. This is acceptable as staged foundation work, but it means the contract has never been exercised by a real caller, which is exactly how the HIGH shareability mismatch above and the concurrency gap below survived. Flagging so it is tracked, not silently accreted.  
**Suggested fix:** Confirm there is an approved spec for the consuming feature (commitments/entities UI or AI-tool surface). If the surface is not imminent, consider deferring the module rather than carrying untested public API; if it is, prioritise wiring so the contract gets real-caller pressure.

#### [MED] No optimistic-concurrency / version guard — concurrent updates silently clobber (last-write-wins)
**File:** `packages/structured-state/src/commitments-repository.ts:62-83`; `packages/structured-state/src/entities-repository.ts:61-82`  
**Invariant violated / concern:** Quality bar — non-atomic / unguarded multi-step state where two actors can interleave; module-specific focus (optimistic-concurrency/version conflicts).  
**Detail:** `update` does an unconditional `set(...).where("id", "=", id)` with no `updated_at`/version precondition. There is no `version` column on `app.commitments` or `app.entities` (see `sql/0031_structured_state.sql:25-39,77-89`). Commitments are explicitly drift-aware with a multi-state lifecycle (`open → at_risk → slipped → renegotiated …`) and entities can be mutated both by the user and by inference write-back, so concurrent edits are a realistic scenario, not theoretical. With last-write-wins, a background inference update can silently overwrite a user's hand-edited status (e.g. user marks `dismissed`, an inference pass concurrently sets `at_risk` and wins). Nothing detects or surfaces the conflict.  
**Suggested fix:** Add a `version int NOT NULL DEFAULT 1` (or use `updated_at`) column and make `update` a guarded `.where("id","=",id).where("version","=",expectedVersion)` that bumps the version; return `undefined`/throw a typed conflict when zero rows matched so the caller can re-read. Decide this deliberately — if last-write-wins is genuinely acceptable for personal single-user scale, document that choice rather than leaving it implicit.

#### [MED] `update`/`get`/`delete` cannot distinguish "not found" from "RLS-filtered / not yours"
**File:** `packages/structured-state/src/commitments-repository.ts:53-60,62-83,85-87`; `packages/structured-state/src/entities-repository.ts:52-59,61-82,84-86`  
**Invariant violated / concern:** Quality bar — leaked-ambiguity contract; error handling at the boundary (E).  
**Detail:** `get`/`update` return `undefined` and `delete` returns `void` for both a genuinely-missing id and an id that exists but is invisible/unwritable to the actor under RLS. `delete` cannot report whether anything was deleted at all (`.execute()` result is discarded). For owner-only correctness this is *safe* (RLS prevents cross-user mutation), but the silent collapse of "no such row" and "exists-but-forbidden" means a calling API layer cannot return a correct 404-vs-403, and a buggy caller deleting the wrong id gets no signal. This is the same ambiguity that, combined with the unwired status, lets bugs hide.  
**Suggested fix:** Have `delete` return the deleted count (or boolean) by reading `executeTakeFirst`/`numDeletedRows`, and document explicitly that `undefined` from `get`/`update` means "not visible under RLS" so the consuming route layer maps it deliberately rather than guessing.

#### [LOW] Repeated `Record<string, unknown>` update-builder + `as Entity`/`as Commitment` casts obscure the real row contract
**File:** `packages/structured-state/src/commitments-repository.ts:41,50,59,67,82`; `packages/structured-state/src/entities-repository.ts:40,49,58,66,81`  
**Invariant violated / concern:** Quality bar / TypeScript (D) — cast-heavy contract; bespoke update-merge helper duplicated across both repos.  
**Detail:** Both repos build a `const updates: Record<string, unknown>` and then sprinkle `if (input.x !== undefined) updates["x"] = ...`, immediately discarding Kysely's column typing, and every read/return is force-cast `as Commitment` / `as Entity`. The casts are needed only because `selectAll()`/`returningAll()` already return the row type — they are redundant on `executeTakeFirstOrThrow` and merely paper over the `Record<string, unknown>` untyping. The `updated_at: new Date()` + conditional-assign block is duplicated verbatim in shape across both files.  
**Suggested fix:** Build the update object with Kysely's `UpdateObject<...>` (or pass the partial directly and let Kysely type it) so the casts disappear; if the conditional-assign pattern stays, factor the "drop undefined keys, stamp updated_at" step into one small shared helper rather than hand-rolling it twice.

#### [LOW] Hand-rolled YAML frontmatter serializer is a bespoke mini-parser where a canonical one likely exists
**File:** `packages/structured-state/src/write-back.ts:5-23`  
**Invariant violated / concern:** Quality bar — bespoke helper duplicating canonical machinery; fragile ad-hoc serialization.  
**Detail:** `write-back.ts` defines its own `FRONTMATTER_RE` regex, a `yamlStr` quoter, and a line-by-line `serializeFrontmatter`. This re-implements YAML frontmatter read/write by hand. The vault module already deals in markdown notes, and the memory/briefings modules parse frontmatter; an existing canonical frontmatter utility (or a vetted YAML dependency) would be safer than a regex that only handles a fixed key set and a single escaping rule. The current quoter handles `\` and `"` but not, e.g., embedded newlines in `name`, which would corrupt the block.  
**Suggested fix:** Reuse the project's existing frontmatter/YAML helper if one exists (grep memory/vault modules first), or depend on a small YAML lib for the frontmatter block; at minimum reject/escape newline-bearing string values so a malformed value cannot break the document structure.

#### [LOW] No worker-runtime grant — module is silently app-runtime-only
**File:** `packages/structured-state/sql/0031_structured_state.sql:71,121,162`  
**Invariant violated / concern:** Quality bar — implicit, undocumented capability boundary (relates to invariant #6 job execution).  
**Detail:** All three tables `GRANT ... TO jarvis_app_runtime` only; `jarvis_worker_runtime` gets nothing. Given commitments are described as drift-aware and inference-sourced (`source_kind` includes `inferred`/`email`/`calendar`), it is plausible a background worker will eventually write commitments/entities — and it will hit a permission-denied error. This is *correct and safe* today (no worker consumer exists), but the absence is undocumented, so the eventual worker author won't know writes were never wired.  
**Suggested fix:** Decide deliberately: if workers will never touch these tables, add a one-line SQL comment stating app-runtime-only is intentional; if they will, add the worker grant in a *new* migration (never edit `0031` — invariant #11) alongside the worker consumer.

#### [INFO] No unbounded-growth guard on preferences/entities/commitments
**File:** `packages/structured-state/sql/0031_structured_state.sql:25-39,77-89,127-134`  
**Invariant violated / concern:** Module-specific focus (unbounded-state-growth guard) — reviewed, no row-count cap or pruning.  
**Detail:** None of the three tables has a per-owner row cap or TTL. `preferences` is naturally bounded by its `UNIQUE (owner_user_id, key)` upsert key, so it cannot grow without bound. `commitments` and `entities` have no cap, but for a personal-scale single-user product unbounded accumulation of inferred commitments/entities is a product concern (clutter), not a storage-safety one, and is appropriately deferred. No action required now; flagging because the audit explicitly asks.  
**Suggested fix:** None required. If inference begins auto-creating commitments/entities at scale, revisit with a soft retention/archival policy on terminal states (`done`/`dismissed`).

#### [INFO] RLS, owner-scoping, and FORCE ROW LEVEL SECURITY are correctly applied across all three tables
**File:** `packages/structured-state/sql/0031_structured_state.sql:44-71,94-121,138-162`  
**Invariant violated / concern:** None — positive confirmation (dimension A).  
**Detail:** All three tables `ENABLE` + `FORCE ROW LEVEL SECURITY`, scope every policy `TO jarvis_app_runtime` (no `BYPASSRLS`, no admin bypass — invariant #1 honored), and gate INSERT/UPDATE/DELETE on `owner_user_id = app.current_actor_user_id()` with `preferences` correctly being SELECT owner-only (not shareable, matching its comment). `owned_tables` in the manifest matches the tables created. The integration test (`tests/integration/structured-state.test.ts`) exercises owner isolation and share-view visibility/revocation for commitments and entities against a real Postgres. This is the right shape.  
**Suggested fix:** None. Note the coverage gaps already raised separately: tests assert `view` share visibility but never assert that `contribute`/`manage` shares grant *write* (they don't — see HIGH finding), and there is no `assertDataContextDb` or concurrency test.

#### [INFO] Module isolation and DataContextDb/VaultContext layering are clean
**File:** `packages/structured-state/src/write-back.ts:1-3`; `packages/structured-state/src/commitments-repository.ts:1`  
**Invariant violated / concern:** None — positive confirmation (dimensions B, invariants #3, #9).  
**Detail:** Repositories import only `@jarv1s/db` types and operate solely on their own `app.commitments`/`app.entities`/`app.preferences` tables — no reach into another module's tables or internals. `write-back.ts` performs all vault I/O exclusively through `@jarv1s/vault` (`readVaultFile`/`writeVaultFile`/`vaultFileExists` with a `VaultContext`), never raw `fs` (invariant #3 satisfied). `AccessContext` usage in tests is the canonical `{ actorUserId, requestId }` (invariant #4). No secrets, tokens, or credentials are handled anywhere in the module.  
**Suggested fix:** None.
