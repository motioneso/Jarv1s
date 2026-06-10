# Coordinator v2 — Audit Findings (inputs for the skill rewrite)

Two Fable-5 audits of the dev-coordinator skill family (2026-06-09), grounded in the first real
run. These are the durable inputs for the **coordinator v2 rewrite** (queued for after the Phase-1
security remediation). Fold BOTH into `coordinate` / `coordinated-build` / `coordinated-wrap-up` /
`coordinated-qa` / `relay` + templates.

## A. SAFETY / PROCESS audit

**Thesis:** the skeleton (worktree isolation, externalized manifest, readiness gate, ephemeral heavy
work) is right; the **trust topology** is wrong — one same-model-family check between agent code and
`main`, feeding a coordinator with unilateral merge + "keep moving" bias. Today's security misses were
the predictable output.

**CRITICAL**

- **C1 — Verification is single-shot, same-lens, untiered, evidence evaporates.** Fix: risk-tier every
  spec in the manifest (`routine/sensitive/security`) by content triggers (auth, sessions, tokens, RLS,
  secrets, rate-limit, network-exposed, shared-table migrations); security tier gets an **adversarial
  cross-model** second pass that hunts _what's NOT tested / trust boundaries_; **post every QA verdict
  to the PR** (`gh pr comment`, durable); **no phase closes without a comprehensive integrated review**
  (exit criterion).
- **C2 — Context self-monitoring is known-false but load-bearing, incl. the coordinator.** Fix:
  coordinator **orders** relays on its liveness sweep (push, not hope); trigger on **countable events**
  not felt %; **compaction tripwire** — "if you see a compaction summary in your own context, flush
  manifest + relay immediately, **merge nothing first**."
- **C3 — Red CI checks waivable, no investigation duty.** Fix: all checks green OR a waiver that's
  investigated (proven failing on `main` @ same SHA) + recorded in manifest + **Ben-approved**; a check
  failing twice = stop-the-line + file an issue.

**HIGH**

- **H1 — Coordinator is judge in its own cause; human front-loaded only.** Fix: content-triggers (not
  judgment) → `security`-tier plans/PRs need **Ben's explicit merge sign-off**; auto-merge = `routine`
  only; standing per-merge digest to Ben.
- **H2 — The single-coordinator "lock" is a naming convention, not a lock** (check-then-act on a
  spoofable string). Fix: bind authority to **manifest pane-id**; before EVERY merge re-read the lock
  line + confirm own `HERDR_PANE_ID` matches, else stand down. Label = routing; pane-id = authority.
- **H3 — No spawn-time env validation; fast pre-push checks not mandated.** Fix: verify each agent can
  resolve its skills (else hand it the absolute SKILL.md path — make it a handoff template field);
  prefer fresh `herdr agent start` over pane reuse; mandate `format:check && lint && typecheck` + fresh
  rebase **before every push**.

**MEDIUM:** spec/skill drift on serialized handoffs (amend spec) · failure budget (2 failed QA cycles
→ stop lane, escalate) · manifest currency needs a forcing function + defined commit location +
`qa-failed`/`rework` vocab · `bypassPermissions` fleet + autonomous merge blast radius · exempt
plan-ready + security escalations from caveman mode. **LOW:** parameterize the `Co-Authored-By` model
string · weak relay liveness check · continuation-doc litter · QA needs an explicit fresh worktree.

**Keep:** worktree/branch/DB isolation · manifest-vs-GitHub split · Phase-0 readiness+collision gate ·
ephemeral-QA/lean-coordinator · escalate-don't-decide · the incident→Red-Flags learning loop.

**Top 3:** (1) risk-tiered, evidence-durable verification + human sign-off for security; (2) external
signals replace self-perception (+ compaction tripwire); (3) red checks are stop-the-line.

## B. PERFORMANCE / USAGE audit

**Data:** the run cost ~$359 / 413M tokens; **cache-read ~334M (81%)** = the resident **Opus**
coordinator re-sending its growing context every turn. Output ~5.1M (1%). "You are not paying for work;
you are paying for the coordinator to remember." The Sonnet build fleet is cheap and roughly right.

**CRITICAL**

- **P-C1 — Coordinator is fat AND immortal.** 70% relay threshold is 4× too high. Fix: relay every
  **~80–100k tokens / 2–3 merges**; make the **manifest the working set** (forget aggressively); never
  let plan or verdict **bodies** enter coordinator context (they're on the PR — read a one-line pointer).
- **P-C2 — Opus is wrong for ~90% of coordinator work (mechanical dispatch).** Fix: run the **resident
  loop on Sonnet**; Opus only for Phase-0 collision-mapping + design-fork adjudication. ~>50% of cost.
- **P-C3 — QA re-runs the full `verify:foundation` gate per PR (+ after rebase), duplicating CI 2–4×.**
  Fix: **trust CI for the mechanical gate**; QA spends tokens on review only (`/code-review` +
  `security-review` + exit-criteria); post-rebase re-QA is **diff-scoped via the collision map**.

**HIGH**

- **P-H1 — Every fresh agent reloads the world** (CLAUDE.md + skills + `pnpm install` per worktree;
  relays re-install needlessly). Fix: **share `node_modules` across worktrees** (pnpm store/symlink);
  relay successors **skip install**; hand agents only the specific memories/skills they need.
- **P-H2 — CI round-trips for trivial failures.** Fix: cheap pre-push trio (format/lint/typecheck) +
  rebase before every push (also H3).
- **P-H3 — Chatty Opus-priced liveness sweep** (pane-read output sticks in coordinator context). Fix:
  poll **status not content**; read pane dumps into a throwaway; lengthen tick to 10–15 min.
- **P-H4 — Model tiering unspecified.** Add a `--model` field per role: **Sonnet** coordinator loop ·
  **Opus** for Phase-0 map / fork adjudication · **delete** QA gate-execution (use CI) · **Opus /
  cross-model** for security-tier QA (the one place to spend up — same-lens Sonnet missed the CRITICALs).

**MEDIUM:** gate is on the critical path twice (let CI own gate execution) · concurrency by feel, not a
resource model (tie to host capacity + coordinator burn) · 4+ full-gate runs per PR (drop the author's
wrap-up gate to fast-checks) · keep continuation docs terse.

**Keep:** caveman messaging · compact verdicts · worktree parallelism · ephemeral-heavy-work.

**Top 3 (by $):** (1) Sonnet coordinator loop + relay every ~80–100k / 2–3 merges; (2) stop
re-executing the gate in QA/wrap-up, trust CI, spend QA on review; (3) kill the per-agent reload tax
(shared node_modules, no re-install on relay, cheap pre-push checks).

## Synthesis

The two audits are **complementary, not in tension**: the performance fixes (Sonnet loop, trust CI,
don't retain bodies) **free the budget** that the safety fixes (cross-model security review,
comprehensive phase passes) **spend** — Fable names security-tier QA as the place to spend up and the
resident loop as the place to spend down. v2 should be **cheaper AND more trustworthy** at once.
