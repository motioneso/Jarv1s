# Coordination Run — phase1-dryrun (DRY RUN — Phase 0 only, NOTHING SPAWNED)

**Date:** 2026-06-09
**Coordinator label:** (dry run — not assigned)
**Merge policy:** autonomous-after-verified-QA (coordination mode)
**Context self-handoff threshold:** ~70%
**Epic:** #46 Phase 1 · Foundation Hardening

> Dry run to validate the dependency/collision map + merge order BEFORE any agent is spawned.
> Per the `coordinate` readiness gate, this run is **NOT cleared to launch**: no item has an
> approved spec yet (§ Readiness).

## Readiness gate — BLOCKED (no approved specs)

Strictly, every item needs an approved spec before spawn. Proposed tiering for Ben:

**Needs a real spec / ADR first (data-at-rest, security, or an open design fork):**
- **#52** auth-secret RLS — RLS classification + a dedicated better-auth role vs. documented
  exception. Security-critical; touches data-at-rest. (Pairs with the `rls-shareability` map.)
- **#55** secret-key rotation — crypto envelope format + decrypt-old/encrypt-new + runbook.
  Data-at-rest; a wrong move silently bricks every stored token.
- **#59** "workspace" vocabulary — genuine fork: *remove the vocabulary* vs. *spec real workspace
  scoping* (ADR). Decide the direction before any agent touches manifests.

**Spec-trivial (issue body already is the spec → straight to `coordinated-build` plan):**
- **#51** unit tests in CI · **#53** rate-limiting · **#54** crash-safety + /health ·
  **#56** scheduled backups · **#58** native-build pin · **#60** UI honesty pass.
  (#54 and #57 are borderline — #57 has ADR 0009 already, so a plan may suffice.)

## Collision map (from the issues' own file-touch annotations)

| Hot resource | Specs that touch it | Handling |
| --- | --- | --- |
| `package.json` + `pnpm-lock.yaml` | **#51** (test:unit script), **#58** (onlyBuiltDependencies), **#53** (+@fastify/rate-limit dep) | Serialize MERGES; rebase each on the prior (lockfile conflicts) |
| `apps/api/src/server.ts` (+ worker) | **#54** (handlers/health/pool), **#53** (rate-limit plugin registration) | #54 lands first; #53 rebases |
| `packages/ai` | **#57** (broad: assistant-tools/routes), **#55** (`crypto.ts`, isolated) | Soft — #55 lands first (isolated), #57 rebases |
| Migrations (global order) | **#52** (RLS migration) only | No ordering collision — single migration author. ASSUMES #55 needs no migration (runtime decrypt-old, no re-wrap migration) — confirm |

Everything else (**#56** ops/scripts, **#60** apps/web, **#59** manifests, **#52** db/sql) is
otherwise independent.

## Wave plan (collision-gated concurrency)

**Wave A — launch in parallel (no shared hot files):**
`#56` · `#60` · `#52` · `#54` · `#55` · `#59` · `#51`
→ each first-mover owns its hot file (#54→server.ts, #55→packages/ai, #51→package.json).

**Wave B — launch after the predecessor MERGES (rebased):**
- `#58` after `#51` (package.json/lockfile)
- `#57` after `#55` (packages/ai)
- `#53` LAST — waits on **both** `#51`/`#58` (package.json) **and** `#54` (server.ts); most-constrained.

**Merge order:** Wave A (any order among themselves) → `#58` → `#57` → `#53`.

> Aggressive alternative: launch all 10 at once and gate only the *merges* in the order above.
> Costs more rebasing; only worth it if wall-clock matters more than clean merges. Recommend the
> wave plan unless Ben says otherwise.

## Queue (status as of dry run)

| Spec | Issue | Status | Agent | Pane | Branch | PR |
| --- | --- | --- | --- | --- | --- | --- |
| _none yet_ | #51 | queued (spec-trivial) | — | — | — | — |
| _needs spec_ | #52 | blocked-on-spec | — | — | — | — |
| _none yet_ | #53 | queued (wave B, last) | — | — | — | — |
| _none yet_ | #54 | queued (spec-trivial) | — | — | — | — |
| _needs spec_ | #55 | blocked-on-spec | — | — | — | — |
| _none yet_ | #56 | queued (spec-trivial) | — | — | — | — |
| _needs spec?_ | #57 | queued (ADR 0009 — plan may suffice) | — | — | — | — |
| _none yet_ | #58 | queued (wave B, after #51) | — | — | — | — |
| _needs spec_ | #59 | blocked-on-fork | — | — | — | — |
| _none yet_ | #60 | queued (spec-trivial) | — | — | — | — |

## Open questions for Ben

1. Confirm the spec tiering (which of #51/#53/#54/#56/#58/#60 truly skip a spec).
2. Confirm #55 needs **no** migration (runtime decrypt-old) — if it does, it joins #52 in global
   migration ordering.
3. Wave plan vs. aggressive (launch-all, gate-merges-only)?
4. #59 direction (remove vocab vs. ADR) — decides whether it's a quick mechanical task or a design item.
