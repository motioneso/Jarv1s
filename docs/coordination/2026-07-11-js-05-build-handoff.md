# Build Handoff — JS-05 scheduled monitoring & run-now (#934)

**Task issue:** #934 (Part of epic #913). Put `Closes #934` in your PR.
**Task spec (approved):** docs/superpowers/specs/2026-07-10-job-search-js-05-monitoring.md —
merged to main via approved PR #929. Read it in full; it is short (~53 lines).
**Companion:** the JS-01→JS-04 lanes are all merged (adapters, KV domain+retention, truth guard,
source adapters). Build ON TOP of them — reuse their KV persistence and source-fetch machinery; do
not re-implement.

## Provenance / rooting

- **Branch:** `feat/js-05-monitoring`, already checked out in THIS worktree, rooted at `origin/main`
  = `af318809` (includes JS-04 #933/#959 source adapters + #915 worker capabilities queue/schedule
  machinery). You are current with main; nothing else Job-Search-related is in flight.

## MODEL — you are FABLE (Ben directive: Fable is the Job Search builder)

Build on **Fable**. If you relay, spawn your successor as Fable (`claude --model claude-fable-5`),
same worktree/tab. QA council for Job Search = Opus + Codex + CI (author-independent).

## Risk tier: SECURITY — scheduled network-exposed fetch + external content

JS-05 drives source discovery/monitoring on a schedule and a run-now path. It touches the same
outbound-fetch + external-content surface as JS-04. Build to the security bar; the Coordinator QAs
with a cross-provider council before merge.

- **ZERO migrations.** Job Search persistence is `module_kv` via `ctx.kv` ONLY (established JS-02).
  If you think you need a migration, STOP and escalate `[DESIGN-FORK]` — you almost certainly don't.
- **Idempotent scheduling.** Manifest declares ONE module-prefixed queue ticking hourly; the hourly
  due-check reads IANA tz / local due-time / last-run local-date from KV and NO-OPs unless due.
  ≤1 discovery run per local day. Prove idempotency (double-tick same hour → one run).
- **Run-now = generic authenticated enqueue + platform singleton key** to collapse double-clicks
  into one in-flight run. Reuse the #915 worker-capabilities enqueue/run-now capability — grep for
  it first; do NOT hand-roll a second enqueue path.
- **Metadata-only job payloads** (actor/resource IDs, job kind, idempotency key, small params only).
- **SSRF + prompt-injection defenses** carry over from JS-04's fetch boundary — reuse the safe
  reader, never a second fetcher. External text is untrusted (treat as data, not instructions).
- **Owner-only isolation** on all KV state; no `BYPASSRLS`; prove owner-only with a cross-owner test.
- **Provider-agnostic AI; DataContextDb only / VaultContext never raw fs; module isolation.**
- **Forward-risk #960** (sanitizer strip-then-decode leaves entity-encoded markup as literal text)
  — if JS-05 renders any source `description`, render it as TEXT (React default), do not dangerously
  set HTML, and reference #960.

## Start

1. `[ -d node_modules ] || pnpm install` (worktrees share the pnpm store).
2. Invoke **`coordinated-build`** end-to-end: verify the spec against THIS branch → **grep for the
   #915 enqueue/run-now capability + JS-04 safe reader first** → draft the plan → **Coordinator
   approval before writing code** → TDD build → **`coordinated-wrap-up`** (PR + report to Coordinator).

## Coordinator routing

- **Coordinator label:** `Coordinator` (escalate via `herdr-pane-message`; verify EXACTLY ONE such
  pane, resolved fresh — never a cached pane number).
- **Coordinator session id:** `58a78927-385c-4b1d-8fa0-94db20255d6f` (authority; label is only routing).
- Tag escalations `[SECURITY]` / `[SSRF]` / `[RLS]` / `[DESIGN-FORK]` / `[CRIT]` for guaranteed routing.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch. `git add` by explicit path — never `git add -A` / `git add .`
  / repo-wide `pnpm format` (other sessions share the tree; News S2 Codex build runs in parallel).
- Never touch `docs/coordination/` beyond reading THIS handoff (coordinator-only; do NOT commit it),
  the project board, milestones, or merge. The Coordinator owns QA + merge.
- No secrets in any doc, payload, log, or prompt.
- Flag spec ambiguity at plan-confirm time rather than guessing.
