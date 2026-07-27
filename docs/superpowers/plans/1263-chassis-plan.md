# Issue #1263 — module self-operation chassis implementation plan

**Binding inputs:** `docs/coordination/handoff-1263-self-operation-chassis.md`, then
`docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`.

**ESCALATION — Ben confirmation pending:** `notes.delete` performs a bare unlink with no trash,
soft-delete, or restore path. The Coordinator has surfaced it to Ben as a fourth
`confirm_always`; this plan includes it pending Ben's confirmation. Do not treat the count as settled
or substitute a risk reclassification. Any fifth candidate is escalated before implementation.

The Coordinator ruled #1263 **built-in only**. External-module self-operation ABI completeness is
tracked by #1267 under epic #1262. Existing external writes remain fail-safe meanwhile: they cannot
declare an action family, so `packages/ai/src/gateway/policy.ts:40` confirms them forever.

The Coordinator also ruled that exclusion rule 7 governs new self-operation/configuration
operations, not retroactive removal of shipped domain tools. Email and Calendar remain
`granted_at_install`. Where rule 7's examples collide with Ben's explicit per-tool classifications,
the per-tool ruling wins; this applies to all five News writes in Task 10.

## Verified baseline and non-negotiable decisions

- Add `selfOperationGrant`, not `selfOperationTier`, to the public SDK manifest. Its values are
  `"granted_at_install" | "confirm_always"`; they are not
  `JarvisActionPermissionTier` values. Do not widen `defaultTier`.
- `packages/ai/src/gateway/policy.ts` stays behaviorally unchanged. Its current order is destructive
  → confirm, no family → confirm, stored tier over declared default, then
  `trusted_auto + executionPolicy:"auto" + allowedTiers` → run.
- The gateway order becomes excluded → unavailable/deny, then YOLO → run, then ordinary policy.
  YOLO must continue to bypass `confirm_always`, destructive risk, and
  `requiresConfirmation`.
- The action-policy store already exists in `app.preferences` at
  `assistant.action_policy.v1.<moduleId>.<familyId>`. Add an insert-if-absent repository method;
  **do not add a migration** and do not reuse the clobbering `setActionPolicy` upsert.
- `PATCH /api/ai/action-policy/:moduleId/:actionFamilyId` rejects tiers absent from
  `allowedTiers`; every family touched here must therefore include `always_confirm`, and every
  `granted_at_install` family must also include `trusted_auto`.
- A `granted_at_install` tool must be `risk:"write"`, have an `actionFamilyId`, and use
  `executionPolicy:"auto"`. Otherwise the existing policy path still prompts. Existing destructive
  tools classified as granted are reclassified to write; their default family tier still preserves
  confirmation for existing users without an install grant.
- Built-in inventory is **38 actual tools across 10 packages**, not 39/11. The 39th grep match is
  the type-only narrowing at `packages/ai/src/routes.ts:647`; `ai.explainRecentErrors` is read-only.
  The assertion and inventory tests must say **built-in** explicitly. External completeness is
  #1267.
- The People round trip is not a reverse: `PeopleRepository.mergePeople` moves every identity and
  link and marks the secondary row merged; `PersonContextService.splitIdentity` moves one identity
  and never revives that row or restores its other identities/links. Preserve both tools as
  destructive and declare `confirm_always`, exactly like `memory.forget`.
- `notesDeleteExecute` (`packages/notes/src/write-tools.ts:232`) calls `unlink(file)` directly.
  Preserve `notes.delete` as destructive and plan its fourth `confirm_always` declaration pending
  Ben's confirmation.
- Do not ship assistant settings tools, a parallel command registry, a migration, the #1266 revoke
  UI, the external-module ABI tracked by #1267, CAS/undo/audit/rate-limit work for later settings
  commands, or a release note claiming direct user-visible behavior.

## Task 1 — Add the public SDK declaration

**Files**

