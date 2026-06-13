# Phase 5: Wellness — the first OPTIONAL module

**Status:** Draft (awaiting review)
**Date:** 2026-06-13
**Owner:** Ben
**GitHub:** Epic issue #50 (Phase 5 · Wellness, milestone #14); ADR 0007 ("enhance Jarvis
understanding of the user", house model), ADR 0009 (module seam; "Wellness is the first real
exercise of the seam").
**Grounded on:** local `main` at the start of this session (settings on per-method DataContextDb,
chat memory-facts migration `0064` is the global high-water mark). **Run `pnpm audit:preflight`
(exit 0) before building.** Record the verified commit at build time.

**Depends on (hard):**

1. **Phase-2 module-enablement seam** — `docs/superpowers/specs/2026-06-12-p2-module-enablement-seam-docking-ports.md`.
   Wellness is the FIRST module to set `required:false` + `supportsUserDisable:true`, so the
   resolver/route-guard/self-service-endpoints from that slice MUST be merged first. Until then,
   Wellness can be built and merged but is effectively always-on (the resolver returns all modules);
   its per-user-disable behavior only becomes real once the seam lands.
2. **Phase-3 briefings** — `docs/superpowers/specs/2026-06-13-phase3-real-briefings-design.md` (the
   `generateSummary` read-tool dispatch in `packages/briefings/src/repository.ts:225-303`) for the
   "Wellness" briefing section. The read-tool seam already exists today, so the briefing section works
   the moment Wellness registers a read tool; Phase-3 only makes the surrounding briefing richer.
3. **Phase-3 scheduler (cron + notifications)** — for ACTIVE medication reminders only. The reminder
   _seam_ is designed here; active reminders are a marked follow-up if the scheduler is absent.

---

## Goal

Ship **Wellness** as a net-new package `packages/wellness/` that **docks via the module-enablement
seam with no core changes beyond one `BUILT_IN_MODULES` registry entry, one generic core
contribution point (the focus-signal provider), and the documented `apps/web/src/app.tsx` page-route
caveat.** It is the first `lifecycle:"user-toggleable"` / `availability.supportsUserDisable:true`,
`required:false` module — the real proof that "a module is just a new package that connects, not
alters" (ADR 0009 §1, epic #50 exit criterion #3).

