# Evening review + evening interview (#213)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/packages/briefings/src/` (`compose.ts` synthesis pipeline + `SYNTHESIS_INSTRUCTIONS`
morning prompt + `TRUST_BOUNDARY`, `schedule.ts` cron-from-targetTime + timezone, `jobs.ts` scheduled/manual
runs), `packages/briefings/sql/0015_briefings_module.sql` (`briefing_run_kind` enum `'manual'|'scheduled'`,
`schedule_metadata.targetTime`), `packages/chat/src/` (live chat engine for the interview).

Un-deferred from epic #213: Tasks/Today/briefings are live and in active use; the end-of-day loop now has
real data and real value. Per the issue: "should not be treated as simply another morning briefing."

## 1. Decision

Two distinct features under the evening-review umbrella, sharing branding but using different engines:

1. **Evening review** — a **scheduled synthesis** (like the morning briefing) that renders a "day in
   review" summary at a user-configurable time (default **19:00 / 7PM**). Shows tasks completed today,
   things still open/slipped, and tomorrow's load. Reuses the briefing engine with a new evening
   prompt + day-reconciliation channels. **Not** just another morning briefing — different inputs,
   tone, and lens.
2. **Evening interview** — a **user-initiated, chat-driven** "prep for tomorrow" conversation.
   Launched from the evening review ("Prep for tomorrow" button) or independently from chat. Uses the
   chat engine, seeded with the day's context, for reflection/planning.

The evening review is the deterministic reconciliation; the interview is the optional conversational
layer. They compose: review first, then optionally reflect.

## 2. Scope split (locked in grilling)

- **This spec:** the **architecture** for both features — schedule defaults, the new briefing
  definition/kind, channel set, the interview's launch + seed, the bridge between them. Plus the
  contracts each reuses.
- **Follow-up micro-spec (`evening-review-content.md`):** the **exact content sections + tone** of
  the evening review synthesis (what "completed today" / "slipped" / "tomorrow's load" mean
  precisely, section headers, length, voice). Flagged for a dedicated content pass because it needs
  real product work — do not implement content from this spec.

## 3. Evening review (scheduled synthesis)

### Schedule

- A **second briefing definition per user**, distinct from the morning one. Same
  `BriefingDefinition` shape, `schedule_metadata.targetTime` defaulting to `"19:00"`,
  `schedule_metadata.timezone` as today. The existing `cronExprFor` + `timezoneFor` in
  `schedule.ts` handle it unchanged.
- User configures the evening review time (and enables/disables the evening review) in the
  **briefings contributed settings surface** (reuses the Module Settings Connector from #474; the
  briefings module already has settings).

### Kind / type

- Add a **`briefing_type`** concept to distinguish morning vs evening. Two options (decide in build):
  - **(a)** Extend the existing `briefing_run_kind` enum with `'morning'`/`'evening'` values — but
    `run_kind` currently means _trigger_ (manual/scheduled), so overloading it muddies the type.
  - **(b)** Add a new `briefing_type` column + enum `'morning' | 'evening'` (migration), keep
    `run_kind` as trigger-only. Cleaner separation. **Recommended.**
- Either way, `compose.ts` selects the prompt + channel-emphasis based on type.

### Channels (day-reconciliation lens)

Same sources as morning (commitments, tasks, calendar, email, vault, chats) but a different
**emphasis** — the evening prompt asks for what _happened/completed_ today, what _slipped/at-risk_,
and what's _rolling forward_ to tomorrow. Morning asks what's coming; evening asks what happened +
what carried. The exact section structure is the follow-up content spec (§2); this spec fixes only
that the channel set is day-reconciliation, not a verbatim reuse of the morning prompt.

### Synthesis

Reuse `composeBriefing`'s pipeline with:

- A **distinct `SYNTHESIS_INSTRUCTIONS_EVENING`** literal prompt (parallel to the existing morning
  one) — exact wording is the content follow-up; this spec fixes that it exists and is a pure literal
  inside the same `TRUST_BOUNDARY` (prompt-injection hardening #316 preserved — no external content
  interpolated into the trusted text).
- The same `TRUST_BOUNDARY` and trusted-instructions construction pattern.

### Delivery

Same as morning: a pg-boss scheduled job produces the briefing, a "Your evening review is ready"
notification fires (mirroring the morning notification in `jobs.ts`), and the review renders in the
briefings surface / Today.

## 4. Evening interview (chat-driven, on-demand)

- **Launch:** a "Prep for tomorrow" button on the evening review (primary entry), plus an
  independent chat entry (chat command / intent like "prep for tomorrow" / "evening review").
