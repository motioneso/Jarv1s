# Build Handoff — JS-07 Job Search freshness, deduplication & AI fit bands

**Task issue:** #936 (Part of epic #913). Put `Closes #936` in your PR.
**Task spec (approved):** `docs/superpowers/specs/2026-07-10-job-search-js-07-ranking.md`.
**Grounded plan (ADOPT THIS — already scouted one slice ahead):**
`docs/superpowers/plans/2026-07-11-js-07-freshness-dedup-fit.md` (finalized `948a06ae`; the
worker-`ctx.ai`-in-slice design-fork was already ruled and folded into the plan).
**Design:** `docs/superpowers/specs/2026-07-10-job-search-module-design.md`.
**Decomposition/deps:** `docs/superpowers/specs/2026-07-10-job-search-task-decomposition.md`.
Read the spec/plan **by section for your current step only** — never the whole thing at once.

## Provenance / rooting

- **Branch:** `feat/js-07-freshness-dedup-fit`, already checked out in THIS worktree, rooted at
  `origin/main` = `d8544793` (includes JS-01..JS-06 module surface + News S2). Build ON TOP; reuse
  the job-search contracts, repo methods, `ctx.kv` / `ctx.ai` surfaces, and the JS-04/JS-05 source
  + monitor outputs already live in the tree. Do not re-implement backend JS-01..JS-06 shipped.
- JS-07 depends on JS-03 (truth guard) + JS-05 (monitor run outputs) — BOTH merged into your root.
- Folds **#962 items 1–2** (per the finalized plan — confirm the exact items in the plan's scope
  section; do not expand beyond them).

## MODEL — you are FABLE (Ben's scoped exception: Fable is the Job Search builder)

Build on **Fable**. Fable drives the entire Job Search build; Sonnet-tier codes under it. **If you
relay, spawn your successor as Fable**, same worktree/tab.

## Risk tier: SECURITY

AI fit-band scoring (worker `ctx.ai`) + dedup/freshness over owner-scoped state. This tier gets an
adversarial Opus QA and a posted verdict before merge — build to survive it:

- **Owner-only isolation on ALL JS-07 state.** RLS applies to every actor incl. admin; no
  `BYPASSRLS`. User A never sees user B's opportunities/dedup keys/fit scores. Your test list MUST
  prove cross-owner denial (raw read/update by another owner → 0 rows / `42501`), not just assert.
- **Provider-agnostic AI for fit bands.** Request the capability via the router
  (`resolveModelForService`, capability=json or similar) — NO hardcoded provider/model. The model
  identity in any persisted fingerprint is a hash, never a secret.
- **Secrets never escape.** No connector/AI creds, tokens, or private content into frontend
  responses, logs, pg-boss payloads, exports, or AI prompts. AI prompt inputs = bounded public
  metadata + opaque IDs, UNTRUSTED-labeled; reject unknown IDs. Metadata-only job payloads
  (actor/resource IDs, kind, idempotency key, small params only).
- **Zero migration expected.** JS-07 should be `module_kv` via `ctx.kv` only. If you believe a
  migration is truly needed, STOP and escalate `[DESIGN-FORK]` before writing it — do NOT add a
  migration on your own judgment.
- **Module isolation** (public APIs/events only; no foreign-table reads / internal imports);
  **DataContextDb only / VaultContext never raw fs.**
- **Fastify response-schema trap:** any new emitted field (fit band, freshness age, dedup group)
  MUST be declared in `packages/shared/*-api.ts`; test via `app.inject`, not the service directly.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store).
2. Invoke **`coordinated-build`** end-to-end: **verify the finalized plan's premises against THIS
   branch first** (JS-02 KV domain/keys, JS-03 truth guard, JS-05 monitor outputs, the `ctx.ai`
   fit-scoring surface, dedup key shape) — the plan was grounded before JS-06/News-S2 landed, so
   re-confirm nothing drifted. If a premise broke, escalate `[DESIGN-FORK]` BEFORE coding.
   Otherwise → **Coordinator approval of your adopt-confirmed plan before writing code** → TDD build
   → **`coordinated-wrap-up`** (PR `Closes #936` + report to Coordinator).

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
- No secrets in any doc, payload, log, or prompt. Flag spec/plan ambiguity at plan-confirm time
  rather than guessing.
