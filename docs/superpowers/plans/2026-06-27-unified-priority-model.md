# Unified Priority Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified priority model for Jarvis ranking — owner-scoped preference, pure scorer, thin consumers — without creating a cross-source broker.

**Architecture:** Create `packages/priority` with pure scoring logic. Store model in `app.preferences`. Consume from briefings, chat, and future proactive monitoring. Keep scorer deterministic, side-effect free, max 200 candidates.

**Tech Stack:** TypeScript, Vitest, React, TanStack Query, Fastify, shared API schemas, existing `app.preferences` KV storage.

---

### Task 1: Priority Package Foundation

**Files:**

- Create: `packages/priority/src/types.ts`
- Create: `packages/priority/src/scoring.ts`
- Create: `packages/priority/src/index.ts`
- Create: `packages/priority/package.json`
- Test: `tests/unit/priority-scoring.test.ts`

- [ ] Add priority types: `PrioritySource`, `PriorityAnchor`, `PriorityModelPreferenceV1`, `PriorityCandidate`, `PriorityScoreInput`, `PriorityResult`.
- [ ] Implement pure scorer `rankPriorityCandidates()` with the V1 fixed formula: explicit priority weights, overdue/duedate windows, signal types, anchor matching, readiness clamping, banding, tie-breaking.
- [ ] Add validation: max 200 candidates → throw typed error; unknown source/signal types treated neutral; malformed preferences handled by caller.
- [ ] Export types and scorer from index.ts.
- [ ] Add unit coverage for every scoring rule: band thresholds, date windows (today/tomorrow/7d), anchor case-insensitive whole-token matching, readiness clamping, mode differences, muted source capping, tie-break order.

### Task 2: Preference Storage and API

**Files:**

- Create: `packages/priority/src/preferences-repository.ts`
- Create: `packages/settings/src/priority-routes.ts`
- Modify: `packages/settings/src/index.ts`
- Modify: `packages/shared/src/settings-api.ts` (or create priority-specific)
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/priority-model-api.ts`

- [ ] Add `PriorityPreferencesRepository` wrapping `PreferencesRepository` for key `priority.model.v1` with defaults.
- [ ] Add settings routes: `GET /api/me/priority-model` (fetch or default), `PATCH /api/me/priority-model` (validate, upsert).
- [ ] Validate PATCH payload: version=1, mode enum, anchors ≤50, label ≤120 chars, aliases ≤10 per anchor ≤80 chars, weight exact set, mutedSources known only, reject unknown top-level keys.
- [ ] Add shared API schemas for `PriorityModelPreferenceV1`, `PriorityCandidate`, `PriorityResult`.
- [ ] Export from packages/shared.

### Task 3: Settings UI Surface

**Files:**

- Create: `packages/settings-ui/src/priority/index.tsx`
- Create: `packages/settings-ui/src/priority/priority-settings.tsx`
- Create: `packages/settings-ui/src/priority/anchor-editor.tsx`
- Modify: `packages/settings-ui/src/index.ts`

- [ ] Create priority settings pane with mode segmented control (Balanced / Deadline first / Energy protective).
- [ ] Add anchors list: label, kind (project/person/domain/goal/obligation), aliases, weight (-2..+2), enabled toggle.
- [ ] Add muted source checkboxes (tasks/calendar/email/notes/memory/wellness).
- [ ] Wire to GET/PATCH APIs with TanStack Query.
- [ ] Contribute pane to settings registry under label "Priorities".

### Task 4: Briefings Consumer

**Files:**

- Modify: `packages/briefings/src/compose.ts`
- Test: `tests/integration/briefings-synthesis.test.ts`

- [ ] Import `rankPriorityCandidates` and types.
- [ ] After signal derivation, normalize tasks/calendar/email results into `PriorityCandidate[]`.
- [ ] Call scorer with user timezone, focus signals, and model.
- [ ] Use band and reasons to order signals; suppress low-band items when space tight.
- [ ] Respect existing source-behavior policy (disabled sources → no candidates).
- [ ] Add integration check that ordering changes with scorer but disabled sources are still filtered.

### Task 5: Chat Consumer (Contract Only)

**Files:**

- Modify: `packages/chat/src/context.ts` (or relevant cross-tool reasoning file when #525 lands)
- Test: `tests/unit/chat-context.test.ts` (or equivalent)

- [ ] Add scorer import and types.
- [ ] After loading candidates (e.g., cross-tool reasoning results), normalize to `PriorityCandidate[]`.
- [ ] Call scorer; use ranked order for chat context or suggestions.
- [ ] Document that scorer does NOT trigger new source reads; ranks already-loaded candidates only.
- [ ] Add unit coverage for candidate normalization and ranking path.

### Task 6: Verification

**Files:**

- Test: `tests/unit/priority-scoring.test.ts` (extend)
- Test: `tests/integration/briefings-synthesis.test.ts` (extend)
- Test: `tests/integration/settings-api.test.ts` (extend)

- [ ] Run full local gate: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`.
- [ ] Run `pnpm test:priority`, `pnpm test:tasks`, `pnpm test:briefings`, `pnpm test:api`.
- [ ] Verify targeted scenarios: default model ranks overdue P5 above normal gaps; deadline_first ignores low readiness for due-today; energy_protective favors quick/penalizes large at low readiness; anchor weight boost/cap; date-only vs instant comparison; scorer throws on 201+ candidates; muted source caps to low; malformed pref returns defaults; PATCH validates weights/lengths/keys.
- [ ] Verify owner-scoped access: user A cannot GET/PATCH user B's model (RLS).
- [ ] Verify no private data in preferences (no bodies, secrets, payloads).

---

**Handoff verified:** Branch `rfa-526-unified-priority-model`. Risk tier: `sensitive`. Lane database: `jarvis_build_rfa_526_priority`.
