# Chat Model Selector in Chat (#759) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Coordinated-build approval gate applies: do not start code until Coordinator approves this plan.

**Spec:** `docs/superpowers/specs/2026-07-05-chat-model-selector.md` (authoritative).

**Goal:** Composer-adjacent model selector in the chat drawer wired to the existing
chat-model-override preference; same-provider switch continues the thread, cross-provider switch
confirms then starts a new chat; admin glue for discovered-model import and chat capability pinning.

**Architecture:** Zero model-resolution rearchitecture. The selector reads
`GET /api/ai/chat-model-override` (settings DTO already embeds full model rows with
`providerConfigId`/`providerKind` — `packages/shared/src/ai-api.ts`), writes
`PUT /api/ai/chat-model-override`, and triggers the engine switch mechanism. Cross-provider reuses
the existing drawer reset flow. Admin work is UI glue over `discover-models` +
`POST /api/ai/models` + `PUT /api/ai/capability-routes/:capability`.

**Tech Stack:** React (chat drawer + settings admin pane), React Query
(`queryKeys.ai.chatModelOverride`, `queryKeys.chat.threads`), Fastify routes in `packages/ai` and
`packages/chat`.

## Settled decision (Ben, 2026-07-05) — nothing below is gated

Same-provider switch mechanism: **relaunch-with-replay** via the existing `POST /api/chat/switch`
route, forcing the launch replay batch (rolling summary + recent turns) on switch-triggered
relaunches even with `JARVIS_CHAT_REPLAY_K=0`. Explicitly not in-CLI `/model` injection (a possible
later per-provider enhancement). Task 3 implements this directly.

## File Map

| File                                                              | Change                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/web/src/chat/chat-drawer.tsx` (+ new `chat-model-pill.tsx`) | New: composer-adjacent pill + drop-up (keep files under the 1000-line gate — extract a component file) |
| `apps/web/src/api/client.ts`                                      | Verify existing override GET/PUT client fns; add the switch call for Task 3                            |
| `apps/web/src/api/query-keys.ts`                                  | Reuse `ai.chatModelOverride`; no new keys expected                                                     |
| `packages/chat/src/live-routes.ts`                                | Task 3: extend `POST /api/chat/switch` for same-provider relaunch-with-replay                          |
| `packages/chat/src/live/chat-session-manager.ts`                  | Task 3: force replay batch on switch-triggered relaunch                                                |
| `packages/chat/src/live/persistence.ts`                           | Task 3: `listPriorTurns` override for switch path (bypass `k<=0` gate)                                 |
| `apps/web/src/settings/settings-ai-admin-pane.tsx`                | Modify: discovered-models bulk import; chat capability pin UI                                          |
| `apps/web/src/settings/settings-ai-pane.tsx`                      | Unchanged behavior; reference for locked/empty patterns                                                |
| `packages/ai/src/routes.ts`                                       | Likely unchanged (bulk import may reuse `POST /api/ai/models` per row from the client)                 |

No migration. No DTO/schema additions expected — provider identity is already exposed
(`aiConfiguredModelSchema.providerConfigId`/`providerKind`).

## Decisions (from spec — do not relitigate)

- Selector is a composer-adjacent pill/drop-up, not a header dropdown, not Settings-style.
- Same-provider → thread continues; cross-provider → confirmation, then new chat via existing
  `clearChat() + clearRecords()` + invalidate `queryKeys.chat.threads`. Never silent, never blocked.
- No per-turn `modelId` on `POST /api/chat/turn`; no thread/message schema change; no hardcoded
  model lists; no new secret surface.
- Admin pin precedence unchanged: admin chat-model-override pin → user override → capability route /
  tier default. Admin-pinned state renders locked in the selector.
- Private chats (#744): cross-provider confirm copy must state the private session is permanently
  destroyed; the switch mechanism is relaunch-based, so a same-provider switch in a private chat
  also loses all context (nothing to replay) — copy must be honest.

## Task 1 — Selector data wiring + pill UI

**Files:** `apps/web/src/chat/chat-model-pill.tsx` (new), `apps/web/src/chat/chat-drawer.tsx`.

- [ ] **Step 1 (test first):** Component tests: pill renders selected model name from
      `chatModelOverrideSettings`; drop-up lists instance default + `selectableOverrideModels`;
      admin-pinned (`selectableOverrideModels: []`) renders locked state; no-default renders empty
      state — mirror `settings-ai-pane.tsx` locked/empty patterns.
- [ ] **Step 2:** Build the pill + drop-up against `queryKeys.ai.chatModelOverride`, styled with
      existing `jds-*`/chat-drawer primitives (no new raw colors outside `tokens.css`).
- [ ] **Step 3:** Same-vs-cross-provider classification = `providerConfigId` equality between the
      candidate row and the currently-selected/effective model row. Unit-test the classifier,
      including "current = instance default" and "override disabled" edges.
- [ ] **Step 4:** Verify: `pnpm typecheck && pnpm --filter web test` (or repo's web test script) +
      `pnpm check:file-size`.

## Task 2 — Cross-provider flow

**Files:** `chat-model-pill.tsx`, `apps/web/src/chat/chat-drawer.tsx`, `apps/web/src/api/client.ts`.

- [ ] **Step 1 (test first):** Tests: selecting a cross-provider model shows confirmation before any
      mutation; cancel = no PUT, selection reverts; confirm = PUT then drawer reset
      (`clearChat` + `clearRecords` + invalidate `queryKeys.chat.threads`); when the active thread
      is incognito, the dialog copy includes the permanent-destruction warning.
- [ ] **Step 2:** Implement dialog + confirm flow. Exact copy: leave a `// COPY-TBD` marker keyed to
      the spec's open copy question — functional default text now, Ben annotates later
      (functionality-pass rule).
