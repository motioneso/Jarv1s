# Coordination Run — 2026-07-06-datasets-hardening-fleet

**Date:** 2026-07-06
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `f64fd971-3fad-4880-a2fd-6dbb7aba935e`** (pane `w1:p8S` at time of writing — resolve fresh by label+session, not this pane number).
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; no `security`-tier items in this run.
**Relay threshold:** routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 0

> Externalized coordinator memory. GitHub is the source of truth for spec/issue/board status;
> this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #832 | routine | queued | datasets-chain | — | 832-host-pinning-log | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #833 | sensitive | queued | datasets-chain | — | 833-redirect-headers | — |
| docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md | #836 | routine | queued | datasets-chain | — | 836-redirect-cachekey | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md (module-isolation follow-up, #798) | #834 | sensitive | queued | dep-cycle | — | 834-jobs-settings-cycle | — |
| docs/superpowers/specs/2026-07-04-module-web-registry.md | #835 | routine | queued | settings-ui-scanner | — | 835-scanner-reserved-paths | — |
| docs/superpowers/specs/2026-07-05-sports-editorial-redesign.md | #837 | routine | queued | sports-cleanup | — | 837-sports-postmerge-cleanup | — |

Risk tier basis: #833 and #834 touch a security-adjacent guard path (redirect header handling)
and a module-isolation boundary respectively — no auth/RLS/secrets, so `sensitive` not
`security`, but flagged for an explicit invariant check during QA. All others `routine`.

## Dependency / merge order

- **Parallel group 1 (3 independent worktrees, launch together):** #834, #835, #837 — no shared
  files with each other or with the datasets cluster (confirmed via Opus collision-map subagent).
- **Serialized chain A (1 worktree, one agent, rebase each on prior):** #832 → #833 → #836 — all
  three rewrite `packages/datasets/src/host-pinning.ts` (redirect loop) and/or `client.ts`. Order:
  #832 first establishes the pinning-error taxonomy; #833 then #836 both mutate the same redirect
  loop body, so they land back-to-back on top of it.
- **Merge order:** #834 / #835 / #837 merge independently whenever green (any order). Datasets
  chain merges strictly #832 → #833 → #836 (each PR based on the previous, not on stale main).

## CI waivers

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| <none> | — | — | — | — |

## Outstanding escalations

- [ ] none yet — no blockers, just mid-spawn when relay fired.

## Reaped sessions

- none yet

## Continuation note (relay @ 2026-07-06, context hit 70%)

**Ben approved this manifest and the plan.** Phase 0 fully done (specs confirmed, main CI green,
Opus collision map done — see Dependency/merge order above). Phase 1 (spawn) is IN PROGRESS, NOT
DONE:

**Done:**
- 4 git worktrees created off `origin/main` @ `616b9ed1` (already exist, do NOT recreate):
  - `.claude/worktrees/832-datasets-host-pinning` (branch `832-datasets-host-pinning`) — chain
    worktree, agent will do #832→#833→#836 sequentially per its handoff doc.
  - `.claude/worktrees/834-jobs-settings-cycle` (branch `834-jobs-settings-cycle`)
  - `.claude/worktrees/835-scanner-reserved-paths` (branch `835-scanner-reserved-paths`)
  - `.claude/worktrees/837-sports-postmerge-cleanup` (branch `837-sports-postmerge-cleanup`)
- Handoff docs committed for all 4, at
  `docs/coordination/handoffs/2026-07-06-{832-833-836-datasets-chain,834-jobs-settings-cycle,835-scanner-reserved-paths,837-sports-postmerge-cleanup}.md`.
  Each has spec, tier, coordinator session id, collision notes. Read-only for build agents.

**NOT done yet — successor's first job:**
1. Create the shared agents tab in workspace `w1` (none exists yet — current w1 tabs are
   `Coordinator`/`Claude`/`Terminal`/`GLM`/`agy`, no `agents` tab). Skill: `herdr pane move
   <first-pane> --new-tab --workspace w1 --label "agents"`, or split within it once made.
2. Spawn 4 build agents, one per worktree above, each via `herdr agent start` with
   `--tab w1:<agents-tab> --cwd <worktree-path> --no-focus -- claude --model sonnet
   --permission-mode bypassPermissions "<boot pointing at its handoff doc>"`.
3. Verify each pane started AND says "Sonnet" (bounded read, `--source recent --lines 12`);
   respawn with `--model sonnet` if it booted Opus.
4. Update the Queue table above with each agent's label/pane/branch, status → `building`.

**Separate, non-fleet item to watch (Ben asked explicitly):** pane `w1:p8Y` (label none, worktree
`829-sports-broadsheet`, branch `worktree-829-sports-broadsheet`, model "Fable 5") is an
**already-running, independent** build agent NOT part of this manifest — it was mid gate-fix
("Fixing stale tests… run full gate" → next: "Commit, push, PR, merge to main") with its own
context meter at 79% when last observed. Ben wants status changes surfaced to him. A background
`Monitor` (task `b4dtih4ru`) was polling `herdr pane list` for this pane's `agent_status` — it does
**NOT survive this relay**; re-establish it:
```bash
prev=""; while true; do
  cur=$(herdr pane list 2>/dev/null | python3 -c "import json,sys
d=json.load(sys.stdin)
p=[x for x in d['result']['panes'] if x['pane_id']=='w1:p8Y']
print(p[0]['agent_status'] if p else 'GONE')")
  [ "$cur" != "$prev" ] && echo "sports-broadsheet (w1:p8Y) status: $cur" && prev="$cur"
  sleep 30
done
```
`837-sports-postmerge-cleanup`'s handoff doc already warns that build agent about this other one
running concurrently (both touch sports files, but different scopes) — no action needed there
beyond the watch.

**Explicitly excluded from this run (Ben's call):** sports issues #840/#841/#842/#845 (standings/
headline follow-ups) — do NOT queue these tonight.
