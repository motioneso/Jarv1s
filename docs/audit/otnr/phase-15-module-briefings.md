## Phase 15 — Module briefings

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 1
- MED: 4
- LOW: 4
- INFO: 3

### Findings

#### [HIGH] Assistant tools executed with a blank ToolContext — owner isolation depends entirely on RLS, with no defense-in-depth
**File:** `packages/briefings/src/repository.ts:253-262`  
**Invariant violated / concern:** Hard invariant 2 (private by default) / hard invariant 9 (module isolation) — latent cross-user leak landmine.  
**Detail:** When generating a summary the module invokes each selected module's tool via `manifestTool.execute(scopedDb, {}, { actorUserId: "", requestId: "", chatSessionId: "" })`. The `ToolContext` is fully blanked. Today the four summarized read tools (`tasks.list`, `notifications.listVisible`, `calendar.listVisibleEvents`, `email.listVisibleMessages`) happen to ignore `ctx` and scope solely off the `scopedDb` RLS handle (see `packages/tasks/src/tools.ts:19` — `_ctx` unused), so isolation currently holds via the worker's `withDataContext(toAccessContext(job))`. But the briefings module accepts an *arbitrary* declared read tool from *any* module manifest (validated only by `risk === "read"`). The moment any module ships a read tool that trusts `ctx.actorUserId` (e.g. to choose a partition, key a cache, or build a query predicate), this call site silently feeds it the empty string `actorUserId`, producing either a crash or a wrong-actor data pull persisted into `briefing_runs.summary_text`/`source_metadata`. The blank context is a sole-RLS-dependency that defeats the project's defense-in-depth stance. The worker already knows the real actor (`job.data.actorUserId`); pass a real `ToolContext` derived from it (the repository should receive the actor id, or accept a `ToolContext` from the job layer) rather than a hardcoded `""`.  
**Suggested fix:** Thread the job's `actorUserId`/`requestId` into `generateRun` and construct a real `ToolContext` (a synthetic `chatSessionId` is acceptable since there is no chat session) instead of `{ actorUserId: "", requestId: "", chatSessionId: "" }`. Assert non-empty `actorUserId` before executing any tool.

#### [MED] `idempotencyKey` is accepted and persisted into the job payload but never enforced — duplicate run jobs are possible
**File:** `packages/briefings/src/routes.ts:123-142`  
**Invariant violated / concern:** Quality smell — cast-heavy/decorative contract; non-idempotent orchestration.  
**Detail:** The route reads `body.idempotencyKey`, stamps it into `BriefingRunPayload`, and calls `dependencies.boss.send(BRIEFINGS_RUN_QUEUE, payload)` with no `singletonKey`/dedup option. pg-boss `send` does not deduplicate on a payload field, so two POSTs with the same `idempotencyKey` enqueue two jobs and produce two `briefing_runs` rows (each with a fresh `runId` generated at line 123, so even the run id is not derived from the key). The field name promises idempotency the system does not deliver. Either wire the key into `boss.send(queue, payload, { singletonKey: body.idempotencyKey })` (or use it to derive a deterministic `runId` guarded by a unique constraint), or remove the field from the request/payload contract entirely.  
**Suggested fix:** Pass `{ singletonKey: idempotencyKey }` to `boss.send` when provided (and/or derive `runId` deterministically with a DB unique guard), or drop `idempotencyKey` from `RunBriefingDefinitionRequest`/`BriefingRunPayload` and `runBriefingDefinitionRequestSchema`.

#### [MED] `summarizeToolResult`/`displayToolName` hard-code other modules' tool names and output shapes
**File:** `packages/briefings/src/repository.ts:316-350`, `392-406`  
**Invariant violated / concern:** Hard invariant 9 (module isolation) — reaching into another module's output contract by string-keyed special cases.  
**Detail:** The summarizer `switch`es on literal tool names owned by other modules (`"tasks.list"`, `"notifications.listVisible"`, `"calendar.listVisibleEvents"`, `"email.listVisibleMessages"`) and blind-casts each module's result into ad-hoc shapes (`result.tasks`, `result.events`, `result.messages`, `item as { title?: unknown; ... }`). Briefings is supposed to collaborate only through declared public APIs. There is no declared `outputSchema` contract being consumed here; the names and field shapes are copied by hand. If tasks renames `tasks.list` → `tasks.listVisible` (note both are already handled, hinting this drift has happened once) or changes the result key, briefings silently degrades to `summarizeUnknownResult` (excerpts vanish, item counts may go to 0) with no failure signal. This special-case sprawl is incidental complexity bolted onto the briefings package. Drive the summary from the declared tool `outputSchema` (or a small generic "first array of objects → count + N excerpts" rule) instead of per-module literals.  
**Suggested fix:** Replace the name-keyed `switch` with a schema-driven or generic extractor (count the first array field; build excerpts from its first string-valued properties). If module-specific formatting is truly required, register it on the owning module's tool manifest, not in briefings.