- [ ] **Step 3:** StrictMode trap: do NOT fire the mutation inside a state updater (known
      double-fire bug pattern in settings confirms). Mutations fire from event handlers only.
- [ ] **Step 4:** Verify: web tests + typecheck.

## Task 3 — Same-provider switch: relaunch-with-replay (settled decision)

**Files:** `packages/chat/src/live-routes.ts`, `packages/chat/src/live/chat-session-manager.ts`,
`packages/chat/src/live/persistence.ts`.

- [ ] **Step 1 (test first):** Integration test: same-provider switch → PUT override, then switch
      route kills + relaunches; relaunch includes the replay batch (rolling summary + recent turns)
      even with `JARVIS_CHAT_REPLAY_K=0`; next turn runs on the new model (assert launch args
      contain the new `--model`).
- [ ] **Step 2:** Add a `forceReplay` flag through `switchProvider` → `launchSession` →
      `listPriorTurns` (bypass the `k <= 0` early return only for switch-triggered relaunches; pick
      a sane K, e.g. reuse the env default shape). Incognito threads have no rows — the replay batch
      is naturally empty; UI copy handles honesty (Task 2/5). Do not implement in-CLI `/model`
      injection — explicitly out of scope per the settled decision.
- [ ] **Step 3:** Wire the pill's same-provider path: PUT → switch call → keep thread open.
- [ ] **Step 4:** Verify: `pnpm test:integration -- <live routes tests>` + typecheck.

## Task 4 — Admin glue: discovered-model import

**Files:** `apps/web/src/settings/settings-ai-admin-pane.tsx`, `apps/web/src/api/client.ts`.

- [ ] **Step 1 (test first):** Test: discovery results render with multi-select; "add selected"
      creates configured model rows (one `POST /api/ai/models` per selection is acceptable — the
      requirement is no manual one-by-one form entry); duplicates already configured are indicated
      and skipped.
- [ ] **Step 2:** Implement against existing `GET/POST /api/ai/providers/:id/discover-models` and
      `POST /api/ai/models`. No new backend route unless duplicate-detection forces one — prefer
      client-side comparison against the configured-models list.
- [ ] **Step 3:** Verify: web tests + typecheck.

## Task 5 — Admin glue: chat capability pinning UI + precedence surfacing

**Files:** `apps/web/src/settings/settings-ai-admin-pane.tsx`.

- [ ] **Step 1 (test first):** Test: chat capability pin control reads/writes
      `GET/PUT /api/ai/capability-routes/chat`; the pane presents both mechanisms (capability pin
      and the existing admin chat-model-override lock) with copy stating precedence: admin pin →
      user override → capability route/tier default.
- [ ] **Step 2:** Implement; do not invent a third pinning mechanism.
- [ ] **Step 3:** Verify: web tests + typecheck.

## Task 6 — Final slice verification

- [ ] Acceptance sweep against the spec's criteria list, including: Settings chat-model control
      still works; no `modelId` on `POST /api/chat/turn`; no secrets in DTOs (grep the touched DTO
      paths); locked/empty selector states.
- [ ] `pnpm verify:foundation` (real exit code).
- [ ] Commit in small slices with **explicit paths only — never `git add -A`** (shared tree).

## Self-Review

- [ ] Does the same-provider path actually change the answering model (not just persist a pref)?
- [ ] Is every model list sourced from override/capability DTOs (zero hardcoded IDs)?
- [ ] StrictMode: any mutation inside a state updater? (Must be no.)
- [ ] Private-chat copy honest per revised #744?
