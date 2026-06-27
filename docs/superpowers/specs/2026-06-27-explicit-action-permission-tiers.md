# Explicit Jarvis action permission tiers (#534)

**Status:** Draft
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #534
**Depends on:** `~/Jarv1s/docs/superpowers/specs/2026-06-25-agency-action-loop.md`, existing
assistant gateway policy/action-request machinery.
**Related follow-ups:** #531 restrained proactive monitoring, #536 scheduled recurring briefings,
#540 safe automation audit log.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-25-agency-action-loop.md`,
`~/Jarv1s/packages/module-sdk/src/index.ts`, `~/Jarv1s/packages/ai/src/gateway/policy.ts`,
`~/Jarv1s/packages/ai/src/gateway/gateway.ts`, `~/Jarv1s/packages/ai/sql/0016_ai_assistant_actions.sql`,
`~/Jarv1s/apps/web/src/chat/action-request-card.tsx`, `~/Jarv1s/packages/tasks/src/manifest.ts`,
`~/Jarv1s/packages/tasks/src/routes.ts`, `~/Jarv1s/packages/tasks/src/settings/index.tsx`.

## 1. Problem

Jarvis can already execute assistant tools through the gateway. Some tools read data, some mutate
local state, and some are destructive or externally visible. Today the user-facing model is still
too implicit:

- task write tools can be promoted through a task module toggle, but the product language does not
  define a general permission tier model;
- source permissions and source behavior toggles can be mistaken for action execution permission;
- future calendar/email/proactive flows need the same safety model without adding per-feature
  branches;
- email send, deletes, and irreversible external actions need a structural always-confirm floor.

The gap is not another executor. The gap is a clear, reusable action permission contract that the
gateway, modules, and settings UI all use.

## 2. Decision

Add **explicit Jarvis action permission tiers V1**.

V1 standardizes action permission as a per-module, per-action-family policy layered on top of the
existing assistant gateway:

1. read tools continue to run when the module/tool is available and the actor has permission;
2. write tools default to `ask_each_time`;
3. reversible/internal write families may be promoted to `trusted_auto` only when the tool declares
   `executionPolicy: "auto"` and the user enables that action family;
4. destructive tools always confirm, regardless of user settings;
5. external communication send actions, including future `email.send`, are destructive by
   declaration and can never be fully autonomous.

Do not add a global automation switch, a second action executor, or a second confirmation table.

## 3. Current Architecture Anchor

The existing pieces to reuse:

- `ModuleAssistantToolManifest.risk`: `read | write | destructive`;
- `ModuleAssistantToolManifest.executionPolicy`: `auto | confirm`;
- `AssistantToolGateway.callTool()`: validates input, resolves policy, runs handlers or creates an
  action request;
- `AssistantToolGateway.confirmAndRun()`: creates `app.ai_assistant_action_requests`, emits the
  chat action-request card, waits for Approve/Deny, and executes only after approval;
- `resolvePolicy()`: already async, already reads an injected preference lookup, and already keeps
  `risk: "destructive"` as a hard confirm floor;
- `tasks.agency_auto_execute`: existing task module preference and settings surface.

#534 should make this system explicit and extensible. It should not replace the gateway path.

## 4. User-Visible Tiers

V1 exposes these action tiers:

```ts
type JarvisActionPermissionTier = "ask_each_time" | "trusted_auto" | "always_confirm";
```

Semantics:

| Tier             | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `ask_each_time`  | Jarvis may propose the action, but execution requires an action-request approval.        |
| `trusted_auto`   | Jarvis may execute this reversible/internal write family without approval.               |
| `always_confirm` | The action must always show an approval card. Users cannot promote it to autonomous run. |

Effective tier rules:

- `read` tools do not use action tiers. They are governed by module availability, source
  permission, route/tool permission, and source behavior settings.
- `write` tools default to `ask_each_time`.
- `write` tools can become `trusted_auto` only when:
  - the tool declares `executionPolicy: "auto"`;
  - the owning module/action family allows `trusted_auto`;
  - the owner has enabled that family.
