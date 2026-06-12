# Coordination Run — 2026-06-11-audit-remediation

**Date:** 2026-06-11
**Coordinator lock:** label `Coordinator` = pane `w653f42bef3ac02-3` (`$HERDR_PANE_ID=p_44`) — RELAY SUCCESSOR claimed 2026-06-12 (predecessor `p_38`/`-2` reaped). Single-coordinator lock — exactly one pane holds this label for the life of the run; agents escalate to the **label** (routing), the coordinator merges only when its own `$HERDR_PANE_ID` resolves to this recorded value (authority). **Pane-ids are VOLATILE (herdr compacts on close) — `$HERDR_PANE_ID=p_44` is the stable authority; re-resolve the numeric pane from `herdr pane list` before any merge.**
**Finding source:** `docs/audits/2026-06-11-fable5-issue-verification.md` — independent Fable 5 verification @ `origin/main e629f3c`, migration head 0052 (22 stand, 8 severity-downgraded to MED/LOW, 0 refuted, 0 already-fixed).
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`. **`security`-tier sign-off DELEGATED to Fable (Ben, 2026-06-12 — "I'm not in a good place to review; have Fable review the security PRs and proceed").** Per security PR: run adversarial QA as a **Fable (`model: 'fable'`) cross-model review** + post verdict via `gh pr comment`; **Fable APPROVE → merge autonomously**; Fable `revise`/`reject` → bounce to build agent, re-QA. Ben gets a per-merge digest (not a gate). Escalate back to Ben only on a genuine design fork Fable can't settle.
**Relay threshold:** security-tier merge → relay immediately; routine/sensitive merges\*since*relay ≥ 2 → relay. No deferral.
**merges_since_relay:** 0 — RESET by relay successor (p_44) 2026-06-12. Predecessor relayed after F/G/I (3 security merges). Next security-tier merge (B #187) → relay again. \_History: F #184 04:34Z, G #186 + I #185 both ~04:40Z under predecessor p_38.*

**Live state (successor p_44, 2026-06-12):** SliceB-build (pane `w653f42bef3ac02-2`, tab :3, alive, `working`) tasked to rebase PR #187 onto current origin/main (e9a4e45) — branch was based on b19f916 (pre-G/I); resolving `foundation.test.ts` (↔I #185) + `structured-state.test.ts` (↔G #186) conflicts, then `--force-with-lease` push + confirm CI green. After green: spawn Fable (`model:'fable'`) security QA → `gh pr comment` verdict → Fable APPROVE → merge `--squash --delete-branch`, close #120/#153/#115/#116/#152, board Done, reap SliceB-build+worktree, **then relay** (security merge).
**Available worker panes (Ben, 2026-06-12):** Coordinator = `w653f42bef3ac02-2` (me). Codex pane = `w653f42bef3ac02-1` = candidate cross-model security-tier QA path. Build agents require an **isolated worktree** + own `JARVIS_PGDATABASE`.

**→ CONTINUATION NOTE (2026-06-12, plans written + Fable-reviewed):** Slices A+C merged/closed. All 7 remaining specs (B,D,E,F,G,H,I) authored + Fable-reviewed + prettier-formatted (035c4d6/7eba4c5). **Ben greenlit the build** ("write up the plans, have Fable review, spin up the agents") — spec-review gate SATISFIED. 7 TDD plans written (`docs/superpowers/plans/2026-06-12-audit-slice-*.md`); Fable adversarial review over all 7 → **all `revise`** (false intermediate-gate expectations; claimed-tested-but-uncaught security tests; fabricated line refs; **+1 spec-level security defect: H #134 chat_messages_update was `USING(true) WITH CHECK(true)` → removes owner-scoping; fixed in spec+plan**). Per-slice fix agents applied Fable's exact FIX text (workflow w78euq8lv). NEXT: format+commit+push the 7 plans → Phase-1 spawn parallel-safe (B,F,G,I) off origin/main; hold D(after B)/E(after D)/H(after B+G) on the spine. **Security-tier merges still need Ben's per-merge sign-off** (build greenlight ≠ merge greenlight). Coordinator @ pane `w653f42bef3ac02-2` / `$HERDR_PANE_ID=p_38`.

**→→ SUCCESSOR CONTINUATION NOTE (2026-06-12 ~04:42Z — RELAY, fresh coordinator picks up here):**
Wave-1 fully resolved: **A, C, F, G, I all MERGED** (PRs #181/#182/#184/#186/#185); all their issues
closed, worktrees/branches/agents reaped, board Done. Migration head after these merges is unchanged
(F/G/I added 0 migrations; G's #99 was app-layer). **YOUR IMMEDIATE WORK, in order:**

1. **B — PR #187, ready for QA+merge (migration spine HEAD, 0056, security tier).** SliceB-build is
   ALIVE at pane `-3` (label `SliceB-build`, status `done`, worktree `.claude/worktrees/audit-slice-b`).
   B edits BOTH shared test files and G+I landed first → **task SliceB-build to rebase on current
   origin/main and resolve `foundation.test.ts` (↔I) + `structured-state.test.ts` (↔G) conflicts**,
   re-push, confirm CI green. THEN spawn Fable (`model:'fable'`) security QA via Agent tool
   (general-purpose + coordinated-qa skill, isolation worktree, bg) — adversarial pass on the DROP
   migration + RLS surface; must `gh pr comment` verdict. Fable APPROVE → merge `--squash
