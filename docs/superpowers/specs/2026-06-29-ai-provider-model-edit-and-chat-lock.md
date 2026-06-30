# AI Provider Settings — Edit Models + Hard-Lock Chat to a Model (#513)

**Status:** approved (Ben, 2026-06-29)
**Issue:** #513 (cluster with #510, #517; distinct from both)
**Author:** Stanley (spec agent), paired with Ben — 2026-06-29
**Tier:** sensitive (changes chat capability routing + admin governance surface)
**Migration:** **none** — both gaps are UI + routing-semantics over machinery that already ships.

## 1. Problem

The admin AI provider pane (`apps/web/src/settings/settings-ai-admin-pane.tsx`) has two gaps Ben hit while dogfooding multi-provider setups:

1. **Created models can't be edited.** You can create a model and delete it, and toggle its "allow user override" flag (`settings-ai-admin-pane.tsx:787` calls `updateAiModel(id, { allowUserOverride })`), but there is **no UI to edit the rest** — display name, the provider model id, capabilities, tier, or status. The backend already supports a full edit (`UpdateAiModelInput` at `packages/ai/src/repository.ts:117`, `repository.updateModel` at `:396`, route `PATCH /api/ai/models/:id` at `packages/ai/src/routes.ts:297`, client binding `updateAiModel` at `apps/web/src/api/client.ts:757`). So to fix a typo in a model id, or re-tier one of the "interactive" Codex test entries, you currently must delete and recreate it. This is purely an unsurfaced backend capability.

2. **Chat's model is not durably lockable; it tracks the active provider.** Chat resolves its model via `AiRepository.resolveModelForCapability(db, "chat")` (`packages/ai/src/repository.ts:547`), in order: **admin pin → manual capability route → automatic selection**. The admin pin (`app.preferences['ai.admin_pinned_model_id']`, key constant `AI_ADMIN_PINNED_MODEL_PREFERENCE_KEY` at `:174`) already resolves _first_. But:
   - It is **not surfaced** anywhere in the AI admin pane (only the per-user pin route `/api/admin/users/:userId/ai-pin` exists, `packages/ai/src/admin-ai-pin-routes.ts`, with a client binding at `apps/web/src/api/client-admin.ts:86`). With no pin set, chat falls through to **automatic**, which selects from currently-active models — so **switching the active provider silently changes the chat model**, forcing a manual re-pick. That is the reported pain.
   - When a pin _is_ set but its model/provider later goes inactive, resolution **silently falls through** to manual route → automatic (`reason: "admin-pin-unavailable-fallback"`). A deliberate "lock" that silently swaps to a different model is surprising.

## 2. Goals

- **Edit existing models in the admin pane** — surface a full edit form on each model row, wired to the already-shipped `updateAiModel` (`PATCH /api/ai/models/:id`). No backend change.
- **Lock chat to a specific model, provider-independently** — surface the existing admin pin in the AI admin pane as a first-class "Lock chat to model" control, so the choice survives provider activation/swap.
- **Hard-lock semantics (Ben, 2026-06-29):** a locked model that becomes unavailable (its provider removed/deactivated) must **not** silently swap. Chat surfaces a clear _"locked model unavailable — pick another"_ state; the admin re-picks. No surprise model changes.

## 3. Non-Goals (seams preserved)

- **Instance-wide single lock for all users.** V1 reuses the existing **owner-scoped** admin pin (per-user preference, set by an admin). An instance-default lock checked before the per-user pin is a clean later layer (one preference + one branch in `resolveModelForCapability`), not a redesign. Out of scope here.
- **Per-capability locks beyond chat.** The pin already applies to whatever capability is resolved; this spec only adds the **chat** lock surface and the unavailable-state UX. Locking briefings/other capabilities to specific models is the existing manual capability-route mechanism, unchanged.
- **#510 YOLO/trust mode and #517 execution mode.** Separate issues; #517 already shipped. Not touched here beyond living in the same admin pane (coordinate file edits).
- **New model-management data model.** No new tables/columns; no migration.