- Modify `packages/module-sdk/src/index.ts`
- Modify `tests/unit/mcp-gateway-units.test.ts`

**Changes**

1. Export
   `ModuleAssistantToolSelfOperationGrant = "granted_at_install" | "confirm_always"`.
2. Add optional
   `readonly selfOperationGrant?: ModuleAssistantToolSelfOperationGrant`
   to `ModuleAssistantToolManifest`. It remains optional at the TypeScript level because read tools
   do not declare it; the runtime/build assertion enforces it for writes.
3. Do not change `JarvisActionPermissionTier` or
   `ModuleAssistantActionFamilyManifest.defaultTier`.
4. In the existing `"module-sdk tool contract"` describe block, add
   `"accepts the selfOperationGrant vocabulary without widening action tiers"` and compile fixtures
   for both values.

**Verify**

`pnpm vitest run tests/unit/mcp-gateway-units.test.ts`

**Commit**

`feat(module-sdk): declare self-operation grants`

## Task 2 — Implement the one central exclusion artifact and manifest assertion

**Files**

- Add `packages/ai/src/gateway/self-operation.ts`
- Modify `packages/ai/src/gateway/index.ts`
- Add `tests/unit/self-operation-chassis.test.ts`

**Symbols**

- `SELF_OPERATION_EXCLUSIONS`
- `isSelfOperationExcluded(moduleId, tool)`
- `assertBuiltInSelfOperationManifests(manifests)`

**Changes**

1. Keep the exclusion data immutable and server-owned. Each entry has a stable rule id, a fixed
   reason, and a matcher over manifest-owned identity only: module id, tool name, permission id,
   action-family id, and input-schema property names. Do not add a second command registry or a
   module-controlled “excluded” value.
2. Encode all seven approved categories:
   - `self_authority`: YOLO, action-policy/tier promotion, permissions, built-in/external module
     enable/install/remove/purge, connector feature grants, task agency auto-execution, AI service
     bindings/default provider/chat-model override/admin pin.
   - `prompt_shaping`: persona/assistant name, memory settings/fact mutation except the binding
     `memory.remember`/`memory.forget` declarations, priority ranking, source behavior and notes
     source selection, chat-skill mutation/import, and page-context writes.
   - `secrets`: registry entries with `secret:true`, credential and web-search-key writes, provider
     create/update, voice endpoint, connector authorize/complete/connect, onboarding
     login/install, terminal password/ticket.
   - `identity_auth_registration`: account lifecycle, admin promotion, session revocation,
     registration flags, onboarding state.
   - `data_scope_consent`: wellness AI consent and future prompt-data-widening flags.
   - `assistant_brain`: chat model override, embed provider, provider revoke, model disable,
     multiplexer.
   - `external_effect`: third-party sends, scheduled/cancelled work, digest/proactive/notes-source
     scheduling, provider tests/discovery, connector sync/revoke, briefing mutation/run, news
     preview/refresh, transcription, exports, module queue runs, host install.
3. Reject any write/destructive tool whose input schema exposes a generic `key`,
   `preferenceKey`, or `settingKey`; tools must hardcode their target.
4. `assertBuiltInSelfOperationManifests` must reject:
   - a write/destructive tool with neither an exclusion match nor `selfOperationGrant`;
   - an excluded tool which tries to declare either grant;
   - `granted_at_install` unless risk is write, execution policy is auto, its family exists, and
     that family allows both `trusted_auto` and `always_confirm`;
   - `confirm_always` on a tool other than the four-entry planned allowlist
     `memory.forget`, `people.merge`, `people.splitIdentity`, and pending `notes.delete`;
   - any action family referenced by a self-operation-declared tool which omits
     `always_confirm`;
   - duplicate tool names, duplicate family ids, or an action-family reference which does not
     resolve in its own module.
5. Error messages name the module/tool and failed invariant, never tool inputs.
6. Put this exact scope rationale in the assertion's doc comment: it validates **built-in
   manifests only**; external module tools are deferred to #1267, and remain safe because their ABI
   cannot declare `actionFamilyId`, so `policy.ts:40` confirms every external write unconditionally.

