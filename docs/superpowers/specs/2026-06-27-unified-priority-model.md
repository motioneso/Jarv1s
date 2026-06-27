# Unified priority model for Jarvis ranking (#526)

**Status:** Draft
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #526
**Depends on:** existing task priority/focus logic, existing focus-signal provider seam.
**Related follow-ups:** #525 cross-tool reasoning, #527 usefulness feedback signals, #531
restrained proactive monitoring, #536 scheduled recurring briefings.
**Grounded on:** `~/Jarv1s/packages/tasks/src/drift.ts`,
`~/Jarv1s/packages/shared/src/tasks-view.ts`, `~/Jarv1s/packages/module-sdk/src/index.ts`,
`~/Jarv1s/apps/api/src/server.ts`, `~/Jarv1s/packages/briefings/src/signals.ts`,
`~/Jarv1s/docs/superpowers/specs/2026-06-26-calendar-briefing-signals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-26-email-briefing-signals.md`.

## 1. Problem

Jarvis has several local ranking ideas, but not one shared model of what matters:

- tasks have explicit `priority`, due dates, do dates, effort, overdue, at-risk, and focus ranking;
- briefings derive calendar/email signals but rank them with source-specific heuristics;
- wellness/readiness can contribute focus signals;
- chat and future proactive suggestions need to decide which obligation deserves attention first.

Without one shared priority contract, Jarvis can produce flat briefings, inconsistent suggestions,
and chat answers where everything sounds equally important.

## 2. Decision

Add a **unified priority model** as a small shared scoring layer.

V1 has three parts:

1. an owner-scoped, user-editable priority model stored in `app.preferences`;
2. a pure scorer that turns already-loaded source candidates into `PriorityResult`s;
3. thin consumers in briefings, chat context ranking, and future proactive suggestions.

The scorer does not query notes, email, calendar, tasks, memory, or wellness itself. Consumers pass
the candidate items they already loaded. This preserves module isolation and avoids building a
cross-source broker under #526.

## 3. Current Architecture Anchor

Existing ranking seams:

- `TaskDriftRepository.getFocus()` returns overdue plus at-risk tasks, ordered by explicit task
  priority, due date, and effort.
- `groupByPriority()` groups tasks by the existing 1-5 task priority.
- `aggregateFocusSignals()` collects module-provided readiness/focus signals with fail-soft
  behavior and active-module filtering.
- Briefing signal derivation already emits structured email/calendar signal objects with
  `relevanceReasons` and `suggestedActions`.

#526 should reuse those inputs. It should not replace task priority, task focus, briefing signal
derivation, or focus-signal providers.

## 4. Priority Model Preference

Persist one owner-scoped preference key:

```text
priority.model.v1
```

No new database table in V1.

This relies on `app.preferences` being the existing owner-scoped generic JSON preference store. If
the implementation finds a stricter schema than that, stop and add the smallest migration needed to
support this key rather than storing priority data in an unrelated table.

Shape:

```ts
interface PriorityModelPreferenceV1 {
  readonly version: 1;
  readonly mode: "balanced" | "deadline_first" | "energy_protective";
  readonly anchors: readonly PriorityAnchor[];
  readonly mutedSources: readonly PrioritySource[];
  readonly updatedAt: string;
}

type PrioritySource = "tasks" | "calendar" | "email" | "notes" | "memory" | "wellness";

interface PriorityAnchor {
  readonly id: string;
  readonly kind: "project" | "person" | "domain" | "goal" | "obligation";
  readonly label: string;
  readonly aliases: readonly string[];
  readonly weight: -2 | -1 | 0 | 1 | 2;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

Defaults:

- `mode: "balanced"`;
- empty `anchors`;
- empty `mutedSources`.

Semantics:

- `mode` adjusts fixed scoring weights; it is not a per-source permission.
- `anchors` are user-authored hints about what currently matters.
- `mutedSources` lets a user keep a source available while preventing it from raising priority in
  the unified scorer.
- The model stores labels and aliases only. It must not store email bodies, note excerpts, calendar
  descriptions, task descriptions, secrets, tokens, or connector metadata.

## 5. Priority Candidates

Consumers normalize already-loaded source items into candidates:

```ts
interface PriorityCandidate {
  readonly source: PrioritySource;
  readonly title: string;
  readonly summary?: string;
  readonly occurredAt?: string;
  readonly startsAt?: string;
  readonly dueAt?: string;
  readonly doAt?: string;
  readonly effort?: "quick" | "medium" | "large";
  readonly explicitPriority?: 1 | 2 | 3 | 4 | 5;
  readonly signalType?: string;
  readonly relevanceReasons?: readonly string[];
  readonly textForAnchorMatch: readonly string[];
}
```

Rules:

- Candidate construction belongs to the consumer that already owns the source result shape.
- Candidate text is used only for scoring in memory during the request.
- Candidates may carry private text transiently, but no candidate snapshots are persisted by #526.
- Source ids may stay in the consumer's local metadata, but the scorer API does not require raw ids.

## 6. Scoring Contract

Create a pure priority scorer, for example `packages/priority/src/scoring.ts`.

```ts
interface PriorityScoreInput {
  readonly model: PriorityModelPreferenceV1;
  readonly candidates: readonly PriorityCandidate[];
  readonly now: string;
  readonly timeZone: string;
  readonly focusReadiness: readonly { moduleId: string; readiness: number; summary: string }[];
}