#### [MED] Run authorization is enforced in the app layer, not by RLS — `getDefinitionById` returns shared definitions then a string compare gates the run
**File:** `packages/briefings/src/routes.ts:114-121`  
**Invariant violated / concern:** Hard invariant 1/2 — owner-only operation guarded by app code rather than the database.  
**Detail:** The `/run` handler loads the definition via `repository.getDefinitionById` (no owner predicate — RLS now permits owner-or-share per `0026_briefings_owner_or_share.sql`), then rejects non-owners with `definition.owner_user_id !== accessContext.actorUserId`. So "only the owner may trigger a run" lives only in TypeScript. The repository already has `getOwnedDefinitionById` (used inside `generateRun`), and the worker insert is RLS-guarded to the owner, so the real damage is bounded — but the route's own gate is a soft, easily-regressed check. A future refactor that drops the `!==` line would let a `view`-shared user enqueue runs on someone else's definition. Prefer fetching with the owner-scoped query at the route so the authorization decision is uniform with the rest of the module.  
**Suggested fix:** In the `/run` route, fetch via an owner-scoped query (mirror `getOwnedDefinitionById`) and 404 on `undefined`, removing the separate `owner_user_id` comparison so the owner-only rule is expressed once.

#### [MED] `briefing_definition` is wired into the share RLS path but the manifest declares no `shareableResources`
**File:** `packages/briefings/src/manifest.ts:22-132`, `packages/briefings/sql/0026_briefings_owner_or_share.sql:21`  
**Invariant violated / concern:** Hard invariant 9 (module isolation / declared public surface) — undeclared shareable resource type.  
**Detail:** Migration 0026 adds `app.has_share('briefing_definition', id, 'view'|'manage')` to the select/update policies for definitions and propagates view-share to runs. Yet `briefingsModuleManifest` has no `shareableResources` array, unlike `tasks` (`packages/tasks/src/manifest.ts:227`) and `structured-state` which declare `resourceType` + `grantLevels`. The result is a sharing capability that exists at the database layer with no declared module contract describing it, no advertised grant levels, and (depending on how grants are minted) possibly no supported path to actually create such a grant. This is exactly the kind of "infrastructure leaked ahead of / behind the declared API" gap the standards target: either briefings is meant to be shareable (then declare `shareableResources: [{ resourceType: "briefing_definition", grantLevels: ["view", "manage"] }]`) or it is not (then the `has_share` clauses are dead RLS surface that should be reverted to owner-only). The mismatch must be resolved one way or the other.  
**Suggested fix:** If sharing is intended, add the `shareableResources` manifest entry matching the grant levels used in 0026 (`view`, `manage`). If not, add a follow-on migration restoring owner-only policies and drop the `has_share` clauses.

#### [LOW] Dead conditional — both branches of the pluralization yield the same string
**File:** `packages/briefings/src/repository.ts:386`  
**Invariant violated / concern:** Quality smell — dead code / incidental complexity.  
**Detail:** `const visibleLabel = tool.itemCount === 1 ? "visible" : "visible";` — the ternary is a no-op; both arms are `"visible"`. It is either a leftover from an intended singular/plural ("item"/"items") or pure noise. Delete it or make it actually pluralize.  
**Suggested fix:** Replace with a literal `"visible"` (or implement real pluralization, e.g. `` `${count} item${count === 1 ? "" : "s"}` ``).

#### [LOW] Redundant runtime metadata-only check on a payload TypeScript already constrains, via a double cast
**File:** `packages/briefings/src/routes.ts:124-134`  
**Invariant violated / concern:** Quality smell — over-defensive internal check + cast-heavy contract (`as unknown as Record<string, unknown>`).  
**Detail:** `payload` is built as a typed `BriefingRunPayload` object literal from known fields. The subsequent `if (!isBriefingRunPayloadMetadataOnly(payload as unknown as Record<string, unknown>)) throw ...` can never fire for this literal — there is no path by which extra keys appear. The check is duplicated again (correctly, as a true boundary) in the worker (`jobs.ts:72`). On the producer side it adds a `as unknown as` double cast and a dead `throw` to an internal flow. The worker-side check is the meaningful boundary; the route-side one is ceremony.  
**Suggested fix:** Drop the route-side guard (or, if a belt-and-suspenders check is desired, keep only the worker-side one). Avoid the `as unknown as Record<string, unknown>` cast.