**Tests — exact names**

- `"rejects an unclassified built-in write tool"`
- `"rejects a built-in module override of a central exclusion"`
- `"rejects generic preference-key inputs on built-in tools"`
- `"covers all seven immutable built-in exclusion categories"`
- `"rejects built-in granted_at_install without write auto execution"`
- `"rejects built-in granted_at_install without a resolvable trusted family"`
- `"requires always_confirm in every referenced built-in family"`
- `"allows only the four planned built-in confirm_always tools"`
- `"accepts built-in read tools without a declaration"`
- `"documents built-in-only coverage with external modules deferred to #1267"`

Use synthetic manifests in this task; do not wire the assertion into boot until Tasks 4–13 have made
the built-in inventory valid.

**Verify**

`pnpm vitest run tests/unit/self-operation-chassis.test.ts`

**Commit**

`feat(ai): enforce self-operation classifications`

## Task 3 — Enforce exclusions before YOLO without changing YOLO

**Files**

- Modify `packages/ai/src/gateway/gateway.ts`
- Modify `tests/integration/mcp-gateway.test.ts`

**Changes**

1. In `AssistantToolGateway.executableTools`, omit centrally excluded tools so they are never listed
   to the model.
2. In `AssistantToolGateway.callTool`, keep exclusion/unavailability ahead of the existing YOLO
   branch. Do not move `resolvePolicy`, destructive handling, or `requiresConfirmation` ahead of
   YOLO.
3. Reuse `isSelfOperationExcluded`; do not duplicate exclusion logic in the gateway.

**Tests — exact names**

- `"does not list or execute an excluded tool with YOLO on"`
- `"YOLO still runs confirm_always destructive and per-call-confirm tools"`
- `"YOLO off still confirms confirm_always destructive and per-call-confirm tools"`

The YOLO-on regression test must cover all three ordinary confirmation mechanisms, not only
destructive risk.

**Verify**

`pnpm vitest run tests/integration/mcp-gateway.test.ts`

**Commit**

`fix(ai): enforce exclusions before yolo`

## Task 4 — Classify Tasks

**Files**

- Modify `packages/tasks/src/manifest.ts`
- Add `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- `granted_at_install`: `tasks.create`, `tasks.update`, `tasks.updateStatus`, `tasks.breakDown`,
  `tasks.addActivity`, `tasks.assignTag`, `tasks.unassignTag`, `tasks.createList`,
  `tasks.renameList`, `tasks.createTag`, `tasks.renameTag`, `tasks.deleteList`, `tasks.deleteTag`.
- Add `always_confirm` to `task_changes.allowedTiers`.
- Make `task_cleanup.allowedTiers` include `trusted_auto` and `always_confirm`.
- For `tasks.deleteList` and `tasks.deleteTag`, change risk to write and add
  `executionPolicy:"auto"`; keep `actionFamilyId:"task_cleanup"`. Existing users still confirm
  through the family's declared default until an install grant is stored.
- Add `"classifies all 13 Tasks write tools as granted_at_install"` to the new manifest test.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/tasks-tools.test.ts`

**Commit**

`feat(tasks): classify assistant writes for install grants`

## Task 5 — Classify Commitments

**Files**

- Modify `packages/commitments/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- `granted_at_install`: `commitments.accept`, `commitments.reject`, `commitments.snooze`.
- Add `executionPolicy:"auto"` to all three.
- Add `always_confirm` to `commitment_review.allowedTiers`.
- Add `"classifies all 3 Commitments write tools as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/commitments.test.ts`

**Commit**

`feat(commitments): classify assistant writes for install grants`

## Task 6 — Classify Goals

**Files**

