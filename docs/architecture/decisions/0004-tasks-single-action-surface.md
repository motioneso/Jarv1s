# 0004 — Tasks are the single action surface; Commitments, Chores, and Drift are sources and lenses

- **Status:** Accepted
- **Date:** 2026-06-08
- **Context:** Tasks Foundation design. See `docs/superpowers/specs/2026-06-08-tasks-foundation-design.md` and the domain glossary in the repo-root `CONTEXT.md`. Output of a `grill-with-docs` session.

## Decision

A **Task** is the one and only surface the user acts on. Everything that produces something
to do — a manual entry, a chat exchange, a meeting action item, a recurring chore, an
inferred commitment — becomes a **Task**, distinguished only by its `source` (an open
namespaced string) and optional `source_ref`.

Specifically:

- **A "Commitment" is not a separate user-facing concept, surface, table, or milestone.** It
  is simply a Task whose `source` is inferred (e.g. `meeting:*`, `chat`, `commitment`). Any
  counterparty context ("Sarah is waiting") lives in the Task's **description**, not a
  dedicated field. This **reverses** the boundary the shipped `structured-state` module
  asserts in migration `0031` (`-- Commitments … Distinct from Tasks (user-chosen)`).
- **Chores** are a _separate future area_ that automates Task creation by writing through
  the `source` seam; Tasks hold no chore logic.
- **Drift** (on-track → at-risk → slipped) is a **task-level computed query**, not a
  commitment-only lifecycle and not a stored column.

The legacy `app.commitments` table is left in place and untouched; this design neither
imports nor queries it. Whether to retire it is a separate future cleanup.

## Why

The product north-star is to excel for people with **executive-function challenges**. The
deciding test (the user's words): _a chief of staff hands you one unified list — never
"here are your tasks, and separately, your commitments."_ Multiple surfaces for the same
obligation multiply cognitive load, and a secondary surface tends to be abandoned. A single
Task surface, fed by many sources and viewed through optional lenses (Matrix, drift, focus),
is the lowest-overwhelm shape.

Generalizing drift from commitments to **all** tasks is strictly more useful: a self-imposed
"finish the deck" slips exactly like a promise to a person, and the EF user benefits from
the nudge on everything (gated to Medium+ priority to avoid noise).

## Considered Options

- **Keep Commitments as a parallel first-class concept** (the shipped model): rejected — it
  creates the exact double-surfacing the product exists to eliminate, and its only unique
  data (counterparty) is adequately served by the description.
- **Collapse Commitment into Task via a structured `counterparty` field**: rejected — field
  fatigue; the description carries it without forcing the user (or schema) to.
- **Closed enums for `source` / `activity_type`**: rejected — every new source module
  (chores, meetings, connectors) would force a migration to the tasks module, violating
  module isolation. Open namespaced strings let new sources plug in without editing Tasks.

## Consequences

- De-duplication is **structural**: an obligation has exactly one representation (the Task),
  so the briefing and lists cannot show it twice.
- New source modules integrate by writing Tasks with their `source`/`source_ref`/
  `external_key` — no changes to the tasks schema or module.
- The `structured-state` commitments table becomes dormant with respect to Tasks; a future
  decision is owed on retiring or repurposing it.
- Drift and "what's next" are exposed as pure queries (`getAtRisk`/`getOverdue`/`getFocus`)
  that the briefing (M-A4) and a future heartbeat will reuse unchanged.
- The `structured-state` integration suite (`tests/integration/structured-state.test.ts`)
  still asserts commitment CRUD and stays green, so the "retirement" of the concept is **not**
  enforced by tests — a reader must consult this ADR to know commitments are no longer a
  first-class surface.