- `destructive` tools are always `always_confirm`.
- Any externally visible irreversible action is declared `destructive`, even if the underlying API
  technically supports undo.

Examples:

| Module   | Action family       | Tool examples                                | Allowed user tiers              |
| -------- | ------------------- | -------------------------------------------- | ------------------------------- |
| tasks    | task changes        | `tasks.create`, `tasks.update`, `tasks.*Tag` | `ask_each_time`, `trusted_auto` |
| tasks    | destructive cleanup | `tasks.deleteList`, `tasks.deleteTag`        | `always_confirm`                |
| calendar | event changes       | future `calendar.create`, `calendar.move`    | `ask_each_time`, `trusted_auto` |
| email    | draft preparation   | future `email.draft`                         | `ask_each_time`, `trusted_auto` |
| email    | external sending    | future `email.send`                          | `always_confirm`                |

## 5. Action Family Contract

Extend module manifests with action-family metadata:

```ts
interface ModuleAssistantActionFamilyManifest {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultTier: "ask_each_time" | "always_confirm";
  readonly allowedTiers: readonly JarvisActionPermissionTier[];
}

interface ModuleAssistantToolManifest {
  readonly actionFamilyId?: string;
}

interface JarvisModuleManifest {
  readonly assistantActionFamilies?: readonly ModuleAssistantActionFamilyManifest[];
}
```

Rules:

- `actionFamilyId` is needed only for `write` tools that can be shown in user settings.
- Write tools without `actionFamilyId` always confirm. A tool must explicitly opt into an action
  family before it can ever use `trusted_auto`.
- Destructive tools may explicitly declare a family whose only allowed tier is `always_confirm` so
  the settings UI can render a locked row. If they omit a family, the gateway still confirms from
  `risk: "destructive"`.
- A module's settings surface owns the UI for its action families.
- The central gateway reads action family policy but does not render settings UI.
- New modules add their own families; there is no global registry switch.

V1 task mapping:

- `tasks.create`, `tasks.update`, `tasks.updateStatus`, `tasks.breakDown`, `tasks.addActivity`,
  `tasks.assignTag`, `tasks.unassignTag`, `tasks.createList`, `tasks.renameList`,
  `tasks.createTag`, and `tasks.renameTag` explicitly declare `actionFamilyId: "task_changes"`.
- `tasks.deleteList` and `tasks.deleteTag` are displayed under task cleanup but remain
  `always_confirm`.

## 6. Preference Storage

Store action policy in owner-scoped `app.preferences`.

Canonical key:

```text
assistant.action_policy.v1.<moduleId>.<actionFamilyId>
```

Value:

```ts
interface AssistantActionFamilyPolicyPreferenceV1 {
  readonly version: 1;
  readonly tier: "ask_each_time" | "trusted_auto";
  readonly updatedAt: string;
}
```

Rules:

- Missing preference means `ask_each_time`.
- More precisely: missing preference means the manifest family's `defaultTier`; if the family is not
  found, fail closed to `ask_each_time`/confirm.
- Unknown or malformed preference means `ask_each_time` and logs metadata only.
- The preference is owner-only. Admins cannot promote another user's action family.
- Existing `tasks.agency_auto_execute` remains a compatibility alias for
  `assistant.action_policy.v1.tasks.task_changes` until the task settings route migrates.
- Policy lookup for `tasks/task_changes` loads both the canonical key and the legacy
  `tasks.agency_auto_execute` boolean when present. Existing users with only the legacy preference
  keep their current behavior.
- If both canonical and legacy task preference rows exist, lookup chooses the row with the newest
  database `updated_at` timestamp; ties prefer the canonical key. This prevents generic seeding or
  migration scripts from silently losing the newer user choice.
- The gateway, canonical `GET /api/ai/action-policy`, and legacy
  `GET /api/tasks/agency-auto-execute` must share the same compatibility helper, for example
  `getResolvedTaskChangesPolicy(scopedDb)`, so the UI displays the same effective tier that the
  gateway enforces.
