# Plan Review Log: Module self-operation

Act 1 (grill) complete — plan locked with Ben 2026-07-26, grounded on `751c7f14`.

- `PLAN_FILE` = `docs/superpowers/plans/2026-07-26-module-self-operation.md`
- `MAX_ROUNDS` = 5
- Reviewer: Codex, `gpt-5.6-sol` at `high` reasoning (Ben's explicit choice), herdr agent
  `codex-selfop`, read-only every round.

## Round 1 — Codex (gpt-5.6-sol high) — VERDICT: REVISE

Grounded on `751c7f14ff2316c7d481c8ddd915c43de63f1bbe`; local HEAD matched cached `origin/main`.
17 findings, 5 marked BLOCKER.

**BLOCKERs**

1. Prompt injection is an unsolved confused-deputy vulnerability — the gateway has actor identity
   but no evidence the human asked for a given write (`packages/ai/src/gateway/gateway.ts:127`).
   Proposed fix: server-parsed command or first-party intent token bound to the exact setting/value.
2. The assistant could modify the controls governing its own authority — the plan excluded three
   brick vectors but not YOLO settings, action-family trust tiers, persona text, or skills.
   `personaText` renders directly into future prompts (`packages/chat/src/live/runtime.ts:500`).
3. "Reversible scalar" ≠ reversible effect — enabling registration admits accounts, promotion grants
   privilege, deactivation revokes sessions and reconciles jobs (`packages/settings/src/routes.ts:563`).
4. The plan's auto-run behaviour cannot be expressed by the current gateway — auto-run requires a
   user-promoted `trusted_auto` family; `requiresConfirmation` can only _force_ confirmation
   (`packages/ai/src/gateway/policy.ts:29`).
5. YOLO executes _before_ `requiresConfirmation` and destructive-policy evaluation, so unrecoverable
   calls bypass the claimed mandatory prompt whenever YOLO is on (`packages/ai/src/gateway/gateway.ts:158`).

**Others (6–17):** plan self-contradiction between steps 5 and 6; the app map is not a setting
registry (its `settings` are coarse UI surfaces, `packages/shared/src/app-map-core.ts:62`); extending
only `AppMapItem` is the wrong schema change (`module-sdk/src/index.ts:456`, `app-map-tool.ts:21`);
`scope` is presentation metadata, not an authorization contract (`app-map.ts:35`, `routes.ts:932`);
a central settings dispatcher breaks module isolation and least privilege; secret handling violates a
hard invariant (`instance-settings-keys.ts:14`); read-before-write and undo are racy; `(key, before,
after)` cannot reverse absent rows or defaults (`runtime-config-keys.ts:10`); "the conversation is the
sink" is not a defined undo mechanism; observability insufficient — audit summaries are key-names only
and fire-and-forget (`assistant-tools.ts:36`, `gateway.ts:609`); artifact/runtime drift is fail-open
(`app-map.ts:27`, `scripts/build-app-map.ts:23`); the design-spec gate is unmet.

### Claude's response

Independently verified the five load-bearing claims before acting on them. All confirmed in code:
`gateway.ts:160` does run the YOLO branch ahead of `resolvePolicy`; `policy.ts:29` grants auto-run
only for `trusted_auto` + `executionPolicy: "auto"`; the `settings` module's app-map entries are the
screens `priority-settings` and `admin-settings`; `resolveChatPersona` renders stored `personaText`
into the system prompt; `web.brave_search_api_key` is `secret: true` and rejected by generic upsert.

**Accepted (2–17).** The plan was rewritten: the app map is no longer the write registry (a
server-owned command registry is canonical and the artifact derives from it); commands live in the
owning module rather than a central `settings` dispatcher; a permanent exclusion set now covers
self-authority, prompt-shaping, secrets, identity/auth and the three brick vectors; execution modes
are explicitly `auto_reversible` / `confirm_only`, removing the step 5/6 contradiction; reversibility
is defined on effect rather than value; auto-run reuses `trusted_auto` instead of inventing policy;
per-command authorization callbacks replace `scope`-as-authz; writes become compare-and-swap with
presence-aware undo; undo is a bounded in-memory per-chat stack keyed by opaque mutation id with no
prior values in model output; audit is transactional and names the command; startup asserts
registry/handler parity. The YOLO-before-policy bug is pulled out as a prerequisite fix that lands
first, since it is a live bypass independent of this feature.

**Rejected — finding 1's fix, not finding 1.** An intent token bound to the exact setting and value
requires the user to pre-authorize each write, which is a confirmation prompt with extra steps and
defeats the single requirement this feature exists to satisfy (ask, then walk away). The accepted
mitigation is capability reduction instead: with authority, secrets, identity and external effects
out of the tool surface, a successful injection can change a theme and quiet hours — bounded and
reversible — rather than escalating its own privileges. The residual risk is recorded in the plan and
must be re-argued for every future allowlist addition.

**Noted, not a plan defect — finding 17.** The plan explicitly precedes two design specs; a process
note now says so.

## Round 2a — Fable 5 (independent second lens, revised plan) — VERDICT: REVISE

Independent pass over the _rewritten_ plan, grounded on `751c7f14`. Confirmed the rewrite's factual
claims (YOLO-before-policy, tier machinery, `app.getMapSlice` as settings' only tool,
`assertBootstrapOwnerAdminUser` file-local, key-names-only fire-and-forget audit, persona-into-prompt,
`required: true` modules undroppable, notifications in-app only, weather exfil negligible). Nine
findings:

1. **HIGH — the walk-away UX doesn't exist under "machinery that exists".** SDK `defaultTier` is
   typed `"ask_each_time" | "always_confirm"` (`module-sdk/src/index.ts:26`), so `trusted_auto` can
   never be a _default_; `policy.ts:47` auto-runs only after the user promotes the family. Every
   round-one command therefore prompts on every call until a promotion the plan never mentions.
2. **HIGH — internal contradiction.** Allowlisted `chat response style` is banned by the plan's own
   "nothing shaping future prompts" rule (`runtime.ts:529`), and stored timezone interpolates into
   the prompt (`runtime.ts:524`) while the write path accepts any ≤100-char string
   (`locale-routes.ts:63`) even though the read path validates (`locale-utils.ts:7`).
3. **HIGH — the exclusion sweep finds real unnamed items:** `wellness.ai_consent_granted` (a whole
   missing category — data-scope consent flags), module install / trust / instance-wide disable,
   `POST /api/admin/host/install` (host script, deliberately outside any DB context),
   `chat.modelOverride` / `ai.chat_model_override.enabled`, `ai.embed_provider: stub` (permanent
   recall holes = the plan's own deferred-effect failure), `registration.requires_approval`,
   `onboarding.state`.
4. **MED — exclusion enforcement is undefined and self-contradictory.** "Enforced before YOLO"
   presumes a gateway denylist, but the plan's model is "the dangerous command is not a tool", in
   which case the gateway has nothing to check. Also: `tasks` ships two `risk: "destructive"` tools
   that auto-run under YOLO today, so "fixing" the ordering is a visible product change, not a
   pure bug fix.
5. **MED — shared-namespace hazard.** `yolo.allowed`, `yolo.enabled`, `persona.bundle`, wellness
   consent and the tasks tier compat key all live in the same `app.preferences` table behind the
   same `PreferencesPort` the allowlisted commands will use. Any command taking a key as an
   argument is self-promotion to YOLO.
6. **MED — CAS needs schema that doesn't exist.** `app.preferences` is `value_json` + `updated_at`
   with last-write-wins upsert (`structured-state/preferences-repository.ts:9`); no version column,
   and `instance_settings` likewise. Requires a migration on a shared core table, with an unstated
   ownership question.
7. **LOW-MED — "side-effect-free" is too generous.** Quiet hours and notification prefs gate whether
   alerts reach the user, and missed notifications are not retroactively deliverable.
8. **LOW — undo needs its own policy.** Undo is itself an auto write tool; scope it to round-one
   mutation ids or it becomes a second write surface.
9. **NIT — two citations off** (audit fire-and-forget is `gateway.ts:169/187`; the summarizer is
   `packages/ai/src/assistant-tools.ts`).

## Round 2b — Codex (gpt-5.6-sol high) — VERDICT: REVISE

Scored all 17 prior findings: 5 addressed, 4 mostly/partially, and 4 and 5 **not addressed**. Twelve
new material flaws, plus a concrete exclusion sweep. The load-bearing ones:

1. **The YOLO prerequisite is incomplete.** Moving only the permanent exclusions ahead of the YOLO
   branch still lets YOLO execute `confirm_only`, `risk: "destructive"`, and `requiresConfirmation`
   calls. Correct order: exclusion → deny; confirm-mode/destructive/per-input → confirm; only then
   may YOLO bypass ordinary policy.
2. **The new command registry duplicates one that exists.** `ModuleAssistantToolManifest`
   (`module-sdk/src/index.ts:499`) already owns tool name, permission id, action family, risk,
   execution policy, handler, schemas and services. Extend it with the self-operation metadata and
   keep only a central immutable denylist — do not add a parallel registry, which would make a third
   source of truth beside `assistantTools` and action families (`gateway.ts:585` executes handlers
   straight off module manifests).
3. **"Calls the module's existing service layer" is false** for locale, chat style, quiet hours and
   notification preferences — all four write repositories directly from routes. The work is to
   extract a module-owned application function, not to reuse one.
4. **CAS on `updated_at` is not safe** — same-timestamp collisions, clock-derived correctness. Needs
   an integer revision incremented atomically, conditional update/delete, and `ON CONFLICT DO
NOTHING` for absent-row creation.
5. **Bounded blast radius is not bounded in frequency.** An injected loop can oscillate a setting
   indefinitely, filling audit and undo state. Needs per-actor/per-command rate limits, no-op
   suppression, bounded mutation retention, and a metric on hard-exclusion and repeated-CAS failures.
6. **Several proposed auto commands are not effect-reversible**, verified in code:
   `NotificationsRepository.create()` returns null while notifications are disabled
   (`notifications/src/repository.ts:185`) so undo cannot recreate what was never made; quiet hours
   writes a stored `deferred_until` (`repository.ts:199`) that restoring the setting does not undo;
   `clearUnread` is irreversible (`notification-preferences-routes.ts:96`); weather location is sent
   to Open-Meteo on every future read (`weather-service.ts:41`) and cannot be retracted; locale
   supplies both prompt text (`runtime.ts:526`) and the fallback timezone for deferral.
7. **Personal commands must derive the target user from `ToolContext`**, never accept a target-user
   argument.
8. **Audit outcome semantics undefined** — rejected authorization, validation failures and
   transaction aborts cannot all be recorded "in the same transaction as the write".
9. **Exclusion sweep, as concrete operation IDs** (the set is not enforceable as prose): module
   enablement `/api/admin/modules/:id` and `/api/me/modules/:id`, external-module
   download/enable/remove/purge, connector feature grants (`connectors/src/manifest.ts:162`), task
   agency auto-execution (`tasks/src/manifest.ts:485`), AI service bindings, default provider,
   chat-model override, admin AI pin (`ai/src/manifest.ts:225`); memory settings and fact mutation
   (`chat/src/manifest.ts:133`), priority-model ranking (`settings/src/manifest.ts:241`),
   source-behavior and notes-source selection, chat-skill CRUD/import (`chat/src/manifest.ts:163`),
   page-context writes (would let the model forge evidence returned by `chat.getCurrentView`); module
   credential PUT/DELETE, web-search key, provider create/update, voice endpoint, connector
   authorize/complete/connect, onboarding provider login/install, terminal password/ticket;
   notification digest scheduling, proactive monitoring, notes-source scheduling/sync, provider
   test/model discovery, connector connect/sync/revoke, briefing create/update/run, news source
   preview/refresh, transcription, export jobs, module queue runs, host install.
10. **Codex explicitly withdrew its intent-token demand**: "Capability reduction is a defensible
    product choice when commands are closed, actor-bound, rate-limited, and genuinely incapable of
    durable loss, authority changes, secrets, or external disclosure."

### Claude's response (rounds 2a + 2b)

**Ben's ruling supersedes the allowlist.** Both reviewers critiqued the pre-inversion text. Ben
replaced the curated allowlist with a permissions model: default yes, declaration mandatory, grant at
install. Codex's finding 4 (auto-run impossible) and Fable's finding 1 are the same finding, and the
inversion is what resolves it — the install grant persists `trusted_auto` for families whose
`allowedTiers` already permit it, so `policy.ts:47`'s stored-tier lookup wins over `defaultTier`
without an SDK type change.

**Accepted in full:** the YOLO ordering must evaluate full mode, not just exclusions (Codex 1); the
parallel registry is dropped in favour of extending `ModuleAssistantToolManifest` (Codex 2); the
service-layer claim is corrected to "extract one" (Codex 3); CAS gets an integer revision (Codex 4);
rate limits, no-op suppression, bounded retention and failure metrics are added (Codex 5); every
command in Codex 6 is reclassified `confirm_always`, and locale is split so only strictly validated
presentation fields auto-run (Codex 6); target user comes from `ToolContext` (Codex 7); audit outcome
semantics are defined for the non-write paths (Codex 8); the operation-ID sweep becomes the denylist,
with a general external-effect rule so the list is a floor rather than the whole guarantee (Codex 9);
Fable's shared-`app.preferences` namespace invariant and consent-flag category are adopted.

**Reframed, not rejected — the prompt-shaping rule.** Both reviewers flagged that chat response style
is banned by the plan's own rule. Restated as a property: a value may reach a prompt only if its write
path validates against a closed set and it renders through a server-owned constant template. Response
style qualifies; timezone does not until write-time IANA validation exists.
