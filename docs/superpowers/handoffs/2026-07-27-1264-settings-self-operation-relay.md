# #1264 settings self-operation — relay (pre-plan, no code yet)

**Branch/worktree:** `1264-settings-self-operation` (this worktree). **Coordinator label:** `Coordinator`
(pane resolved by label, not a baked pane number — re-resolve via `herdr pane list`).
**Risk tier:** security (Opus QA required before merge, per spec Exit Criterion).

## State: still in grounding/pre-plan. No plan written. No code written. No commits made.

Do NOT re-read the full spec again — read it by section only, per `coordinated-build`.
Spec: `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md`.
Handoff doc (read once, already done): `docs/coordination/handoff-1264-settings-self-operation.md`.

## Coordinator rulings already locked in (do not re-escalate these)
1. Gateway-ordering prerequisite already satisfied by #1263/PR #1268 — skip building it, cite
   evidence in PR body (`gateway.ts:592,355,431,161`).
2. **Digest settings dropped from scope entirely** — never rename/narrow the exclusion prefix to
   route around it. Contradiction parked in `docs/coordination/AWAITING-BEN.md`.
3. Three migrations, exact directories: `app.preferences` revision → `packages/structured-state/sql/`
   (highest existing: `0167_worker_entities_grant.sql`); `app.instance_settings` revision →
   `infra/postgres/migrations/` (highest: `0156_module_installs.sql`); audit-outcome CHECK-widening
   (add `invalid`/`conflict`) → NEW file in `packages/ai/sql/` (highest: `0173_...`), **never edit
   `0127_jarvis_action_audit_log.sql`**. Migration numbers are global/landing-order — do not assume
   numbers in the plan.
4. Audit scope confirmed in-scope; settings tools write audit rows only through the existing audit
   port (module isolation); the TS outcome-union type change + the CHECK widening must land in the
   SAME PR/migration set.

## One NEW open question for the coordinator (raised in relay message, unanswered as of this doc)
**"Chat response style" ownership.** Spec cites it as a round-one auto-safe setting
(`chat-settings-api.ts:3` → `runtime.ts:529`). Grounded this session: `ChatResponseStyle`/
`ChatSettingsDto` live in `packages/shared/src/chat-settings-api.ts`; the route lives in
`packages/chat/src/routes.ts`; consumed by `packages/chat/src/live/runtime.ts:529`. **This is owned
by the `chat` module, not `settings`.** Per CLAUDE.md module isolation, if in scope for #1264 the
tool likely belongs on the `chat` module's own manifest, not settings'. Options: (a) coordinator
rules it in-scope and it becomes a small separate tool declaration on chat's manifest within this
same PR, (b) coordinator defers it explicitly to a follow-up. **Do not silently decide either way —
wait for the coordinator's answer** (message already sent, may have a reply waiting).

## Grounding already done — do not re-derive
- No new SDK "authorization callback" field needed. Every other module (Tasks/Notes/Calendar/Email/
  People/Memory/News/Web-Research) derives the actor from `ToolContext`/`AccessContext`; `DataContextDb`
  RLS is the authorization mechanism. Follow that pattern.
- Install-time `trusted_auto` grant wiring is ALREADY generic for `settings`
  (`packages/module-registry/src/index.ts`'s `resolveGrantSelfOperationForModule` only special-cases
  `tasks`). No new wiring task — just declare `selfOperationGrant` + `actionFamilyId` correctly on
  each tool.
- `resolvePolicy` (`packages/ai/src/gateway/policy.ts`, read in full): for a tool to run card-free
  needs `risk:"write"`, `executionPolicy:"auto"`, an `actionFamilyId` whose family `allowedTiers`
  includes `trusted_auto`, and a stored tier of `trusted_auto` (which install-grant provides).
- Round-one settings tool name candidates, confirmed clear of ALL 7 exclusion categories'
  `settings.*` prefixes in `packages/ai/src/gateway/self-operation.ts` (full list re-derivable by
  reading that file's `SELF_OPERATION_EXCLUSIONS`, lines ~1-45): `settings.themeMode.set`,
  `settings.locale.setRegionAndDateFormat`, `settings.locale.setTimezone`, `settings.quietHours.set`,
  `settings.weatherLocation.set`, `settings.notificationPreference.setEnabled`. **Avoid anything
  starting `settings.module.enable.`** (reserved/excluded).
- Real gaps confirmed by reading (not assumed): `locale-routes.ts` has NO real IANA timezone
  validation (only non-empty trim) — timezone tool needs write-time validation added.
  `notification-preferences-routes.ts`'s per-module enable/disable logic is inline in the route
  handler (lines 66-107 of that file) — needs extraction to a module-owned application function
  before a tool can call it. `preferences-repository.ts` (68 lines, full file) has plain
  upsert/get/list/delete with `ON CONFLICT ... DO UPDATE` — **no CAS/revision column at all**, fully
  net-new work.
- `packages/ai/sql/0127_jarvis_action_audit_log.sql` (85 lines, read in full): `outcome` CHECK is
  currently `IN ('success','failed','denied','cancelled')` — widen via new migration to add
  `invalid`/`conflict`.
- `packages/settings/src/manifest.ts` (421 lines, read in full): only one existing assistantTool
  (`app.getMapSlice`, read-risk). This is the file to extend with new `assistantTools` entries
  (and likely `assistantActionFamilies`).
- **Merge-conflict risk flagged to coordinator:** `tests/unit/self-operation-manifests.test.ts`
  (365 lines, read in full) has an exact-count assertion
  (`grantedAtInstall.length === 29`, `confirmAlways.length === 5`, `userPromotable.length === 4`,
  sum `=== 38`) that both this build and sibling #1265 (news/sports) will need to bump — coordinator
  must reconcile final numbers at merge time. Don't loosen the assertion; only add your own tools'
  contribution to the counts/name lists.

## Still not done / not read
- `runtime-config-keys.ts` (~line 10) — cited by spec's undo-over-absent-row test requirement, not
  yet read.
- Whether the spec's "per-module view + revoke screen" is in scope for this PR (absent from spec's
  Tests section and Exit Criterion/UAT). Leaning: propose deferring to a follow-up issue — get
  coordinator sign-off, don't just decide.
- The plan document itself — not started. Next concrete action: once the chat-response-style
  question comes back, invoke `superpowers:writing-plans`, write
  `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md`, message
  coordinator "plan ready for <slug>: <path>. Approve, or flag a fork.", STOP for approval, then
  build via TDD task-by-task with per-task green commits.

## Full detail
`memory_smart_search` project `jarv1s`, query `"1264 settings self-operation"` — has the same
findings above plus the complete verbatim exclusion-prefix list per category (already independently
re-derivable from `self-operation.ts` if memory is stale).
