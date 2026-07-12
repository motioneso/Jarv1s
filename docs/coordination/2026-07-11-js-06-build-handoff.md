# Build Handoff — JS-06 Job Search module surface & assistant handoff

**Task issue:** #935 (Part of epic #913). Put `Closes #935` in your PR.
**Task spec (approved):** `docs/superpowers/specs/2026-07-10-job-search-js-06-module-surface.md`.
**Grounded design:** `docs/superpowers/specs/2026-07-10-job-search-module-design.md`.
**Dependency map:** `docs/superpowers/specs/2026-07-10-job-search-task-decomposition.md`.
Read the spec **by section for your current step only** — never the whole thing at once.

## Provenance / rooting

- **Branch:** `feat/js-06-module-surface`, already checked out in THIS worktree, rooted at
  `origin/main` = `9d4589d1` (includes JS-01..JS-05 — module KV domain, truth guard, source
  adapters, monitoring/run-now). Build ON TOP; reuse the job-search contracts, repo methods, and
  the existing job endpoints. Do not re-implement backend that JS-01..JS-05 already shipped.
- You are current with main; nothing else job-search is in flight.

## MODEL — you are FABLE (Ben's scoped exception: Fable is the Job Search builder)

Build on **Fable**. Fable drives the entire Job Search build; Sonnet-tier codes under it. **If you
relay, spawn your successor as Fable**, same worktree/tab.

## Scope (build ONLY this)

- Authored external `Root` UI under `/m/jarv1s.job-search/*`.
- Six-step onboarding progress; profile/resume approval; monitor configuration + health; next due
  time; run-now (prevents duplicate activation, reports queued state without polling); authored
  loading / empty / error / disabled / degraded states using existing JDS tokens/primitives.
- Invoke **#916's one-click editable assistant starter action** for the assistant handoff.
- Read/write ONLY through existing owner-scoped job-search APIs (actor-authenticated, module-gated).

## Risk tier: SENSITIVE

New module surface wired into the shell that consumes a **cross-module** action (#916 assistant
starter). No new migration, no secrets, no network fetch — but it crosses a module boundary, so:

- **Module isolation:** collaborate ONLY through declared public APIs/events. Do NOT import another
  module's internals or query its tables. The #916 assistant action is invoked via its public
  surface — if you can't find a public entry, STOP and escalate `[DESIGN-FORK]`.
- **No contract/payload drift.** If the surface needs a new endpoint, a changed
  `packages/shared/*-api.ts` contract, or a changed job payload shape, that is NOT in scope — STOP
  and escalate `[DESIGN-FORK]` before writing it. (A drifting contract bumps this to security tier.)
- **Owner-only isolation** on everything the surface reads/writes. User A never sees user B's
  monitors/profile. Prove with the existing owner-scoped API — no direct table reads.
- **Fastify response-schema trap:** any field the UI needs from an endpoint MUST be declared in the
  `packages/shared/*-api.ts` response schema (`additionalProperties:false` silently drops undeclared
  fields). Test via `app.inject`, not the service directly.
- **Preserve the authored design system:** serif headings / mono eyebrows / sans body; extend
  `jds-*` + local primitives; raw CSS colors ONLY in `apps/web/src/styles/tokens.css`. Empty/loading
  states use existing authored patterns — no new bespoke card accents (no curved colored left-border).
- **Secrets never escape; provider-agnostic AI; DataContextDb only / VaultContext never raw fs.**

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store).
2. Invoke **`coordinated-build`** end-to-end: verify the spec section + JS-01..JS-05 surfaces against
   THIS branch → draft the plan → **Coordinator approval before writing code** → TDD build →
   **`coordinated-wrap-up`** (PR + report to Coordinator).

## Coordinator routing

- **Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify EXACTLY ONE such
  pane, resolved fresh — never a cached pane number).
- **Coordinator session id:** `58a78927-385c-4b1d-8fa0-94db20255d6f` (authority; label is routing only).
- Tag escalations `[SECURITY]` / `[RLS]` / `[DESIGN-FORK]` / `[CRIT]` for guaranteed routing.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch. `git add` by explicit path — never `git add -A` / `git add .`
  / repo-wide `pnpm format` (other sessions share the tree).
- Never touch `docs/coordination/` beyond reading THIS handoff (coordinator-only; do NOT commit it),
  the project board, milestones, or merge. The Coordinator owns QA + merge.
- No secrets in any doc, payload, log, or prompt.
- Flag spec ambiguity at plan-confirm time rather than guessing.