- Writes are bi-directional while both routes exist:
  - canonical family policy writes also update `tasks.agency_auto_execute`;
  - the legacy `/api/tasks/agency-auto-execute` PATCH route also writes
    `assistant.action_policy.v1.tasks.task_changes`.
- Bi-directional writes happen inside one `withDataContext` transaction so a failed second write
  cannot leave canonical and legacy keys partially updated.
- The action policy lookup must read row metadata, not only `value_json`. Extend the preferences
  repository and the shared `PreferencesPort` interface in `packages/db` with a
  `getWithMetadata(scopedDb, key)` helper that returns `{ value, updatedAt }` under
  `DataContextDb`, and use it for compatibility resolution.
- Do not store source ids, action inputs, prompts, private content, or connector metadata in the
  preference value.

Canonical API:

- Owner package: `packages/ai`, because the assistant gateway owns action policy.
- `GET /api/ai/action-policy?moduleId=...`
- `PATCH /api/ai/action-policy/:moduleId/:actionFamilyId`

Patch request:

```ts
interface PatchAssistantActionPolicyRequest {
  readonly tier: "ask_each_time" | "trusted_auto";
}
```

Route rules:

- The route validates that `moduleId` is active for the actor and that `actionFamilyId` belongs to
  that module's manifest.
- The route rejects unsupported tiers with 400.
- The route writes only the canonical key, except for `tasks/task_changes`, where it also syncs the
  legacy `tasks.agency_auto_execute` key while the legacy route exists.
- The legacy `/api/tasks/agency-auto-execute` route remains during migration and writes both keys.

## 7. Gateway Policy

Keep `resolvePolicy()` as the single decision point.

Updated policy input:

```ts
interface ActionPolicyLookup {
  getFamilyPolicy(input: { readonly moduleId: string; readonly actionFamilyId: string }): Promise<{
    readonly family: ModuleAssistantActionFamilyManifest | null;
    readonly tier: JarvisActionPermissionTier;
  }>;
}
```

Composition rules:

- The composition layer builds `ActionPolicyLookup` from the active module manifests plus the
  owner-scoped preferences repository. Do not pass the old raw `AgencyPrefLookup` directly to
  `resolvePolicy`.
- `AssistantToolGatewayDependencies` should expose an action-policy factory, for example
  `actionPolicy?: (ctx: ToolContext) => ActionPolicyLookup`.
- The factory may adapt the existing `agencyPrefs` implementation during migration, but the object
  passed to `resolvePolicy` must implement `ActionPolicyLookup`.
- Keep the existing raw `agencyPrefs` dependency, or an equivalent small preference writer, for
  non-policy gateway state such as `tasks.agency_auto_execute.first_prompt_seen`. That notice state
  is not part of action policy and should not be folded into `ActionPolicyLookup`.
- `getFamilyPolicy` must verify that `actionFamilyId` is declared by the manifest for the same
  `moduleId`. If not, it returns `{ family: null, tier: "ask_each_time" }`.

Policy rules:

```ts
async function resolvePolicy(
  tool: ModuleAssistantToolManifest,
  moduleId: string,
  lookup: ActionPolicyLookup
): Promise<PolicyDecision> {
  if (tool.risk === "read") return "run";
  if (tool.risk === "destructive") return "confirm";
  if (tool.risk !== "write") return "confirm";
  if (tool.executionPolicy !== "auto") return "confirm";
  if (!tool.actionFamilyId) return "confirm";

  try {
    const policy = await lookup.getFamilyPolicy({
      moduleId,
      actionFamilyId: tool.actionFamilyId
    });
    if (!policy.family) return "confirm";
    if (!policy.family.allowedTiers.includes(policy.tier)) return "confirm";
    return policy.tier === "trusted_auto" ? "run" : "confirm";
  } catch {
    return "confirm";
  }
}
```

Operational rules:

- Lookup failures fail closed to `confirm`.
- Missing action family metadata fails closed to `confirm`.
- Stored tiers are enforced against the manifest `allowedTiers` at runtime, not only in the settings
  UI.
