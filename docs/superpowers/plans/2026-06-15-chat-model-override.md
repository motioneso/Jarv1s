# Chat Model Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this coordinated build, execute manually; do not use disabled execution sub-skills.

**Goal:** Persist a per-user chat model override, gate it by an admin global toggle plus per-model allow flags, and make live chat resolve the override with safe fallback to the instance default.

**Architecture:** Treat AI provider/model configuration as instance configuration: safe metadata is readable by authenticated users, writes are admin-gated, and credentials remain encrypted and never serialized. Store `allow_user_override` on `app.ai_configured_models`, store global toggle in `app.instance_settings` under `ai.chat_model_override.enabled`, and store each user's override in owner-only `app.preferences` under `chat.modelOverride`. Add a pure resolver for the truth table, then have AI repository/routes and live chat call it.

**Tech Stack:** TypeScript, Fastify, Kysely/Postgres/RLS, Vitest, React Query, existing JDS settings components.

---

## File Structure

- `docs/superpowers/specs/2026-06-15-chat-model-override.md`: include the approved spec in this branch if it remains untracked.
- `packages/ai/sql/0091_chat_model_override.sql`: placeholder migration adding `allow_user_override` and updating AI config RLS to authenticated-safe reads + admin-only writes.
- `packages/db/src/types.ts`: add `allow_user_override` to `AiConfiguredModelsTable`.
- `packages/shared/src/ai-api.ts`: extend model DTO/create/update schemas and add chat-model-override settings contracts.
- `packages/ai/src/chat-model-override.ts`: pure resolution helper and constants for setting/preference keys.
- `packages/ai/src/repository.ts`: carry `allow_user_override`; add default/override resolution, settings read/write, admin-user check, and preference upsert/delete.
- `packages/ai/src/routes.ts`: add admin/self routes, admin-gate provider/model writes, serialize new fields.
- `packages/ai/src/manifest.ts`: register new migration and routes.
- `packages/chat/src/live/persistence.ts`: resolve chat via the new override-aware repository method.
- `apps/web/src/api/client.ts`: add client functions for admin settings and self preference.
- `apps/web/src/api/query-keys.ts`: add query keys.
- `apps/web/src/settings/settings-ai-admin-pane.tsx`: add global switch and per-model allow controls.
- `apps/web/src/settings/settings-ai-pane.tsx`: replace localStorage/NotWired with backend-backed read-only or picker state; do not edit Persona.
- `tests/unit/ai-chat-model-override.test.ts`: pure truth-table tests.
- `tests/integration/ai.test.ts`: migration, RLS/admin-gate, route contract, resolution tests.
- `tests/integration/chat-live-api.test.ts`: live chat uses override-selected model.

## Assumption Needing Coordinator Approval

Existing AI config rows are owner-scoped. The approved spec says "admin-configured instance routing" and requires user A/B to use admin-configured models. This plan changes AI provider/model safe metadata to instance-readable and model/provider writes to admin-only, while preserving secret non-serialization and encrypted credential storage. Without this shift, user override cannot work across users.

## Task 1: Pure Resolver

**Files:**
- Create: `tests/unit/ai-chat-model-override.test.ts`
- Create: `packages/ai/src/chat-model-override.ts`
- Modify: `packages/ai/src/index.ts`

- [ ] **Step 1: Write failing truth-table tests**

Cover these test names:
- `returns default when global override is disabled`
- `returns override when global override is enabled and model is allowed`
- `returns default when override model is disallowed`
- `returns default when override model was removed`
- `keeps instance default selectable even when its allow flag is false`

Run:
```bash
pnpm test:unit -- tests/unit/ai-chat-model-override.test.ts
```

Expected: FAIL because `resolveChatModelOverride` module does not exist.

- [ ] **Step 2: Implement minimal resolver**

Create `resolveChatModelOverride(input)` with inputs: `defaultModel`, `requestedModelId`, `overrideEnabled`, `models`. It returns `{ selectedModel, effectiveOverrideModelId, allowedModels }`; only active chat-capable models with active providers are candidates, `allowUserOverride !== false` controls override eligibility, and the default model is always included in `allowedModels`.

- [ ] **Step 3: Verify green**

Run:
```bash
pnpm test:unit -- tests/unit/ai-chat-model-override.test.ts
```

