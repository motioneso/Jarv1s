# Briefing Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add calendar and email briefing-signal derivation plus the matching per-module governance/settings surfaces, without touching command-palette surfaces.

**Architecture:** Keep the existing briefing source seams. `packages/briefings/src/compose.ts` will derive bounded signal objects from existing calendar/email read results and feed those signal summaries into synthesis + `source_metadata`. Calendar and email each get a small preferences API plus a contributed settings pane that edits source inclusion and signal-governance toggles through existing preference storage.

**Tech Stack:** TypeScript, Fastify, React, TanStack Query, Vitest, shared API schemas, existing `app.preferences` KV storage.

---

### Task 1: Briefing Signal Derivation

**Files:**

- Modify: `packages/briefings/src/compose.ts`
- Test: `tests/unit/briefings-compose.test.ts`

- [ ] Add calendar/email signal types, preference readers, and bounded heuristic derivation helpers inside `compose.ts`.
- [ ] Feed derived signal summaries, not raw event/message lines, into the calendar/email sections used for synthesis.
- [ ] Persist `calendarSignals` and `emailSignals` in `source_metadata`, preserving email account ids and calendar event ids.
- [ ] Add unit coverage for signal derivation, inclusion toggles, and account-aware email metadata.

### Task 2: Calendar Governance Surface

**Files:**

- Modify: `packages/calendar/src/manifest.ts`
- Modify: `packages/calendar/src/routes.ts`
- Modify: `packages/calendar/src/index.ts`
- Modify: `packages/calendar/package.json`
- Create: `packages/calendar/src/settings/index.tsx`
- Create: `packages/shared/src/calendar-briefing-settings-api.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] Add a contributed calendar settings surface and calendar briefing-preferences routes/schema.
- [ ] Store/retrieve `calendar.briefing_lookahead_days`, `calendar.signal_suggest_tasks`, `calendar.signal_create_tasks`, `calendar.signal_suggest_time_blocks`, and `calendar.signal_block_time` via existing preferences storage.
- [ ] Let the settings pane edit `calendar.briefings` through the existing source-behavior API and the other toggles through the new calendar preferences API.

### Task 3: Email Governance Surface

**Files:**

- Modify: `packages/email/src/manifest.ts`
- Modify: `packages/email/src/routes.ts`
- Modify: `packages/email/src/tools.ts`
- Modify: `packages/email/src/index.ts`
- Modify: `packages/email/package.json`
- Create: `packages/email/src/settings/index.tsx`
- Create: `packages/shared/src/email-briefing-settings-api.ts`
- Modify: `packages/shared/src/email-api.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] Add a contributed email settings surface and email briefing-preferences routes/schema.
- [ ] Keep REST email DTOs unchanged, but make the assistant-tool output account-aware so compose can preserve `connectorAccountId` without widening unrelated UI surfaces.
- [ ] Store/retrieve `email.signal_create_tasks`, `email.signal_suggest_replies`, `email.signal_draft_replies`, and `email.signal_auto_send` via existing preferences storage.

### Task 4: Verification

**Files:**

- Modify: `tests/integration/calendar-email.test.ts`
- Modify: `tests/integration/briefings-synthesis.test.ts`

- [ ] Add route coverage for calendar/email briefing preference APIs.
- [ ] Add synthesis/integration checks for derived signal metadata where the current suites already exercise briefing composition.
- [ ] Run targeted Vitest coverage for the touched units/integration suites, then run package typecheck or repo verification commands as far as time permits.
