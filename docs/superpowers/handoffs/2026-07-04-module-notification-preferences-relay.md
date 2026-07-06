# Relay — rfa-735-module-notification-preferences

**Spec (approved):** docs/superpowers/specs/2026-07-04-module-notification-preferences.md
**Issue:** #735 · **Risk tier:** sensitive
**Worktree/branch:** ~/Jarv1s/.claude/worktrees/rfa-735-module-notification-preferences @ rfa-735-module-notification-preferences (off origin/main@422157a1)
**Coordinator label:** `Coordinator` — resolve via `herdr pane list` fresh each time, verify exactly one match, before messaging.
**Coordinator session id:** `019f2dc9-26c0-75c2-a7d8-4ccbec45510f`
**Relay trigger:** context-meter 70% warning (fired now).

## State: no code written yet. Nothing committed. Still in coordinated-build Step 1 (plan, pre-approval).

`git status` is clean except two untracked coordinator-dropped docs (handoff + spec — read-only,
do not touch/commit) and a `.claude/context-meter.log` tool artifact (ignore).

## Done

- Read AGENTS.md, CLAUDE.md, handoff, spec, coordinated-build SKILL.md — all in full.
- `pnpm install` already run; `node_modules` present — **successor: skip pnpm install**.
- agentmemory recalls run (3 required queries) — all empty, nothing to reconcile.
- Step ½ stale-premise check: **every spec premise re-verified against this branch — none has
  shipped/drifted.** Confirmed by reading:
  - `apps/web/src/settings/settings-module-subviews.tsx` — `NotificationSettings` (lines ~302-381)
    is still pure local `useState`, wrapped in `<NotWired>`. Confirms spec's Problem statement.
  - `packages/notifications/src/repository.ts`, `routes.ts`, `manifest.ts`, `packages/notifications/sql/0008_notifications_module.sql` —
    no `moduleId`/`module_id` anywhere yet. Highest existing migration seen: `0105_notifications_urgency_deferral.sql`.
  - `packages/module-sdk/src/index.ts` — `JarvisModuleManifest` has no notification-capability
    field. Closest structural precedent to mirror: `sourceBehaviors?: readonly SourceBehaviorSourceDecl[]`
    (id/name/description/behaviors shape, ~line 390-460).
  - `packages/settings/src/quiet-hours-routes.ts` + `packages/settings/src/preferences-port.ts` —
    **`ProfilePreferencesPort` = `PreferencesPort` from `@jarv1s/db`**, a generic scoped string-key
    KV store (`.get(scopedDb, key)` / `.upsert(scopedDb, key, value)`). This is the mechanism to
    reuse for the spec's "generic per-module notification preference API" — key like
    `notifications:<moduleId>`, no bespoke table needed. (Architectural decision — save to
    agentmemory once plan is final: why reuse PreferencesPort over a new table.)
  - `packages/settings/src/routes.ts` (~700-828) + `manifest.ts` — `/api/me/modules` +
    `listModuleDenyRowsForActor` / `toMyModuleDto` / `computeMyModuleDto` (in
    `routes-serializers.ts`, not yet fully read) already implement "is module X enabled for user Y"
    (instance-disabled + user-disabled deny rows). This is the existing half of the spec's
    "enabled for current user AND manifest declares notification support" gate.
  - `packages/jobs/src/upgrade-notify.ts` and `packages/briefings/src/jobs.ts` — the only 2 real
    notification producers today, neither passes a moduleId. Briefings' manifest id is
    `"briefings"` (`packages/briefings/src/manifest.ts` line ~16, `BRIEFINGS_MODULE_ID`) — natural
    owner for the briefing-ready notification. upgrade-notify has no natural existing module owner
    (see open question below).
  - `packages/module-sdk/src/index.ts` line ~324 — `ModuleAvailabilityManifest.supportsUserDisable?: boolean`
    already exists and gates `/api/me/modules` PATCH.

## Not yet read (do before finalizing plan)

- `packages/settings/src/routes-serializers.ts` full (`toMyModuleDto`/`computeMyModuleDto` bodies).
- `apps/web/src/settings/settings-personal-data-panes.tsx` (2nd spec file-in-play).
- `packages/shared/*notifications*` (DTO/schema file needing a `moduleId` field).
- `packages/db/src/types.ts` (Notification row type — needs `module_id`).
- `apps/web/src/settings/settings-sample-data.ts` (current `DEFAULT_NOTIFICATIONS`/`NotificationsSettings` shape, incl. Sensitivity + hardcoded types, being replaced/kept-partially).
- `apps/web/src/settings/settings-source-behaviors.ts` (another per-module-row rendering precedent, added in ec6b8569).
- `packages/db` — confirm exact `PreferencesPort` interface signature.

## Open questions to settle in the plan (implementation-detail judgment calls, not architecture forks — decide + document, don't escalate unless Coordinator disagrees)

1. **upgrade-notify's moduleId** — no existing module manifest owns it. Leaning `"settings"`
   (body text says "Settings -> Diagnostics"). Confirm settings module should declare
   notification-capability to own this, or consider a dedicated system module — decide in plan.
2. **Fate of "Sensitivity" segmented control + hardcoded "What you hear about" types section** in
   `NotificationSettings`. Spec's Scope only says replace hardcoded *categories* with module rows;
   doesn't explicitly mention Sensitivity. Reading: Sensitivity is a separate out-of-scope local
   concept — leave as-is (still local/unwired) unless plan calls it out as being removed. State
   this explicitly in the plan rather than guessing silently.
3. **`module_id` column nullability** on new `app.notifications` migration — NOT NULL requires a
   backfill/default strategy for existing rows; nullable-but-enforced-at-repository-layer is
   simpler. Spec acceptance criterion wants creation-without-moduleId to fail at repo/API boundary
   — app-layer enforcement in `NotificationsRepository.create` (throw if missing) may suffice
   without a DB NOT NULL constraint on day one; decide and document reasoning either way.
4. **Manifest field shape** for notification-capability — spec says panel only needs module id/name
   + on/off, no subtypes. Likely just `notifications?: { supported: true }` or similar minimal
   marker (simpler than mirroring full `sourceBehaviors` richness) — confirm against
   `settings-source-behaviors.ts` precedent before finalizing.
5. Gating `NotificationsRepository.create` on the per-module preference needs an **injected port**
   (mirror the existing `QuietHoursPort` pattern in `repository.ts`) to preserve module isolation —
   don't have `NotificationsRepository` import `@jarv1s/settings` directly.

## Next concrete step

1. Finish the 6 unread files above.
2. Invoke `superpowers:writing-plans` → write `docs/superpowers/plans/2026-07-04-module-notification-preferences.md`
   covering: manifest field + wiring (notifications/briefings/settings), migration for `module_id`
   (new file above `0105` in `packages/notifications/sql/`, **check current highest number fresh,
   don't trust this doc's number**), `CreateNotificationInput.moduleId` + repo/route + both producer
   call-site changes, generic preference API via `PreferencesPort` + injected gating port, frontend
   rewrite of `NotificationSettings`, disable-module unread-clear prompt flow, tests per layer.
3. **Message Coordinator (resolve pane fresh by label `Coordinator` + session id `019f2dc9-26c0-75c2-a7d8-4ccbec45510f` via `herdr pane list`) with the plan for approval. Do not write code before approval.**
4. TaskCreate tracker had: #1 orient (in_progress, effectively done), #2 verify premises (in_progress→ mark completed once done), #3 write plan (pending), #4 escalate to Coordinator (pending). Recreate/continue these.