Expected: all new tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/ai-chat-model-override.test.ts packages/ai/src/chat-model-override.ts packages/ai/src/index.ts
git commit -m "feat(ai): add chat model override resolver

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 2: DB + Shared Contract

**Files:**
- Modify: `docs/superpowers/specs/2026-06-15-chat-model-override.md` only if untracked
- Create: `packages/ai/sql/0091_chat_model_override.sql`
- Modify: `packages/ai/src/manifest.ts`
- Modify: `packages/db/src/types.ts`
- Modify: `packages/shared/src/ai-api.ts`
- Test: `tests/integration/ai.test.ts`

- [ ] **Step 1: Write failing migration/contract tests**

In `tests/integration/ai.test.ts`, add assertions that migration `0091_chat_model_override.sql` applies, `app.ai_configured_models.allow_user_override` exists with default true, model DTOs include `allowUserOverride`, create defaults it to true, PATCH can set false, non-admin model writes return 403, and non-admin safe reads do not contain `encrypted_credential`/`ciphertext`.

Run:
```bash
JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm test:ai
```

Expected: FAIL because migration/DTO/schema fields are absent and non-admin writes still succeed.

- [ ] **Step 2: Add migration**

`0091_chat_model_override.sql` must:
- `ALTER TABLE app.ai_configured_models ADD COLUMN IF NOT EXISTS allow_user_override boolean NOT NULL DEFAULT true;`
- Replace `ai_provider_configs_select` and `ai_configured_models_select` to allow authenticated reads for `jarvis_app_runtime` and `jarvis_worker_runtime`.
- Replace insert/update policies on both AI config tables so `app.current_actor_is_admin()` is required for writes.
- Keep grants unchanged except any needed worker read preservation.

- [ ] **Step 3: Update TS DB/shared types**

Add `allow_user_override` to `AiConfiguredModelsTable`; add `allowUserOverride` to `AiConfiguredModelDto`, create/update model requests, JSON schemas, and route schemas.

- [ ] **Step 4: Verify focused green**

Run:
```bash
JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm db:migrate
JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm test:ai
```

Expected: AI integration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-15-chat-model-override.md packages/ai/sql/0091_chat_model_override.sql packages/ai/src/manifest.ts packages/db/src/types.ts packages/shared/src/ai-api.ts tests/integration/ai.test.ts
git commit -m "feat(ai): add admin-gated chat override model flag

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 3: Repository + Routes

**Files:**
- Modify: `packages/ai/src/repository.ts`
- Modify: `packages/ai/src/routes.ts`
- Modify: `packages/ai/src/manifest.ts`
- Test: `tests/integration/ai.test.ts`

- [ ] **Step 1: Write failing route/resolution tests**

Add tests for:
- `GET /api/ai/chat-model-override` default OFF returns default model, no picker, and current override null.
- `PUT /api/admin/ai/chat-model-override` toggles global setting and rejects non-admin with 403.
- `PUT /api/ai/chat-model-override` persists user A override and user B sees null.
- Repository resolution chooses override for user A, default for user B, and default when global OFF.
- Disallowing/removing selected model silently falls back to default.

Run:
```bash
JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm test:ai
```

Expected: FAIL because routes and repository methods do not exist.

- [ ] **Step 2: Implement repository methods**

Add constants for setting/preference keys, `getChatModelOverrideSettings`, `setChatModelOverrideEnabled`, `setChatModelOverride`, `selectChatModelForUser`, and an admin check via `app.get_user_by_id`. Use `app.instance_settings` value shape `{ value: boolean }`, default false. Use `app.preferences` owner-only upsert/delete for `chat.modelOverride`.

- [ ] **Step 3: Implement routes**

Add:
- `GET /api/ai/chat-model-override` for current user.
- `PUT /api/ai/chat-model-override` with `{ modelId: string | null }`.
- `PUT /api/admin/ai/chat-model-override` with `{ enabled: boolean }`.

Admin-gate existing provider/model POST/PATCH/revoke routes before writes. Serialize model `allowUserOverride` everywhere.

- [ ] **Step 4: Verify focused green**

Run:
```bash
JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm test:ai
```

Expected: AI integration tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/repository.ts packages/ai/src/routes.ts packages/ai/src/manifest.ts tests/integration/ai.test.ts
git commit -m "feat(ai): persist and resolve chat model overrides

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 4: Live Chat Uses Override

