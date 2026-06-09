# UI honesty pass — Design (P1 #60)

**Status:** DRAFT (coordinator readiness, 2026-06-09) — needs Ben's sign-off
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #60 (Part of epic #46)

## Context

Several web surfaces ship a full, polished UI with **no working backend behind them**, so the app
lies to the user. Real versions of these arrive in **Phase 3** (connector sync) and later. Until
then they must be disabled, clearly marked "coming soon", or removed. Investigated surfaces:

1. **Calendar page** (`apps/web/src/calendar/calendar-page.tsx`) — full filter UI + event rows, but
   there is **no sync engine**: `packages/calendar/src/` has only `routes/repository/manifest` — no
   jobs, no ingestion. Nothing writes `calendar_events`, so the page is **always empty**. Nav entry
   comes from `calendar/src/manifest.ts` (`id: "calendar"`, `order: 35`).
2. **Email page** (`apps/web/src/email/email-page.tsx`) — same shape, same story: no sync engine in
   `packages/email/src/`, **always empty**. Nav from `email/src/manifest.ts` (`id: "email"`, `order: 40`).
3. **Chat Facts panel** (the "What Jarvis knows about you" section of
   `apps/web/src/chat/memory-panel.tsx`, the drawer opened from `chat/chat-drawer.tsx`). The facts
   list is driven by `chat_memory_facts`, populated only by `handleExtractFactsJob` —
   **confirmed no-op** (`packages/chat/src/jobs.ts:104-111`: TODO, returns immediately). So the panel
   **always shows "No facts stored yet."** (The *Recall* toggle and recall feature ARE real — Phase 3
   Recall landed; only the **facts extraction** half is stubbed.)
4. **Legacy connector token-paste form** — `CreateConnectorForm` in
   `apps/web/src/connectors/connectors-panel.tsx:104-189`, default `{"accessToken":"placeholder"}`
   textarea. This is dev scaffolding that sits **right next to the real per-user OAuth flow**
   (`connect-google-panel.tsx`, M-B1, fully functional). Pasting a placeholder token creates a junk
   connector account with no real credential.
5. **AI provider `{"apiKey":"placeholder"}` panel** — `CreateAiProviderForm` in
   `apps/web/src/ai/ai-settings-panel.tsx:118-226`, default credential textarea `{"apiKey":"placeholder"}`.
   **Nuance:** unlike calendar/email/facts, the AI provider+model backend is **REAL** (M-A3 — provider
   CRUD, capability routing, encrypted credentials all work). The problem here is **not "no backend"**;
   it is a crude raw-JSON dev affordance with a misleading placeholder default, next to the real flow.

## Goals

- No surface presents working UI for a feature with no backend. Calendar, Email, and the Facts panel
  are clearly marked **"coming soon"** (honest empty state), not silently-empty.
- No **placeholder-token** entry points visible to end users: the legacy connector token-paste form is
  removed; the AI provider credential affordance no longer ships a `placeholder` secret default.
- `pnpm verify:foundation` green; `pnpm test:e2e` updated where it asserts removed/changed UI.

## Non-Goals

- **Do not build the real backends** (calendar/email sync engine, fact extraction) — those are Phase 3.
- **Do not remove the real flows:** the Google OAuth panel (`connect-google-panel.tsx`) and the real
  AI provider/model CRUD stay. The AI **Recall** memory toggle stays (it is real).
- No new feature flag *infrastructure* unless Open Decision 2 chooses it.

## Resolved Decisions (already decided)

- **Real versions are Phase 3+**, per epic #46 / roadmap — so the honest state is "coming soon", not
  "removed forever", for the no-backend product surfaces (calendar, email, facts).
- **AI provider backend is real (M-A3)** — so the AI credential entry is a UX/scaffolding cleanup, not
  a disable. (Memory `settings-add-provider-flow`: target UX is "Add Provider → pick → Test", not
  raw-JSON paste.)

## Open Decisions — NEED BEN (disable / coming-soon / remove, per surface)

Per-surface recommendation (confirm each):

| Surface | Recommendation | Why |
| --- | --- | --- |
| **Calendar page** | **Coming-soon state, keep nav** | Backend arrives Phase 3; keep the route + nav so the user knows it's planned. Replace body with a "Coming soon — calendar sync arrives in Phase 3" panel; keep the data query only if you want it to auto-light-up later (Decision 2). |
| **Email page** | **Coming-soon state, keep nav** | Same as Calendar. |
| **Chat Facts panel** | **Coming-soon within the existing panel** | Keep the Memory panel + Recall toggle (real). Replace the "What Jarvis knows about you" facts list with a "Coming soon — Jarvis will remember facts in Phase 3" note; **disable the "Remember facts about me" toggle** (it controls a no-op). |
| **Legacy connector token-paste form** | **REMOVE** | Pure dev scaffolding superseded by the real OAuth panel; a placeholder-token path that creates junk accounts. No coming-soon — the real replacement already ships. |
| **AI `{"apiKey":"placeholder"}` default** | **Fix, not remove** | Backend is real. Minimum: drop the `placeholder` secret default → empty/`{}` with a non-secret placeholder hint. (Optional, larger: replace raw-JSON with a labeled API-key field — likely its own Phase-2/3 polish task, out of scope here.) |