## 4. Resolved Decisions

- **D1 — Hard lock + visible alert.** (Ben, 2026-06-29.) When the locked (admin-pinned) model is set but not resolvable (model inactive / provider inactive or removed), `resolveModelForCapability("chat")` returns a **distinct unavailable resolution** (`model: null`, `reason: "admin-pin-unavailable"`) rather than falling through to manual/automatic. The chat surface renders an actionable "locked model unavailable" state. This **changes** the current silent `admin-pin-unavailable-fallback` behavior for chat.
- **D2 — The lock IS the existing admin pin.** No new persistence. "Lock chat to model X" = write model X's id to `ai.admin_pinned_model_id` for the target user (the existing `setAdminPinnedModel` / `/ai-pin` path); "unlock" = clear it. Resolution already checks the pin first, so a set pin is inherently provider-independent — switching the _active provider_ does not touch the preference.
- **D3 — The pin must never be auto-cleared on provider/model teardown.** Deleting/revoking a provider must **not** cascade-clear `ai.admin_pinned_model_id`. Staleness is surfaced (D1), not silently erased — otherwise the "lock" wouldn't survive the exact event Ben cares about. (Audit: confirm no provider/model delete path clears the preference.)
- **D4 — Model edit reuses the shipped backend verbatim.** Edit form fields = exactly what `UpdateAiModelInput` accepts: `providerModelId`, `displayName`, `capabilities`, `status`, `tier`, `allowUserOverride`. No new validation beyond what `routes.ts` already enforces. **Reclassification** (change tier / toggle capabilities) is therefore covered by edit.
- **D5 — Admin-gated, owner-scoped.** Both surfaces sit behind the existing `assertInstanceAdmin` gate; the pin write runs inside the target user's `DataContextRunner` scope (as `admin-ai-pin-routes.ts` already does). No `BYPASSRLS`, no cross-user preference write outside that scope.
- **D6 — Removal = soft-disable only.** (Ben, 2026-06-29.) "Remove a model" = set `status: "disabled"` (it drops out of all routing, the row + audit history stay, re-enable any time). There is **no hard-delete** — no `DELETE /api/ai/models/:id` route or `deleteModel` repo method exists today, and we do not add one. Reversible and safe; avoids dangling-FK/locked-model-deletion edge cases entirely.
- **D7 — Multiple models per (tier, provider) stay allowed; the lock is the tiebreaker.** (Ben, 2026-06-29.) No uniqueness constraint is added — running e.g. two `interactive` chat-capable Codex models side by side (the "multiple interactive levels for testing" case in #513) is explicitly supported. **Reconciliation when chat resolves _automatically_** (no lock, no manual route): `selectAutomaticModelForCapability` walks `economy → interactive → reasoning` from the requested tier and, within the first matching tier, picks **most-recently-created** (`ORDER BY created_at DESC, id DESC`). This is deterministic but implicit, so: (a) the admin pane must surface the **effective** chat model, and (b) the lock (Part B) is the supported way to pin _which_ of several same-tier models chat uses.

## 5. Architecture

### 5.1 Backend — routing semantics (small, surgical)

- **`packages/ai/src/repository.ts` `resolveModelForCapability`:** introduce a **hard-lock branch**. When an admin pin is set (`adminPinnedModelId` truthy) but the pinned model query returns nothing, **stop**: return `{ model: null, reason: "admin-pin-unavailable" }` for the **chat** capability instead of continuing to manual route / automatic. (Decision point: scope hard-lock to chat now; other capabilities may keep today's fallback — keep the change minimal and explicit. If we make it global, document it.)
- **`packages/shared`:** add `"admin-pin-unavailable"` to the resolution `reason` union (`AiCapabilityRouteResolution`) so the chat capability response can carry it to the frontend.
- **Pin set/clear:** reuse `setAdminPinnedModel` + the `/api/admin/users/:userId/ai-pin` route as-is (already audited: idempotent set, audit-logged `ai.admin_pin.set` / `ai.admin_pin.clear`). Add a self-targeting convenience only if the admin pane can't already address the acting admin's own user id (verify; the per-user route likely suffices with `currentUserId`).
- **Audit D3:** grep provider/model `deleteProvider`/`deleteModel`/revoke paths to confirm none clear `ai.admin_pinned_model_id`. If any does, remove that cascade.

### 5.2 Frontend — admin pane (Part A: edit models)

- On each model row in `settings-ai-admin-pane.tsx`, add an **Edit** affordance mirroring the existing **provider** edit pattern (`onEdit`/`editing` state at `:237`/`:334`/`:350`). The form binds the `UpdateAiModelInput` fields (display name, provider model id, capabilities, tier, status, allow-override) and calls the already-imported `updateAiModel(model.id, patch)` (extend its single current use at `:787`). Invalidate the AI models query on success (same pattern as the provider mutation at `:768`–`:787`).
- **Remove = Disable (D6):** a "Disable" action sets `status: "disabled"` via the same `updateAiModel`; disabled rows render greyed with an "Enable" toggle. No hard-delete control.
- No new client binding — `updateAiModel` exists (`client.ts:757`).

### 5.3 Frontend — admin pane (Part B: lock chat to model)

- Add a **"Lock chat to model"** control in the chat-capability area of the admin pane: a picker over chat-capable models (`model.capabilities.includes("chat")`, already computed at `:114`) with a "Locked: <model> · Unlock" state. Set/clear via the existing admin-pin client binding (`client-admin.ts:86`/`:95`).
- **The picker is grouped by provider** (e.g. `Anthropic ▸ claude-opus-4-8`, `OpenAI ▸ gpt-…`). This is the answer to "how do I change the chat provider from the UI": you re-pick a model under the desired provider, which re-locks chat to that provider's model in one action. Changing the lock is always an explicit, supported action — the hard lock only blocks _silent_ swaps (provider teardown / activation changes), never a deliberate re-pick.
- Show the lock state explicitly so it reads as durable ("Chat is locked to _<model>_ (Anthropic). This survives provider changes — to switch provider, pick another model below.").
- **Effective-model indicator (D7).** Whether or not chat is locked, the pane shows the **model chat would actually use right now** (lock target if locked+available; else the automatic pick = newest-created in the matching tier). When chat is **unlocked and >1 active chat-capable model shares the resolving tier**, show a nudge: "_N interactive chat models active; chat auto-uses the newest (<model>). Lock one to make this explicit._" This makes the implicit newest-wins rule visible and points to the lock as the fix.

### 5.4 Frontend — chat surface (Part B: unavailable alert)

- The chat surface must consume the chat capability resolution `reason`. When it is **`admin-pin-unavailable`**, render an actionable banner in the chat composer/empty state: _"The locked chat model is unavailable (its provider was removed or disabled). Pick another model in Settings → AI."_ — link to the admin pane. Chat does **not** auto-send to a different model. (Net-new: no chat UI currently reads the resolution reason.)

## 6. Security & Invariants Honored (CLAUDE.md)

- **No admin private-data bypass / RLS for all:** pin set/clear runs in the target user's `DataContextRunner` scope; preference rows are owner-scoped; no `BYPASSRLS`, no cross-user write outside scope.
- **Secrets never escape:** unchanged — only a model **id** (already non-secret, already in `safe` rows) crosses to the frontend; no credentials.
- **Provider-agnostic AI:** the lock pins a _user-configured_ model id; it hardcodes no provider/model. The router still selects per capability; the lock is a user/admin configuration of that router, not a hardcode.
- **Module isolation:** all changes within `packages/ai` public surface + its admin routes; the chat surface consumes the capability resolution via the existing capability-route response, not `ai` internals.

## 7. Testing Strategy

- **Unit (`packages/ai`):** `resolveModelForCapability("chat")` returns `reason: "admin-pin-unavailable"` (model null) when a pin is set but the model/provider is inactive; returns `admin-pin` when resolvable; unchanged automatic/manual paths when **no** pin is set.
- **Unit:** setting then clearing the pin round-trips through `ai.admin_pinned_model_id`; switching the active provider does **not** change the pin or the resolved chat model.
- **Integration:** deleting/revoking the pinned model's provider leaves `ai.admin_pinned_model_id` intact (D3) and flips chat resolution to `admin-pin-unavailable` (not a silent swap).
- **Integration / component:** model edit form PATCHes each `UpdateAiModelInput` field and the row reflects it after invalidation.
- **Frontend:** chat surface renders the unavailable banner on `admin-pin-unavailable` and does not auto-route to another model.

## 8. Acceptance Criteria

- [ ] Admin can edit an existing model's display name, provider model id, capabilities, tier, and status from the AI admin pane (no delete-and-recreate). "Remove" disables (soft); no hard-delete.
- [ ] The pane shows the **effective** chat model and, when unlocked with >1 same-tier chat model active, nudges to lock one.
- [ ] Admin can lock chat to a specific chat-capable model from the AI admin pane, and see it is locked.
- [ ] With a lock set, switching/activating a different provider does **not** change the chat model.
- [ ] If the locked model's provider is removed/disabled, chat shows an actionable "locked model unavailable — pick another" state and does **not** silently use a different model.
- [ ] The lock preference is never auto-cleared by provider/model teardown.
- [ ] No migration added; all changes honor admin-gate + owner-scoped RLS; no secrets cross to the frontend.

## 9. Files In Play

- `~/Jarv1s/packages/ai/src/repository.ts` — `resolveModelForCapability` hard-lock branch; audit no pin auto-clear on delete.
- `~/Jarv1s/packages/shared/*` — add `"admin-pin-unavailable"` to the resolution `reason` union (`AiCapabilityRouteResolution`).
- `~/Jarv1s/packages/ai/src/admin-ai-pin-routes.ts` / `routes.ts` — reuse pin set/clear (verify self-targeting works for the acting admin).
- `~/Jarv1s/apps/web/src/settings/settings-ai-admin-pane.tsx` — model edit form (Part A); "Lock chat to model" control (Part B).
- `~/Jarv1s/apps/web/src/api/client.ts` (`updateAiModel`, exists) / `client-admin.ts` (pin get/put, exists) — no new bindings expected.
- `~/Jarv1s/apps/web/src/chat/*` — consume chat resolution `reason`; render the `admin-pin-unavailable` banner (net-new).

## 10. Open Risks

- **Hard-lock scope.** §5.1: confining the hard-lock (no-fallback) behavior to the **chat** capability vs. all capabilities. Recommend chat-only in V1 to avoid changing briefings/other routing silently; make the scope explicit in code + tests.
- **Pin/teardown audit (D3).** Must confirm no existing delete/revoke path clears `ai.admin_pinned_model_id`; if one does, removing it changes teardown behavior — call it out in the PR.
- **Resolution-reason plumbing.** The chat surface does not currently read the capability resolution reason; wiring it through the chat capability response is the largest single piece of net-new work and should be verified end-to-end (server reason → response → composer banner).
- **Build needs a GitHub `task` issue (Part of #513)** before coding — process gate per CLAUDE.md; this spec satisfies the spec gate only.

## 11. Slices (handoff-ready)

- **Slice 1 — Edit models (Part A).** Surface a full model-edit form wired to the existing `updateAiModel`/`PATCH /api/ai/models/:id`. UI-only, no backend, independently shippable. Closes the "can't edit created models" half of #513.
- **Slice 2 — Hard-lock chat to a model (Part B).** Backend: `admin-pin-unavailable` resolution + reason type + D3 audit. Frontend: "Lock chat to model" control in the admin pane + the chat-surface unavailable banner. Depends on Slice 1 only for shared admin-pane edits (coordinate file).