- Modify `packages/goals/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- `granted_at_install`: `goals.create`, `goals.update`, `goals.addEvidence`.
- Add `executionPolicy:"auto"` to all three.
- Add `always_confirm` to `goals_management.allowedTiers`.
- Add `"classifies all 3 Goals write tools as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts`

**Commit**

`feat(goals): classify assistant writes for install grants`

## Task 7 — Classify Notes

**Files**

- Modify `packages/notes/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/notes-write-tools.test.ts`

**Exact classification**

- `granted_at_install`: `notes.create`, `notes.edit`.
- Add `always_confirm` to `note_changes.allowedTiers`.
- `notes.delete`: keep `risk:"destructive"` and declare `confirm_always`; do not add auto execution
  or reclassify it as write. This is the planned fourth declaration pending Ben's confirmation.
- Preserve `notes.create.requiresConfirmation` for the `overwrite:true` call shape; this is an
  existing per-call policy and YOLO continues to bypass it.
- Add `"classifies Notes create and edit as granted_at_install"`,
  `"keeps notes.delete destructive with pending confirm_always"`, and
  `"keeps overwrite confirmation conditional while ordinary note writes are auto-capable"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/notes-write-tools.test.ts`

**Commit**

`feat(notes): classify assistant writes for install grants`

## Task 8 — Classify People with the binding destructive ruling

**Files**

- Modify `packages/people/src/manifest.ts`
- Modify `packages/people/src/tools.ts`
- Modify `packages/people/src/__tests__/tools.test.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`

**Exact classification**

- Add family `people_review`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `granted_at_install` plus `executionPolicy:"auto"`:
  `people.acceptMatch`, `people.rejectMatch`.
- `confirm_always`, retaining destructive risk and confirm execution policy:
  `people.merge`, `people.splitIdentity`.
- Add `"declares merge and splitIdentity confirm_always because split is not a merge reverse"` to
  `packages/people/src/__tests__/tools.test.ts`; assert the exact four-tool map.
- Add `"classifies People with exactly two binding confirm_always declarations"` to the central
  manifest test.

Do not add a round-trip implementation or pretend `splitIdentity` restores merged state; the
verified repository/service behavior is the reason for the declaration.

**Verify**

`pnpm vitest run packages/people/src/__tests__/tools.test.ts tests/unit/self-operation-manifests.test.ts`

**Commit**

`feat(people): preserve destructive confirmations by declaration`

## Task 9 — Classify Memory

**Files**

- Modify `packages/memory/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/memory-graph-tools.test.ts`

**Exact classification**

- Add family `memory_management`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `memory.remember`: `granted_at_install`, `risk:"write"`,
  `actionFamilyId:"memory_management"`, `executionPolicy:"auto"`.
- `memory.forget`: `confirm_always`, retaining destructive risk; this preserves the existing
  destructive floor.
- Add `"classifies remember as granted and forget as binding confirm_always"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/memory-graph-tools.test.ts`

**Commit**

`feat(memory): declare assistant self-operation grants`

## Task 10 — Classify News

**Files**

- Modify `packages/news/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/news-chat-tools.test.ts`

**Exact classification**

- Add family `news_personalization`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `granted_at_install` plus that family and `executionPolicy:"auto"`:
  `news.confirmSource`, `news.removeSource`, `news.addTopic`, `news.removeTopic`,
  `news.addExclusion`.
- This exact per-tool classification from approved Spec 2 wins over rule 7's older
  `"news source preview/refresh"` example. Do not centrally exclude any of these five tools.
- Remove stale comments saying these tools can never be auto-approved.
- Add `"classifies all 5 News personalization writes as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/news-chat-tools.test.ts`

**Commit**

`feat(news): classify personalization writes for install grants`

## Task 11 — Classify Email

**Files**

- Modify `packages/email/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/email-reply-tools.test.ts`

**Exact classification**

- Add `always_confirm` to `email_drafts.allowedTiers`.
- Add family `email_sends`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `email.draftReply`: `granted_at_install`, retaining `email_drafts` and auto execution.
- `email.sendReply`: `granted_at_install`, change destructive to write, add
  `actionFamilyId:"email_sends"` and `executionPolicy:"auto"`.