--delete-branch`, close #120/#153/#115/#116/#152, board Done, reap SliceB-build + worktree. This
   is a security merge → **relay again after it.**
2. **D/E/H — still `blocked-on-Ben-review`** (specs written, not yet greenlit to spawn). Do NOT spawn
   until Ben clears them. When cleared: D after B (spine), E after D, H after B (+G, landed). Wave =
   3 agents → render **3×1** in the "Agents" tab (`w653f42bef3ac02:3`) per the grid convention.
3. **Task #8 — update the `coordinate` skill** (still pending): codify (a) all build/QA agents share
   ONE tab named "Agents"; (b) 2×2 for 4-agent waves, 3×1 for 3-agent waves; (c) build agents NEVER
   touch `docs/coordination/` and must scope `pnpm format` to their own paths (see Incident log).
   Ben wants this done "after you orchestrate everything" — i.e. once the build wave settles.
4. **Ben flagged (2026-06-12 ~04:40Z): "agents aren't hitting Enter on messages."** Root cause: agents
   using `herdr agent send` / `pane send-text` (literal text, NO Enter) instead of `herdr pane run`
   (types text + Enter atomically). When you message a pane, use `herdr pane run <pane> "<msg>"` and
   verify with `herdr pane read`; for long msgs send a follow-up `send-keys <pane> Enter`. Consider
   folding this into the task-#8 skill pass (herdr-pane-message skill already documents it — the gap
   is agents not following it).
5. **Pending Q from Ben (unanswered):** "Are we having codex QA?" — default stays Fable. Codex pane is
   `w653f42bef3ac02-1` (idle) if Ben switches.
6. **Session-end housekeeping:** remove plan/spec copies from the obsidian vault (git copy canonical);
   save durable memory for the prettier-discipline lapse + build-agent scope-creep trap + G-off-spine.

Lock NOW: Coordinator = `$HERDR_PANE_ID=p_44` (pane `w653f42bef3ac02-3` at claim time, volatile).
Re-confirm yours matches before any merge.

> Coordinator's externalized memory. Keep CURRENT. GitHub is source of truth for spec/issue/board
> status; this file holds only in-flight operational state.

## Phase-0 gate status

- **CI on `main`:** ✅ green @ 7eba4c5 (verified 2026-06-12)
- **Ben manifest approval:** ✅ approved (Slice A first — 2026-06-11)
- **Ben build greenlight:** ✅ 2026-06-12 ("write up the plans, have Fable review, spin up the agents") — spec-review gate satisfied; security-tier MERGES still need per-merge sign-off
- **Slice A spec/plan:** ✅ merged (PR #181)
- **Remaining slices B–I:** specs ✅ + TDD plans ✅ written + Fable-reviewed (all `revise` → fixes applied 2026-06-12)

## Queue (proposed slices — each needs a spec before it can spawn)

Severity post-Fable. Tier by content trigger (most of this backlog is `security`).

| Slice                                    | Issues                                                                                                                                                  | Tier                               | Adds migration?                                                | Spec                                                                            | Status                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — RLS least-priv migrations**        | #97 users-column UPDATE restriction, #98 worker memory RLS policies                                                                                     | security                           | **yes (×3: 0053+0054+0055)**                                   | `docs/superpowers/specs/2026-06-11-audit-slice-a-rls-least-priv.md` ✅          | **MERGED** PR #181 @ 2026-06-12T00:13:10Z — issues #97 #98 closed, board Done                                                                                                                                                                                                                                                                                                                                                 |
| **B — Dead subsystem deletion**          | #120 workspaces, #153 resource-grants no-op, #115 + #116 (resolved by deletion), fold #152 manifest-narrowing; advances #155/#127/#101 workspace-halves | sensitive→**security**             | **yes (DROP, 0056)**                                           | `docs/superpowers/specs/2026-06-12-audit-slice-b-dead-subsystem-deletion.md` ✅ | **DONE — ready for QA+merge** PR #187 (SliceB-build pane `-3`, alive, status `done`). Rebased on b19f916; VF_EXIT=0 AUDIT_EXIT=0 (366/366 integration + 97 unit). **Migration spine HEAD (0056).** ⚠️ G+I LANDED FIRST → B must rebase BOTH shared test files (`foundation.test.ts` ↔I, `structured-state.test.ts` ↔G) on current origin/main before merge — task SliceB-build to do it. Security-tier → Fable QA then merge. |
| **C — Vault containment**                | #129 actorUserId validation, #130 symlink real-path containment                                                                                         | security                           | no (code)                                                      | `docs/superpowers/specs/2026-06-11-audit-slice-c-vault-containment.md` ✅       | **MERGED** PR #182 @ 2026-06-12T00:13:23Z — issues #130 closed, board Done                                                                                                                                                                                                                                                                                                                                                    |
| **D — Settings → DataContextDb**         | #95 SettingsRepository raw Kysely, #155 /api/me cross-user read                                                                                         | security                           | maybe (grant)                                                  | `docs/superpowers/specs/2026-06-12-audit-slice-d-settings-datacontext.md` ✅    | blocked-on-Ben-review                                                                                                                                                                                                                                                                                                                                                                                                         |
| **E — Auth module hardening**            | #101 module-isolation, #127 bootstrap actor-GUC, #141 OAuth error-body leak (#113 deferred → issue #183)                                                | security                           | no (code)                                                      | `docs/superpowers/specs/2026-06-12-audit-slice-e-auth-hardening.md` ✅          | blocked-on-Ben-review                                                                                                                                                                                                                                                                                                                                                                                                         |
| **F — AI tool-path hardening**           | #132 REST validateToolInput, #119 server-side allowlist, #148 blank ToolContext, #172 tools/list actor-scope                                            | security                           | no (code)                                                      | `docs/superpowers/specs/2026-06-12-audit-slice-f-ai-toolpath-hardening.md` ✅   | **MERGED** PR #184 @ 2026-06-12T04:34Z (sha b19f9165) — Fable APPROVE; issues #119/#132/#148/#172 closed; worktree+branch reaped; board Done                                                                                                                                                                                                                                                                                  |
| **G — Data-layer defense-in-depth**      | #102 assertDataContextDb, #144 vectorSearch owner predicate, #99 structured-state WITH CHECK                                                            | security                           | **no** (#99 = app-layer; 0031 WITH CHECK already owner-scoped) | `docs/superpowers/specs/2026-06-12-audit-slice-g-datalayer-defense.md` ✅       | **MERGED** PR #186 @ ~2026-06-12T04:40Z — Fable APPROVE (migration claim VERIFIED by direct read of 0031: WITH CHECK present at claimed lines); issues #102/#144/#99 closed; worktree+branch+agent reaped; board Done                                                                                                                                                                                                         |
| **H — Migration/job infra**              | #124 schema_migrations per-dir, #134 worker dead grant REVOKE, #135 incognito trigger, #157 metadata-only payload guard, #174 pgboss RLS                | security/sensitive                 | **yes (×2 versioned + 1 grants file)**                         | `docs/superpowers/specs/2026-06-12-audit-slice-h-migration-job-infra.md` ✅     | blocked-on-Ben-review                                                                                                                                                                                                                                                                                                                                                                                                         |
| **I — Portability + observability tail** | #170 export omits private, #149 handleRouteError, #140 list ownership, #166 test hygiene (LOW)                                                          | sensitive/routine→**security-bar** | no (code)                                                      | `docs/superpowers/specs/2026-06-12-audit-slice-i-portability-tail.md` ✅        | **MERGED** PR #185 @ ~2026-06-12T04:40Z — Fable APPROVE (#170 secret/derived-column audit CLEAN; owner-scoped double-guard); issues #170/#149/#140/#166 closed; worktree+branch+agent reaped; board Done. Non-blocking follow-up: breakdown.ts parent-visibility-not-ownership (same class as #140, pre-existing)                                                                                                             |

Not yet sliced: the aggregate `MED/LOW findings —` batch issues (#104–#111, #114, #117, #122–#171 even, #156…) — a later backlog pass after the HIGH/MED individual findings land.

## Dependency / collision map

**Dominant constraint: migration numbers are global, assigned by landing order** — every
migration-adding slice must land in a fixed sequence. No two migration slices spawn in parallel
without a pre-assigned number, and a serialized slice must NOT assume its number until its
predecessor merges.

- **Serialized migration spine (merge order):** **A → B → D(if migration) → G(#99) → H**.
  Each waits for its predecessor to land before its migration number is real.
- **Parallel-safe (code-only, distinct modules) — may run alongside the spine:**
  - **C (vault)** — `packages/vault` only; no overlap with spine.
  - **E (auth)** — `packages/auth/src/index.ts`; #101/#113/#127/#141 all touch this one file ⇒
    **serialize internally** (one agent, one slice), but parallel to spine/C/F.
  - **F (ai)** — `packages/ai` + briefings; parallel to spine/C/E.
- **Cross-slice overlaps to honor:**
  - #155 appears in both **B** (workspace-half) and **D** (raw-Kysely read) → **D after B**.
  - #127/#101 bootstrap touched by both **B** (workspace writes) and **E** (auth isolation) →
    coordinate the bootstrap edit; **B lands the workspace removal first, E rebases**.
  - #98 (A) and #102/#144 (G) both touch memory repos → **G after A**.
- **Recommended first wave (smallest blast radius, highest value):** **Slice A** (two tiny
  security migrations, live-breakage fix for #98) → then **Slice B** (the deletion that collapses
  #120/#153/#115/#116/#152 and de-risks D/E). Author specs A and B first.

## Risk-tier note

8 of 9 slices are **security-tier** ⇒ each gets cross-model adversarial QA + a posted
`gh pr comment` verdict. **SIGN-OFF SUPERSEDED (Ben, 2026-06-12):** security-tier merge sign-off is
**DELEGATED to Fable**, not Ben (see Merge policy, line 6). Per security PR: run the adversarial QA
as a **Fable (`model: 'fable'`) cross-model review** → post verdict via `gh pr comment` → **Fable
APPROVE merges autonomously**; Fable `revise`/`reject` bounces to the build agent for re-QA. Ben
gets a per-merge digest (not a gate); escalate to Ben only on a design fork Fable can't settle.
Plan token spend accordingly (security QA is the budgeted place to spend up; the resident loop runs
cheap on Sonnet).

## Fleet layout (Ben, 2026-06-11)

- **One shared tab for all build/QA agents: "Agents"** (`w653f42bef3ac02:3`) — never the
  coordinator's own pane, never "window 1". The coordinator pane spawns only its own relay successor.
- **Grid layout convention:** **2×2 for a 4-agent wave, 3×1 for a 3-agent wave** — set at spawn time
  via alternating `herdr pane split --direction down|right` (herdr has no in-place re-tile; layout is
  fixed by split order at creation, so running agents are not retiled mid-build). The current wave-1
  (B/F/G/I) predates this convention and stays as-spawned; the next release-held wave (D/E/H = 3
  agents → 3×1) is the first to use it.

## Wave-1 spawn (2026-06-12, parallel-safe B/F/G/I — all `building`)

Spawned into the "Agents" tab (`w653f42bef3ac02:3`), Sonnet 4.6, bypass-permissions, off
`origin/main @ e0a9e2a`. Each executes its pre-written + Fable-reviewed plan via
`superpowers:executing-plans` (execute-not-replan; no plan-approval round-trip). Handoffs:
`docs/coordination/handoffs/2026-06-12-audit-slice-{b,f,g,i}.md` (committed bb7f994).

> **Pane IDs are VOLATILE — route by LABEL, not number.** The reaped SliceA/C panes freed `-3..-6`
> and herdr compacted this wave's IDs down by one (was `-4..-7` at spawn → now `-3..-6` per
> `herdr pane list` @ 20:45 sweep). Labels (`SliceX-build`) + cwd are stable; re-resolve the numeric
> pane from `herdr pane list` before any send/read/reap.

| Agent        | Pane (volatile) | Branch          | Migration                        | Test-file collisions                                       |
| ------------ | --------------- | --------------- | -------------------------------- | ---------------------------------------------------------- |
| SliceB-build | `-3`            | `audit-slice-b` | 0056 (spine HEAD)                | `foundation.test.ts` (↔I), `structured-state.test.ts` (↔G) |
| SliceF-build | `-4`            | `audit-slice-f` | none (code-only)                 | none — collision-free                                      |
| SliceG-build | `-5`            | `audit-slice-g` | #99 (number at merge, after B+D) | `structured-state.test.ts` (↔B)                            |
| SliceI-build | `-6`            | `audit-slice-i` | none (code-only)                 | `foundation.test.ts` (↔B; B merges first)                  |

**Sweep 1 (20:45):** all 4 `working`, no stalls/escalations. B at 59% ctx/$5.12 mid-deletion
(Task 1b done, 2-9 pending), auto-compacting — expect a self-relay (successor in same worktree).

**Sweep 2 (21:07):** all 4 `working`, no escalations. **G ahead** — impl done (5 files), running
`pnpm verify:foundation` (final gate); likely first done. **B COST WATCH** — still Task 1b/2 after
52 min, re-compacted (55% ctx), **$8.81** (largest slice; throughput healthy, not stalled, but
pricey — flag to Ben). F/I working, nominal. No relay yet (B held pane `-3`).

**F DONE (21:1x):** PR #184 (closes #119/#132/#148/#172), security-tier, collision-free (merges
independent of spine once green). Pane-id authority re-confirmed `p_38` ✅. CI **pending** at QA
dispatch. **Fable** (`model: fable`) security QA spawned via Agent tool (general-purpose +
coordinated-qa skill, isolation worktree, bg) — adversarial trust-boundary pass (allowlist
server-side enforcement, validateToolInput 400, actorUserId always-populated, listToolsForActor
scoping) + must `gh pr comment` an APPROVE/REVISE/REJECT verdict. Merge gated on Fable APPROVE **and**
green CI. (Ben's Codex-vs-Fable choice still open — verdict is reversible before merge.)

**21:2x — F CI GREEN ✅, I CI RED ❌ (stop-the-line):**

- **F #184:** both required checks PASS. Merge now gated only on Fable QA APPROVE (running). First to be merge-ready.
- **I #185:** agent self-reported `VF_EXIT=0` but CI `Verify foundation` **FAILED in 50s** (run 27393989565) — too fast for tests ⇒ early gate step (lint/format/typecheck/migrate); local pass + CI fail ⇒ uncommitted/unstaged file or stale node_modules masking. **Bounced to SliceI-build** (idle, 40% ctx/$7.07) with diagnose+fix pointer; it's running `gh run view --log-failed`. NOT QA'd until green. Self-report-vs-CI divergence = textbook reason we don't trust agent "done".
- **Merge-order note:** F merges independent of spine (collision-free). I is code-only too; once green it can merge before B (B then rebases its `foundation.test.ts` `it`-block edit) — I no longer strictly "after B".

**Merge sequencing for the collisions:** B merges first (spine HEAD) → G and I rebase their shared
test-file edits on top of B before their own merge. F is collision-free, merges as soon as green.

## CI waivers

| Check  | PR  | Proven red on `main` @ SHA | Proof | Ben-approved |
| ------ | --- | -------------------------- | ----- | ------------ |
| <none> | —   | —                          | —     | —            |

## Outstanding escalations

- [ ] **Ben spec review** — all 7 specs (B, D, E, F, G, H, I) authored 2026-06-12, awaiting
      Ben's review and approval before writing-plans are invoked and build agents are spawned.
      Specs in `docs/superpowers/specs/2026-06-12-audit-slice-*.md`.
- [x] **Spec authoring strategy** — resolved: slice-by-slice, now complete.
- [x] **#113 bearer-token design fork** — resolved: deferred to GitHub issue #183 (proper API-key
      milestone). Slice E scoped to #101/#127/#141 only.

## Incident log

- **2026-06-12 ~04:15 — Coordinator broke main (prettier).** Coordination-doc commits this
  session landed unformatted markdown → `prettier --check .` (format:check gate step) failed on
  main for 3 consecutive runs. Poisoned every agent rebasing onto main. **Root cause:** coordinator
  skipped `format:check` before its own commits (skill rule violated). **Fix:** reformatted all 5
  coordination docs, pushed `87189c5`; `format:check` now MANDATORY before every coordinator commit.
  **Collateral:** PR #185 (I) "CI red" was 100% this — failing log listed only `docs/coordination/*.md`,
  zero of I's files; I was unfairly bounced, told to just rebase.
- **2026-06-12 — Build-agent scope creep (F + G).** Both PR #184 and #186 swept in the 5
  coordination docs (likely `pnpm format` rewriting the whole repo + a broad `git add`), violating
  the "git add only your task's files" compact. Both told to `git checkout origin/main -- docs/coordination/`
  - rebase. **Skill fix (task #8):** instruct build agents to never touch `docs/coordination/` and
    to scope `pnpm format` to their own paths.

## Reaped sessions

- SliceA-build (pane -3) — reaped post-merge PR #181
- SliceA-QA (pane -5) — reaped post-verdict
- SliceC-build (pane -4) — reaped post-merge PR #182
- SliceC-QA (pane -6) — reaped post-verdict
- SliceF-build (pane -4 of wave-1) — reaped post-merge PR #184
- SliceG-build (pane `w653f42bef3ac02-4`) — reaped post-merge PR #186
- SliceI-build (pane `w653f42bef3ac02-5`) — auto-gone post-merge PR #185 (worktree deleted)