**NEED BEN — the two genuine forks:**

1. **Facts toggle: disable vs hide?** Recommend **disable + "coming soon" caption** (keeps the
   feature discoverable). Alternative: hide the facts section entirely until Phase 3.
2. **Coming-soon mechanism: render-state vs route-removal vs feature flag?**
   Recommend the **simplest honest option: a render-state swap** (the page/section renders a
   `ComingSoon` panel instead of the live UI) with **no new flag infra** — the surfaces are statically
   not-ready, so a runtime flag adds machinery for no benefit. Keep nav entries (so the roadmap is
   visible). Reject route-removal (loses discoverability) and a feature-flag system (over-engineered
   for a known-static state). Confirm you don't want the nav entries hidden too.

## Approach (concrete files + changes)

- **Add a small shared `ComingSoon` component** (e.g. `apps/web/src/shell/coming-soon.tsx` or reuse the
  existing `empty-state` styling) rendering an icon + "Coming soon" + one line of context. One
  component, reused by all three surfaces (keeps it DRY, ~30 lines).
- **`apps/web/src/calendar/calendar-page.tsx`** — replace the live `task-list`/query body with
  `<ComingSoon title="Calendar" note="Calendar sync arrives in Phase 3." />`. Keep the page heading.
  Drop the now-unused `useQuery`/`listCalendarEvents` import to satisfy lint (or keep query disabled —
  see Decision 2; recommend remove for honesty + clean lint).
- **`apps/web/src/email/email-page.tsx`** — same treatment.
- **`apps/web/src/chat/memory-panel.tsx`** — keep the Recall toggle + section; replace the facts list
  (`memory-facts` section) with a coming-soon note; disable the "Remember facts about me" checkbox
  (add `disabled` + a "coming soon" hint). Leave `getMemoryFacts`/`deleteMemoryFact` wiring untouched
  in `client.ts` (no dead-code churn needed; just stop rendering the list).
- **`apps/web/src/connectors/connectors-panel.tsx`** — **delete `CreateConnectorForm`** and its mount
  at the "Connector Accounts" panel; the panel keeps the real account **list** (revoke/activate are
  real) and the real OAuth flow lives in `connect-google-panel.tsx`. Remove now-unused imports
  (`createConnectorAccount`, `parseTokenPayload`, `parseScopes`, related state). Verify no other caller
  of `createConnectorAccount`; if unused, optionally drop it from `client.ts` (confirm).
- **`apps/web/src/ai/ai-settings-panel.tsx`** — change the `credentialPayload` default from
  `'{"apiKey":"placeholder"}'` to `'{}'` (or `''`) and add a non-secret `placeholder=` hint on the
  textarea (e.g. `{"apiKey":"sk-..."}` as a *placeholder attribute*, not a value). Backend untouched.
- **e2e:** update `tests/e2e/*` and any `mock-api.ts` expectations that asserted the calendar/email
  lists, the facts list, or the connector create form. Grep e2e for `calendar`, `email`, `Add connector`,
  `apiKey` and adjust.

## Collision notes

- **⚠️ Touches `apps/web` broadly** (calendar, email, chat, connectors, ai dirs + a new shared
  component + e2e). **Coordinate via herdr before any other agent edits `apps/web`.** Land as one
  cohesive PR to avoid half-honest intermediate states.
- **Independent of #59** (which is manifests + SDK types; no `apps/web` overlap).
- Soft touch on `apps/web/src/api/client.ts` only if removing now-unused `createConnectorAccount` —
  optional; skip if any other surface uses it.

## Exit Criteria (from issue #60 acceptance)

- [ ] Calendar and Email pages render an honest "coming soon" state, not a silently-empty live UI.
- [ ] Chat Facts panel shows "coming soon" for facts and the facts toggle is disabled; the real Recall
      toggle still works.
- [ ] The legacy connector token-paste form (`CreateConnectorForm`, `{"accessToken":"placeholder"}`)
      is removed; no placeholder-token panel is visible to end users.
- [ ] The AI provider credential field no longer ships a `placeholder` **secret value** default;
      the real AI provider/model CRUD still works.
- [ ] No remaining surface presents working UI for a feature with no backend.
- [ ] `pnpm verify:foundation` green; `pnpm test:e2e` green (updated for the changed surfaces).

## Hard Invariants honored

- **Secrets never escape.** Removing the placeholder-token/`apiKey` defaults *reduces* secret-shaped
  surface area; no credential rendering is added. Real OAuth/credential flows (encrypted at rest) are
  untouched.
- **Provider-agnostic AI.** No provider/model is hardcoded; the AI panel keeps requesting capabilities
  via the existing CRUD. The placeholder fix is presentation-only.
- **Module isolation.** All changes are in `apps/web` presentation + e2e; no module internals or
  cross-module imports touched. No backend/API/contract changes.
- **Spec before build.** This document is the gate for #60.
