# Admin: set AI provider per user (#485, phase-1)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/packages/ai/src/repository.ts:476` (`listCapabilityRoutes` reads a single
instance-wide `app.instance_settings` key — no `owner_user_id` filter; this is the gap),
`packages/ai/src/repository.ts:519` (`resolveModelForCapability` resolution order),
`packages/ai/src/chat-model-override.ts` + routes (existing per-user self-override, which an admin pin
must supersede), `packages/settings/src/routes.ts:259` (`/api/admin/users` admin user-management — the
admin-acts-on-user pattern), `packages/ai/sql/0013_ai_module.sql` (`ai_provider_configs` /
`ai_configured_models` are owner-scoped — per-user provider state already exists).

## 1. Decision

Let an admin **pin a specific AI provider/model for an individual user**, overriding the instance-wide
capability route for that user. The pin is **binding** (the user cannot self-override it while it's
active). Phase-1 pins **one model for all of the user's capabilities at once**; per-capability pins
are deferred to a phase-2 child issue.

Today capability routing is instance-wide only (one `app.instance_settings` key applies to everyone).
#485 adds a per-user override layer above it.

## 2. Resolution order (the core change)

`resolveModelForCapability` gains a per-user check **before** the instance route:

```
1. Admin pin for this user (if set, and the pinned model is active+capable) → use it. BINDING.
2. Instance capability route (existing) → manual-route.
3. Automatic selection (existing tier-ladder) → matched-active-model / no-active-model.
```

If a pin is set but the pinned model is inactive/disabled/missing the capability, fall through to the
instance route (reason: `admin-pin-unavailable-fallback`) — same fallback pattern as the existing
manual-route-unavailable path. Never hard-fail: an admin who disables a pinned model shouldn't break
the user's chat.

The pin binds: while a pin is active, the existing user self-override
(`/api/ai/chat-model-override`) returns 409/conflict with a clear message ("An admin has pinned your
AI provider; contact them to change it") rather than silently overriding the pin. The
`ai.chat_model_override.enabled` instance setting and `allow_user_override` model flag continue to
govern self-override _when no pin is active_.

## 3. Storage

Per-user pin stored in `app.preferences` under key `ai.admin_pinned_model_id` (value: the configured
model id, or absent = no pin). Owner-scoped RLS — but written by an admin via an admin route (the
admin route operates under the target user's `DataContextDb`, so the row lands under the target's
`owner_user_id`). This reuses the existing `app.preferences` table; **no new table, no migration.**

Using `app.preferences` (not a new column on `users`) keeps AI-module state inside the AI module's
ownership and avoids a users-table schema change.

## 4. Routes (admin-scoped)

New routes in `packages/ai/src/`, gated by admin RLS + the existing admin guard (mirror
`/api/admin/users` auth posture). Operate on a `targetUserId` path param:

- `GET /api/admin/users/:userId/ai-pin` → `{ pinnedModelId: string | null, pinnedModel: AiConfiguredModelSafeDto | null }`.
  Returns the resolved pin (model dto or null). Never returns secrets (uses the existing safe row
  shape — `ai_configured_models` safe projection, no API keys).
- `PUT /api/admin/users/:userId/ai-pin` body `{ modelId: string | null }` → sets (or clears, on
  `null`) the pin. Validates the model exists, is active, and is owned by the target user (an admin
  can only pin a model the user has configured — they can't force a model the user has no provider
  for). Returns the new pin state.
- Audit row on every PUT: `action: "ai.admin_pin.set" / "ai.admin_pin.clear"`, `targetType: "user"`,
  `targetId: userId`, metadata `{ modelId }` only (no provider secrets).

`resolveModelForCapability` reads the pin via `PreferencesRepository.get(scopedDb,
"ai.admin_pinned_model_id")` — under the per-actor context this is automatically the right user's
pin (RLS). No new context field.

## 5. Resolver change

`packages/ai/src/repository.ts` `resolveModelForCapability` becomes:

```ts
async resolveModelForCapability(scopedDb, capability, tier, preferences) {
  // 1. Admin pin (binding)
  const pinnedId = await preferences.get(scopedDb, "ai.admin_pinned_model_id");
  if (typeof pinnedId === "string") {
    const pinned = await this.safeModelQuery(scopedDb)
      .where("models.id", "=", pinnedId)
      .where("models.status", "=", "active")
      .where("providers.status", "=", "active")
      .executeTakeFirst();
    if (pinned) return { model: pinned, reason: "admin-pin" };
    // else fall through with reason admin-pin-unavailable-fallback (set below if no later match)
  }
  // 2. + 3. existing instance-route + automatic logic unchanged
  ...
}
```

`PreferencesRepository` is injected (it already exists in `@jarv1s/structured-state`). The composition
host passes it into the resolver dep set. No `AccessContext` change.

## 6. Admin UI

In the admin user-management surface (the existing `/api/admin/users`-backed admin view — find its
frontend component; if there isn't a per-user detail view yet, add a minimal one reachable from the
user list), add an **"AI provider"** section per user:

- Shows the user's current effective model (resolved, with reason: "admin pin" / "instance route" /
  "automatic").