Wellness enhances Jarvis's understanding of who the user is and helps focus on what matters
(ADR 0007 #1, epic #50 criterion #2) across three components:

1. **Feelings check-ins** — multiple-per-day, timestamped emotion logging via a Feelings-Wheel modal
   (with body sensations and an embedded Jarvis chat to help identify a feeling), persisted to an
   owner-only table, optionally piped into a Jarvis conversation.
2. **Medications** — meds with a research-grounded frequency model (incl. PRN), a today's-schedule
   view, dose logging (taken / skipped / PRN-with-reason), and a designed-but-deferred reminder seam.
3. **Active prioritization** — Wellness derives a daily readiness/energy signal that re-weights the
   "what matters most" focus recommendation, surfaced through **one generic focus-signal contribution
   point** (no Wellness↔Tasks coupling), plus a briefings section and chat recall context.

Exit feeling: _Jarvis knows how I'm actually doing, helps me notice it, and quietly factors my energy
into what it tells me to focus on — and I can turn the whole thing off if I don't want it._

---

## Architecture

Wellness follows the **full-module template** set by `packages/tasks/` (manifest + sql + repository +
routes + tools + web), not the data-only template (`packages/structured-state/`), because it has REST
routes, assistant tools, and a UI. Its registration is one entry in `BUILT_IN_MODULES`
(`packages/module-registry/src/index.ts:101-181`) exactly like every other module: a `manifest`, its
`sqlMigrationDirectories`, `queueDefinitions` (empty until the reminder seam activates),
`registerRoutes`, and (later) `registerWorkers`.

**Why this proves the seam.** Every integration Wellness needs already exists as a declared
contribution point or public API:

- **Nav** auto-renders from `manifest.navigation[]` via `GET /api/modules` →
  `serializeModule` (`apps/api/src/server.ts:332-340`) → `readNavigation` in
  `apps/web/src/shell/app-shell.tsx:206`. Registering the manifest is sufficient for the sidebar
  entry. (Caveat: page routing — see Component 6.)
- **REST routes** register through `registerRoutes(server, deps)` (the `BuiltInRouteDependencies`
  contract, `packages/module-registry/src/index.ts:65-80,91-94`), identical to
  `registerTasksRoutes` (`packages/tasks/src/routes.ts:62`).
- **SQL** is globbed automatically from the module's exported `sqlMigrationDirectory`
  (`scripts/migrate.ts` globs every built-in dir; mirror `tasksModuleSqlMigrationDirectory`,
  `packages/tasks/src/manifest.ts:43`).
- **AI tools** are declared on `manifest.assistantTools[]` with an `execute` handler and surface
  through the in-process MCP gateway and the briefings read-tool dispatch — no extra wiring (ADR
  0009 §2,4).
- **Briefing section** uses the existing read-tool seam: `generateSummary`
  (`packages/briefings/src/repository.ts:225`) resolves a definition's selected tool names against
  `input.moduleManifests` and calls `manifestTool.execute(...)`. A Wellness read tool added to its
  manifest is selectable in a briefing definition with **zero briefings-package changes** (the
  default-case `summarizeUnknownResult`/`displayToolName` already handle unknown tools;
  `repository.ts:383,440`).
- **Chat recall context** uses the existing recall seam: `RecallService.recall(actorUserId)`
  (`packages/chat/src/recall-port.ts:42`) assembles `facts` rendered by `renderMemorySeedBlock`
  (`packages/chat/src/live/recall-seed.ts:49`) into the `<memory>` "What I know about you" block
  injected at session launch (`packages/chat/src/live/chat-session-manager.ts:178-184`). Wellness
  contributes a derived energy-trend fact through a generic recall contributor (Component 5).
- **Per-user enable/disable** is the Phase-2 seam: setting `required:false` +
  `supportsUserDisable:true` on the manifest makes Wellness the first module the resolver can drop for
  an actor, the route guard 404s, and tools vanish — all behaviors already built and tested against a
  _fixture_ manifest in Phase 2. Wellness replaces the fixture with the first real optional module.

**The single justified core change beyond the registry entry** is one generic focus-signal
contribution point (Component 5: a `FocusSignalProvider` type in `module-sdk` + a consumer in the
focus path). It is deliberately generic — **any** module can implement it — so it is a platform seam,
not a Wellness special-case. This is the only edit to a non-Wellness, non-registry, non-app.tsx file.

---

## Components

### 1. Feelings check-ins (data + REST + AI tool + modal UI)

**What it does.** Lets the user log how they feel, multiple times per day, each entry timestamped
(NOT one-per-day). An entry captures: the selected feeling and its full wheel path (core → secondary
→ tertiary), an array of body sensations, an intensity, and a free-text note/context. The UX is a
button that opens a modal containing the Feelings-Wheel; if the user doesn't know what they feel, an
embedded Jarvis chat helps them identify it; after a feeling is selected, a details form collects the
rest; on submit the user can EITHER just-submit OR submit-and-copy-a-summary into a Jarvis
conversation.

**Research grounding — the Feelings Wheel taxonomy (Gloria Willcox, 1982).** The wheel is three
concentric rings that grow more specific outward: **6 core emotions** (Willcox's set — `mad`, `sad`,
`scared`, `joyful`, `powerful`, `peaceful`), each expanding to **secondary** feelings, each expanding
to **tertiary** feelings (~72 leaf feelings total). Sources:
[The Feeling Wheel — Gloria Willcox, 1982 (SAGE)](https://journals.sagepub.com/doi/abs/10.1177/036215378201200411),
[Willcox 1982 original (PDF)](https://thefeelingswheel.com/wp-content/uploads/2024/09/willcox1982_feelingswheel.pdf),
[Cleveland Clinic — What Is the Feelings Wheel](https://health.clevelandclinic.org/feelings-wheel),
[Neurodivergent Insights — The Feelings Wheel](https://neurodivergentinsights.com/the-feelings-wheel/).
The taxonomy ships as a **static TypeScript constant** in the wellness package (`feelings-wheel.ts`),
shape `{ core: string; secondary: { name: string; tertiary: string[] }[] }[]`. It is reference data,
NOT a DB table (the user does not edit the wheel; only their selections are stored). The component
records the wheel _version_ in the entry's metadata so a future wheel revision does not retroactively
mislabel old entries.

**Research grounding — body sensations / interoception list.** To help identify emotions, the modal
offers a short curated interoception checklist (a "body check" list). Grounded in interoception
research: temperature changes, "butterflies"/fluttering stomach, lump in the throat, muscle tension
(clenched jaw, stiff shoulders), sweating/dry mouth, racing heart, heaviness/fatigue, shallow
breathing, restlessness — recognizing and labeling these (emotional granularity) aids regulation.
Sources:
[Interoception (Simply Psychology)](https://www.simplypsychology.org/interoception.html),
[Interoception and the Body Chart Checklist](https://neuronsandsalads.wordpress.com/2016/09/13/interoception-and-the-body-chart-checklist/),
[Interoception and Mental Health: A Roadmap (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6054486/).
This list also ships as a static constant (`body-sensations.ts`), not a table; the user's _selected_
sensations are stored as a `text[]` on the entry.

**Data — `app.wellness_checkins`** (owner-only; new module-owned table). Columns:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE`
- `checked_in_at timestamptz NOT NULL DEFAULT now()` — the timestamp; **multiple rows per day are
  expected** (no per-day unique constraint, unlike `app.preferences`'s `UNIQUE(owner,key)`).
- `feeling_core text NOT NULL` — one of the 6 cores (CHECK against the enum below).
- `feeling_secondary text NULL`, `feeling_tertiary text NULL` — the wheel path (secondary/tertiary
  optional, so a user can stop at "scared" without drilling in).
- `wheel_version text NOT NULL DEFAULT 'willcox-1982'` — provenance of the taxonomy used.
- `sensations text[] NOT NULL DEFAULT '{}'` — selected interoception labels.
- `intensity smallint NULL CHECK (intensity BETWEEN 1 AND 5)` — optional self-rated intensity.
- `note text NULL` — free-text context.
- `identified_via text NOT NULL DEFAULT 'wheel' CHECK (identified_via IN ('wheel','assisted'))` —
  whether the user picked directly or used the in-modal Jarvis chat. (Metadata only; the chat
  transcript is NOT stored here.)
- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`.
- Use an `app.wellness_feeling_core` ENUM created with the `DO $$ ... EXCEPTION WHEN duplicate_object`
  idempotent guard (mirror `app.entity_type`, `packages/structured-state/sql/0031_structured_state.sql:17`).
- Index: `wellness_checkins_owner_time_idx ON app.wellness_checkins(owner_user_id, checked_in_at DESC)`
  (the dominant query is "recent check-ins for the owner").

**How it's used.**

- REST (mirror `registerTasksRoutes`, all under `resolveAccessContext` + `withDataContext`):
  - `POST /api/wellness/checkins` — create a check-in (owner-scoped).
  - `GET /api/wellness/checkins?since=<ISO>&limit=<n>` — list the actor's recent check-ins.
- AI read tool `wellness.recentCheckIns` (read; permission `wellness.view`) — returns recent
  check-ins for briefings + chat. This is the briefing-section seam (Component 4) and the energy-signal
  source (Component 5).
- New shared DTOs + route schemas in a new `packages/shared/src/wellness-api.ts` (mirror
  `packages/shared/src/*-api.ts`; the file is browser-bundled, so **no `node:*` imports** — see the
  Shared Browser Bundle memory).

**Modal UX + the `FeelingsWheel` reusable component.** A `FeelingsWheel` React component
(`apps/web/src/wellness/feelings-wheel.tsx`) renders the static taxonomy as a selectable wheel
(core → secondary → tertiary drill-in). The check-in modal (`feelings-checkin-modal.tsx`) composes:

1. The `FeelingsWheel` for direct selection, with the body-sensations checklist alongside to help
   identify the feeling.
2. An **"I don't know what I feel" affordance** that opens an **embedded Jarvis chat inside the
   modal**, reusing the existing live-chat path. Reuse `sendChatTurn` (`apps/web/src/api/client.ts:248`)
   and the SSE stream hook `useChatStream` (`apps/web/src/chat/use-chat-stream.ts`) — the embedded
   chat is a thin reuse of the chat-drawer machinery, NOT a second engine. The MCP/confirm path is
   unchanged (the chat already runs through the gateway). The user converses, lands on a feeling, and
   the modal pre-selects it on the wheel.
3. After a feeling is selected, a **details form** collects sensations, intensity, and a note.
4. On submit, two buttons: **Save** (POST the check-in, close) and **Save & discuss** — POST the
   check-in, then **copy a check-in summary into a Jarvis conversation** via the chat drawer seam
   (Component 7).

**Depends on:** `@jarv1s/db` (`DataContextDb`, `assertDataContextDb`), `@jarv1s/module-sdk`,
`@jarv1s/shared`, `fastify`; the static taxonomy/sensation constants (in-package); the chat drawer +
`sendChatTurn`/`useChatStream` (existing public web surfaces).

### 2. Medications (data + REST + AI tool + UI; reminder seam designed, active reminders deferred)

**What it does.** Lets the user add/edit medications with a frequency model, view today's schedule,
and log doses (taken / skipped / PRN-with-reason). Scheduled reminders are a designed seam, gated on
the Phase-3 scheduler.

**Research grounding — how established med trackers model meds.** Medisafe / MyTherapy / Round Health
model a medication as **name + dosage + form + a frequency type + schedule times**, and dose events
as **taken / skipped / PRN-with-reason + timestamp**. Consumer apps converge with the clinical FHIR
`Dosage`/`Timing` model: `timeOfDay` arrays (e.g. "06:00, 12:00, 18:00"), a `frequency`/`period` for
"N times per N hours/days", `dayOfWeek` for specific weekdays, and an `asNeeded` boolean +
`asNeededFor` reason for PRN. Sources:
[MyTherapy](https://www.mytherapyapp.com/),
[Medisafe](https://medisafe.com/),
[FHIR Dosage (v5.0.0)](http://hl7.org/fhir/dosage.html),
[FHIR Dose syntax — frequency & period](https://nhsconnect.github.io/Dose-Syntax-Implementation/dosage-doseQuantity-freq-period.html),
[Best medication reminder apps (SingleCare)](https://www.singlecare.com/blog/best-medication-reminder-apps/).

This grounds the frequency model as a **discriminated `frequency_type`** with type-specific fields,
covering the six locked types: once-daily, N-times/day, specific weekdays, every-N-hours, as-needed
(PRN), and cyclical.

**Data — `app.medications`** (owner-only). Columns:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE`
- `name text NOT NULL CHECK (length(btrim(name)) > 0)`
- `dosage text NULL` — free text (e.g. "50 mg"); a structured `dose_quantity`/`dose_unit` pair is a
  future refinement (Out of scope).
- `form text NULL` — e.g. tablet, capsule, liquid, injection (free text; no fixed enum, real-world
  forms are long-tailed).
- `frequency_type text NOT NULL CHECK (frequency_type IN
('once_daily','times_per_day','specific_weekdays','every_n_hours','as_needed','cyclical'))` —
  created via the same idempotent ENUM guard OR a CHECK constraint (CHECK preferred — easier to extend
  without a migration that alters an enum).
- `times_per_day smallint NULL` — for `times_per_day` (e.g. 3).
- `interval_hours smallint NULL` — for `every_n_hours` (e.g. 8).
- `weekdays smallint[] NULL` — for `specific_weekdays`, ISO weekday numbers 1–7.
- `schedule_times time[] NULL` — explicit clock times of day (e.g. `{'08:00','20:00'}`), the
  FHIR `timeOfDay` analog; drives the today's-schedule view and (future) reminders.
- `cycle_days_on smallint NULL`, `cycle_days_off smallint NULL`, `cycle_anchor_date date NULL` — for
  `cyclical` (e.g. 21 on / 7 off, anchored).
- `active boolean NOT NULL DEFAULT true` — soft-disable without losing history.
- `notes text NULL`.
- `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`.
- A CHECK that the type-specific fields are present for their `frequency_type` (e.g.
  `frequency_type = 'every_n_hours'` ⇒ `interval_hours IS NOT NULL`) — keep it readable; over-strict
  cross-field CHECKs are brittle, so validate primarily in the route layer and use CHECKs as a
  backstop for the obvious cases.

**Data — `app.medication_logs`** (owner-only). Columns:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `medication_id uuid NOT NULL REFERENCES app.medications(id) ON DELETE CASCADE`
- `owner_user_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE` — denormalized for a
  simple owner-only RLS predicate (avoids a subquery join in the policy; mirrors how `task_activity`
  carries `actor_user_id`, `packages/tasks/sql/0003_tasks_module.sql:30`). A trigger or insert-time
  CHECK ensures it equals the parent medication's owner.
- `status text NOT NULL CHECK (status IN ('taken','skipped','prn'))` — `prn` = an as-needed dose.
- `dose text NULL` — what was actually taken (may differ from the scheduled dosage).
- `prn_reason text NULL` — required-ish for `status='prn'` (validated in the route layer; "as needed
  for x", FHIR `asNeededFor`).
- `scheduled_for timestamptz NULL` — which scheduled slot this log satisfies (NULL for a pure PRN
  dose); lets the schedule view mark a slot taken/skipped.
- `logged_at timestamptz NOT NULL DEFAULT now()` — when the user recorded it.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- Index: `medication_logs_owner_time_idx ON app.medication_logs(owner_user_id, logged_at DESC)` and
  `medication_logs_med_idx ON app.medication_logs(medication_id)`.

**How it's used.**

- REST: `GET/POST /api/wellness/medications`, `PATCH /api/wellness/medications/:id` (incl. toggling
  `active`); `GET /api/wellness/medications/schedule?date=<ISO date>` (today's computed slots);
  `POST /api/wellness/medications/:id/logs` (log a dose). All owner-scoped under `withDataContext`.
- The schedule computation (`schedule.ts`) is pure logic over `frequency_type` + `schedule_times` +
  the date → an ordered list of `{ medicationId, name, scheduledFor, status }` slots, marking each
  slot taken/skipped from same-day `medication_logs.scheduled_for`. PRN meds appear as a "log as
  needed" affordance, not a fixed slot.
- AI read tool `wellness.medicationAdherence` (read; `wellness.view`) — returns recent adherence
  (scheduled vs taken/skipped over a window) for briefings + the energy signal (Component 5). It
  returns **counts and status**, never a full med list to the AI unless the user's own model needs it
  (privacy posture, Security section).
- Shared DTOs/schemas in `packages/shared/src/wellness-api.ts`.
- UI: an "add/edit medication" form, a today's-schedule list with taken/skipped/PRN log buttons.

**Reminder seam (designed; active reminders deferred to the Phase-3 scheduler).** The manifest
declares a `jobs[]` queue `wellness-medication-reminder` with a **metadata-only** payload
`{ actorUserId, medicationId, scheduledFor, idempotencyKey }` (mirror the tasks deferred-status job,
`packages/tasks/src/manifest.ts:219-226`; metadata-only per the Hard Invariant). A future
`registerWellnessJobWorkers` (mirroring `registerTasksJobWorkers`,
`packages/module-registry/src/index.ts:119`) would, when the Phase-3 native per-definition pg-boss
cron exists (`docs/superpowers/specs/2026-06-13-phase3-real-briefings-design.md` "Scheduling is
native per-definition pg-boss cron"), schedule a reminder per medication slot and, on fire, create a
notification through the existing notifications module's public surface. **Until the scheduler lands,
the wellness `queueDefinitions` is `[]` and no worker is registered** — the schedule view and dose
logging work fully; only proactive reminders wait. This is the explicit STRETCH/follow-up.

**Depends on:** `@jarv1s/db`, `@jarv1s/module-sdk`, `@jarv1s/shared`, `fastify`; (future)
`@jarv1s/jobs` + `pg-boss` + the notifications module's public event API once reminders activate.

### 3. Active prioritization via ONE generic focus-signal contribution point

**What it does.** Wellness derives a daily **readiness/energy signal** from recent check-ins
(intensity + emotional valence of recent feelings) and optionally medication adherence, and that
signal **re-weights the "what matters most" focus recommendation**. The critical constraint
(module-isolation Hard Invariant): **Wellness must NOT import `@jarv1s/tasks` and `@jarv1s/tasks`
must NOT import `@jarv1s/wellness`.** They collaborate only through a generic, core-owned seam.

**The generic seam (the single justified core change).** Add to `@jarv1s/module-sdk` a generic
contribution-point type — a **focus-signal provider** — that **any** module can implement:

```ts
// in packages/module-sdk/src/index.ts (new types; no Wellness-specific naming)
export interface FocusSignal {
  /** Stable id of the contributing module, e.g. "wellness". */
  readonly moduleId: string;
  /** Normalized readiness in [0,1]; 1 = fully ready/energized, 0 = depleted. */
  readonly readiness: number;
  /** Short, non-sensitive human label, e.g. "energy trended low 3 days". */
  readonly summary: string;
}
export type FocusSignalProvider = (
  scopedDb: unknown, // DataContextDb, narrowed by the implementing module (cf. ToolExecute)
  ctx: { readonly actorUserId: string; readonly requestId: string }
) => Promise<FocusSignal | null>; // null = no signal for this actor (e.g. no recent check-ins)
```

A module may declare `readonly focusSignal?: FocusSignalProvider;` on `JarvisModuleManifest`
(`packages/module-sdk/src/index.ts:135`). The consumer is the **focus path**: the focus computation
(today `TaskDriftRepository.getFocus`, surfaced by `taskFocusExecute`,
`packages/tasks/src/tools.ts:93` / `GET /api/tasks/focus`) is NOT modified to import wellness;
instead the **composition root** (`apps/api/src/server.ts` / `module-registry`) collects all
registered manifests' `focusSignal` providers, runs the active ones for the actor (respecting the
Phase-2 enablement resolver — a disabled Wellness contributes no signal), and exposes the aggregated
signals to whatever ranks focus.

Concretely the seam is consumed in ONE place to keep the blast radius minimal: a new generic
`GET /api/focus/signals` platform-or-tasks-adjacent read endpoint (or, preferred, the **briefings
prioritization** + the focus tool's response metadata) returns `FocusSignal[]` for the actor. The
implementation chooses the lightest-touch consumer that satisfies "re-weights focus":

- **Preferred:** the tasks focus tool/route output carries an optional `signals: FocusSignal[]`
  field (additive to the response schema) and a `readinessAdjustedOrder` hint, computed by a generic
  helper in the **consumer** (not in wellness, not in tasks-business-logic) that down-weights or
  caps the focus list when aggregate `readiness` is low (e.g. "energy low → surface fewer, lighter
  tasks"). Tasks does not know _why_ readiness is low; it only consumes a generic number.
- This keeps the rule generic: a future "sleep" or "calendar-load" module could implement
  `FocusSignalProvider` and feed the same consumer with no new code.

**Wellness's implementation of the seam** lives entirely in `packages/wellness/` (`focus-signal.ts`):
a `FocusSignalProvider` that reads recent `wellness_checkins` (+ optional `medication_logs` adherence)
under the passed `scopedDb` and returns a normalized `readiness` + `summary`. Wellness depends only on
`@jarv1s/module-sdk` and `@jarv1s/db` for this — never on tasks.

**Why this is the ONLY generic core change.** It touches exactly two core files: `module-sdk`
(the type + the optional manifest field) and the consumer (the focus path that aggregates providers).
It is defined generically (provider interface, not "wellness readiness"), satisfying ADR 0009 §1
("modules register, never mutate core") — the core gains a new contribution point, not a Wellness
hook. Everything else Wellness needs is an existing seam.

**Depends on:** `@jarv1s/module-sdk` (the new type), `@jarv1s/db`; the Phase-2 resolver (to skip a
disabled provider); the focus consumer (the one core edit).

### 4. Briefings "Wellness" section (existing read-tool seam, zero briefings-package change)

`generateSummary` (`packages/briefings/src/repository.ts:225-321`) builds a briefing by resolving each
of a definition's `selected_tool_names` to a **read** assistant tool from `input.moduleManifests` and
calling `manifestTool.execute(scopedDb, {}, ctx)`. Because Wellness declares
`wellness.recentCheckIns` (and `wellness.medicationAdherence`) as `risk:"read"` tools with `execute`
handlers, a user can add them to a briefing definition and the section renders with **no edit to the
briefings package**. The default formatter (`summarizeUnknownResult` → `displayToolName`,
`repository.ts:403,429`) already handles tools it doesn't special-case. (Optionally, a one-line
`case "wellness.recentCheckIns":` could be added to `displayToolName`/`summarizeToolResult` for a
nicer label, but that is a briefings-package nicety, NOT required, and is the only place Wellness
could touch briefings — kept out of the "core change" count and marked optional.)

**Depends on:** the existing briefings read-tool dispatch; Wellness's manifest `assistantTools`.

### 5. Chat recall context ("energy has trended low 3 days")

The recall seam injects a "What I know about you" block at chat-session launch:
`RecallService.recall(actorUserId)` returns `facts: FactSummary[]`
(`packages/chat/src/recall-port.ts:42-66`), rendered by `renderMemorySeedBlock`
(`packages/chat/src/live/recall-seed.ts:49-82`) into the `<memory>` block submitted before replay
(`packages/chat/src/live/chat-session-manager.ts:178-195`). Today the only fact source is
`ChatMemoryFactsRepository.listActiveFacts` (`packages/memory/src/facts-repository.ts:65`).

Wellness contributes a **derived energy-trend fact** (e.g. "Energy has trended low over the last 3
days") so chat is aware of the user's recent state. Two non-coupling options (the builder picks the
cleaner one against the as-merged Phase-3 recall code; **prefer the generic contributor**):

- **Preferred — a generic recall-context contributor seam:** mirror the focus-signal pattern — a
  small `RecallContextProvider` on the manifest (`(scopedDb, ctx) => Promise<FactSummary[]>`),
  aggregated by `RecallService` alongside `listActiveFacts`. This is a second tiny generic core seam;
  if the builder takes it, it is documented as a generic contribution point (same justification as
  Component 5), and Wellness implements it in-package. _Use this only if it stays generic._
- **Fallback — write a real fact:** Wellness periodically (or on check-in) derives the trend and
  upserts a `category:'profile'` fact via the memory module's public `ChatMemoryFactsRepository`
  (`insertFact`/`supersedeFact`), so the existing recall path picks it up with **no chat/memory core
  change at all**. This keeps the core-change count at exactly one (Component 5) at the cost of
  writing a fact row.

The fact text is short and non-clinical (a trend, not raw feelings/meds) — see the privacy posture.

**Depends on:** `@jarv1s/memory` (public `ChatMemoryFactsRepository`) for the fallback, or the new
recall-context seam for the preferred path; the Wellness check-in data.

### 6. Web app (`apps/web/src/wellness/`) + the documented app.tsx page-route caveat

The Wellness pages (`wellness-page.tsx` — a tabbed Feelings / Medications surface — plus
`feelings-wheel.tsx`, `feelings-checkin-modal.tsx`, `medications-view.tsx`, `medication-schedule.tsx`)
mirror the tasks web patterns (`apps/web/src/tasks/`): React Query for fetch/mutate (`queryKeys`,
`apps/web/src/api/query-keys.ts`), the typed client in `apps/web/src/api/client.ts`.

**The documented frontend caveat (the one allowed non-registry frontend edit).** The sidebar nav
entry renders automatically from the manifest, but **page routing is manual**: `apps/web/src/app.tsx`
`<Routes>` (`:85-95`) is a static list, so a `<Route path="/wellness" element={<WellnessPage />} />`
MUST be added there. This is the documented exception ("the app.tsx page-routing caveat") — it is the
known gap between "module registers" and "module fully appears," and is the only `apps/web` edit
beyond the new `wellness/` directory and the typed client additions.

**Nav-visibility-when-disabled gap (call out explicitly).** `GET /api/modules`
(`apps/api/src/server.ts:312-318`) currently serializes `getBuiltInModuleManifests()` — the FULL
registered set, NOT the Phase-2 active-filtered resolver (the Phase-2 spec deliberately keeps
`/api/modules` on the full set and on the guard allowlist;
`2026-06-12-p2-module-enablement-seam-docking-ports.md` Components 6, 7). Consequence: if a user
disables Wellness, the route guard 404s its routes and its tools vanish, **but its sidebar nav entry
would still render** unless addressed. Resolution (in scope for this slice, smallest viable):
`/api/modules` (or a sibling `/api/me/modules` already added by Phase-2 self-service) is the source
the shell uses to decide nav visibility — the web shell should render nav from the actor-active set
(Phase-2's `GET /api/me/modules` returns `active` per module). The builder wires the shell's
`readNavigation` to honor `active` (hide disabled modules' nav) rather than expanding the core
`/api/modules` semantics. This is a **web-shell change, not a new core API**, and is required for the
disable UX to be coherent. Documented here as a known integration point, not hidden.

**Taste-sensitive mockup.** The FeelingsWheel modal flow is taste-sensitive. The build produces a
**static HTML/PNG mockup** under `docs/brand/mockups/` (a new directory) showing the modal flow:
(1) wheel + sensations, (2) "I don't know" → embedded chat, (3) details form, (4) Save / Save &
discuss. Ben reviews the mockup in the morning; the actual `FeelingsWheel` component also lands on the
branch (buildable overnight) so review can compare mockup vs real component.

**Depends on:** `@jarv1s/shared` (DTOs), the existing web client/query-key/shell patterns, the chat
drawer seam (Component 7).

### 7. Chat-drawer "copy a summary into a Jarvis conversation" seam

Two places need to push text into a Jarvis conversation: the in-modal "I don't know what I feel"
chat, and the post-submit "Save & discuss." Today the drawer's composer calls
`sendChatTurn(text)` (`apps/web/src/api/client.ts:248` → `POST /api/chat/turn`), and the drawer
open-state (`chatOpen`) + transcript records live lifted in the app shell
(`apps/web/src/shell/app-shell.tsx:48-53`). The seam: lift a small `openChatWith(prompt: string)`
helper to the shell (open the drawer, then `sendChatTurn(prompt)`), or expose the existing
shell-level chat controls to descendants via context. Wellness's "Save & discuss" composes a short,
non-clinical summary string (e.g. "I just logged feeling anxious (intensity 4), with a tight chest.
Help me think through it.") and calls `openChatWith(summary)`. No new chat backend surface — this is
pure web reuse of the existing turn endpoint + drawer state.

**Depends on:** the app-shell chat state, `sendChatTurn` (existing). One small shell helper is the
only addition.

---

## Data flow

**Check-in (write):** modal → `POST /api/wellness/checkins` → `resolveAccessContext` →
`withDataContext({actorUserId})` → `WellnessRepository.createCheckin(scopedDb, input)`
(`assertDataContextDb` first; `owner_user_id = app.current_actor_user_id()`) → row in
`app.wellness_checkins` (RLS owner-only). Optional "Save & discuss" → `openChatWith(summary)` →
`POST /api/chat/turn`.

**Assisted identification (in-modal chat):** "I don't know" → embedded chat reuses `useChatStream` +
`sendChatTurn` → existing live-chat/MCP path (gateway, blocking confirm) → user lands on a feeling →
modal pre-selects it → details form → submit (`identified_via='assisted'`).

**Medication dose (write):** schedule view → `POST /api/wellness/medications/:id/logs` →
`withDataContext` → `WellnessRepository.logDose(scopedDb, {medicationId, status, dose?, prn_reason?,
scheduled_for?})` → row in `app.medication_logs` (RLS owner-only). Schedule view recomputes slot
status from same-day logs.

**Briefing section (read):** scheduled/manual briefing → `generateRun` → `generateSummary` resolves
`wellness.recentCheckIns` from `moduleManifests` → `manifestTool.execute(scopedDb, {}, {actorUserId:
owner, requestId: 'pgboss:<jobId>'|'briefing:<runId>', chatSessionId:''})`
(`packages/briefings/src/repository.ts:263-276`) → recent check-ins summarized into the briefing.

**Recall context (read):** chat session launch → `RecallService.recall(actorUserId)` →
(preferred) recall-context providers incl. Wellness's energy-trend, OR (fallback) Wellness's
`category:'profile'` fact via `ChatMemoryFactsRepository` → `renderMemorySeedBlock` → `<memory>` block
submitted to the engine (`chat-session-manager.ts:182-195`).

**Focus re-weighting (read):** focus request (tool/route) → composition root aggregates active
modules' `FocusSignalProvider`s for the actor (Phase-2 resolver gates which run) → Wellness's provider
reads recent check-ins under `scopedDb` → returns `{readiness, summary}` → generic consumer
down-weights/caps the focus list and attaches `signals[]` to the response. Tasks never imports
Wellness; Wellness never imports Tasks.

**Enablement (the seam's point):** `PATCH /api/me/modules/wellness {disabled:true}` (Phase-2
self-service) → owner-scoped deny row → resolver drops Wellness for that actor → route guard 404s
`/api/wellness/*`, the MCP/REST tool surface drops `wellness.*`, the focus provider is skipped, the
nav hides (web-shell honors `active`). Re-enable = DELETE the row. Other users unaffected (RLS).

---

## Error handling

- **Route layer:** mirror tasks — `try { ... } catch (error) { return handleRouteError(error, reply); }`
  (`packages/module-sdk` `handleRouteError`, used in `packages/tasks/src/routes.ts:95`). Validation
  errors (e.g. unknown `feeling_core`, `status='prn'` without `prn_reason`, `frequency_type` missing
  its required field) → `HttpError(400, ...)` (mirror `packages/tasks/src/routes.ts:84`).
- **AI tool layer:** a failing `wellness.*` read tool degrades the briefing rather than failing the
  whole run — already handled by `generateSummary`'s per-tool try/catch which emits a redacted
  `briefing_tool_failed` log (tool name + error name + 200-char message) and a `tool_failed` summary
  (`packages/briefings/src/repository.ts:279-302`). Wellness must not throw raw health content out of
  `execute`.
- **Focus-signal provider:** a provider that throws or returns malformed data must NOT break focus.
  The consumer wraps each provider in try/catch and treats a failure/`null` as "no signal" (fail
  soft — focus still works without the signal). A provider for a _disabled_ module is never called.
- **In-modal chat:** reuse the chat-drawer error handling (`sendChatTurn` errors surfaced inline,
  `apps/web/src/chat/chat-drawer.tsx:243-247`). If the embedded chat fails, the user can still pick a
  feeling manually on the wheel — the assisted path is additive, never blocking.
- **Reminder seam (when active):** job failures follow pg-boss retry; payloads stay metadata-only so a
  failed/retried job never logs health content.
- **Secrets/health content:** none of these paths put feelings/meds into logs, pg-boss payloads, or
  AI prompts beyond the user's own check-in summary they explicitly chose to discuss. See Security.

---

## Security & invariants

Cites the CLAUDE.md Hard Invariants this slice touches.

- **Private by default / health-data sensitivity (explicit posture).** Feelings and medications are
  among the most sensitive personal data in the system. **All three new tables are owner-only RLS**
  (`owner_user_id = app.current_actor_user_id()` for SELECT/INSERT/UPDATE/DELETE), mirroring
  `app.preferences` (`packages/structured-state/sql/0031_structured_state.sql:141-162`), NOT the
  owner-or-share tasks pattern — Wellness declares **no `shareableResources`**. There is no cross-user
  access path, no admin read path (admins get config power only, not data — No-admin-bypass invariant),
  and `FORCE ROW LEVEL SECURITY` is set so even the table owner role is subject to RLS.
- **Secrets/health content never escape.** Raw feelings/medication content never reaches: frontend
  responses for another user (RLS), logs (the briefings failure log is name+truncated-message only,
  `repository.ts:285-294`), pg-boss payloads (reminder payload is `{actorUserId, medicationId,
scheduledFor, idempotencyKey}` — metadata only, Hard Invariant), or AI prompts **beyond what the
  user's own model needs**. The energy-trend recall fact and the focus-signal `summary` are
  deliberately **derived/abstracted** ("energy trended low 3 days"), not raw entries. The
  `wellness.medicationAdherence` tool returns counts/status, not a full medication list, unless the
  user's own configured model is the consumer (provider-agnostic; the capability router selects the
  user's model — no hardcoded provider, per the Provider-agnostic AI invariant).
- **DataContextDb only.** Every repository method takes `scopedDb: DataContextDb`,
  `assertDataContextDb(scopedDb)` as the first line (mirror `packages/tasks/src/tools.ts:20`,
  `packages/briefings/src/repository.ts:69`); no root `Kysely` handle is introduced; all DB access
  runs under `withDataContext`. The `FocusSignalProvider`/`RecallContextProvider` receive `scopedDb`
  typed `unknown` and narrow it via `assertDataContextDb` (mirrors `ToolExecute`,
  `packages/module-sdk/src/index.ts:39-43`).
- **AccessContext shape.** Wellness constructs `{ actorUserId, requestId }` only — no added fields
  (the permanent shape, `packages/db/src/data-context.ts`; the briefing path already passes exactly
  this, `repository.ts:269-274`).
- **Module isolation (the headline constraint).** Wellness imports NO other module's internals and
  queries NO other module's tables. The Wellness↔Tasks coupling is forbidden and is satisfied by the
  **generic `FocusSignalProvider`** seam (Component 5) — a core-owned contribution point, not a
  cross-module import. The recall context uses either the generic recall-context seam or the memory
  module's **public** `ChatMemoryFactsRepository` API. Briefings/chat consume Wellness only through the
  declared `assistantTools`/recall seams. (`@jarv1s/wellness` `package.json` MUST NOT list
  `@jarv1s/tasks` as a dependency, and vice-versa — assert in review.)
- **Never edit applied migrations / module SQL in the owning module's `sql/`.** Wellness adds NEW
  migration files under `packages/wellness/sql/`, numbered by **global landing order** (the current
  high-water mark across all dirs is `0064_chat_memory_facts_source_thread_idx.sql`; pick the next
  free global prefixes at build time, re-checking because other in-flight slices may land numbers
  concurrently — Fleet Operations: migration numbers are global by landing order). Files live in
  `packages/wellness/sql/`, **never** `infra/postgres/migrations/`. Grants are in-migration
  (`GRANT SELECT, INSERT, UPDATE, DELETE ON app.wellness_* TO jarvis_app_runtime;` — worker grants
  added only if/when the reminder worker needs them), mirroring
  `packages/tasks/sql/0003_tasks_module.sql:93` and `0031_structured_state.sql:71`.
- **Metadata-only job payloads.** The (deferred) reminder queue payload carries only actor/resource
  IDs + idempotency key + the scheduled time — no feelings, no medication content, no notes.
- **Provider-agnostic AI.** The in-modal chat and any AI summarization request capabilities through
  the existing router; Wellness hardcodes no provider/model.

---

## Testing strategy

All integration tests run via Vitest against the `db:up` Postgres (per CLAUDE.md). New suite
`tests/integration/wellness.test.ts` (+ a `pnpm test:wellness` script mirroring `test:tasks`).

- **Check-in CRUD + RLS:** create multiple check-ins same day → all persist (no per-day uniqueness);
  list `since` returns the actor's own only; actor B cannot SELECT actor A's check-ins (RLS owner-only);
  `feeling_core` outside the enum/CHECK → rejected; `wheel_version` recorded.
- **Medications + logs + schedule:** CRUD a med per `frequency_type` (each of the six types);
  schedule computation produces correct slots for `once_daily`/`times_per_day`/`specific_weekdays`/
  `every_n_hours`/`cyclical` and a "log as needed" affordance for `as_needed`; log taken/skipped/PRN;
  `status='prn'` without `prn_reason` → 400; logs are owner-only (RLS); a slot shows taken after a
  matching `scheduled_for` log.
- **AI read tools:** `wellness.recentCheckIns` and `wellness.medicationAdherence` execute under
  `withDataContext`, return owner-scoped data, are `risk:"read"`, and are selectable by a briefing
  definition (assert `generateSummary` renders a section with NO briefings-package change). Assert the
  adherence tool does not leak a full med list when not needed.
- **Focus-signal seam:** Wellness's `FocusSignalProvider` returns `null` with no check-ins, a low
  `readiness` after low-intensity negative check-ins; the generic consumer down-weights/caps focus
  when readiness is low and attaches `signals[]`. **Isolation assertions:** `@jarv1s/wellness` does
  not depend on `@jarv1s/tasks` and `@jarv1s/tasks` does not depend on `@jarv1s/wellness` (grep
  `package.json` deps + `import` statements in CI/test). A _disabled_ Wellness contributes no signal.
- **Recall context:** Wellness's energy-trend reaches the `<memory>` "What I know about you" block
  (assert via the chosen path — recall-context provider aggregated, or a `profile` fact picked up by
  `listActiveFacts`); the fact text is the abstracted trend, not raw feelings.
- **Enablement (the seam exercise — requires Phase-2 merged):** with the Phase-2 resolver/guard,
  `PATCH /api/me/modules/wellness {disabled:true}` → `/api/wellness/*` returns **404** (not 403),
  `wellness.*` tools vanish from the actor's tool surface, the focus provider is skipped, and
  `GET /api/me/modules` shows `active:false`; re-enable round-trips; another actor is unaffected.
  Wellness is the first REAL (non-fixture) module proving the Phase-2 drop paths.
- **Manifest validity:** `required:false`, `supportsUserDisable:true`, `defaultEnabled:true`,
  `compatibility.jarv1s` admits `CORE_VERSION` (Phase-2 compat gate); registered in `BUILT_IN_MODULES`;
  every declared `routes[]` entry corresponds to a registered route (Phase-2 coverage assertion boots
  clean with Wellness present).
- **Web (smoke / Playwright):** the `/wellness` route renders (app.tsx caveat applied); the
  FeelingsWheel selects a path; Save and Save-&-discuss behave; nav hides when disabled.
- **Gate:** `pnpm verify:foundation` green (lint, format, file-size <1000 lines, typecheck,
  db:migrate idempotent, integration) + `pnpm audit:release-hardening` green. No source file >1000
  lines (decompose `wellness-page.tsx`/repository as needed).

---

## Acceptance criteria

1. A net-new package `packages/wellness/` exists (full-module template: `manifest.ts`, `sql/`,
   `repository.ts`, `routes.ts`, `tools.ts`, `index.ts`; `package.json` depends on `@jarv1s/db`,
   `@jarv1s/module-sdk`, `@jarv1s/shared`, `fastify`, `kysely` — and **not** `@jarv1s/tasks`), and
   `@jarv1s/tasks` does **not** depend on `@jarv1s/wellness`.
2. `wellnessModuleManifest` declares `lifecycle:"user-toggleable"`,
   `availability:{defaultEnabled:true, required:false, supportsUserDisable:true}`,
   `compatibility.jarv1s` admitting `CORE_VERSION`, navigation, permissions, routes, and
   `assistantTools` — and is registered as exactly one entry in `BUILT_IN_MODULES`
   (`packages/module-registry/src/index.ts`). It is the first module with `required:false`.
3. New migration(s) under `packages/wellness/sql/` (numbered by global landing order, **not**
   hardcoded, **not** in `infra/postgres/migrations/`) create `app.wellness_checkins`,
   `app.medications`, `app.medication_logs` with the research-grounded schema, owner-only RLS
   (ENABLE+FORCE, owner-only policies mirroring `app.preferences`), indexes, and in-migration grants.
   `pnpm db:migrate` is idempotent. The three tables are added to `JarvisDatabase`
   (`packages/db/src/types.ts`) with table interfaces + `Selectable` exports.
4. **Feelings check-in** end-to-end: `POST/GET /api/wellness/checkins` (multiple-per-day, timestamped,
   owner-only); a `FeelingsWheel` reusable React component renders the Willcox taxonomy
   (core→secondary→tertiary) with the interoception sensation list; the check-in modal supports
   direct selection, an embedded Jarvis chat for "I don't know" (reusing `useChatStream`/`sendChatTurn`),
   a details form, and Save / Save-&-discuss (the latter copies a summary into a Jarvis conversation).
5. **Medications** end-to-end: `app.medications` supports all six `frequency_type`s incl. PRN +
   `schedule_times`; `app.medication_logs` records taken/skipped/PRN-with-reason + timestamp;
   `GET .../schedule` returns today's slots with status; `POST .../logs` logs a dose; all owner-only.
   The reminder queue is declared in the manifest (`jobs[]`, metadata-only payload) but
   `queueDefinitions` is `[]` / no worker is registered until the Phase-3 scheduler exists (deferred).
6. **One generic focus-signal contribution point** is added to `@jarv1s/module-sdk` (a
   `FocusSignal`/`FocusSignalProvider` type + an optional `focusSignal` manifest field), consumed in
   exactly one focus consumer; Wellness implements it in-package; the consumer down-weights/caps focus
   when readiness is low; a disabled or absent provider yields normal focus. Tasks and Wellness do not
   import each other. This is the ONLY generic core change.
7. **Briefings** render a "Wellness" section purely via the existing read-tool seam (`wellness.recentCheckIns`
   selectable in a briefing definition) with **zero** required edits to the briefings package (any
   label nicety is optional and is the only place Wellness may touch briefings).
8. **Chat recall** surfaces a derived energy-trend ("energy trended low N days") in the `<memory>`
   "What I know about you" block via either a generic recall-context seam (documented as generic) or
   the memory module's public `ChatMemoryFactsRepository` — never importing chat/memory internals.
9. **Core-change ledger asserted:** the ONLY files outside `packages/wellness/`, `packages/shared/`
   (new `wellness-api.ts`), `packages/db/src/types.ts` (table types), and `apps/web/src/wellness/`
   that change are: (a) `packages/module-registry/src/index.ts` (the one `BUILT_IN_MODULES` entry +
   imports), (b) `packages/module-sdk/src/index.ts` (the generic focus-signal type + the focus
   consumer), and (c) `apps/web/src/app.tsx` (the `/wellness` `<Route>` — the documented caveat) plus
   the web-shell nav-visibility honoring `active`. The spec lists these explicitly and asserts no
   other core edits.
10. **Per-user disable works** (once Phase-2 is merged): disabling Wellness for an actor 404s its
    routes, drops its tools, skips its focus signal, and hides its nav for that actor only; re-enable
    restores; other actors unaffected. Wellness is the first real (non-fixture) exercise of the
    Phase-2 seam.
11. **Privacy posture holds:** all three tables owner-only RLS (ENABLE+FORCE, no share, no admin data
    read); no feelings/meds in logs, pg-boss payloads, or AI prompts beyond the user's own chosen
    summary and the abstracted trend/readiness; provider-agnostic AI throughout.
12. A static mockup of the FeelingsWheel modal flow exists under `docs/brand/mockups/`; the
    `FeelingsWheel` component lands on the branch for morning review.
13. `pnpm verify:foundation` and `pnpm audit:release-hardening` are green; no source file >1000 lines.

---

## Out of scope / deferred

- **Active medication reminders / notifications** — the _seam_ is designed (metadata-only queue,
  future `registerWellnessJobWorkers`), but firing reminders depends on the Phase-3 native
  per-definition pg-boss cron + the notifications module; deferred until that scheduler is present
  (the explicit STRETCH).
- **Structured dose quantity/unit** (vs free-text `dosage`), drug-interaction warnings, refill
  tracking, pharmacy integration, barcode scan — consumer-app features beyond this slice.
- **Sharing wellness data** with another household user (caregiver view) — deliberately NOT
  shareable; owner-only by the privacy posture. A future caregiver-share would need its own spec +
  RLS classification.
- **Editing/curating the Feelings Wheel taxonomy** — the wheel is static reference data; user-custom
  feelings are out of scope.
- **Symptom/mood journaling beyond the feelings check-in** (e.g. sleep, pain scales) — a future
  Wellness expansion; the focus-signal seam is built generically so such inputs can feed it later.
- **`defaultEnabled:false` (off-by-default) modules** — Phase-2's store is deny-only; Wellness is
  `defaultEnabled:true`. An off-by-default module needs the allow-row extension Phase-2 deferred.
- **Trends/analytics dashboards** (charts over time) — the data supports it; the UI is later.

---

## Open risks

1. **Phase-2 dependency timing.** The per-user-disable behavior is the whole point of Wellness-as-first-
   optional-module, but it only works once the Phase-2 resolver/guard/self-service endpoints are merged.
   Mitigation: build Wellness against the Phase-2 contract; if Phase-2 isn't merged at build time,
   Wellness still ships and works (always-on via the current "all modules" resolver), and the
   enablement acceptance criteria (10) are verified after Phase-2 lands. Sequence Phase-2 first.
2. **Nav-visibility-when-disabled gap.** `/api/modules` serves the full set, so a disabled Wellness's
   nav would persist without the web-shell change to honor `active` (Component 6). If missed, disabling
   Wellness leaves a dead nav link (route 404s). Mitigation: the web-shell `readNavigation` honors the
   actor-active set (Phase-2 `GET /api/me/modules`); covered by acceptance criterion 10 + a web test.
3. **Generic-seam discipline.** The focus-signal (and optional recall-context) seam must stay generic
   ("any module can implement"), not become a Wellness hook — the single justified core change. Risk:
   an implementer special-cases "wellness" in the consumer. Mitigation: the type/field carry no
   Wellness naming; the isolation test asserts no tasks↔wellness import; review checks the consumer
   treats providers uniformly.
4. **Feelings-Wheel taste.** The modal is taste-sensitive and may need iteration. Mitigation: the
   mockup-first flow (criterion 12) gets Ben's eyes before the component is finalized; the component
   lands on the branch so mockup vs real can be compared, and the wheel taxonomy is data-driven so
   restyling doesn't touch logic.
5. **Embedded-chat-in-modal complexity.** Reusing the live-chat path inside a modal (its own session
   vs the global drawer) could entangle session state. Mitigation: reuse `useChatStream`/`sendChatTurn`
   as-is (same per-user engine), treat the modal chat as a transient view onto the same session, and
   keep "assisted" purely additive — if it misbehaves, manual wheel selection always works.
6. **Frequency-model schema rigidity.** The discriminated `frequency_type` + type-specific columns
   could prove too rigid for an exotic schedule. Mitigation: `schedule_times time[]` + free-text
   `dosage`/`form` provide escape hatches; the CHECKs are deliberately light (route-layer validation
   is primary) so adding a frequency type later is a small additive migration, not a rewrite.
7. **Migration-number contention.** Global migration numbers are assigned by landing order; another
   in-flight slice may take the next number. Mitigation: pick the next free GLOBAL prefix at build
   time (current high-water mark `0064`), re-check immediately before commit, and never hardcode early.
8. **Health-data leakage via derived surfaces.** The energy-trend fact and focus `summary` flow into
   AI prompts; a careless implementation could embed raw feelings/meds. Mitigation: the contract is
   abstracted strings only (criterion 11), enforced by review + a test asserting the fact/summary text
   contains no raw entry content.
