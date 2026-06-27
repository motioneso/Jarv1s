# Plan: rfa-534-action-permission-tiers

**Spec:** `docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`

## Overview

Implement explicit action permission tiers (`ask_each_time`, `trusted_auto`, `always_confirm`) on top of the existing assistant gateway. Write tools default to ask, but reversible write families can be promoted by the user. Destructive/external actions always confirm.

## Tasks

### Task 1: Module SDK Action Family Contracts

- **File:** `packages/module-sdk/src/index.ts`
- **Action:** Add `JarvisActionPermissionTier` type (`"ask_each_time" | "trusted_auto" | "always_confirm"`).
- **Action:** Add `ModuleAssistantActionFamilyManifest` interface (id, label, description, defaultTier, allowedTiers).
- **Action:** Add `actionFamilyId?: string` to `ModuleAssistantToolManifest`.
- **Action:** Add `assistantActionFamilies?: readonly ModuleAssistantActionFamilyManifest[]` to `JarvisModuleManifest`.

### Task 2: Tasks Module Action Families

- **File:** `packages/tasks/src/manifest.ts`
- **Action:** Declare `task_changes` (allows `ask_each_time`, `trusted_auto`) and `task_cleanup` (only allows `always_confirm`) families in `assistantActionFamilies`.
- **Action:** Assign `actionFamilyId: "task_changes"` to non-destructive write tools (`tasks.create`, `tasks.update`, etc.).
- **Action:** Assign `actionFamilyId: "task_cleanup"` to destructive tools (`tasks.deleteList`, `tasks.deleteTag`).

### Task 3: Preferences metadata support

- **Files:** `packages/db/src/preferences.ts` (or equivalent interface definition) and PG implementation.
- **Action:** Extend `PreferencesPort` with `getWithMetadata<T>(db: DataContextDb, key: string): Promise<{ value: T; updatedAt: Date } | null>`.
- **Action:** Implement in the postgres preferences repository.
- **Action:** Test `getWithMetadata` fetches correctly.

### Task 4: Gateway Policy Resolution

- **Files:** `packages/ai/src/gateway/policy.ts`, `packages/ai/src/gateway/gateway.ts`, tests.
- **Action:** Define `ActionPolicyLookup` interface (`getFamilyPolicy` returning family manifest and tier).
- **Action:** Rewrite `resolvePolicy` to take `(tool, moduleId, lookup: ActionPolicyLookup)` and return `PolicyDecision` based on the new tiered rules, defaulting to `confirm`.
- **Action:** Update `AssistantToolGateway` to accept an `actionPolicy` factory from `AssistantToolGatewayDependencies` and use it.
- **Action:** Ensure gateway preserves non-policy preference lookups (like `first_prompt_seen`).

### Task 5: AI Module Action Policy Routes & Compatibility Helper

- **Files:** `packages/ai/src/routes.ts` (or new sub-router for action-policy), compatibility helper in `packages/tasks` or shared internal.
- **Action:** Create `getResolvedTaskChangesPolicy(db)` that safely reads both `assistant.action_policy.v1.tasks.task_changes` and `tasks.agency_auto_execute` using `getWithMetadata`, returning the newest tier.
- **Action:** Implement `GET /api/ai/action-policy` and `PATCH /api/ai/action-policy/:moduleId/:actionFamilyId`.
- **Action:** For tasks, ensure the PATCH route also syncs the legacy `tasks.agency_auto_execute` key transactionally.

### Task 6: Tasks Legacy Route Sync

- **Files:** `packages/tasks/src/routes.ts`
- **Action:** Update `GET /api/tasks/agency-auto-execute` to use `getResolvedTaskChangesPolicy` so the effective tier returned matches AI routes.
- **Action:** Update `PATCH /api/tasks/agency-auto-execute` to write BOTH `tasks.agency_auto_execute` and `assistant.action_policy.v1.tasks.task_changes` transactionally.

### Task 7: Settings UI Updates

- **Files:** `packages/tasks/src/settings/index.tsx`
- **Action:** Update the task settings UI to show the tier segmented control/toggle instead of the simple boolean. (Label: "Ask every time" vs "Trusted auto-run").

### Task 8: App Composition

- **Files:** `packages/chat/src/routes.ts` (or where the gateway is composed).
- **Action:** Inject the real `ActionPolicyLookup` implementation into the gateway dependencies, wiring it to read from `app.preferences` and the active module manifests.
- **Action:** Ensure tests pass end-to-end.