- A model `<Select>` populated from the user's configured active models (`ai_configured_models` for
  that user). Setting it PUTs the pin; a "Clear pin" option removes it (falls back to instance route).
- Copy that makes the binding explicit: _"Pinning forces this model for all of this user's AI
  features. They cannot change it themselves while pinned."_
- Disabled state if the user has no configured models (can't pin what doesn't exist).

Phase-1 is one pin = all capabilities. The UI is a single model selector, not per-capability rows
(phase-2).

## 7. Security & invariants

- **Admin = config power only, no data bypass.** An admin pinning a model doesn't give the admin
  access to the user's chats/content — RLS still applies to everything. The pin only selects _which
  model_ the user's AI calls use.
- **No secrets surface.** The pin route uses the existing safe model projection (no API keys, no
  provider credentials). Audit metadata is model-id only.
- **Target-user ownership respected.** An admin can only pin a model the target user has configured
  (`owner_user_id = targetUserId`); can't force a model the user has no provider for.
- **No new context fields.** `AccessContext` stays `{ actorUserId, requestId }`. The preference read
  is per-actor via RLS.
- **Binding is enforced server-side.** The user self-override route checks for an active pin and
  refuses; a hostile client can't bypass (the resolver is the source of truth, not the client).

## 8. Acceptance criteria

- [ ] Admin can open a user in the admin user-management view and pin a specific active model.
- [ ] The pinned model is used for **all** of that user's AI capabilities (chat, briefing,
      summarization, etc.) — verified via `resolveModelForCapability` reason `"admin-pin"`.
- [ ] While pinned, the user's self-override (`/api/ai/chat-model-override`) is refused with a clear
      message.
- [ ] Clearing the pin restores the user to the instance route + their own override freedom.
- [ ] If the pinned model is deactivated, the resolver falls through to the instance route (no
      hard-fail); reason `admin-pin-unavailable-fallback`.
- [ ] Admin cannot pin a model the user hasn't configured (validation error).
- [ ] No secrets in any response or audit row.
- [ ] No new DB table/migration (uses `app.preferences`); no new `AccessContext` field.

## 9. Rollout / blast radius

- `packages/ai/src/repository.ts` — `resolveModelForCapability` gains the pin check + an injected
  `PreferencesRepository` dep.
- `packages/ai/src/admin-ai-pin-routes.ts` — new GET/PUT admin routes.
- `packages/ai/src/manifest.ts` — register the two routes.
- `packages/ai/src/chat-model-override.ts` / its route — refuse self-override while a pin is active.
- Composition host — inject `PreferencesRepository` into the resolver deps.
- `packages/shared/src/ai-types.ts` — DTOs + schemas for the pin GET/PUT.
- `apps/web/src/settings/settings-admin-panes.tsx` (or wherever the admin user view lives) — per-user
  "AI provider" section.
- `apps/web/src/api/client.ts` + `query-keys.ts` — client fns + keys.

No DB migration (reuses `app.preferences`). No new permissions (admin routes use the existing admin
guard).

## 10. Out of scope (phase-2 child issue)

- **Per-capability pins** (Gemini for chat, Claude for briefings) — phase-2. The resolver already
  supports per-capability resolution; phase-2 adds per-capability pin storage
  (`ai.admin_pinned_model_id.<capability>`) + per-capability UI rows. The phase-1 architecture
  (preference key, resolver check, admin route) extends cleanly.
- Non-admin per-user model preferences beyond the existing self-override (unchanged).
- Bulk pin (pin one model across many users at once) — defer.
- A user-facing explanation/notification when an admin pins their model (the self-override refusal
  message is the only user-visible signal for now).