- Update descriptions/comments which currently promise an unconditional approval prompt. Third-party
  disclosure and externally observable writes are not `confirm_always` grounds under Ben's binding
  ruling.
- State plainly in the production manifest comment and regression test: after the install grant,
  Jarvis sends the email immediately with **no confirmation card ever**. This consequential effect
  must remain impossible to miss in review.
- Add `"classifies both Email writes as granted_at_install"` and
  `"email.sendReply sends without a confirmation card after install grant"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/email-reply-tools.test.ts`

**Commit**

`feat(email): classify reply writes for install grants`

## Task 12 — Classify Calendar

**Files**

- Modify `packages/calendar/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/integration/calendar-delete.test.ts`

**Exact classification**

- Add `always_confirm` to `calendar_writeback.allowedTiers`.
- Add `trusted_auto` to `calendar_management.allowedTiers`; retain `always_confirm`.
- `calendar.proposeFocusBlock`: `granted_at_install`, retaining write/auto/writeback family.
- `calendar.deleteEvent`: `granted_at_install`, retaining the management family but adding
  `executionPolicy:"auto"`; change risk to write.
- Update descriptions/comments which say deletion always asks.
- Add `"classifies both Calendar writes as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/integration/calendar-delete.test.ts`

**Commit**

`feat(calendar): classify calendar writes for install grants`

## Task 13 — Classify Web Research

**Files**