**Files:**
- Modify: `packages/chat/src/live/persistence.ts`
- Test: `tests/integration/chat-live-api.test.ts`

- [ ] **Step 1: Write failing live-chat test**

Seed admin provider/models `claude-default` and `claude-override`, enable global override, set user A override to `claude-override`, submit `/api/chat/turn`, then assert assistant message metadata executed model is `claude-override`. Add a second assertion that when global OFF the executed model is default.

Run:
```bash
JARVIS_PGDATABASE=jarvis_build_chatmodel241 vitest run tests/integration/chat-live-api.test.ts
```

Expected: FAIL because live persistence still calls `selectModelForCapability`.

- [ ] **Step 2: Swap live resolution**

Change `DataContextChatPersistence.resolveActiveProvider` to call `this.ai.selectChatModelForUser(scopedDb)` and keep the no-model and unsupported-provider error behavior.

- [ ] **Step 3: Verify focused green**

Run:
```bash
JARVIS_PGDATABASE=jarvis_build_chatmodel241 vitest run tests/integration/chat-live-api.test.ts
```

Expected: chat-live API tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/chat/src/live/persistence.ts tests/integration/chat-live-api.test.ts
git commit -m "feat(chat): route live chat through user model override

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 5: Web Client + UI

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/settings/settings-ai-admin-pane.tsx`
- Modify: `apps/web/src/settings/settings-ai-pane.tsx`

- [ ] **Step 1: Run typecheck before UI edit**

Run:
```bash
pnpm typecheck
```

Expected: PASS before UI changes.

- [ ] **Step 2: Add client/query helpers**

Add `getChatModelOverrideSettings`, `putChatModelOverride`, `putAdminChatModelOverrideEnabled`, and use existing `updateAiModel` for per-model `allowUserOverride`.

- [ ] **Step 3: Update admin pane**

Import `Switch`; add a group/row for "Allow users to override their chat model"; add per-chat-model switch in `ModelLine` or provider card row to PATCH `allowUserOverride`; invalidate `queryKeys.ai.chatModelOverride`, `queryKeys.ai.models`, and capability keys on success.

- [ ] **Step 4: Update personal ChatModel only**

Remove localStorage state, `CHAT_MODEL_STORAGE_KEY`, `NotWired`, and backend TODO. Query backend settings; if `overrideEnabled` is false, render a read-only field showing instance default. If true, render select with `default` plus `allowedModels`, persist via mutation, and toast success/error. Do not edit Persona.

- [ ] **Step 5: Verify focused frontend**

Run:
```bash
pnpm typecheck
pnpm lint
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/settings/settings-ai-admin-pane.tsx apps/web/src/settings/settings-ai-pane.tsx
git commit -m "feat(web): wire chat model override settings

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Task 6: Required Gates + Wrap-Up

**Files:** no source edits unless gates expose failures.

- [ ] **Step 1: Run required pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run required foundation gate**

```bash
JARVIS_PGDATABASE=jarvis_build_chatmodel241 pnpm verify:foundation
```

Expected: exit 0.

- [ ] **Step 3: Rebase**

```bash
git fetch origin main && git rebase origin/main
```

Expected: rebase clean or conflicts resolved without touching unrelated files.

- [ ] **Step 4: coordinated-wrap-up**

Use `/home/ben/Jarv1s/.claude/skills/coordinated-wrap-up/SKILL.md`: run full gate/audit, push `chat-model-override-241`, open PR against `main`, and report PR + evidence to Coordinator. Do not move board, merge, or edit `docs/coordination/`.

## Self-Review

- Spec coverage: global OFF read-only, global ON picker, per-model allow flag, owner-only user pref, admin-only writes, fallback resolution, UI removal of local-only NotWired, and manual verification path are covered.
- Placeholder scan: no TBD/TODO/fill-later steps.
- Collision guard: plan touches `apps/web/src/api/client.ts`, `packages/chat/src/routes.ts` not needed, `packages/chat/src/live/persistence.ts`, `settings-ai-admin-pane.tsx`, and only `ChatModel` inside `settings-ai-pane.tsx`; avoids `apps/web/src/onboarding/**` and `docs/coordination/**`.