- **Mechanism:** starts a chat session **seeded** with the evening review's content (or, if launched
  independently without a review, the day-reconciliation channel data gathered on-demand). The seed
  is injected as the first system/context message — not a tool call.
- **Role:** Jarvis conducts a short reflection/planning conversation ("What went well? What slipped?
  What's the one thing for tomorrow?"). Reuses the chat engine entirely — no new synthesis pipeline.
- **Optional.** The user can read the evening review and never open the interview. The interview is
  not scheduled.

### Interview seed + trust boundary

The seed (day's data) is untrusted external content — it MUST be emitted inside the chat engine's
equivalent of `<external_source>` blocks, exactly as the briefing `TRUST_BOUNDARY` requires for
briefing synthesis. Do NOT interpolate day data into the trusted prompt. Reuse the same trust-boundary
pattern; the interview prompt is a pure literal, the day data is delimited external content.

### Write/approval rules

If the interview proposes actions (create a tomorrow task, reschedule, etc.), it flows through the
**agency action-loop** from #214 — proposals surface as confirmable action-request cards, governed by
the same per-module trust-tier toggles. No special evening-interview write path.

## 5. Architecture summary

```
Evening review (scheduled, ~7PM)
  └─ briefings engine (new evening type/prompt, day-reconciliation channels)
       │
       └─ renders summary + "Prep for tomorrow" button
              │
              └─ Evening interview (user-initiated chat)
                    └─ chat engine, seeded with the review
                          └─ proposals flow through #214 action-loop
```

## 6. Acceptance criteria

- [ ] A user can enable an evening review, set its time (default 19:00), in briefings settings.
- [ ] The evening review renders at the scheduled time as a day-reconciliation synthesis (distinct
      from the morning briefing), with a "Prep for tomorrow" button.
- [ ] "Prep for tomorrow" (and an independent chat entry) launches an evening interview chat seeded
      with the day's data, conducted by Jarvis for reflection/planning.
- [ ] The evening synthesis uses a distinct evening prompt (pure literal) inside the existing
      `TRUST_BOUNDARY` — no external content in the trusted text (prompt-injection hardening intact).
- [ ] The interview's proposed actions (if any) flow through the #214 action-loop + trust-tier.
- [ ] Evening review time is timezone-aware (reuses `timezoneFor`); the interview needs no schedule.
- [ ] Both features live in their owning packages (briefings engine for review; chat for interview),
      not bolted into core.

## 7. Security & invariants

- **Trust boundary preserved.** Evening synthesis prompt + interview seed follow the same
  external-content-delimiting rules as morning briefing (`TRUST_BOUNDARY`, #316). The static-isolation
  test for the morning prompt is extended to cover the evening prompt + interview seed.
- **No new context fields.** Reuses `AccessContext` shape.
- **Metadata-only job payloads.** The evening review scheduled job carries only `{ actorUserId, kind,
briefingType, idempotencyKey }` — no private content (CLAUDE.md invariant).
- **Action proposals governed by #214.** Interview-proposed actions can't bypass the per-module
  trust-tier or the destructive-confirm floor.

## 8. Rollout / blast radius

- `packages/briefings/sql/` — migration adding `briefing_type` column + enum (option b), or extending
  `briefing_run_kind` (option a). Re-run-safe (idempotent `DO $$ … EXCEPTION`).
- `packages/briefings/src/compose.ts` — select prompt by `briefing_type`; add
  `SYNTHESIS_INSTRUCTIONS_EVENING` literal.
- `packages/briefings/src/manifest.ts` + `repository.ts` + `jobs.ts` — second definition per user,
  evening schedule, evening notification copy.
- `packages/briefings/src/settings/index.tsx` — contributed settings surface for evening review
  enable/time (depends on #474 settings-connector).
- `packages/chat/src/` — evening-intent recognition + seeded-session creation (the "Prep for
  tomorrow" launch + independent chat entry).
- Apps/web — "Prep for tomorrow" button on the evening review; chat entry surface.
- `packages/shared/src/*-api.ts` — DTOs/schemas for evening definition + interview seed.

## 9. Out of scope

- **Exact evening review content** (sections, headers, tone, length) — follow-up `evening-review-content.md`.
- Weekly/monthly review cadence (daily only for now, per the morning schedule's scope note).
- Proactive interview prompts (Jarvis nudging "want to prep for tomorrow?" unprompted) — quiet-hours
  - notification-posture work governs this; defer.
- Cross-day trend analysis in the review (today-only reconciliation; trends are Insights territory).
- Recording/archiving interview transcripts beyond the existing chat history (no special persistence).