- Modify `packages/web-research/src/manifest.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify `tests/unit/web-research.test.ts`

**Exact classification**

- Add family `web_research_requests`, default `ask_each_time`, allowed tiers
  `ask_each_time`, `trusted_auto`, `always_confirm`.
- `web.read`: `granted_at_install`, `risk:"write"`, the new family, and
  `executionPolicy:"auto"`.
- Add `"classifies web.read as granted_at_install"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/unit/web-research.test.ts`

**Commit**

`feat(web-research): classify page reads for install grants`

## Task 14 — Persist install grants without clobbering user policy

**Files**

- Modify `packages/ai/src/repository.ts`
- Modify `packages/ai/src/gateway/self-operation.ts`
- Add `tests/integration/action-policy-install-grants.test.ts`

**Symbols**

- `AiRepository.insertActionPolicyIfAbsent`
- `grantSelfOperationForModule`

**Changes**

1. `insertActionPolicyIfAbsent(scopedDb, moduleId, familyId, tier)` writes the existing
   `app.preferences` key with `ON CONFLICT (owner_user_id,key) DO NOTHING` and returns whether it
   inserted. It never calls or emulates `setActionPolicy`.
2. `grantSelfOperationForModule` derives the unique family ids referenced by
   `granted_at_install` tools and inserts `trusted_auto` only for those families. It does not grant
   confirm-only or unrelated families.
3. Keep the write actor-scoped through `DataContextDb`; add no root-DB path.

**Tests — exact names**

- `"stores trusted_auto under the existing action-policy preference key"`
- `"does not clobber an existing always_confirm user choice"`
- `"is idempotent across reinstall and reconcile"`
- `"grants only families referenced by granted_at_install tools"`

**Verify**

`pnpm vitest run tests/integration/action-policy-install-grants.test.ts`

**Commit**

`feat(ai): persist install grants without clobbering overrides`

## Task 15 — Wire grants into built-in enable paths

**Files**

- Modify `packages/settings/src/routes.ts`
- Modify `packages/settings/src/routes-modules.ts`
- Modify `packages/module-registry/src/index.ts`
- Modify `apps/api/src/server.ts`
- Modify `tests/integration/module-enablement.test.ts`

**Changes**

1. Add a narrow injected `grantSelfOperationForModule(scopedDb, manifest)` port to
   `SettingsRoutesDependencies`; settings must not import AI internals.
2. The composition layer owns one `AiRepository` and supplies the port using the AI helper.
3. Call the port inside the same actor-scoped transaction, after successful enable and before the
   response, in the two built-in branches:
   - `PATCH /api/me/modules/:id` when `disabled:false`;
   - `PATCH /api/admin/modules/:id` when `disabled:false`.
4. Do not touch `/api/admin/external-modules/:id`; external self-operation is #1267.
5. Re-enable/reconcile calls the helper again safely; insert-if-absent preserves a user's
   `always_confirm` override.

**Tests — exact names**

- `"user enable stores trusted_auto for eligible module families"`
- `"admin enable stores grants only for the acting admin"`
- `"re-enable does not overwrite always_confirm"`
- `"disable never mutates action-policy preferences"`
- `"external enable remains outside built-in grant wiring"`

**Verify**

`pnpm vitest run tests/integration/module-enablement.test.ts tests/integration/action-policy-install-grants.test.ts`

**Commit**

`feat(settings): grant self-operation policy on module enable`

## Task 16 — Wire the built-in assertion at startup and lock the inventory

**Files**

- Modify `apps/api/src/server.ts`
- Modify `tests/unit/self-operation-manifests.test.ts`
- Modify the closest existing `createApiServer` readiness test, or add
  `tests/unit/self-operation-startup.test.ts` if no focused readiness fixture remains small

**Changes**

1. Call `assertBuiltInSelfOperationManifests(getBuiltInModuleManifests())` before the server can
   become ready. Never pass external manifests.
2. Keep the assertion's doc comment and startup call explicit that #1263 covers built-ins only;
   cite #1267 and `policy.ts:40`.
3. Add the complete built-in inventory test:
   - 38 write/destructive tools;
   - 34 `granted_at_install`;
   - four planned `confirm_always`, with `notes.delete` pending Ben;
   - zero unclassified and zero excluded built-in tools;
   - exact planned confirm set `memory.forget`, `people.merge`, `people.splitIdentity`,
     `notes.delete`.
4. Add readiness regressions named
   `"built-in server startup fails closed on an unclassified built-in write tool"` and
   `"built-in startup assertion deliberately excludes external manifests tracked by #1267"`.

**Verify**

`pnpm vitest run tests/unit/self-operation-manifests.test.ts tests/unit/self-operation-startup.test.ts`

**Commit**

`feat(api): fail startup on self-operation drift`

## Task 17 — Runtime walk-away regression and final gate

**Files**

- Modify `tests/integration/mcp-gateway.test.ts`
- No production files unless this test exposes a defect in an earlier task

**Tests — exact names**

- `"first use after install grant runs without an action card"`
- `"stored always_confirm override still produces an action card"`
- `"the four planned built-in confirm_always tools remain the only confirmation declarations"`

The first test must persist the grant through the real repository/helper and let the gateway read the
stored tier; a stubbed `getFamilyTier:"trusted_auto"` is insufficient. Assert no `action_request`
event, not merely a successful handler result.

**Verify**

1. `pnpm vitest run tests/unit/self-operation-chassis.test.ts tests/unit/self-operation-manifests.test.ts tests/integration/action-policy-install-grants.test.ts tests/integration/mcp-gateway.test.ts`
2. `pnpm verify:foundation` with its real exit code; never pipe it through `tail`.

**Commit**

`test(ai): prove install grants run card-free`

## Builder stop conditions

- A proposed fifth `confirm_always` tool: stop that package task and message the Coordinator.
- Ben rejects or changes the pending `notes.delete` ruling: update Task 7 and the Task 16/17 counts
  before implementation.
- Any implementation that widens `defaultTier`, adds a migration, creates a parallel command
  registry, moves ordinary policy ahead of YOLO, clobbers an existing stored tier, or expands
  #1263 into the external ABI owned by #1267: stop.
- Stage and commit only the exact files in each task. Never use `git add -A` or run repo-wide format
  rewrites.