interface PriorityResult {
  readonly source: PrioritySource;
  readonly title: string;
  readonly score: number; // 0..100
  readonly band: "critical" | "high" | "normal" | "low";
  readonly reasons: readonly string[];
}

function rankPriorityCandidates(input: PriorityScoreInput): PriorityResult[];
```

The scorer is deterministic and side-effect free.

### 6.1 Score Inputs

V1 may use only these inputs:

- explicit task priority;
- due/do/start time urgency;
- source signal type, such as `needs_reply`, `time_sensitive`, `prep_needed`, or
  `schedule_density_overload`;
- user anchors and aliases;
- focus/readiness values;
- task effort.

Do not use model calls, hidden conversation state, or raw source ids in the scoring formula.

Input limit:

- `rankPriorityCandidates` accepts at most 200 candidates.
- Consumers must pre-filter source results before calling the scorer.
- If more than 200 candidates are passed, the scorer throws a typed validation error; consumers
  catch it and fall back to their existing order.

### 6.2 Bands

Map score to bands:

- `critical`: 85-100
- `high`: 65-84
- `normal`: 35-64
- `low`: 0-34

Consumers may display the band and reasons. They should not expose the raw score unless a debug or
admin view explicitly needs it.

### 6.3 Fixed Formula

Use a small additive formula capped to 0..100:

- explicit task priority: `5 => +30`, `4 => +22`, `3 => +14`, `2 => +6`, `1 => +0`;
- overdue: `+35`;
- due today / starts today: `+28`;
- due tomorrow / starts tomorrow: `+18`;
- due or starts within 7 days: `+8`;
- high-pressure signal types: `needs_reply`, `time_sensitive`, `follow_up_risk`, `prep_needed`,
  `high_stakes_meeting`, `schedule_density_overload` => `+20`;
- medium-pressure signal types: `planning_impact`, `travel_transition_pressure`,
  `usable_open_gap` => `+10`;
- enabled anchor match: `weight * 10`;
- source muted in the model: cap final score at `34`;
- readiness fit:
  - in `energy_protective` mode, readiness below `0.45` gives quick tasks `+8` and large tasks
    `-12`;
  - medium effort is neutral in all modes;
  - in `balanced` mode, readiness below `0.45` gives large tasks `-6`;
  - in `deadline_first` mode, readiness does not lower overdue or due-today items.

Readiness scalar:

- clamp each focus-signal `readiness` to `0..1`;
- if no focus signals are present, use `1.0`;
- otherwise use the minimum readiness across active focus-signal providers. This is conservative:
  one low-readiness signal is enough to make energy-protective mode prefer smaller work.

Anchor matching:

- normalize anchors and candidate text by lowercasing, trimming, and splitting on non-alphanumeric
  boundaries;
- aliases and labels match whole normalized token sequences only, not arbitrary substrings;
- ignore aliases shorter than 2 characters;
- sum all enabled matched anchor weights, then clamp the total anchor contribution to `-20..20`;
- add one reason per matched anchor label, capped at 3 anchor reasons.

Date math:

- `now` must be an ISO instant;
- `dueAt`, `doAt`, `startsAt`, and `occurredAt` may be ISO instants or `yyyy-mm-dd` local dates;
- compare all relative windows after converting into the input `timeZone`;
- date-only values are interpreted as local dates in the input `timeZone`;
- "today" and "tomorrow" use local calendar days, not rolling 24-hour windows;
- "within 7 days" means local day difference `0..7`.

Tie-break order:

1. higher score;
2. earlier target time, choosing `dueAt` first, then `startsAt`, then `doAt`, then `occurredAt`;
3. explicit task priority;
4. lower effort;
5. title ascending.

This formula is intentionally boring. #527 can later use feedback to tune defaults, but V1 should
ship deterministic behavior that is easy to reason about.

## 7. User Editing And Overrides

Add a small priority settings surface:

- route: `GET /api/me/priority-model`;
- route: `PATCH /api/me/priority-model`;
- UI home: settings, label `Priorities`;
- storage: `app.preferences` key `priority.model.v1`;
- permissions: self/owner only.

The `PATCH` route must validate the full payload before storing it:

- `version` must be `1`;
- `mode` must be one of the declared modes;
- `anchors` max length: 50;
- anchor `label` max length: 120;
- each anchor max aliases: 10;
- alias max length: 80;
- `weight` must be exactly `-2 | -1 | 0 | 1 | 2`;
- `mutedSources` may contain only known `PrioritySource` values;
- unknown top-level keys are rejected.

Controls:

- segmented control for mode: Balanced, Deadline first, Energy protective;
- editable anchors list: label, kind, aliases, weight, enabled;
- muted source checkboxes.

Per-item overrides:

- tasks keep using the existing task priority field; do not create a second task-priority override;
- non-task items in V1 can be influenced by anchors or muted source settings only;
- item-specific feedback such as "more like this" or "less like this" belongs to #527.

## 8. Consumer Contract

### 8.1 Briefings

Briefing composition passes derived candidates to the scorer after task/email/calendar signal
derivation and before narrative synthesis.

Use results to:

- choose the top briefing anchor;
- order calendar/email/task signals;
- suppress low-band items when space is tight.

Do not let priority scoring bypass source-behavior policy. If a source is disabled for briefings, it
does not become a candidate.

### 8.2 Chat Answers

Chat may use the scorer only after a chat feature has already loaded candidates, such as #525
cross-tool reasoning. The scorer ranks candidates; it does not trigger new source reads.

### 8.3 Proactive Suggestions

#531 owns proactive monitoring. This spec only defines the scoring contract that future proactive
suggestions may call after they have an allowed candidate set.

## 9. Privacy, Safety, And Auditability

- Priority model preferences are owner-scoped through `app.preferences` RLS.
- No admin private-data bypass.
- No source content is persisted in priority model records.
- Scoring results are computed on demand and are not stored as a new source of truth in V1.
- Logs include metadata only: actor id, request id, candidate count, source counts, duration, and
  error class. Never log candidate titles, summaries, aliases, or source text.
- A muted source affects scoring only; it does not revoke module permissions or erase data.

## 10. Error Handling

- Missing preference: use defaults.
- Malformed preference JSON: ignore it, log metadata only, and return defaults.
- Scorer error in a consumer: fail soft and fall back to the consumer's existing order.
- Focus-signal failure: use the existing fail-soft focus-signal behavior.
- Unknown source or signal type: treat as neutral; do not throw.

## 11. Out Of Scope

- A machine-learned ranking model.
- Automatic priority changes from feedback (#527).
- Proactive monitoring loops (#531).
- Recurring briefing scheduling (#536).
- User-visible provenance cards (#539).
- New cross-source data collection.
- Persisted per-item priority score records.
- Replacing task priority or task focus ranking.

## 12. Acceptance Criteria

- [ ] A user can view and edit one priority model in Settings.
- [ ] The model is stored owner-scoped in `app.preferences` under `priority.model.v1`.
- [ ] The scorer ranks mixed candidates deterministically into `critical/high/normal/low` bands.
- [ ] Existing task priority remains the task-specific override.
- [ ] Briefings consume the scorer after source policy has already selected allowed sources.
- [ ] Chat can consume the scorer for already-loaded cross-tool candidates without triggering new
      reads.
- [ ] Muted sources cannot raise priority but remain otherwise available.
- [ ] No priority model record stores source bodies, secrets, connector metadata, or raw tool
      payloads.
- [ ] User A cannot read or edit user B's priority model.

## 13. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:priority
pnpm test:tasks
pnpm test:briefings
pnpm test:api
```

Targeted tests:

- default model ranks overdue priority-5 tasks above normal calendar gaps;
- `deadline_first` does not downrank due-today items for low readiness;
- `energy_protective` boosts quick work and downranks large work when readiness is low;
- multiple focus signals use the minimum clamped readiness value;
- anchor weight raises and lowers matching candidates;
- anchor matching is case-insensitive, whole-token, and clamps multi-anchor contribution;
- date-only and instant timestamps are compared in the user's timezone;
- scorer rejects more than 200 candidates;
- muted source caps score at `low`;
- malformed preference falls back to defaults without throwing;
- `PATCH /api/me/priority-model` rejects invalid weights, long anchors, unknown sources, and
  unknown top-level keys;
- briefing candidate ordering changes through the scorer but still respects disabled sources;
- owner-scoped API tests for `GET/PATCH /api/me/priority-model`.
