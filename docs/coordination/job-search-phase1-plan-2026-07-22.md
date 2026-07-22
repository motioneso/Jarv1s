# Job Search — Phase 1 Plan (broader & updated) — DRAFT for approval

**Status: PROPOSAL. No feature code and no GitHub issues created yet — spec-before-build
and build-needs-task-issue gates hold.** This is the orchestration plan to review on wake.
Base = the consolidated `build/job-search-broad-discovery` branch (see
`job-search-consolidation-2026-07-22.md`).

## Where we are

Broad discovery (freehire.dev, keyless cross-company search) is **built and verified** — it's
the base branch. It closes the original gap (sources only watched one company ATS board each).
What remains on the *already-built* feature is exit-gating, not building:

- **G1 — AC1 live UAT** (needs Ben): fresh user → onboarding → "Start my search" → real
  freehire matches, no company URL. Assistant-mediated; hermetic harness can't cover it.
  Checklist: `docs/coordination/uat-ac1-job-search-broad-discovery.md`.
- **G2 — full `pnpm verify:foundation`** on a quiet box / isolated gate DB.
- **G3 — push branch + open PR** (Part of #1229, epic #913), record AC1 PASS.
- **G4 — merge to main.**

## Phase 1 scope — the broader, updated job search

Phase 1 evolves the shipped broad-discovery base from "a working broad search" into a fuller
**intelligent job-search surface**. Three candidate workstreams, each needing your call:

### WS-1 — Opportunities surface (the load-bearing decision)
The uncommitted `fix/1203` work restructures the web layer into dedicated **Opportunities list
+ Opportunity detail** screens and a flat onboarding, with `starter-drafts`. This is **Track B**
and it **deletes** the current `onboarding/` subdir the shipped feature extends (**Track A**).

- **Steelman Track A (keep subdir, extend):** already shipped, verified, zero rework; broad
  discovery's onboarding + matches feed work as-is. Lower risk, faster to prod.
- **Steelman Track B (restructure):** a real Opportunities/Detail surface is a materially better
  job-search UX than a flat matches feed — arguably *the* point of "broader & updated." But it's
  9.4k uncommitted lines, unverified, and re-flattening onboarding means re-applying the shipped
  broad-discovery onboarding edits against the new structure.
- **Decision needed:** does phase 1 adopt Track B's Opportunities/Detail restructure? If yes, it
  needs its own spec + task issue, and the broad-discovery onboarding edits get re-implemented on
  the flat structure (the adapters/worker/domain half of broad discovery ports cleanly — it's
  structure-independent). If no, defer Track B; ship Track A.

### WS-2 — Onboarding polish (dev-HITL)
`fix/dev-chat-pdf-regressions` carries onboarding/resume recovery edits (`onboarding/{controls,
index}`, `styles.ts`, `resume.ts`). Candidate folds into Track A onboarding — small, needs a
read-through against the shipped edits (5-way divergent hotspot). Preserved; not yet assessed
line-by-line (deferred to conserve budget / your direction).

### WS-3 — Source breadth beyond freehire
Broad discovery is single-source (freehire.dev). "More broad" could mean adding a second
`JobDiscoveryProvider` (Adzuna Path A and structured-scrape Path B are documented-but-unbuilt
fallbacks in the spec). The provider seam already supports this as mostly-additive work.

## Proposed orchestration (on your approval)

1. **You** decide WS-1 (Track A ship vs Track B restructure) — this gates everything.
2. Close G1–G4 for the shipped base regardless of WS-1 (broad discovery ships).
3. Per WS-1 decision: write the phase-1 spec (`docs/superpowers/specs/`), file the task
   issue(s) under epic #913, then fan out the build.
4. Fold WS-2, scope WS-3.

## Draft issue breakdown (ready to file once scope approved — NOT filed)

- `task`: Close broad-discovery exit gates (AC1 UAT + verify:foundation + PR + merge). Part of #1229.
- `spec`: Phase-1 job-search surface — Track decision + Opportunities/Detail scope. Part of #913.
- `task`: (if Track B) Opportunities/Opportunity-detail screens + flat onboarding restructure.
- `task`: Onboarding dev-HITL polish fold. Part of #913.
- `spec`: (if pursued) Second discovery provider for source breadth.

## Open questions for Ben

1. **WS-1: Track A (ship the verified subdir feature) or Track B (adopt the Opportunities/Detail
   restructure)?** Everything downstream depends on this.
2. Ship broad discovery to prod first (G1–G4) independently, or hold it and ship the whole
   phase-1 bundle together?
3. WS-3 source breadth — in phase 1, or a later phase?