- Action family ids are module-local. A family key is addressed as `(moduleId, actionFamilyId)`; a
  third-party module cannot reuse `tasks/task_changes` by declaring the same string locally.
- The policy uses existing `ToolContext.actorUserId` and injected preferences. Do not add fields to
  `AccessContext` or `ToolContext`.
- `confirmAndRun()` and `app.ai_assistant_action_requests` remain the only confirm path.
- Confirmed action execution continues through `runHandler()` with `DataContextDb`.
- Read tools still receive no `toolServices`, preserving the existing write-confirm floor.

## 8. Settings UI

Each module that contributes write action families exposes a "Jarvis actions" group in its module
settings surface.

For each family:

- show family label and short description;
- show tier choices as a segmented control or toggle:
  - `Ask every time`;
  - `Trusted auto-run`;
- show destructive/external send families as locked `Always confirm`;
- default to `Ask every time`.

Tasks V1:

- Keep the existing task settings pane, but update copy to use the tier language.
- The old binary task toggle can remain visually as a switch if it maps exactly to
  `ask_each_time`/`trusted_auto`.

No global action dashboard in V1. A later overview can aggregate module settings, but the source of
truth stays per-module/action-family.

## 9. Source Permissions Are Separate

Action tiers are not source permissions.

Rules:

- Enabling a source connection, source behavior, briefing source, or proactive card source does not
  grant write/action execution.
- Enabling proactive monitoring from #531 does not grant action execution.
- A proactive card may suggest an action, but choosing to act routes through the normal assistant
  tool proposal and this gateway policy.
- Read access to source data stays governed by module availability, route/tool permission, source
  behavior policy, and `DataContextDb`.
- Action policy never bypasses source/tool permissions. A `trusted_auto` family only affects whether
  a write tool confirms after all normal availability and permission checks pass.

## 10. External Communication And Irreversible Actions

Hard rules:

- `email.send` is `risk: "destructive"`.
- Any future direct message, post, payment, account deletion, token revocation, or irreversible
  external API action is `risk: "destructive"`.
- `destructive` means `always_confirm`; no setting can override it.
- `email.draft` may be `risk: "write"` and eligible for `trusted_auto`, because it does not send.
- Calendar event creation/move may be eligible for `trusted_auto` only as a module-owned action
  family. Deletes/cancellations that notify others should be considered destructive unless the
  calendar spec proves a safe reversible flow.

## 11. Proactive And Scheduled Surfaces

#531 proactive cards and #536 recurring briefings can propose actions, not execute actions by
themselves.

Rules:

- Suggestions created outside chat must route through the same action-request/gateway path when the
  user chooses to act.
- Scheduled jobs carry metadata-only payloads and may not carry action inputs that would execute
  without gateway policy.
- A proactive-card "Do it" button may start a proposal, but the gateway still enforces
  `ask_each_time`, `trusted_auto`, or `always_confirm`.
- #540 owns safe automation audit-log UX. #534 may keep existing action-request history but does
  not build a new audit log.

## 12. Privacy, Safety, And Auditability

- Action policy preferences are owner-only through `app.preferences` RLS.
- No admin private-data bypass.
- `AccessContext` remains `{ actorUserId, requestId }`.
- `ToolContext` remains `{ actorUserId, requestId, chatSessionId }`.
- Action requests remain metadata-only: tool module, tool name, permission id, risk, bounded input
  summary, request id, timestamps, and status.
- Logs include actor id, module id, action family id, effective tier, risk, outcome, duration, and
  error class only. Never log raw action inputs, source content, prompts, secrets, tokens, or
  connector payloads.
- Tool handlers still execute only under `DataContextDb`.

## 13. Error Handling

- Missing preference: use the manifest family's `defaultTier`; if no family is found, confirm.
- Malformed preference: `ask_each_time`, metadata-only warning.
- Missing action family on an auto write tool: confirm.
- Unknown action family preference: confirm.
- Preference tier not present in manifest `allowedTiers`: confirm.
- Disabled module/tool: unavailable, no proposal or execution.
- Destructive tool with `trusted_auto` preference due to stale data: ignore preference and confirm.
- Preference route write for unsupported tier: 400.
- Gateway policy lookup failure: confirm.