#### [LOW] `excerpts` field is optional in the interface but always written — and `summarizeToolResult` blind-casts every item
**File:** `packages/briefings/src/repository.ts:316-365`  
**Invariant violated / concern:** TypeScript soundness — `item as { title?: unknown; ... }` casts without validation.  
**Detail:** Each summarizer arm casts an arbitrary array element (`item as { readonly title?: unknown }`) and trusts it. Because the data originates from RLS-scoped owner data this is not a leak, but it is unsound: a tool returning a non-object array (e.g. `string[]`) would pass `Array.isArray` and then access `.title` on a primitive (yielding `undefined`, silently). Combined with the hard-coded names (see the MED above), the contract between briefings and source tools is entirely cast-based. Narrow with a type guard (`typeof item === "object" && item !== null`) before property access.  
**Suggested fix:** Add an object guard inside `formatItem` callbacks before reading fields; prefer deriving from the tool's declared `outputSchema`.

#### [LOW] Per-tool `try/catch` swallows the underlying error with no log or detail
**File:** `packages/briefings/src/repository.ts:253-273`  
**Invariant violated / concern:** Error handling — swallowed catch loses diagnostic signal.  
**Detail:** A failing tool execution is caught and reduced to `{ status: "failed", blockedReason: "tool_failed" }` with the original error discarded entirely (bare `catch {`). The run is correctly marked `failed`, but there is no log line, request id, or error message captured anywhere, making a flaky source tool effectively undebuggable in production. Note `retryLimit: 0` (jobs.ts:41) means there is no retry to compensate. Capture the error (structured log keyed by `requestId`/tool name) while still degrading gracefully.  
**Suggested fix:** Log the caught error with the tool name and the run/request id before pushing the `failed` summary; keep the user-facing `blockedReason` opaque.

#### [INFO] Module performs NO AI/LLM call — "AI briefing generation" is a deterministic text summarizer
**File:** `packages/briefings/src/repository.ts:210-286`  
**Invariant violated / concern:** Scope clarification for invariants 5 and 7 (secrets/PII into AI prompts; provider-agnostic AI) — not applicable as built.  
**Detail:** Despite the framing, `generateSummary` never invokes any AI provider or capability router. It executes read tools and string-formats their results (`formatToolSummary`) into `summary_text`. No prompt is constructed, so there is no path for private content or secrets to reach an AI prompt, and there is no hardcoded provider/model to violate provider-agnosticism. This is the safe design. Flagging so reviewers do not assume an AI-prompt exposure surface exists where none does — but note that if a future slice adds real AI summarization, invariants 5/7 and the metadata-only-payload rule will all newly apply to this path.  
**Suggested fix:** None. If AI summarization is added later, route through the capability router and keep raw tool output out of any logged/persisted prompt.

#### [INFO] Owner-or-share runs persist real private excerpts (email senders/subjects, task titles) into `briefing_runs`
**File:** `packages/briefings/src/repository.ts:316-346`, `packages/briefings/sql/0026_briefings_owner_or_share.sql:53-67`  
**Invariant violated / concern:** Confirmation of share semantics for invariant 2 — reviewed, consistent with design.  
**Detail:** `source_metadata.tools[].excerpts` and `summary_text` store genuine owner private content (e.g. email `sender`/`subject`, task `title`). Runs are visible to `view`-shared users via the runs select policy. This is the intended consequence of sharing a briefing definition (a sharee sees the summarized output), and generation runs under the owner's RLS scope (job `actorUserId` = definition owner), so no foreign data is mixed in. Tests at `tests/integration/briefings.test.ts:392-415` confirm a User A job cannot generate User B's private briefing. No defect — recorded so the share-exposure of excerpt content is an explicit, reviewed decision (and ties to the unresolved `shareableResources` declaration gap above).  
**Suggested fix:** None, provided the `shareableResources` MED is resolved so the share surface is actually declared.

#### [INFO] Module reviewed against dimensions A–G; structure is clean and well-tested
**File:** `packages/briefings/src/repository.ts:57-208`, `tests/integration/briefings.test.ts:100-428`  
**Invariant violated / concern:** Reviewed-clean note.  
**Detail:** All repository methods call `assertDataContextDb` and accept only `DataContextDb` (invariant 3 upheld); `AccessContext` is the canonical `{ actorUserId, requestId }` (invariant 4); job payloads are metadata-only and the rule is enforced both at producer and worker boundaries and asserted in tests (invariant 6); RLS is `ENABLE`+`FORCE` with owner-scoped policies and narrow worker grants, and the SQL lives in the module's `sql/` dir (invariants 1, 11); read-risk gating on tool selection is enforced at the route (`requiredReadToolNames`) and re-checked at generation time (`risk !== "read"`), a good double gate; no raw `fs`/`VaultContext` surface here; all source files are well under the 1000-line limit. Output is plain text/JSON returned through serializers with no HTML rendering, so output-injection risk is minimal at this layer (frontend must still treat `summaryText` as untrusted text — out of scope for this package). Tests run against a real Postgres with two users and verify cross-user isolation, RLS-on migration shape, metadata-only payloads, and the `withDataContext` guard.  
**Suggested fix:** None.