## 14. Out Of Scope

- A global automation dashboard or global on/off switch.
- Safe automation audit-log UX (#540).
- New email/calendar write tools.
- Proactive-card generation (#531).
- Scheduled recurring briefings (#536).
- Per-contact, per-recipient, or per-rule automation allowlists.
- Action execution outside the assistant gateway.
- Changing `AccessContext` or storing private action payloads in jobs.

## 15. Acceptance Criteria

- [ ] Jarvis action tiers are documented and user-visible as `ask_each_time`, `trusted_auto`, and
      locked `always_confirm`.
- [ ] Write action policy is stored per owner, module, and action family in `app.preferences`.
- [ ] Missing/malformed action policy fails closed to `ask_each_time`.
- [ ] Existing task trust behavior maps to `tasks/task_changes` without breaking the current task
      settings route.
- [ ] Existing users with `tasks.agency_auto_execute = true` do not silently reset to
      `ask_each_time`.
- [ ] Gateway lookup, canonical GET, and legacy task GET share the same effective-policy helper.
- [ ] Legacy task route writes and canonical family policy writes stay bi-directionally synced while
      both exist.
- [ ] Bi-directional compatibility writes are transactional.
- [ ] The AI module exposes canonical owner-scoped action-policy read/write routes.
- [ ] `PreferencesPort` exposes `getWithMetadata` so timestamp compatibility resolution does not
      bypass the repository boundary.
- [ ] `resolvePolicy()` remains the single gateway policy decision point.
- [ ] `trusted_auto` applies only to `risk: "write"` tools that declare `executionPolicy: "auto"`
      and explicitly declare an action family enabled by the owner.
- [ ] Gateway policy validates stored preference tiers against manifest `allowedTiers` at runtime.
- [ ] Gateway policy resolves action family ids only inside the owning module manifest.
- [ ] `risk: "destructive"` tools always confirm regardless of preferences.
- [ ] Source permissions/source behavior/proactive source settings do not grant action execution.
- [ ] Proactive or scheduled surfaces route action execution through the same gateway policy.
- [ ] No action policy path changes `AccessContext` shape or stores private payloads in jobs/action
      requests.
- [ ] User A cannot read or mutate user B's action family policy.

## 16. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:ai
pnpm test:tasks
pnpm test:api
pnpm test:web
```

Targeted tests:

- default missing policy confirms task write tools;
- enabling `tasks/task_changes` lets `tasks.create` run without an action request;
- disabling `tasks/task_changes` routes `tasks.create` through `confirmAndRun`;
- malformed preference fails closed to confirmation;
- `tasks.deleteList` and `tasks.deleteTag` always confirm;
- future/mock `email.send` with `risk: "destructive"` always confirms even with a stale
  `trusted_auto` preference;
- write tool with `executionPolicy: "confirm"` still confirms;
- write tool missing `actionFamilyId` confirms;
- stale `trusted_auto` preference for a family whose manifest disallows it confirms;
- third-party module declaring `actionFamilyId: "task_changes"` does not inherit the tasks policy;
- existing legacy `tasks.agency_auto_execute = true` is read as `trusted_auto`;
- when canonical and legacy task preferences both exist, the newest row wins;
- compatibility lookup reads preference row `updated_at` metadata under `DataContextDb`;
- canonical GET, legacy task GET, and gateway lookup return the same effective task policy;
- missing preference uses the manifest default tier;
- canonical `PATCH /api/ai/action-policy/:moduleId/:actionFamilyId` rejects unsupported tiers;
- legacy task PATCH updates the canonical action-family preference;
- canonical task family PATCH updates the legacy task preference;
- failed second write in a compatibility sync rolls back both preference writes;
- first-run task notice still reads/writes `tasks.agency_auto_execute.first_prompt_seen`;
- source behavior/proactive source preference does not change action policy;
- policy lookup failure confirms;
- action-request rows remain metadata-only and owner-scoped;
- RLS isolation for policy read/write routes.
