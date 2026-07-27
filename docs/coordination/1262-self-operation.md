# Coordination Run — 1262-self-operation

**Date:** 2026-07-26
**Epic:** #1262 — module self-operation (Jarvis can operate Jarvis)
**Handoff:** `docs/coordination/handoff-1262-module-self-operation.md`
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id
`43e5f5e2-0deb-4ab5-9237-436e8795b611`** (match `agent_session.value` in `herdr pane list`).
Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this
anchor holds authority for the life of the run. ⚠️ **Pane numbers (`w…-N`) reflow on every
restart/split/reap — do NOT trust any pane number written in this file as an identifier; resolve the
pane fresh by label+session at read time.** Agents escalate to the **label** (routing, re-claimable);
the coordinator merges only when its own pane's **session id** (immutable, NOT the pane number)
matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs
Ben's explicit merge sign-off**. All three items in this run are `security` tier — every merge in
this run is Ben-gated.
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive
`merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge
nothing.
**merges_since_relay:** 0

> This is the coordinator's externalized memory. Keep it CURRENT — it is what lets a fresh
> coordinator adopt this run after a self-handoff. GitHub is the source of truth for
> spec/issue/board status; this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` (chassis half) | #1263 | security | building — Task 1 committed (`b2840f7b`), builder #2 relayed at 70% mid-Task-2 | `chassis-1263` (builder #2 session `7467c98e-…` relaying; successor inherits label); planner `planner-1263` idle | builder in tab `w1:t3J` = "agents" (resolve fresh by label); planner `w1:p11W` | `1263-self-operation-chassis` | — |
| `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` | #1264 | security | gated on #1263 merge | — | — | `1264-settings-self-operation` | — |
| `docs/superpowers/specs/2026-07-26-module-self-operation-content-commands.md` | #1265 | security | gated on #1263 merge | — | — | `1265-module-content-self-operation` | — |
| **no spec yet — DO NOT SPAWN** | #1266 | tbd | blocked on spec gate | — | — | — | — |

**#1266** (user-facing "always confirm" override) was filed from Ben's Fork-B ruling and is linked on
the epic. It has **no approved design spec**, so the project's hard spec-gate forbids spawning it.
Ben authors/approves a spec first. It does not block #1263/#1264/#1265.

Risk tier (content triggers, set at Phase 0 — see `coordinate` Risk tiering):

- `routine` — no schema/auth/secret surface → auto-merge after green QA.
- `sensitive` — shared-table migration / cross-module contract / export-delete / job-payload shape → auto-merge + Ben digest.
- `security` — auth/sessions/tokens/RLS/secrets/rate-limit/network-exposed/policy migration → cross-model Opus QA + `gh pr comment` verdict + **Ben merge sign-off**.

**Why all three are `security`:**

- **#1263** rewrites the gateway authorization path (`packages/ai/src/gateway/gateway.ts:160`) and
  introduces the denylist that decides what the model may ever do. Policy-touching by definition.
- **#1264** adds a core-owned migration on the shared `app.preferences` table, a per-tool
  authorization callback, and a hard rule that no tool may take a preference key (a key-taking tool
  is a hole straight through the denylist — self-promotion to YOLO). Spec's own exit line: "Security
  QA on Opus."
- **#1265** flips ~39 existing write tools from confirm-on-every-call to auto-run, and includes an
  SSRF containment check on `news.previewSource` (network-exposed surface, `externalContent: true`).
  Changing what executes without a prompt is an authorization-surface change.

Status vocabulary: `queued` → `building` → `awaiting-plan-approval` → `blocked` →
`pr-open` → `qa` → `qa-failed`/`rework` → `awaiting-ben-signoff` (security) → `merged`
(or `handed-off` when relayed to a fresh session).

## Dependency / merge order

- **Serialized gate:** **#1263 lands alone, first.** It changes `ModuleAssistantToolManifest`
  (`packages/module-sdk/src/index.ts:499`) and the gateway; both siblings build on that exact shape.
  A parallel start guarantees a rebase collision on the same SDK type.
- **Parallel group 1 (only after #1263 merges):** #1264 ∥ #1265.
- **Merge order:** #1263 → then #1264 and #1265 in whichever order goes green (no ordering
  dependency between them once the chassis has landed).

### Verified collision surface between #1264 and #1265

Checked at Phase 0 rather than assumed:

| Surface | #1264 | #1265 | Collision |
| ------- | ----- | ----- | --------- |
| `packages/settings/src/*` | writes | — | no |
| `packages/structured-state/src/preferences-repository.ts` | CAS | — | no |
| New migration file | **yes** (core-owned, `app.preferences` revision column) | none identified (sports follows + news tables already exist) | **no** — only one migration in the run, so no global-number race |
| `packages/news/src/*`, `packages/sports/src/*` | — | writes | no |
| `packages/module-sdk/src/index.ts` | reads the field | reads the field | no (field lands in #1263) |
| Cross-module write-tool classification | see fork A below | see fork A below | **potential** — resolved by fork A |

## Ben's Phase-0 rulings (2026-07-26) — binding on every agent in this run

Answers to forks A/B/C below. These override the specs where they differ, and the #1263 handoff doc
carries them.

- **Fork A → the retrofit moves to #1263.** The chassis agent classifies all 39 shipped write tools
  alongside the build assertion. #1265 keeps news action-family/`executionPolicy`, the `guidance`
  prompt-shaping question, the `previewSource` SSRF check, and the sports build.
- **Fork B → `memory.remember` = `granted_at_install`; `memory.forget` = `confirm_always`.** This is
  the **one sanctioned exception** to the epic's "nothing in round one is `confirm_always`" ruling.
  An agent proposing to "correct" it back is wrong — cite this line. Neither spec's UAT acceptance run
  invokes `memory.forget`, so the "no confirmation card anywhere" exit criteria are unaffected.
  - Note: `policy.ts:37` already returns `confirm` for **any** `risk: "destructive"` tool regardless
    of tier, so `memory.forget` confirms today. This ruling is preserved-by-declaration, not new
    behaviour.
- **Fork B (second half) → the user must be able to set "always confirm" on any permission.** New
  requirement, in neither spec. Verified state of the code before scoping it:
  - The tier vocabulary already includes `always_confirm`
    (`module-sdk/src/index.ts:20`, `shared/src/ai-api.ts:852`), storage is per
    `(moduleId, familyId)`, and `PATCH /api/ai/action-policy/:moduleId/:actionFamilyId` already
    exists. In `resolvePolicy`, `always_confirm` simply fails the `trusted_auto` check and falls
    through to `confirm` — so the **policy layer already honours it**. No gateway work needed.
  - **The blocker is `allowedTiers`.** That PATCH route rejects any tier the family does not list
    (`action-policy-routes.ts:90`). A family declared `allowedTiers: ["trusted_auto"]` can never be
    set to always-confirm by the user — exactly the capability Ben is asking for. → **#1263 must
    require `always_confirm` in `allowedTiers` for every action family in this epic, and assert it at
    build** alongside its other assertions.
  - **The install grant must never clobber a user-set tier.** Install persists `trusted_auto`; if a
    reinstall/reconcile re-applies it over a user's `always_confirm`, the override is silently lost.
    Precedence rule + regression test → **#1263**.
  - **There is no general UI to set a per-family tier.** The only setter in the app is email's
    bespoke drafts toggle (`packages/email/src/settings/index.tsx:115`);
    `settings-activity-pane.tsx` only *displays* families. → **filed as its own child issue of
    #1262**, buildable in parallel with #1264/#1265 once #1263 lands (frontend over existing routes).
  - **YOLO still bypasses a user-set `always_confirm`** — consistent with the standing ruling that
    YOLO is the user accepting the risk. Stated as an assumption; flagged to Ben if he wants
    otherwise, but not treated as blocking.
- **Fork C → the #1263 agent verifies the `people.merge` → `people.splitIdentity` round-trip** and
  classifies on the evidence. Exact-prior-state restore → `granted_at_install`; anything less →
  escalate to Ben rather than guess. (Both are `risk: "destructive"`, so both confirm today
  regardless.)

## Ben's mid-run rulings

- **2026-07-26 — no successor relay.** "No don't worry about successor's, keep going here." Cancels
  the `coordinate` skill's mandatory 70% relay for this run; coordinator session
  `43e5f5e2-…` drives to the end.
- **2026-07-26 — Sonnet never writes plans; a `gpt-5.6-sol high` planner does.** Verbatim: "oh hey,
  sonnet should never write plans. They are builders. Let's have 5.6-sol high write it please." This
  splits the `coordinated-build` skill's plan→approve→build loop into two agents: a **planner**
  (codex, `gpt-5.6-sol` at `high` — the `~/.codex/config.toml` default, so a bare `codex` spawn
  already is one) writes the plan and stops; a **fresh Sonnet builder** executes it task-by-task
  without re-deriving it. Consequences for anyone adopting this run:
  - The plan must be written **for an executor**: exact files, symbols, and test names per task, in
    dependency order, each independently committable. A plan that assumes the reader will re-read
    the spec defeats the split.
  - This does **not** contradict the standing memory that `sol xhigh` is banned for _build_ — sol is
    sanctioned for **planning** only, and at `high`, not `xhigh`.
  - Coordinator approval of the plan still applies; it now gates the builder's spawn rather than the
    builder's first commit.

## Coordinator rulings on the #1263 plan (2026-07-26)

The plan (`docs/superpowers/plans/1263-chassis-plan.md`, authoritative at `e7d9a1e9`) was written by
a `gpt-5.6-sol high` planner and raised two escalations. Both were adjudicated by the coordinator,
plus one rejection and one unblock. Do not reopen these without new evidence.

- **External-module ABI → #1263 is BUILT-IN ONLY.** The planner wanted to extend
  `ExternalModuleAssistantToolDeclaration` inside this issue. Rejected on verified code:
  that type (`module-sdk/src/index.ts:695-703`) carries no `actionFamilyId`/`executionPolicy`,
  `external/tool-manifests.ts:40` copies only `risk`, and `assistantActionFamilies` sits in the
  forbidden-key list at `external/validate.ts:58`. No family ⇒ `policy.ts:40` returns `confirm`
  unconditionally, so external write tools **cannot** silently auto-run — the gap is completeness,
  not safety. Extending a public external ABI also has no approved spec. **Filed as issue #1267.**
  The planner's real objection was honoured: the assertion, its doc comment, and every test name say
  **built-in** explicitly rather than implying full coverage.
- **Exclusion rule 7 does NOT retroactively remove shipped domain tools.** Rule 7 governs new
  self-operation/configuration operations. Its own enumerated examples are all config/scheduling
  surfaces (digest scheduling, provider test, connector sync, briefing runs, export jobs, host
  install) — not "send an email". Ben rejected third-party disclosure / scheduled work / externally
  observable writes as prompt grounds twice. Email and Calendar classify normally.
  - **Precedence rule:** where rule 7's enumerated examples collide with Ben's explicit per-tool
    ruling, the per-tool ruling wins. News write tools are `granted_at_install` per approved Spec 2,
    notwithstanding "news source preview/refresh" appearing in rule 7.
- **REJECTED — `notes.delete` must not be reclassified `destructive` → `write`.** The handler
  (`packages/notes/src/write-tools.ts:232-246`) does a bare `await unlink(file)` on the user's
  markdown file: no trash, no soft delete, no `deleted_at`, no restore path. That is durable
  unrecoverable loss — Ben's `confirm_always` bar verbatim, same shape as `memory.forget`.
  **`notes.delete` keeps `risk: "destructive"` and declares `confirm_always`.**
- **Task 7 and Tasks 16/17 were briefly gated on Ben and are now UNBLOCKED by the coordinator.**
  Declaring `confirm_always` on an already-`destructive` tool changes nothing at runtime
  (`policy.ts:37`), so it is status quo and needs no approval. The behaviour-changing option is the
  one that was rejected. Exact-count assertions build with **four** `confirm_always`:
  `memory.forget`, `people.merge`, `people.splitIdentity`, `notes.delete`. Ben's open question is a
  check on the coordinator's ruling, not a prerequisite — flipping it later is a one-line
  declaration change plus two count updates.
- **FLAGGED, not changed:** `email.sendReply` moves `destructive` → `write` + `granted_at_install`,
  per Ben's explicit ruling. Effect stated plainly so it cannot be missed in review: **Jarvis sends
  email with no confirmation, ever.**

## Phase-0 findings that needed Ben before spawning

Three things the specs did not settle. Each changed what #1263's agent builds, so they were resolved
first, not discovered mid-build. **All three are answered above.**

### Fork A — who classifies the existing write tools, and how many are there

#1263's build assertion is "a write tool that declares nothing fails the build", and #1263's exit
criterion is `pnpm verify:foundation` green. Those two are only simultaneously satisfiable if the
classification of every already-shipped write tool lands **in #1263**. #1265 scope item 7 says the
same thing in words ("it lands with the assertion") but is filed on the wrong issue.

**Coordinator reading: the retrofit classification belongs to #1263, not #1265.** #1265 keeps the
news-specific work (action family, `executionPolicy`, the `guidance` prompt-shaping question, SSRF
check) and the sports build.

Measured count (`risk: "write" | "destructive"` across `packages/*/src`): **39 tools in 11
packages**, not the 29 the specs state.

| Package | Tools | Enumerated in spec 2? |
| ------- | ----- | --------------------- |
| tasks | 13 | yes |
| news | 5 | yes |
| **people** | **4** | **no** |
| notes | 3 | yes |
| goals | 3 | yes |
| commitments | 3 | yes |
| **memory** | **2** | **no** |
| email | 2 | yes |
| calendar | 2 | yes |
| **web-research** | **1** | **no** |
| ai | 1 | yes |

### Fork B — `memory.remember` / `memory.forget` vs exclusion rule 2

Exclusion rule 2 (prompt-shaping) names "memory settings and fact mutation". `memory.remember`
(`packages/memory/src/manifest.ts:234`, `risk: "write"`) and `memory.forget` (`:242`,
`risk: "destructive"`) are **already-shipped assistant tools**. If the denylist captures them,
Jarvis loses two capabilities it has today — a user-visible regression, not groundwork.

`memory.forget` is also the one tool in the whole retrofit that plausibly clears the
unrecoverable-loss bar (it destroys a fact the user already had), which collides with the ruling that
**nothing in round one is `confirm_always`**. That ruling was written about the *new* settings and
content tools; the retrofit drags a pre-existing destructive tool into round one.

Three coherent answers, none of which an agent should pick on its own:

1. Exclude both — Jarvis stops being able to remember/forget on request (regression).
2. `granted_at_install` for both — keeps today's behaviour, and `memory.forget` auto-runs.
3. `granted_at_install` for `remember`, `confirm_always` for `forget` — the only round-one
   `confirm_always`, which contradicts the ruling as written but matches its stated bar.

### Fork C — `people.merge` / `people.splitIdentity`

Both `risk: "destructive"` (`packages/people/src/tools.ts:161,179`), unenumerated. `splitIdentity`
looks like the reverse of `merge`, which would make them auto-safe under the recoverability bar — but
"reverse exists" and "reverse restores exact prior state" are not the same claim, and the spec
requires a **tested** reverse. Flagging rather than assuming; if Ben wants, the #1263 agent verifies
the round-trip and classifies on the evidence.

## CI state on `main`

- Required `CI` workflow: **green** on the last completed run (`30217146891`, 35m10s, success). The
  run for the handoff commit was still in progress at Phase 0 — re-checked before spawn.
- `modules-registry` workflow, `publish` job: **red on `main` since at least 2026-07-20** (runs
  30217146890, 30064884141, 29790862146, 29751128971). Pre-existing, not introduced by this run, and
  not a required check. Recorded here so no agent mistakes it for their own breakage. Waiver entry
  below if it ever blocks.

## CI waivers

A red required check merges ONLY if waived here. Each waiver: check name + the SHA it's proven
failing on `origin/main` at + the proof + **Ben-approved (y/date)**. A check failing twice =
stop-the-line + file an issue (no waiver).

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| `modules-registry / publish` (non-required) | — | red on `main` across 4 consecutive pushes since 2026-07-20 | `gh run list --workflow=modules-registry` | not needed unless it blocks a merge |

## Outstanding escalations

- [x] **Fork C resolved by the coordinator, 2026-07-26 — Ben should review this one.** The
      `chassis-1263` agent did the round-trip verification Ben ordered and it **fails**:
      `people.merge` marks the secondary person `status: "merged"` + `merged_into_person_id` and moves
      **all** its identities and links to the primary; `people.splitIdentity` relinks only **one**
      identity to a (possibly new) person and never revives the secondary's status or moves the rest
      back (`packages/people/src/{tools.ts:161,179,service.ts:139,192,repository.ts:759}`). So the
      reverse does not restore prior state and `granted_at_install` is not available.
      **Ruling: both are `confirm_always`** — the second and last sanctioned exception in this run.
      Reasoning: `policy.ts:37` already returns `confirm` for any `risk: "destructive"` tool
      regardless of tier, so **both confirm today**; declaring `confirm_always` changes nothing at
      runtime. That is precisely the preserved-by-declaration basis on which Ben approved
      `memory.forget`. The alternative — putting them on the denylist — was rejected because it would
      remove a shipped capability (a real regression), where `confirm_always` is the status quo.
      Neither spec's UAT run invokes them, so the "no confirmation card anywhere" exit criterion is
      untouched. **This does raise Ben's "exactly one `confirm_always`" count to two.** If he wants it
      back at one, the fix is denylisting `people.merge`, and he should say so before #1263 merges.
- [x] Fork A / B / C — **answered by Ben 2026-07-26**, recorded above.
- [ ] **Assumption stated, not blocking:** YOLO continues to bypass a user-set `always_confirm`.
      Consistent with the standing YOLO ruling. Raise with Ben only if he wants a user override that
      YOLO cannot skip — that would be a change to the YOLO ruling itself, not to this epic.

## Reaped sessions

- **`chassis-1263`** (Sonnet 5 builder #1), pane `w1:p11Q`, session
  `6c9e4e26-2f15-47de-93c1-c524645901c4` — reaped 2026-07-26 with **zero code written**. It spent
  its whole context reading and auto-compacted at 72%, then Ben's planner ruling (below) made its
  self-authored plan invalid anyway. Nothing was lost: the worktree held no uncommitted work beyond
  `.claude/context-meter.log`, and its one real output (`docs/superpowers/plans/1263-chassis-plan.md`
  at `e00f6c89`) survives on the branch as research input for the planner. A compacted builder that
  has produced nothing is worth less than a fresh one — replace, do not nurse.

## Continuation note

**2026-07-26, coordinator #1 (session `43e5f5e2-…`) — the relay was CANCELLED by Ben ("don't worry
about successors, keep going here"), so this session continues to drive. Phase 1 is done: #1263 is
spawned and building. Phase 2 (supervision) is live.**

**Manifest approval:** Ben did not sign the manifest as a document, but he answered all three
Phase-0 forks explicitly and instructed "Begin now" / "keep going here". Those answers ARE the
substance of the manifest, so the Phase-0 pause is treated as satisfied. Recorded here so a
successor does not re-pause on it.

**What is in flight:**

- **#1263** — agent `chassis-1263`, pane `w1:p11Q`, tab `w1:t3J` (relabelled "agents"), session
  `6c9e4e26-2f15-47de-93c1-c524645901c4`, branch `1263-self-operation-chassis`, worktree
  `~/Jarv1s/.claude/worktrees/1263-self-operation-chassis`. Verified **Sonnet 5**, high effort,
  bypass-permissions on. Handoff committed to its branch at `39c0acee`
  (`docs/coordination/handoff-1263-self-operation-chassis.md`, prettier-clean).
- `main` CI re-verified **green** before the spawn (run `30224954273`, success, 21m27s).

**Your next action, in order:**

1. **Wait for the plan escalation** from `chassis-1263`. It was booted with an explicit "do NOT
   write code until the coordinator approves your plan". Approve only if the plan stays inside the
   spec's locked decisions **and** the six scope parts in its handoff. A plan that proposes a
   parallel command registry, a second `confirm_always`, or moving `resolvePolicy` ahead of YOLO is
   wrong — cite the rulings section and send it back.
2. When it reports done (PR open): spawn **Opus** `coordinated-qa` (security tier) → it must
   `gh pr comment` its verdict → surface PR + verdict to Ben with "security-tier — your merge
   sign-off?" → **PAUSE**. Never auto-merge in this run.
3. After #1263 **merges**: spawn #1264 and #1265 in parallel, separate worktrees, both `--model
   sonnet`, both into the agents tab `w1:t3J`. Never into the coordinator tab `w1:t3K`.
4. `#1266` stays unspawnable until Ben approves a spec for it.

**Scope reminder (already in the #1263 handoff, repeated here so it survives):** #1263 is bigger
than its issue title implies — it owns the 39-tool retrofit classification, the `allowedTiers`
must-include-`always_confirm` assertion, install-grant precedence over a user-set tier, and the
`people.merge`/`splitIdentity` round-trip verification, on top of the declaration field, denylist,
build assertion and gateway hoist.

**Fleet-mechanics notes for a successor (learned this session):** `herdr agent start` has **no
`--tab` and no `--cwd`** flag in this build. The working recipe is: pick/create a pane in the agents
tab → `herdr pane run <pane> "cd <worktree>"` → `herdr agent start <name> --kind claude --pane
<pane> -- --model sonnet --permission-mode bypassPermissions` → confirm the status line says
"Sonnet" → send the boot prompt with `herdr pane run`. Agent names must **start with a lowercase
letter** — `1263-chassis` was rejected (`invalid_agent_name`), which is why the label is
`chassis-1263`. Fresh build worktrees have **no `node_modules`**, so run prettier from this coord
worktree against the build worktree's path before committing there. `git worktree add` resolves
relative to your cwd, so pass an absolute path or you get a worktree nested inside this one.

## Builder burn-rate intervention (2026-07-26)

Three consecutive builders on #1263 died at roughly one task each:

| Builder session | Outcome | Work landed |
| --------------- | ------- | ----------- |
| `6c9e4e26…` | auto-compacted at 72%, zero code | none |
| `7467c98e…` | relayed at 70% after Task 1 | `b2840f7b` |
| `70c722a2…` | **auto-compacted** at ~87% mid-relay after Task 2 | `d11c4481` |

Diagnosed cause: `docs/superpowers/plans/1263-chassis-plan.md` is 647 lines, and a cold builder
read it end to end before writing a line. That single read costs roughly a third of a fresh
context, so every builder started its first task already close to the relay threshold. Re-briefing
builders on reading discipline did not fix it — builder three received the explicit
"grep your task heading, read only that section" instruction and still burned out.

**Intervention:** `planner-1263` is splitting the plan into `docs/superpowers/plans/1263/task-01.md`
… `task-17.md`, one task per file, content copied verbatim (no rewording — a content change here
would silently diverge from the approved plan and from what Tasks 1–2 were already built against).
Each task file additionally carries its dependency line and any coordinator ruling it needs, so a
builder can start cold from one file. The master plan file becomes a short index.

Sequencing note: the split is a docs-only change on the build branch and touches no source, so it
cannot conflict with the committed work. Tasks 1 and 2 get files too, marked DONE with their shas,
so no successor rebuilds them.

**Next builder starts at Task 3** (the gateway exclusion hoist) reading only
`docs/superpowers/plans/1263/task-03.md`. Task 7 is unblocked: four `confirm_always` tools
(`memory.forget`, `people.merge`, `people.splitIdentity`, `notes.delete`), all keeping
`risk: "destructive"`, so the declaration is status quo at runtime.

Session `70c722a2…` is to be reaped once the split commits — verified `git status` clean of any
uncommitted source, only the context-meter log and its own relay doc were dirty.

### Standing policy change: builders stop, they do not relay (2026-07-26)

`builder-1263-c` (`70c722a2…`) did relay successfully after all, into `builder-1263-d`
(`ff620bd0…`, pane resolved fresh, confirmed Sonnet 5). `70c722a2…` is reaped; continuation doc
`3ddc7a23`.

But `builder-1263-d` booted to **51% context with zero code written**. That is the real cost driver
and it is the relay itself: each successor pays a full boot — relay skill, continuation doc,
handoff doc, plan — before it can act. The continuity a relay buys is worth less than the context
it costs, because the commit history plus the per-task plan files already carry the state.

**New rule for this lane:** a builder at its threshold commits, sends one line naming the last
completed task and its sha, and stops. No continuation doc, no successor, no relay skill. The
coordinator spawns the replacement with a short brief pointing at one task file, which should boot
near 15% rather than 51%.

`builder-1263-d` has been given this instruction and is holding on Task 3 until the plan split
commits. It is running a regression of the ten Task 2 unit tests in the meantime.

### Plan split verified (2026-07-26)

Committed as `fa7c79dc` on the build branch. Verified rather than taken on the planner's word,
because a reworded plan would silently diverge from what I approved and from what Tasks 1–2 were
already built against:

- The commit touches `docs/superpowers/plans/` only — no source file, so it cannot collide with the
  builder's in-flight `gateway.ts` work, which the planner correctly left unstaged.
- All 17 task bodies were diffed line by line against the pre-split file at `d11c4481`. **16 are
  verbatim.** Task 17's 9 differing lines are the "Builder stop conditions" section, which the
  planner promoted into the index; all 9 were confirmed present there. **Zero lines lost.**
- Master plan dropped from 647 lines to a short index (571 lines removed).

Gap the promotion opened, and the fix: builders on this lane read exactly one task file and never
the index, so nobody would have seen the stop conditions. The planner is appending that block
verbatim to all 17 task files, keeping it in the index too. Duplication is cheap; a missed stop
condition on a security-tier change is not.

The stop conditions that matter most: a proposed **fifth** `confirm_always` tool halts that package
task and comes to me, and if Ben changes the pending `notes.delete` ruling, Task 7 plus the Task
16/17 counts all move together.

### Task 3 landed and spot-checked — `149b9df8` (2026-07-26)

`fix(ai): enforce exclusions before yolo`. This is the security-critical change in the plan, so I
verified the shape myself rather than waiting for QA (targeted greps only, no diff read):

- The exclusion is enforced **inside `executableTools`** (`packages/ai/src/gateway/gateway.ts:592`),
  which is the single source for listing (`:125`), lookup (`:138`) and `callTool` (`:330`).
- An excluded tool is therefore **structurally absent** from the set, not conditionally rejected
  later. `!found` returns `Tool not available` at `:141`, and the YOLO branch is at `:161` — so YOLO
  can never observe an excluded tool at all. That is stronger than the plan's "hoist the check above
  YOLO" wording, and it removes the ordering hazard rather than managing it.
- `resolvePolicy` (`:178`), the destructive short-circuit and `requiresConfirmation` are untouched,
  as Ben required.

Builder evidence: 3 new tests green (`exclude-under-yolo`, `yolo-still-runs-confirm-mechanisms`,
`yolo-off-still-confirms`), full `mcp-gateway.test.ts` 27/27, `ai` typecheck clean. Self-reported —
independent QA still owes an adversarial pass on it at PR time; this note is a mid-build sanity
check, not a sign-off.

Branch is 0 commits behind `origin/main` and `main` CI is green, so no rebase debt is accruing on
this serial gate. Builder is on `task-04.md`.

### Task 4 landed — `370da28c` — and a residual-loss ruling (2026-07-26)

All 13 `tasks` write tools classified `granted_at_install`; `task_changes` / `task_cleanup`
`allowedTiers` widened; **`tasks.deleteList` and `tasks.deleteTag` downgraded from
`risk: "destructive"` to `risk: "write"`.** Builder evidence: new
`tests/unit/self-operation-manifests.test.ts` 1/1, tasks-tools integration 17/17, typecheck clean.

The downgrade is authorised by `task-04.md` line 17, so the builder followed the approved plan. It
is also **necessary**: `policy.ts:37` confirms every `destructive` tool regardless of tier, so a tool
left `destructive` can never auto-run no matter what it declares. But it is a real runtime change on
a security-tier PR, so I verified the premise rather than trusting it.

What I found (`packages/tasks/sql/0039_tasks_foundation.sql`, `packages/tasks/src/lists.ts:190`):

- **Tasks themselves are structurally safe.** `app.tasks.list_id` is **`ON DELETE RESTRICT`**, and
  `deleteList` only proceeds if the caller supplies `reassignToListId` to move the tasks first. The
  database refuses to orphan tasks. There are further guards: 404 on a foreign/missing list, 409 on
  deleting your only list, and an advisory lock closing a TOCTOU on that last-list check.
- **Residual loss is real but bounded.** `app.task_tags.list_id` is `ON DELETE CASCADE` and
  `task_tag_assignments.tag_id` likewise, so deleting a list destroys that list's tags and every
  assignment of them; `deleteTag` destroys that tag's assignments. Re-creating a tag does not restore
  which tasks carried it. The list-move path also deliberately drops assignments whose tag is absent
  from the destination list.

**Ruling: the downgrade stands, no new `confirm_always`.** The loss is organisational metadata, not
content — materially lesser than `notes.delete` (a whole document via bare `unlink`) or
`people.merge`. Declaring two more `confirm_always` here would over-prompt exactly the routine
list-tidying Ben's ruling is meant to make prompt-free, and would breach his "if you want a second
one you are wrong about the tool" instruction. **Count stays at four.**

Applying "guardrails, not permission prompts" properly: the `ON DELETE RESTRICT` guarantee is the
guardrail that makes an unconfirmed delete defensible, **and nothing in the suite proves it**. I have
tasked the next builder with a regression test asserting `deleteList` on a list still holding tasks,
with no reassign target, fails and destroys nothing. **The PR body must state the residual tag-
assignment loss in plain language** — QA should confirm both.

### Fleet state

- `builder-1263-d` (`ff620bd0…`) stopped clean at 72% per the no-relay rule and is reaped. It
  delivered Tasks 3 and 4 in one context — the first builder on this lane to complete more than one.
- `builder-1263-e` (`b25edf78…`, pane `w1:p110`, tab `w1:t3J`, **Sonnet 5** confirmed) is driving:
  the `deleteList` regression test, then `task-05.md`.
- Boot cost is now ~40% for a fresh builder — that is the repo's own CLAUDE.md/skills overhead, not
  the brief — so plan on roughly **three tasks per builder** for the remaining Tasks 5–17.

**Herdr API correction (the `coordinate` skill is wrong):** `herdr agent start … --tab <tab>` does
not exist. The working sequence is `herdr pane split <pane> --direction down --cwd <path> --no-focus`
→ `herdr agent start <name> --kind claude --pane <newPane> -- --model sonnet --permission-mode
bypassPermissions` → send the brief with `herdr pane run`, then **one `herdr pane send-keys <pane>
Enter`** (a long brief lands as unsubmitted pasted text).

### 2026-07-26 — Tasks 5 landed; guardrail test corrected and verified

- **Test-validity hole closed.** `a9c65c93` asserted only `statusCode: 409`, but `deleteList`
  raises two different 409s: the last-list guard (`lists.ts:280`, fires *before* any delete is
  attempted) and the `ON DELETE RESTRICT` translation. If the created list had been the actor's
  only list, the test would have passed green without ever exercising the FK guarantee it claims
  to prove. Corrected in `edd990b4`: the actor now gets a second list first, and the assertion
  matches `message: "List is not empty"`.
- **Verified, not assumed:** `grep` confirms `"List is not empty"` is raised in exactly one place
  — `lists.ts:264`, inside the `catch` wrapping the actual `deleteFrom("app.task_lists")`. No
  other path can satisfy that assertion, so the test now can only pass via the FK rejection.
  This matters because that RESTRICT guarantee is the sole guardrail justifying the
  `tasks.deleteList` risk downgrade (destructive → write, auto-run, no confirmation).
- **Task 5 (Commitments) `0eb6437d` spot-checked clean:** `accept`/`reject`/`snooze` all
  `risk: "write"` + `executionPolicy: "auto"` + `actionFamilyId: "commitment_review"` +
  `selfOperationGrant: "granted_at_install"`; the family's `allowedTiers` carries all three tiers
  including `always_confirm` (the `action-policy-routes.ts:90` requirement). No new
  `confirm_always` — count still four, pending Ben on `notes.delete`.
- **Fleet:** `builder-1263-e` (`b25edf78`, pane `w1:p110`, Sonnet 5) at 62%, now on Tasks 6–7.
  Expect its stop-and-report inside those two. **5 of 17 tasks committed.**
- **Herdr note:** `send-keys Enter` did *not* submit a pre-existing input-box line; `send-keys C-u`
  to clear followed by `herdr pane run` did. Prefer clear-then-run over repeated Enters.

### 2026-07-26 — Task 6 landed; builder e reaped, builder f driving

- **Task 6 (Goals) `d9f886a6` spot-checked clean:** `create`/`update`/`addEvidence` all
  `risk: "write"` + `executionPolicy: "auto"` + family `goals_management` +
  `granted_at_install`; `allowedTiers` carries all three. Goals ships no delete tool, so no
  destructive classification arises. **6 of 17 committed.**
- **Builder e stopped at 72% with Task 7 UNCOMMITTED** — a deviation from the stop rule, which
  says commit first. Work was not lost: it lives in the shared worktree, and I reviewed it before
  reaping. `packages/notes/src/manifest.ts` is correct — `notes.create`/`notes.edit` granted,
  `notes.delete` **stays `risk: "destructive"` + `confirm_always`**, `note_changes.allowedTiers`
  widened to include `always_confirm`. Missing piece is only the integration test in
  `tests/integration/notes-write-tools.test.ts`.
- **Reaped builder e** (`b25edf78`, pane `w1:p110`) after confirming the working tree held the
  partial. Closing a pane does not touch files, so the handoff is the worktree itself — cheaper
  than any continuation doc.
- **Spawned `builder-1263-f`**, pane `w1:p121`, tab `w1:t3J`, **Sonnet 5 confirmed**. Brief: finish
  Task 7's missing test and commit it as one commit (explicitly told the reviewed manifest work is
  correct and must not be redone), then Tasks 8 and 9. Task 8 carries the binding People ruling as
  settled fact so it cannot be re-litigated.
- **Stop rule restated to f with the missing clause made explicit:** commit finished work *first*,
  then one line to the Coordinator, then stop.
- Monitor `bifjssgyk` stopped (watched the dead session); replaced with `boxl5xgsc` on `w1:p121`.

### 2026-07-26 — Ben's two rulings; Tasks 7 and 8 landed; builder g driving

**Ben ruled on both open questions (binding).**

1. **`notes.delete` is approve-once, not confirm-always** — "don't need to baby proof." Written up
   as `docs/superpowers/plans/1263/task-07a.md`, which corrects the already-committed `63a38cdd`.
   The consequence matters and is stated in that file: `policy.ts:37` confirms **any** destructive
   tool regardless of tier, so approve-once is unreachable while `notes.delete` stays
   `risk: "destructive"`. Implementing the ruling *requires* the downgrade to `risk: "write"` +
   `executionPolicy: "auto"` + `actionFamilyId`. Declaring `granted_at_install` on a still-destructive
   tool would silently prompt forever — the exact trap Task 2's assertion exists to catch.
   **Accepted residual, recorded for the PR body:** `notesDeleteExecute`
   (`write-tools.ts:232`) is a bare `unlink` — no trash, no restore. Unlike the `tasks.deleteList`
   downgrade, there is **no structural guardrail** behind this one. Ben was told and ruled anyway;
   a soft-delete path is a possible follow-up, not #1263 scope.
2. **Email requires approval before sending** — "Jarvis should approve for email. Again users can
   give it full freedom though." This **reverses** the previous Task 11 ruling, which would have had
   Jarvis send mail with no card ever. `task-11.md` rewritten: `email.sendReply` **keeps
   `risk: "destructive"`, no family, no `executionPolicy`**, and merely declares `confirm_always`
   — preserved-by-declaration, zero runtime change. `email.draftReply` is `granted_at_install`
   (drafting reaches nobody and is reversible).
   - **Judgment call flagged to Ben:** "full freedom" is satisfied today only by global YOLO, which
     bypasses `confirm_always`/destructive/`requiresConfirmation` alike. A per-family email
     auto-send tier would need the destructive floor removed, which is what makes "never silently
     sends mail" a hard guarantee rather than a flippable default. Kept the floor; per-family
     control is a separate decision (candidate for #1266).

**`confirm_always` roster is still four, with one swap:** `memory.forget`, `people.merge`,
`people.splitIdentity`, **`email.sendReply`** (in), **`notes.delete`** (out). `task-16.md` and
`task-17.md` counts updated. Plan commit `1b622d93`.

**Tasks landed.** Task 7 (Notes) `63a38cdd` — superseded in part by 7a. Task 8 (People) `32a75627`
spot-checked clean: `people.merge`/`people.splitIdentity` keep `risk: "destructive"` +
`executionPolicy: "confirm"` + `confirm_always`; `acceptMatch`/`rejectMatch` granted.
**Checked the obvious bypass and it holds:** `people.acceptMatch` is granted-at-install and takes an
arbitrary `candidateId`, so if it could accept a `merge_people` candidate it would be a
no-confirmation route around the confirm-always `people.merge`. It cannot — `service.ts:75` throws
`RequiresExplicitActionError` for `merge_people` and `split_identity` kinds, and that guard is
enforced in code (not just tool prose) and pinned by `service.test.ts:78`. **8 of 17 committed.**

**Fleet.** Builder f stopped mid-Task-9 (memory family added, uncommitted) and was reaped with pane
`w1:p121`. **`builder-1263-g`** spawned, pane `w1:p122`, tab `w1:t3J`, **Sonnet 5 confirmed**, queue
= task-07a → task-09 (told to `git diff` first so it builds on f's partial) → task-10. Stop rule
restated with "commit FIRST" called out as the clause f violated.

### 2026-07-26 (later) — Task 7a landed; builder g → h

**Task 7a (`d011dba5`) reviewed and approved.** `notes.delete` is now `risk: "write"` +
`actionFamilyId: "note_changes"` + `executionPolicy: "auto"` + `granted_at_install`, with
`always_confirm` still in `allowedTiers` so a user can demand the prompt back. The commit also
swapped `notes.delete` → `email.sendReply` in `PLANNED_CONFIRM_ALWAYS_TOOLS`
(`packages/ai/src/gateway/self-operation.ts:178`). That file was **not** in task 7a's file list, but
the edit is correct and necessary — the roster is encoded in code, so approved rather than bounced.

**Caught a stale line in my own plan file.** `task-07a.md` said the roster "drops from four to
three" and told the builder to fix any "four" it found — which would have reverted the email ruling
in tasks 16/17. Corrected in `67bf5e46` before it did damage; builder g had already reasoned to the
right answer independently.

**Caught stale prose the model reads.** Both `notes.delete` descriptions still said "after
approval" after the confirmation was removed. A tool description is decision-time input to the
model, not a comment, so a stale promise of a confirmation is a real defect. Fixed in `4b7a5049`
("immediately and permanently", no trash path added — that stays out of #1263 scope).

**Fleet.** Builder g reaped with pane `w1:p122` after committing cleanly at its threshold (stop rule
held this time — the "commit FIRST" restatement worked). **`builder-1263-h`** spawned, pane
`w1:p123`, **Sonnet 5 confirmed**, queue = task-09 (memory; told to `git status` first because
builder f's `memory_management` family is still uncommitted in the tree) → task-10 (news) →
task-11 (email, with the reversing ruling called out in the brief). Monitor re-armed on `w1:p123`.

**10 of 17 committed.** Sequence: `b2840f7b … 1b622d93`, `63a38cdd`, `32a75627`, `d011dba5`,
`4b7a5049`.

**Herdr note (recurring):** a long brief sent with `herdr pane run` lands as an unsubmitted paste
("paste again to expand", context still 0%) and needs one follow-up `send-keys Enter`. Always
confirm the context meter moved off 0% before believing a builder is driving.

### PR body — required plain-language disclosures (do not let this get lost)

Whoever writes the #1263 PR must state these three in ordinary words, not policy jargon. They are
the user-visible consequences of this change and Ben signs the merge off against them.

1. **Deleting a note now happens immediately, with no confirmation and no undo.** There is no trash
   and no restore path — the delete is a direct file unlink. Ben ruled this deliberately
   ("don't need to baby proof"); it is disclosed, not hidden. A soft-delete is a possible follow-up.
2. **Sending email still always asks first.** Jarvis can draft a reply freely, but it cannot send
   one without a confirmation card. The only way to remove that is global YOLO mode, which turns off
   every confirmation everywhere.
3. **Deleting a task list or a tag no longer asks, and one small thing is lost silently:** deleting
   a tag drops its assignments. Deleting a non-empty list is still refused by the database, so no
   tasks can be destroyed this way.

Everything else in this PR is invisible to users: it declares guarantees that already existed so the
build can check them.

### 2026-07-26 — Task 9 (Memory) landed; builder h → i

**Task 9 (`a9502e4f`) verified.** `memory.remember` = `risk:"write"` + `memory_management` family +
`executionPolicy:"auto"` + `granted_at_install`. `memory.forget` = `risk:"destructive"` +
`confirm_always` with **no family and no executionPolicy** — the same preserved-by-declaration shape
as `email.sendReply`, so the destructive floor keeps confirming it. Family `allowedTiers` includes
`always_confirm`. **11 of 17.**

**Builder h retired after one task.** It reported stopping "per the 70% rule" while actually at
**56%** — builders misjudge their own context meter, so verify with a bounded pane read before
accepting a stop report. Rotated anyway (it was already winding down) rather than push it into a
half-finished task, which has cost two review cycles in this run already.

**Efficiency note for future rotations:** a fresh builder boots at ~40% from CLAUDE.md/skills
overhead *plus* the brief itself, and one classification task costs ~30%. That is the real reason
each builder only gets 1–3 tasks. Builder i's brief was trimmed ~40% against h's for this reason.

**`builder-1263-i`** spawned, pane `w1:p125`, **Sonnet 5 confirmed**, at 41% and driving. Queue =
task-10 (News) → task-11 (Email, reversing ruling flagged in the brief) → task-12 (Calendar).
Monitor re-armed on `w1:p125`.

### 2026-07-26 — Tasks 10–11 landed (Ben's email ruling is IN); builder i → j

**Task 10 News (`3146a327`).** All five news writes — `confirmSource`, `removeSource`, `addTopic`,
`removeTopic`, `addExclusion` — now `risk:"write"` + `news_personalization` family +
`executionPolicy:"auto"` + `granted_at_install`. This also **fixes the standing no-family trap**:
none of the five declared an `actionFamilyId`, so `policy.ts:40` was confirming every one of them on
every call. Real UX improvement, worth a release-note line.

**Task 11 Email (`3a121d1f`) — verified property by property, not trusted.** `email.sendReply`:
`risk:"destructive"`, `selfOperationGrant:"confirm_always"`, **no `actionFamilyId`, no
`executionPolicy`**, and `grep` confirms **no `email_sends` family was invented**. All four
properties are the guarantee; any one alone can hold while mail still auto-sends. The builder also
rewrote the tool description to say "ALWAYS asks for confirmation", so the model is not working from
stale prose (the defect we hit on `notes.delete`). `email.draftReply`: `risk:"write"` +
`email_drafts` + auto + `granted_at_install`; family `allowedTiers` includes `always_confirm`.

**Ben's reversing ruling is now implemented in code, not just planned.** There is no tier any user
or reinstall can set that promotes `email.sendReply` to auto-send; only global YOLO overrides it.

**Fleet.** Builder i retired after 2 tasks (committed first — stop rule held). **`builder-1263-j`**
spawned, pane `w1:p126`, **Sonnet 5 confirmed**, 44% and driving. Queue = task-12 (Calendar) →
task-13 (Web Research) → task-14 (persist install grants — the heavy one; brief calls out both
traps: no migration, and insert-if-absent so a user's `always_confirm` survives a reinstall).

**13 of 17 committed.** Remaining: 12 Calendar, 13 Web Research, 14 install-grant persistence,
15 enable-path wiring, 16 startup assertion + inventory lock, 17 walk-away regression + full gate.

### 2026-07-26 — Calendar regression caught and ruled on; a third declaration value

**I found a real regression in Task 12 (`0991ab47`) and it was my plan's fault, not the builder's.**
Verified against `origin/main` rather than trusting the commit message. On `main`,
`calendar.deleteEvent` was deliberately **double-belted**: no `executionPolicy: "auto"` (so
`policy.ts` always confirmed it) **and** `calendar_management.allowedTiers: ["always_confirm"]` (so
no tier — user, install, or otherwise — could ever promote it). `task-12.md` instructed removing
**both** belts and declaring `granted_at_install`. The builder followed it exactly. Once Task 14's
install grant landed, Jarvis would have deleted calendar events with no card at all — and deleting an
event emails a cancellation to every attendee, which cannot be un-sent.

**Why I escalated instead of deciding.** Ben's framework says `confirm_always` means durable
unrecoverable loss and that third-party disclosure is explicitly *not* grounds for a prompt. But his
email ruling requires a prompt precisely because mail reaches people. Calendar deletion sits on that
line, so I gave him three concrete options rather than guessing.

**Ben's ruling: "Ask by default, but I can turn it off."** Jarvis shows a confirmation card before
deleting a calendar event. The user may flip it to automatic themselves in settings. Nothing changes
silently at install.

**Neither existing declaration value could express that**, which is the interesting part.
`granted_at_install` is false (install must not promote). `confirm_always` is *also* false — it
claims an unflippable guarantee while the tool is `risk:"write"` with `executionPolicy:"auto"` and a
family permitting `trusted_auto`; a user who promoted the family would get silent deletes and the
declaration would be a lie the Task 2 assertion trusts. **A declaration that can be false is worse
than no declaration.**

**So `task-12a.md` adds a third value, `user_promotable`** (`34983211`): wired for auto-run, but
install does not promote it; the family's `defaultTier` stands until the user says otherwise. The
build assertion is extended to reject a false `user_promotable` claim — the tool must be
`risk:"write"`, have a family, have `executionPolicy:"auto"`, and the family must allow **both**
`trusted_auto` (or promotion is impossible) and `always_confirm` (or the user can never demand the
prompt back). A unit test per bullet. `defaultTier`'s type is untouched — that ban is unchanged.

A three-values ruling header was prepended to `task-14/15/16/17` so install skips `user_promotable`
exactly as it skips `confirm_always`, and every roster/count/exhaustiveness assertion covers all
three.

**Ordering is load-bearing: 12a must land BEFORE 14.**

**Task 13 Web Research (`9ce5d558`)** committed. Builder j re-queued: 12a next, then 14.

**14 of 19 committed** (1–13 plus 7a). Remaining: 12a, 14 install-grant persistence, 15 enable-path
wiring, 16 startup assertion + inventory lock, 17 walk-away regression + full gate.

**Fourth PR disclosure** (add to the three already pinned): deleting a calendar event still asks
first, and the user can turn that off in settings if they want to.

### 2026-07-26 — all 19 tasks committed; final gate pending

Tasks 14–17 landed and were each verified against the code, not the commit message:

- **14 (`5f3afa2f`)** install-grant persistence. No migration. `insertActionPolicyIfAbsent` is
  `INSERT … ON CONFLICT DO NOTHING`, so a user's own choice survives a reinstall; owner comes from
  `app.current_actor_user_id()`, not a caller-supplied id. Grants are filtered by a **positive**
  match on `granted_at_install`, so `confirm_always`, `user_promotable`, and any future fourth value
  all default to not-granted — fail-safe by construction.
- **15 (`032398c6`)** enable-path wiring, and it is **genuinely wired**: `apps/api/src/server.ts`
  passes the port, both admin and user enable routes call it. Settings never imports `@jarv1s/ai`
  (module isolation preserved via an injected port). Grants re-apply on enable, so modules disabled
  before this ships still get set up.
- **16 (`e744e822`)** startup assertion in the API `onReady` hook — a tool that declares nothing
  takes the server down at boot. Inventory locked at **33 granted_at_install + 4 confirm_always +
  1 user_promotable = 38**, with the sum asserted.
- **17 (`1a9c03b5`, `bf2789ce`)** walk-away regression.

**Builder k stopped correctly** on a stale roster in `task-16.md` (it still listed `notes.delete` as
`confirm_always`). Investigating found the counts were stale too — the plan said 34
`granted_at_install`; the real number is 33 because Task 12a moved `calendar.deleteEvent` out.
Fixed in `eff8c811`. **Count gotcha:** People declares grants in `packages/people/src/tools.ts`, not
a `manifest.ts` — a count grepped from `manifest.ts` files alone comes out at 34 and is wrong.

**Both plan files now carry a standing rule:** if a plan line contradicts committed code or a Ben
ruling, STOP and message the Coordinator — never edit working code to match a stale plan line. This
is the second time this run a stale roster nearly reverted one of Ben's decisions.

**I required one extra test before the gate** (`bf2789ce`): nothing proved end-to-end that install
runs, grants what it should, and deliberately does **not** promote `calendar.deleteEvent`. The
declaration was tested and cards were tested, but never together — which is precisely the regression
that would ship silent calendar deletes. The test runs the real grant path over the real calendar
manifest with a DB-backed policy lookup, asserts a card is still raised, and rigs the calendar
service to throw if ever invoked.

**Gate.** First `verify:foundation` run returned a **real exit code 1** — format:check only, three
files, no test or type failures. Plan doc formatted by me (`eddd39a0`, coordinator-owned); the two
test files by the builder. Re-run in flight.

**19 of 19 committed.** Next: full gate green → PR → Opus adversarial QA (security tier, must post
its verdict to the PR) → Ben's merge sign-off → merge.

## Continuation note — 2026-07-27, post-compaction (coordinator session 43e5f5e2)

All 19 tasks committed. Test split committed as `19fa10b9` (mcp-gateway.test.ts 899 lines,
new tests/integration/mcp-gateway-self-operation.test.ts 240, tests/unit/mcp-gateway-units.test.ts
back to its origin/main 969, new tests/unit/self-operation-chassis.test.ts).

**Isolated gate run (builder l, JARVIS_PGDATABASE=jarvis_gate_1263, DROP/CREATE before run):**
exit 1. Clean through test:unit (3377/3377), db:migrate clean, test:uat-seed 23/23 — the 3
uat-seed failures from the contaminated run were an artifact of hitting the live DB, not a
regression. test:integration 1712 passed / 1 failed.

**The one failure is ours and the test is what's wrong.** `tests/integration/focus-time.test.ts:97`
asserts `allowedTiers` `toEqual(["ask_each_time", "trusted_auto"])`; Task 12a (`d70b8386`)
deliberately added `always_confirm` to `calendar_writeback` under the standing epic rule that every
family must let the user demand a prompt back. Coordinator verified the assertion directly and
ruled: **fix the test, never the manifest.** Reverting the manifest would break the rule — this is
the third stale-assertion-vs-ruling collision on this run.

**Shared dev DB remediation — verified clean:** UAT Fake Provider rows 0, UAT Fake Model rows 0,
`ai.service_bindings` = `{"chat":{"kind":"mode","tier":"interactive"}}`, `module.news` key absent
(not dangling).

**Open for Ben, dev instance only, not a code defect:**
- `ai.service_bindings.module.news` was overwritten and is unrecoverable — news topic/source add
  will 503 "Topic checking unavailable" until he reconfigures it. Ben acknowledged: "reconfigure
  news later, keep going."
- `instance_settings.onboarding.state` was also touched inside the incident window
  (04:01:10–04:01:18 UTC, synthetic UAT actor `00000000-0000-4000-8000-000000000001`); current
  value `{"value":"completed"}`. No pre-incident snapshot exists, so it is flagged as touched, not
  confirmed unchanged. Nothing else in `instance_settings` has a timestamp in the window.

**Next:** builder l fixes focus-time.test.ts + re-runs the full gate on a fresh gate DB → coordinator
opens the PR (body drafted, four disclosures: notes delete is permanent/no trash; email always
asks and only global YOLO removes it; task-list/tag delete no longer asks and tag-assignment loss
is silent; calendar delete asks by default but is user-promotable) → Opus `coordinated-qa`
(security tier, must `gh pr comment` its verdict) → surface to Ben → **PAUSE for his merge
sign-off** → merge → then spawn #1264 + #1265 in parallel.

### PR opened + QA dispatched — 2026-07-27

Final gate on branch `1263-self-operation-chassis`: **`pnpm verify:foundation` exit 0** against a
freshly DROP/CREATEd `jarvis_gate_1263` (unit 3377/3377, uat-seed 23/23, integration 158 files /
1713 passed / 0 failed). Stale-test fix landed as `336913be` — test-only, three lines, manifest
untouched, why-comment cites the always_confirm rule.

**PR #1268** open against `main`. Body carries the four required plain-language disclosures.

**QA:** `qa-1263`, Opus 5, pane `w1:p12A` in agents tab `w1:t3J`, detached read-only worktree
`.claude/worktrees/qa-1263` at `336913be`, `JARVIS_PGDATABASE=jarvis_qa_1263`. Dispatched via the
**Herdr fallback path, not the Agent tool** — Ben's standing session rule is that the Agent tool is
not called unless he asks for it; the coordinate skill sanctions this fallback. Briefed with seven
adversarial targets (policy/gateway ordering, INSERT-only install grant, production wiring vs the
#1257 test-only-prop trap, the confirm_always floor, calendar ask-by-default after a real grant,
RLS/actor scoping on preference writes, external-ABI leakage into #1267's scope). Must
`gh pr comment 1268` its verdict before reporting.

Builder l (`w1:p128`, 62%) is **kept alive** pending the verdict in case fixes are needed; reap
after merge.

**Security tier — nothing auto-merges. Ben's explicit sign-off required after the verdict.**

### Fable security review added — Ben's call, 2026-07-27

Ben: "have fable security review it first." `sec-1263-fable`, **Fable 5**, pane `w1:p12B`, detached
worktree `.claude/worktrees/sec-1263` at `336913be`, `JARVIS_PGDATABASE=jarvis_sec_1263`. **Its
verdict leads.** The Opus `qa-1263` pass was already in flight and was left running as an
independent second lens rather than discarded — two lenses on a security-tier PR is what the
tiering wants anyway. Both must `gh pr comment 1268` before I act on either.

Fable briefed to assume the declarations are lies until the code proves otherwise, across eight
targets: gateway/policy ordering incl. the YOLO path at `gateway.ts:161`; INSERT-only install
grant; wired-vs-test-only (the #1257 trap); whether any crafted preference row / family definition
/ install grant can lift the four-tool `confirm_always` floor; calendar ask-by-default after a real
grant; DataContextDb-only actor scoping with no admin bypass; external-ABI scope leak (#1267); and
an open "what did I not think to ask / what is asserted but unproven" slot. Findings require a
concrete failure scenario, and it was told explicitly not to manufacture findings to look thorough.

### Fable verdict + Ben's ruling — 2026-07-27

**Fable 5 lead security review: APPROVE, no CRITICAL, no HIGH.** Posted to PR #1268, grounded on
`336913be`. It verified rather than assumed: both confirmation floors fire before any tier/family
lookup; the install grant is genuinely INSERT-only (a stored `always_confirm` survives re-enable);
the startup assertion IS on the production boot path (traced Docker CMD → `scripts/start-jarv1s.ts`
→ built `dist/server.js` → `onReady`), so not a #1257-style test-only prop; the four-tool floor is
held structurally; external modules unaffected; actor scoping clean, no admin bypass.

**MEDIUM (real, coordinator-verified in the code):** `packages/module-registry/src/index.ts:711-722`
`buildCalendarFollowThroughPort.executeAutoActions` is a **second reader of the action-policy tier**
— a proactive worker that reads `listActionPolicies` and, on `trusted_auto`, calls
`calendarWrite.proposeAndInsert` against the real calendar with no card, no chat session, no
gateway. As opened, this PR made *enabling the calendar module* arm unattended background writes.

**Ben's ruling: do not grant it at install.** `calendar.proposeFocusBlock` →
`user_promotable` (all four prerequisites already held, so no new machinery). Accepted cost:
proposing a focus block in chat asks each time until the user promotes the family. Also landing:
both LOW hardening assertions (no family shared between a `granted_at_install` and a
`user_promotable` tool; a `confirm_always` tool must not be promotable via any family) and a
regression proving install grants write nothing for calendar. Ruling posted to the PR as durable
evidence (`#issuecomment-5087557955`).

**STANDING RULE adopted for the epic — carry into #1264 and #1265:** an action-policy tier has more
readers than `resolvePolicy`. Any future `granted_at_install` classification must audit every
`listActionPolicies` consumer, not just the chat gateway.

Counts move: `granted_at_install` 33 → 32, `user_promotable` 1 → 2, `confirm_always` stays 4, total
stays 38. The inventory assertions are exact, so they fail loudly if a bucket is missed.

Builder l (`w1:p128`, 69% — near rotation, watch it) is implementing, then re-running the full gate
on a fresh `jarvis_gate_1263`. Opus `qa-1263` still running as the second lens. PR body still needs
the YOLO note and the focus-block behaviour change before Ben's sign-off.

### Continuation note — web.read ruling + PR body rewrite

**Builder l stop-and-ask, answered.** It correctly refused to widen
`PLANNED_CONFIRM_ALWAYS_TOOLS` (`packages/ai/src/gateway/self-operation.ts:192-197`) without
authorisation and reported the real constraint: the `confirm_always` check at `:324-331` is a pure
tool-NAME allowlist with no risk-field requirement, so widening the roster is the only path to
declare `web.read` as `confirm_always`.

**Ruling: widen the roster, keep `risk: "write"`.** The roster is a list of intended declarations,
not the security control — the control is `policy.ts:40`, which confirms unconditionally for any
write tool with no `actionFamilyId`. Promoting `web.read` to `destructive` to satisfy the informal
"all four are destructive" convention was rejected: destructive means irreversible loss, `web.read`
is an exfiltration vector, and overloading the risk field to mean two things would cost more than
it buys.

**Collision resolved before it could bite.** The Opus review's non-blocking #1 proposed asserting
`confirm_always ⇒ risk destructive`. That phrasing directly contradicts the ruling above —
`web.read` would fail it. Hardening assert 4(b) is therefore specified as the structural version:
a `confirm_always` tool must not be promotable (no `executionPolicy: "auto"`, and either no
`actionFamilyId` or a family whose `allowedTiers` cannot reach `trusted_auto`). All five satisfy
it, and it catches the real regression — someone later re-risking one of the four to `write` and
silently inheriting its family's floor. It must land in the same commit as the `web.read` change,
not after it, because it is what converts the name-allowlist convention into a structural
guarantee. Both reviewers independently flagged this same weakness from different angles.

**Confirm-always set is now five:** `memory.forget`, `people.merge`, `people.splitIdentity`,
`email.sendReply`, `web.read`. The plan files (`task-07a.md`, `task-12a.md`, `task-16.md`) all name
four and carry a "a proposed fifth is a stop condition" clause — that stop condition fired, was
escalated, and was ruled on here. Those plan lines are now stale by ruling; do not let a later
agent "reconcile" the code back down to four.

**PR body rewritten** (scratchpad `pr-1263-body.md`, not yet pushed): added the YOLO caveat, a
fifth behaviour disclosure for focus blocks, the web-research scope paragraph, and the two new
regressions. Inventory line now reads 31 granted / 5 confirm / 2 promotable = 38. **That split is
derived, not verified** — hold the push until builder l's inventory test reports the real counts,
and correct the line if they differ.

**QA checklist item added while watching `eb0470ef`.** Both hardening asserts landed correctly
phrased — 4(a) forbids a family shared between a `granted_at_install` and a `user_promotable` tool,
4(b) is "confirm_always implies NOT promotable" with an in-code comment recording that it is
deliberately not "implies destructive" and naming `web.read` as the reason. Good.

But the commit's new test lines are in `tests/unit/self-operation-chassis.test.ts`, not the
integration file. **Verify at QA that the "installing calendar does not arm the background
follow-through writer" regression actually exercises the install-grant path**, not just the manifest
declaration. A unit assert that `proposeFocusBlock` is declared `user_promotable` does NOT prove
install skips it — the declaration and the install logic are two different code paths, and the whole
point of this change is the second one. This is the #1257 "wired, not just defined" failure mode.

### Merge authority change — Ben delegated, 2026-07-26 (late)

Ben: **"I need to sleep, lets push to get this completed without me."** That is an explicit,
in-session override of the coordinate skill's security-tier rule requiring his personal merge
sign-off. Authority to merge #1268 without waiting for him is therefore granted, and this line is
the record of it.

**What the delegation does NOT cover.** It is authority to merge a GREEN result, not authority to
lower the bar. A RED verdict from the in-flight delta review goes back to the builder and gets
re-verified; it does not get merged because nobody is awake to argue with. Same for a red CI check
— the waiver protocol needs Ben, so a red check parks the merge until morning rather than being
waived.

**Sequence being executed unattended:** delta review verdict → merge #1268 (squash, delete branch)
→ close #1263, board/epic bookkeeping → reap builder l + its worktree + qa2-1263 → spawn #1264 and
#1265 in parallel (separate worktrees, `--model sonnet`, agents tab `w1:t3J`) → write Ben's morning
digest.

**Worktree trap hit and fixed while spawning the reviewer** (saved to agentmemory): `git worktree
add` with a RELATIVE path from inside a worktree nests the new worktree under the current one
(`coord-1262/.claude/worktrees/qa2-1263`). The absolute path then handed to `herdr … --cwd` does not
exist, the pane silently falls back to `$HOME`, the agent boots with no repo, and the briefing text
lands in bash as `command not found` noise. Also: `herdr agent start --cwd` does not re-root an
existing pane — close the pane and re-split with the right `--cwd`. Always absolute paths, always
`git worktree list` before spawning.

### Delta review RED — install grant overrides an explicit user opt-out (blocking)

Third review (Opus, delta-scoped to `eb0470ef`/`ffb58f16`/`8fae3909`), verdict RED, one blocking,
posted at PR #1268 `#issuecomment-5088140595`. It confirmed all four Fable findings and the
`web.read` blocker are genuinely closed in code, then found a new one.

**The blocker.** `packages/tasks/src/action-policy.ts:10-26` + `packages/ai/src/repository.ts:1932`.
Tasks keeps a legacy dual-key compatibility path: the resolver reads both the canonical
action-policy key and the legacy `tasks.agency_auto_execute` boolean and takes whichever row is
**newer**. `insertActionPolicyIfAbsent` only checks the canonical key. So a user who explicitly
turned task auto-execute OFF between #488 and #548 has `legacy=false` and no canonical row; enabling
the tasks module inserts canonical `trusted_auto` with `updated_at=now`, which wins on timestamp,
and eleven task write tools begin auto-running with no card. Their settings toggle flips itself back
on. This is worse than the calendar case: the user did not fail to opt in, they opted **out** and we
overrode it. Zero tests touch `LEGACY_AGENCY_AUTO_EXECUTE_KEY`.

**The standing rule adopted earlier this run was blind to it, by construction.** "Audit every
`listActionPolicies` consumer" only finds consumers of that function. This reader goes at the
preference key directly. **Amended rule for #1264/#1265: audit every reader of the action-policy
preference keys — including legacy keys and any compatibility resolver — not every caller of
`listActionPolicies`.** A grep for the function name will not find the next one of these either.

**Rulings issued with it.**
- **task_cleanup (review item 3), upheld.** `deleteList`/`deleteTag` were `granted_at_install` on a
  family whose `defaultTier` is `always_confirm` — install overriding the strongest default a family
  can declare. Fixed from the grant side: both become `user_promotable`. The family's `defaultTier`
  is untouched, because widening a `defaultTier` is a standing stop condition, and
  always_confirm + user_promotable is exactly the calendar precedent. A sibling assert now fails the
  build on `granted_at_install` over an `always_confirm` family.
- **notes.delete (review item 2), declined again.** Ben ruled on it explicitly, knowing it is an
  unrecoverable unlink. The reviewer is right that the override of spec 2's bar was never written
  down — that is what this paragraph is for. Not a defect, and not a decision to revisit at 1am.
- Items 4/5/6 (unanchored name allowlist, bare `.toThrow()`, stale toggle copy) folded into the
  second fix commit. The name-allowlist one is real: `seenToolNames` is per-manifest and
  `executableTools` is first-match-wins, so a future built-in declaring its own `web.read` with a
  trusted family would shadow the confirming one and pass every assert.

**Expected inventory after the fix: granted_at_install 31→29, user_promotable 2→4, total 38.**
Verify against the builder's real numbers; PR body disclosure 3 must then be rewritten, since task
list/tag deletion now asks by default instead of not asking.

### Continuation note — 2026-07-27 ~01:45

- builder-1263-l reaped (context checkpoint, zero commits toward the RED). Handoff
  `.claude/HANDOFF-1263-l.md` verified to carry the four anti-regression rulings verbatim.
- **builder-1263-m** is the live builder: pane `w1:p12G`, same worktree
  `.claude/worktrees/1263-self-operation-chassis`, branch `1263-self-operation-chassis`,
  Sonnet 5, booted ~52%. Branch head still `8fae3909`.
- Briefed with the fix order: (A) BLOCKING tasks legacy dual-key fix, **its own commit, first**,
  with a test proven to fail before the fix; (B) `deleteList`/`deleteTag` → `user_promotable`
  + sibling assert, cross-module tool-name uniqueness assert, pin the two bare `.toThrow()`
  messages, fix `packages/calendar/src/routes.ts:171` copy.
- Stop condition given to m: if the new always_confirm-family assert trips a module **other than
  tasks**, stop and message me — do not self-fix.
- Expected inventory after B: `granted_at_install` 31→29, `user_promotable` 2→4, total 38.
  m was told to report the REAL numbers and flag a mismatch rather than make them match.
- Monitor `bt2ilzbzj` watches for new commits on the build branch and for pane death.
- **Still owed by me before merge:** rewrite PR #1268 body disclosure 3 (task list/tag deletion
  now asks by default and is promotable) — do this only after the reclassification commit lands.
- Merge authority: delegated by Ben in-session ("I need to sleep, lets push to get this completed
  without me"). Authority to merge GREEN only. RED returns to the builder. A red CI check parks
  until morning — the waiver protocol needs Ben.

### Pre-staged spawn material (2026-07-27)

`686c3080` adds both build handoffs so #1264/#1265 can spawn the moment #1263 merges:

- `docs/coordination/handoff-1264-settings-self-operation.md`
- `docs/coordination/handoff-1265-module-content-self-operation.md`

**They live on `coord/1262-self-operation`, not `main`** — a build worktree cut from `main` will not
contain them. Hand each agent the **absolute path into this coordinator worktree**
(`~/Jarv1s/.claude/worktrees/coord-1262/docs/coordination/handoff-1264-…`), exactly as #1263 was
handled. Do not copy them into the build worktrees; build agents must not write under
`docs/coordination/`.

Both carry: the three-value declaration rule, the defaultTier stop condition, the always_confirm
allowedTiers rule, `confirm_always` ⇒ NOT PROMOTABLE (with web.read as the named exception), Ben's
fork-A (retrofit already in #1263) and fork-B (memory.remember/forget) rulings, the no-key-taking-
tool rule for #1264, and the **amended preference-key audit rule** born from the #1263 RED.

Shared surface flagged in both: the exact-count inventory assertion in
`tests/unit/self-operation-manifests.test.ts`. Second to land rebases and updates the numbers;
both are explicitly forbidden from loosening the assert to dodge the conflict.

### RED blocker resolved — `1751bc7a` (coordinator-verified at diff level)

`fix(tasks): preserve legacy agency_auto_execute opt-out on module re-enable`. Touches
`packages/module-registry/src/index.ts`, `packages/tasks/src/action-policy.ts`,
`tests/integration/module-enablement.test.ts` (+105/−2).

Verified by me, not taken on report:

- `TasksCompatibilityHelper.grantInstallTimeTrustIfUnset` is a **single atomic**
  `insert … select … where not exists (… key in (canonical, legacy))` — no read-then-write race
  between concurrent enable requests. Either key present ⇒ no insert, so a legacy
  `tasks.agency_auto_execute = false` opt-out survives a module re-enable.
- `assertDataContextDb(db)` then `.execute(db.db)` — precedent in
  `packages/ai/src/terminal-password-repository.ts`. Branded handle in, no root Kysely.
- Registry imports `TasksCompatibilityHelper`/`tasksModuleManifest` from the **`@jarv1s/tasks`
  package root**, not a deep path — module isolation holds.
- Builder proved the test red before green by temporarily reverting the fix (`ask_each_time` →
  `trusted_auto` reproduced), as ordered.

**Latent trap I ordered guarded in Task B:** the substitution makes tasks bypass the generic grant
path entirely and hardcodes exactly one family key. Correct today, and exactly correct once
`task_cleanup` goes `user_promotable` — but a future third tasks family declared
`granted_at_install` would be granted by neither the special case nor the generic path. Fails
quiet, which is the failure mode this epic exists to prevent. Ordered an assert: **tasks has
exactly one `granted_at_install` family and it is `task_changes`**; a second must fail the build,
commented back to the registry substitution.

### Second builder relay — m → n (2026-07-27 ~02:1x)

- **builder-1263-m reaped** (session `807d55c9`, pane `w1:p12G` closed) after committing Task A
  (`1751bc7a`, the RED blocker) and pushing. It folded my checkpoint-4 drift guard into
  `.claude/HANDOFF-1263-m.md` as Task B item 1b before signing off — verified present at lines
  44-51, including the instruction to **count and report actual numbers rather than match a guess**.
- **builder-1263-n** is the live builder: pane `w1:p12H`, tab `w1:t3J`, same worktree/branch,
  Sonnet 5, booted ~47%. Doing Task B (items 1, 1b, 2, 3, 4, 5) as one bundled commit, then
  messaging me before Task C's gate.
- **Gap I found and closed by hand:** `HANDOFF-1263-m.md` does **not** mention `web.read` at all
  (0 hits) and references the five-tool `confirm_always` roster only obliquely. The plan docs
  `docs/superpowers/plans/1263/task-07a.md`, `task-12a.md`, `task-16.md` still carry the **stale**
  stop condition "the set is exactly four; a proposed fifth ⇒ stop", which predates my post-Opus
  ruling and was never rewritten. A successor running the gate could "reconcile" committed code
  down to a stale plan and strip `web.read`. Messaged n directly with: the roster is five;
  assert 4b is *NOT PROMOTABLE*, never *implies destructive*; `web.read` stays `risk: "write"`
  with no family; widening a `defaultTier` to make the gate pass is a stop condition, not a fix;
  and where a plan doc contradicts a ruling, the ruling wins and I want the contradicting line
  reported.
- **Follow-up owed (not blocking the merge):** those three plan docs should be corrected or marked
  stale before #1264/#1265 start, or the same trap is waiting for them.

### Third builder relay — n → relay-1263-n (2026-07-27 ~02:3x)

- **builder-1263-n reaped** (session `433657c4`, pane `w1:p12H` closed). Panes resolved fresh; the
  driver was distinguished by activity (`w1:p12J` mid-work, `w1:p12H` idle with unsubmitted text),
  not by trusting the reported numbers.
- **relay-1263-n** is the live builder: session `19da2cb2`, pane `w1:p12J`, tab `w1:t3J`, same
  worktree/branch, Sonnet 5, ~53%.
- **Nothing is committed for Task B.** Head is still `1751bc7a`; work sits uncommitted in the
  shared worktree (`packages/ai/src/gateway/self-operation.ts`,
  `packages/tasks/src/manifest.ts`, `tests/unit/self-operation-chassis.test.ts`).

**Coordinator-verified before reaping** (claims checked in the tree, not taken on report):

- `tasks.deleteList` (~`packages/tasks/src/manifest.ts:781`) and `tasks.deleteTag` (~`:801`) are
  **both** `user_promotable` under `task_cleanup`. Real.
- **Gap I found that the builder had not:** `tests/unit/self-operation-manifests.test.ts` is
  untouched and still encodes the pre-change inventory — `:325` asserts
  `grantedAtInstall.length === 31`, plus a `granted_at_install` assert on a delete tool near `:103`.
  Both are now false, so the gate would have failed. Expected after item 1: **29 / 4 / 38**
  (`:335` total unchanged). Passed to the driver with the standing instruction to report real
  numbers and flag a mismatch rather than edit until they match.

**Chain-fidelity warning (worth carrying past this issue):** builder-n discovered its own handoff
claimed item 1 complete when only `deleteList` had been changed — `deleteTag` was still
`granted_at_install`. **A relay handoff in this chain has now asserted a completion that was
false.** Instruction given to the driver: verify every "done" by reading the file, never by
trusting the checkbox. Three relays on one task is the real cost driver here; if #1264/#1265
show the same pattern, the task decomposition is too large for one context, not the agents' fault.

### Task B landed — `37d5d78d` (coordinator-verified at diff level)

`feat(self-operation): demote task_cleanup to user-promotable, harden built-in inventory`.
Five files, all staged explicitly: `packages/tasks/src/manifest.ts`,
`packages/ai/src/gateway/self-operation.ts`, `packages/calendar/src/settings/index.tsx`,
`tests/unit/self-operation-chassis.test.ts`, `tests/unit/self-operation-manifests.test.ts`.

All three ordered asserts are present in `assertBuiltInSelfOperationManifests`, each commented with
its rationale at the point of failure:

1. **Sibling assert** — a `granted_at_install` tool whose family `defaultTier` is `always_confirm`
   throws. Install can no longer silently widen a family the module deliberately gated.
2. **Cross-module tool-name uniqueness** — the gateway dispatches by name alone, so a collision
   would let one module's manifest shadow another's tool.
3. **Tasks single-family drift guard (my checkpoint-4 order)** — `tasks` must declare exactly one
   `granted_at_install` family, `task_changes`. The comment explains that the registry special-case
   is a *full bypass* of the generic path and tells whoever trips it how to fix it.

**Observed inventory, run live rather than reasoned: 29 granted_at_install / 5 confirm_always /
4 user_promotable = 38.** Matches the prediction exactly.

**My pointer was wrong on item 5 and the builder was right.** I had specified
`packages/calendar/src/routes.ts:171`; that line is policy-set logic with no copy in it (verified
myself). The copy lives in `packages/calendar/src/settings/index.tsx`, where the Time-blocks row
fell back to the shared `CALENDAR_MODE_OPTIONS` "auto" description that names only the chat
surface. Fix overrides the description for Time blocks only and leaves prep tasks on the shared
string — correct, because prep tasks has no background writer, so the generic copy is still true
there.

Pre-commit verification reported: full `pnpm typecheck` (incl. apps/web + external modules),
`check:file-size`, eslint on all five files, `self-operation-manifests.test.ts` 16/16,
`self-operation-chassis.test.ts` 18/18.

**Task C in flight:** fresh `jarvis_gate_1263` + full `pnpm verify:foundation`. Stop conditions
given: report the real exit code (never piped through `tail`/`head`); on red, send failing test
names and **do not fix** — if a failure could be made to pass by widening a `defaultTier` or
relaxing one of the new asserts, that is a stop-and-message.

### Task C gate: RED at lint — and it exposed a real coverage gap (2026-07-27)

`pnpm verify:foundation` on a fresh `jarvis_gate_1263` **exit code 1**, failing at the FIRST stage
(`pnpm lint`) before typecheck/tests/migrate ever ran:

```
tests/integration/module-enablement.test.ts
  11:3  error  'tasksModuleManifest' is defined but never used
```

Introduced by **Task A (`1751bc7a`)**, which I accepted. **My miss:** I reviewed that commit's
*source* diff and not its *test* diff.

**Do not drop the import — it is the fingerprint of a real gap.** The regression at
`tests/integration/module-enablement.test.ts:689` calls
`tasksCompat.grantInstallTimeTrustIfUnset(scopedDb)` **directly**. That covers the helper half of
the fix. It does **not** cover the routing half — the `manifest.id === tasksModuleManifest.id`
branch in `packages/module-registry/src/index.ts`. Delete that branch and the test still passes
green while the security fix is gone. This is a "wired, not just defined" instance (cf. #1257).

Ordered: cover the routing half using `tasksModuleManifest` so the import becomes honest.
Preferred assertion is behavioural — drive the module **enable** path for tasks with a pre-existing
legacy `tasks.agency_auto_execute = false` and assert the opt-out survives (the actual QA bug, end
to end). Acceptable lesser version: assert the registry's resolved `grantSelfOperationForModule`
for the tasks manifest routes into the compat helper rather than the generic path. Builder to say
which it chose and why.

**Explicit escape hatch given** (to avoid a 3am grind): if both are impractical in that harness,
drop the import, say so, and I file a follow-up issue + disclose the gap on the PR. An admitted
gap beats a fake test.

Gate DB: keep, but DROP/CREATE fresh at the start of the rerun (migrate never ran).

**Also owed before merge:** PR #1268 body disclosure 3 still says task list/tag deletion "no longer
asks" — `37d5d78d` inverted that. Rewrite after the gate goes green.

### Gate-blocker resolved — `af2ec6d4` (routing coverage)

Builder took the **acceptable lesser** path, and checked the preferred one first rather than
assuming: driving `PATCH /api/me/modules/tasks` end to end needs chat engine factories, RPC
connections, a boss queue, and onboarding probes, and **no existing integration test drives
`registerBuiltInApiRoutes`** — only `apps/api/src/server.ts` does, at production boot. That is real
new fixturing, so the lesser path was the right call and the reasoning is in the commit body, not
just in chat.

Change: the inline closure at `packages/module-registry/src/index.ts` is extracted verbatim into an
exported `resolveGrantSelfOperationForModule(genericGrant)`, asserted in both directions. I read the
diff myself — behaviour-preserving: same ternary, `PreferencesRepository` still constructed inside
the returned closure (not hoisted, so per-call timing is unchanged), and the generic port is captured
at the same moment the old object literal was built. Two files, 25/25 pass (was 23).

**Caveat preserved on purpose:** the generic grant in test 1 is a no-op spy, so the assertion with
real teeth is "generic grant was **not** called", not an observed policy change. That is now a code
comment in the test so a later reader does not overestimate it.

**Coordinator miss worth keeping:** I accepted `1751bc7a` after reviewing its *source* diff and not
its *test* diff. Review both halves of a commit, every time.

### Open before merge

- Gate rerun in flight on a dropped/recreated `jarvis_gate_1263`, real exit code.
- PR #1268 body **rewritten locally, not yet pushed** (scratchpad `pr-1263-body.md`): disclosure 3
  inverted to "asks by default, promotable"; inventory corrected 31/5/2 → **29/5/4**; routing-test
  bullet added. Push with
  `gh api -X PATCH repos/:owner/:repo/pulls/1268 -F body=@<file>` — `gh pr edit --body-file` fails
  here with a GraphQL Projects-classic deprecation error.
- `docs/superpowers/plans/1263/task-07a.md`, `task-12a.md`, `task-16.md` still carry the **stale**
  "confirm_always set is exactly four; a fifth ⇒ stop" condition, and task-16 still says 31 /
  two-promotable. Harmless to #1264/#1265 (their handoffs carry the corrected five-tool roster, and
  nothing outside #1263 reads `plans/1263/`), but the squash-merge lands the stale text in `main`.
  Plan: after the gate is green, one docs-only commit correcting all three, then re-run **only**
  `pnpm lint` + `pnpm format:check` — the only gates a markdown edit can break — and say exactly
  that on the PR rather than implying the full gate re-covered it.

### Gate green, PR body pushed, delta QA in flight

**Gate: exit 0** on a freshly dropped/recreated `jarvis_gate_1263`. The builder's first attempt died
at `format:check` on its own **untracked** `.claude/HANDOFF-1263-*.md` scratch — the known prettier
trap, not reviewed code. It prettier-wrote those four files only and reran clean from lint. Correct
call to make without me. Real numbers: unit 3380 passed / 2 skipped; integration 1719 passed / 2
skipped (includes the 25 in `module-enablement.test.ts`); uat-seed 23 passed; migrations clean
through `0155`.

**Task D landed — `7a00b6df`, docs-only, three files.** The stale roster and counts in
`plans/1263/task-07a.md`, `task-12a.md`, `task-16.md` are corrected (five `confirm_always`, 29
granted-at-install, four promotable, stop conditions moved fifth→sixth). Verified against `lint` +
`format:check` only, both exit 0 — **not** the full gate, and the PR says so rather than implying
otherwise. Note the 38 total needed no edit: −2 granted_at_install and +2 user_promotable net to
zero.

**PR #1268 body pushed** with the corrected disclosure 3, the 29/5/4 inventory, and the routing-test
bullet.

**Integration risk is nil.** `origin/main` moved by exactly one commit, `84d1c291` — docs only
(`CLAUDE.md` + a new `audit-grounding` skill). No source overlap with #1263, so the rebase-and-re-QA
concern the collision map exists to catch does not apply here. CI was green on `af2ec6d4`; it
re-runs on `7a00b6df`.

**Delta QA spawned: `qa3-1263`, pane `w1:p12K`, Opus 5 high, session `bf088932-0b49-449f-b6f2-e8e887f636c5`.**
Why a fresh agent and not QA2: QA2 sat at 71% with "2% until auto-compact", and a security reviewer
whose context compacts mid-review is exactly what should not gate a merge. Its verdict is already
durable on the PR, so it was safe to reap — pane closed, worktree removed.

QA3's scope is the genuinely unreviewed delta: `1751bc7a`, `37d5d78d`, `af2ec6d4`. The posted
"independent delta security review" comment covers `eb0470ef`/`ffb58f16`/`8fae3909` — everything
*before* Task A — so those three commits have had no independent eyes at all. Its brief lives at
`scratchpad/qa3-1263-brief.md` (herdr's `agent start` rejects long prompts as unencodable, so the
brief goes in a file and the prompt is a pointer).

**Herdr API correction for successors:** the `coordinate` skill's spawn line is stale.
`herdr agent start <name> --kind claude --pane <ID> -- <args>` — there is no `--tab` and no `--cwd`;
you `herdr pane split <pane> --direction right --cwd <path> --no-focus` first, then start the agent
into the returned pane. Names must be lowercase.

**Still blocking merge:** QA3 verdict + CI green on `7a00b6df`.

### QA3 GREEN, then Task E — `7dc37352` (test-only hardening)

QA3 returned **GREEN, zero blocking, four non-blocking**. Its most valuable output was a *negative*
result: it audited the action-policy preference **by key** rather than by caller — the exact
blindness that hid the original bug — and found four readers total, three tasks-aware and all three
verified wired in production (`module-registry:1152/1249/1299`), with `tasks.agency_auto_execute`
the only legacy dual-representation key in the repo. **The bug class does not recur elsewhere.** It
also confirmed by reading the tree (not prose) that both reclassifications faked in a handoff doc
last time are genuinely present.

I took all four NB findings **before** merging. QA did not block; I did this because three are the
bug class this PR exists to prevent, and #1264/#1265 inherit whatever pattern lands tonight.
Reasoning posted on the PR so it survives this session.

`7dc37352` — two files, both tests, boundary held (I checked the stat myself rather than trusting
the report). Local: eslint 0, full-monorepo typecheck 0, unit 21/21, integration 27/27 on an
isolated DB.

**Two things worth carrying forward:**

1. **NB-4 came out better than I ordered, and it contradicts an earlier justification.** `af2ec6d4`'s
   commit body says driving the full `PATCH /api/me/modules/tasks` path needs chat engine factories,
   RPC connections, a boss queue and onboarding probes. Task E drove exactly that path via
   `getBuiltInModuleRegistrations()` + `server.inject`, and found only four required fields on
   `BuiltInRouteDependencies` — everything else optional. **The "too heavy" assessment was wrong**,
   and it was wrong in the direction that avoids work. `af2ec6d4`'s body will land in `main` saying
   so; not worth another commit to correct, but do not cite it as evidence that the HTTP path is
   expensive to test — it is not, and #1264/#1265 should drive it.
2. The caveat comment I required on the spy test was **updated, not left stale**, when NB-3 removed
   the spy (`module-enablement.test.ts:787` now says the generic grant wraps the real function). The
   remaining `vi.fn` at `:877` is the NB-4 block's deliberate raw spy and is documented as such at
   `:816`. Checked directly — a stale comment here would have been the very thing NB-2 was about.

**Blocking merge:** QA3 scoped re-verify (mutation check — does each new negative test fail when its
assert is removed?) + CI green on `7dc37352`.

### [CRIT] Gate RED on `7dc37352` — and it was my instruction that caused it

QA3's scoped re-verify caught what my own acceptance would have missed. CI failed at
`prettier --check` — **link 2** of `verify:foundation` — so `test:unit` and `test:integration`
**never ran**. The four tests Task E exists to add had executed nowhere except the builder's local
run, while its commit body truthfully reported eslint 0, typecheck 0, 21/21, 27/27.

**My miss.** My Task E instruction said "lint, typecheck, and the affected test files. Not the full
gate." That list omitted `format:check`. The builder ran exactly what I asked for. Third time
formatting has stopped this branch's gate. **`format:check` goes in every verification list from
here, however small the change**, and builders should add it even when I forget. Saved as durable
memory (`mem_ms2zoj7l_9cf09d234b32`) — the failure mode is that a format failure reads as "tests
pending" rather than "tests failed", which is easy to misread as nothing being wrong.

Task F: `prettier --write` on `tests/unit/self-operation-chassis.test.ts` only (two hunks — a call
needing a wrap ~L327, a string wanting single quotes ~L407), then lint + **format:check** + typecheck
+ both test files.

**QA3's mutation check cleared all four NB fixes analytically**, and the detail worth keeping is that
NB-1's `always_confirm` fixture declares `allowedTiers: [always_confirm, trusted_auto]`. The natural
reading — declaring only `[always_confirm]` — would trip an earlier assert with a *different*
message, and since `.toThrow` substring-matches, the test would have passed for the wrong reason.
QA3 also verified each pinned message has exactly one producer in the tree, and walked all nine
asserts preceding each target to prove the fixtures actually reach them. That is the standard for a
negative test: not "it throws" but "it throws *because of the assert under test*".

NB-4's vacuity risk was checked too: `PATCH` on an already-enabled required module does reach the
grant (`settings/routes-modules.ts:306-308`, unconditional when `!disabled`), so the pass-through
mutation really would invoke the raw spy.

**Merge gate now: CI green on the Task F head. Nothing else outstanding.**

## 2026-07-27 — #1263 MERGED; parallel wave #1264 + #1265 spawned

### #1263 merged

**PR #1268 squash-merged as `73e50847`** on the head `ace5fd98`. Merge performed under Ben's
standing verbal delegation ("I need to sleep, lets push to get this completed without me"), **not a
fresh approval** — the digest must say so plainly. The delegation's limit held: authority to merge
GREEN only, never to lower the bar.

Merge preconditions, all satisfied before the merge:

- **Session-id authority re-confirmed** (Phase 3 step 0): exactly one `Coordinator` pane, `w1:p11T`,
  session `43e5f5e2-0deb-4ab5-9237-436e8795b611`, matching the lock line at the top of this file.
- **CI green on the merged head** `ace5fd98`: Verify foundation and app **pass 24m43s**, Compose
  deployment smoke pass, Prod compose deployment smoke pass. "Build and publish images" was still
  in progress — non-required post-merge packaging, not a gate on the code.
- **QA3 final verdict: MERGE-READY YES**, and it is the verification worth keeping. Rather than
  trusting the green tick, QA3 pulled job log 89931094945 and walked the chain to prove the test
  steps *actually executed* this time (`format:check` 08:56:09 → `test:unit` 08:57:06 → `db:migrate`
  → `test:uat-seed` 08:59:20 → `test:integration` 08:59:29–09:16:45). Counts CI itself saw:
  unit 443 files / **3383** passed / 2 skipped; uat-seed 11 files; integration 158 files / **1721**
  passed / 2 skipped; release-hardening 19 passed. Zero failures; the 2+2 skips are pre-existing.
- **The four new tests were proven to have run by delta, not by the file being green** — the failure
  mode QA3 was hunting is a new test silently never collected while its file still reports green.
  `self-operation-chassis.test.ts` 18 → **21** (+3 = NB-1's three negative tests) with the unit total
  moving 3380 → 3383, the same +3, so nothing else shifted.
  `module-enablement.test.ts` 25 → **27** (+2 = NB-4's two wiring tests) with the integration total
  moving 1719 → 1721, the same +2. NB-2 and NB-3 were rewrites of existing tests, so they add no
  count and ran inside that green 27.
- **`ace5fd98` confirmed formatting-only**: one file, +5/−2, exactly the two predicted hunks. The
  L407 change (escaped-double → single-quote delimiter) leaves the runtime string byte-identical —
  which matters, because that string is a pinned `.toThrow` substring; one character of drift would
  have broken the drift-guard test. It passed.
- **Integration risk nil**: `origin/main` had moved by one docs-only commit (`84d1c291`), no source
  overlap, so no rebase-and-re-QA was required.

Bookkeeping done: issue #1263 closed (auto, by the PR), board item **Done**, no milestone attached,
remote branch `1263-self-operation-chassis` deleted (the `gh` "failed to run git" line was only its
local branch-switch cleanup — `main` is checked out by the shared `/home/ben/Jarv1s` tree — not the
merge). Builder pane `w1:p12J`, QA3 pane `w1:p12K`, and both worktrees reaped.

### Relay trigger fired and was overridden — recorded so it is not lost

A **security-tier merge fires an unconditional relay** under the `coordinate` skill. Ben's standing
override ("No don't worry about successor's, keep going here") cancels it, and the context meter has
also passed 70% without a relay for the same reason. **This manifest is therefore the only durable
record of the run** — a successor adopts from here, not from a handoff.

### Parallel wave spawned (Phase 1b)

Both worktrees were created off **fresh `origin/main` at `73e50847`** (i.e. with the chassis in),
and both agents booted on **Sonnet 5** with bypass permissions, verified by pane read.

| Issue | Branch / worktree | Agent | Pane | Session id |
| --- | --- | --- | --- | --- |
| #1264 settings self-operation | `1264-settings-self-operation` | `build-1264` | `w1:p12M` | `7f52e0b8-8667-4102-9c4a-4776ba866a48` |
| #1265 module content self-operation | `1265-module-content-self-operation` | `build-1265` | `w1:p12N` | `13aa3da8-3214-4b2b-bf82-7298053a411f` |

Each was handed the **absolute path** to its pre-staged handoff inside this coordinator worktree —
the handoffs live on `coord/1262-self-operation`, **not on `main`**, so a repo-relative path would
have 404'd in their fresh worktrees. Both approved specs *are* on `main` (verified before spawning).

**New agents tab is `w1:t3Q`** (the old `w1:t3J` disappeared when its last pane was reaped; recreate
with `herdr pane move <pane> --new-tab --workspace w1 --label "agents"`). Coordinator tab stays
`w1:t3K` and remains coordinator-only.

### Herdr spawn API — one more correction, verified this session

`herdr agent start <name> --kind claude --pane <ID> -- claude --model sonnet …` **silently eats the
prompt.** `--kind claude` already supplies the binary, so the literal `claude` after `--` is taken as
the prompt and the real one is dropped. The flags still apply (both panes came up on Sonnet with
bypass permissions), so the pane *looks* correctly spawned — the only symptom is the agent replying
"It looks like your message came through empty — just 'claude'". Always read the pane after spawning;
recover by delivering the prompt with `herdr pane run <pane> "<prompt>"` + one `send-keys Enter`.

### Carried forward for the digest — the sizing question is the real one

Not a defect, but the pattern worth Ben's judgement: **#1263 took three relays on one task**, which
suggests tasks are being decomposed past what one context can hold. Also for the digest: the
`format:check` omission above; and the **"too heavy to test" justification in `af2ec6d4`'s commit
body that proved wrong** — it claimed the full `PATCH /api/me/modules/tasks` path needed chat engine
factories, RPC connections, a boss queue and onboarding probes, but Task E drove exactly that path
and found only four required fields on `BuiltInRouteDependencies`. The assessment erred in the
direction that avoids work. #1264/#1265 must not cite it as precedent.

## 2026-07-27 — parallel wave in flight: rulings and relays

### #1265 relayed before writing any code

`build-1265` (session `13aa3da8`) hit 70% during spec-vs-branch verification with **no code written**,
relayed, and was reaped. Successor **`build-1265-self-op`, session `8860e0b7`, pane `w1:p12P`**, same
worktree, confirmed driving on Sonnet 5 by bounded pane read. Its handoff is
`docs/superpowers/handoffs/2026-07-27-1265-module-content-self-operation-relay.md` (allowed — the ban
covers `docs/coordination/` and `docs/superpowers/plans/`).

Findings it carried forward, worth keeping: the news retrofit **was already done in #1263** (matches
the scope correction in its handoff); `news.previewSource` SSRF containment is **adequate as shipped,
no code change needed**; the sports follow/unfollow extraction is real work, not stale spec text; and
the `guidance` field on `news.addTopic` must be **dropped from the tool input schema** — it is
untrusted framing and fails the closed-set rule. The spec pre-authorises that drop.

### #1264 — four-item ruling, verified in code before answering

`build-1264` escalated four items before writing its plan. I read the code myself rather than take
the report; the evidence is in the ruling so it can be cited in the PR.

1. **Prerequisite PR is already satisfied — skipped.** The spec's "lands FIRST" item was to hoist the
   self-operation exclusion check above the YOLO branch. #1263 already did it structurally:
   `executableTools()` drops excluded tools at `gateway.ts:592` ("Fail closed #0"), **both** execute
   call sites (`:355` read, `:431` write) resolve their tool only through `executableTools()`, and
   the YOLO branch at `:161` is reached only after `found` exists. An excluded tool is therefore
   never found and never reaches YOLO or `resolvePolicy`. Told it to record this as evidence, and to
   treat any execution path that resolves a tool *without* `executableTools()` as a stop-and-escalate.

2. **Digest — refused the rename, dropped from scope.** Not a naming collision: the spec contradicts
   itself (line 42 `granted_at_install` vs line 82 external-effect exclusion), and the denylist
   implements line 82 at `self-operation.ts:153` with the prefix `settings.digest.`. The proposed
   `settings.notificationDigest.*` would resolve a **prefix-matched security exclusion by choosing a
   different string** — if a rename can move a tool out of the denylist, the denylist is decorative.
   Narrowing the prefix is the honest version of the same move and loosens a control, so it is Ben's
   call. Parked in `AWAITING-BEN.md` §3b; the rest of the round-one classification proceeds.

3. **Migrations — the split is right, but there are three, not two.** `app.preferences` revision →
   `packages/structured-state/sql/`; `app.instance_settings` revision → `infra/postgres/migrations/`
   (genuinely core: defined in `0004`, and `packages/settings/sql` only ever adds RLS/grants on it).
   The third was hiding inside its item 4: the audit `outcome` closed set is a **DB CHECK
   constraint**, `packages/ai/sql/0127_jarvis_action_audit_log.sql:10`
   (`CHECK (outcome IN ('success','failed','denied','cancelled'))`), so adding `invalid` and
   `conflict` needs a new migration in `packages/ai/sql/` — never an edit to `0127`. Numbers are
   global by landing order; take the next free ones at commit time.

4. **Audit scope acknowledged.** Moving `recordAudit` from fire-and-forget to same-transaction is a
   genuine strengthening. Two constraints attached: settings tools write audit rows **through the
   existing audit port**, never raw SQL against another module's table; and the TS union and the CHECK
   constraint must land together or inserts pass typecheck and fail at runtime. Its ground truth on
   the three net-new pieces (per-actor+per-tool gateway rate limiting, CAS on `PreferencesRepository`,
   undo stack) was verified against the tree and matches the spec's framing.

### Sizing evidence is accumulating

#1265 relayed at 70% with zero code; #1264 reached 62% answering one round of escalation. Both were
told to read the spec **by section**. This is the decomposition-sizing question for Ben, now with
three data points across two lanes, not an agent-performance problem.

### Coordinator state

Context meter passed 70% again; **no relay, per Ben's standing override** ("keep going here"). This
manifest remains the only durable record. Monitor `bxgzk30cj` watches panes `w1:p12M` (#1264) and
`w1:p12P` (#1265) plus both remote branches.

## Continuation note — 2026-07-27, both lanes planning

**Fleet (resolve panes fresh; numbers below reflow):**

| Lane | Agent | Session | Pane | State |
| --- | --- | --- | --- | --- |
| #1264 settings | `settings-1264-b` | `d88f59be` | `w1:p12Q` | plan being written to disk; predecessor `7f52e0b8` reaped |
| #1265 content | `build-1265-self-op` | `8860e0b7` | `w1:p12P` | **plan approved, building** |

Monitor `buwr5kdik` watches pane death + branch commits only (status flips dropped as noise).

**#1265 plan approved** — `docs/superpowers/plans/2026-07-27-module-content-self-operation.md`, 7
tasks. Its `sports_follows` family keeps `defaultTier: ask_each_time` while the tools declare
`granted_at_install`, which is the design working as intended: the grant promotes, the default stays
conservative. Three conditions attached: (1) the install-grant test must be **routing level** — install
the sports module and assert the `assistant.action_policy.v1.sports.sports_follows` row exists, because
#1263's QA caught a helper-level test that would have stayed green while the grant silently never
fired; (2) confirm the tools are not `risk: "destructive"`, since destructive can never auto-run and
`granted_at_install` on one is a silent lie no test catches; (3) do not loosen the exact-count
assertion to dodge the #1264 collision. Its flagged assumption — leaving `DELETE
/api/sports/follows/:id` on the raw repository — was **upheld**: the boundary is RLS +
DataContextDb, not the service layer, so the direct call loses nothing; a why-comment goes at the
route so nobody later "tidies" it by pointing the tool at the id path and dropping catalogKey
resolution.

**#1264's four rulings are now on disk** in `handoff-1264-settings-self-operation.md` (commit
`d0797865`) rather than living only in pane messages. Both lanes were within a few percent of
auto-compact when the rulings were issued, and four contexts across this epic have now ended with
nothing committed — the handoff is the only artifact that survives that. The added ruling this
window: **chat-response-style is in scope but belongs on the chat module's manifest**, with the
three-value enum validated server-side as a closed set. That enum is the entire reason the tool is
not assistant-brain-excluded, so free text reaching the system prompt through it is stop-and-escalate.
Count consequence: it moves the **chat** package's inventory, not settings'.

**Mid-doing:** waiting on #1264's plan pointer for approval; #1265 is building. Neither has opened a
PR. Both are `security` tier — adversarial Opus QA with a posted `gh pr comment` verdict before any
merge, and whichever lands second rebases the exact counts in
`tests/unit/self-operation-manifests.test.ts`.

## Continuation note — 2026-07-27, T1 reopened on a verified finding

**Fleet:** #1264 `settings-1264-b` / `d88f59be` / `w1:p12Q`; #1265 `relay-1265-3` / `38c461d9` /
`w1:p12S` (predecessors `7f52e0b8` and `8860e0b7` reaped). Monitor `bjx9jyxt9` — it watches
**local worktree HEADs**, not `origin` refs; the old monitor could never have fired a commit event
because neither branch is pushed until PR time.

**T1 as committed was cosmetic, and I reopened it.** #1265 reported the `guidance` drop from
`news.addTopic` done in `e71f4f78`. Verified in the tree rather than taken from the report:
`packages/ai/src/gateway/input-validation.ts` states outright that it **deliberately does not
enforce `additionalProperties`**, and `validateToolInput` returns the caller's input object
unchanged — it strips nothing. So an undeclared key still reaches the execute function, and
`packages/news/src/chat-tools.ts:252-255` was still reading `guidance` off the input and persisting
it through `createCustomTopic`. Dropping the field from the schema only stops the model being *told*
about it. **My approval was at fault** — I accepted the plan's "schema-only, no execute-fn change"
framing without checking whether anything enforced the closed set.

Fix ordered before T2: stop reading `guidance` in `chat-tools.ts`, with a why-comment, plus a
regression that calls `newsAddTopicExecute` with the key present in the input object anyway and
asserts the persisted value is null. Explicitly **not** removing `guidance` from the repository,
`packages/shared/src/news-api.ts`, or the REST route — `personalization-routes.ts:469` accepts
user-typed guidance under a `maxLength: 1000` constraint and that is legitimate; the threat is
model-authored text, not human-typed text.

Saved as memory `mem_ms3250ny_14d4e340eb65`. The general rule for the rest of this epic: **a field
removed from a tool's input schema is not contained until the execute function refuses it**, and a
test that drives the schema proves nothing, because the schema is not what enforces it.

**Mid-doing:** #1265 fixing T1 then continuing to T2; #1264 still owes me its plan pointer. No PRs
open.

## Continuation note — 2026-07-27, #1264 plan approved with a required addition

Plan: `docs/superpowers/plans/2026-07-27-module-self-operation-settings-commands.md` (Tasks 0a–11).
Approved — **both lanes are now building.**

The plan is faithful to the spec on the things that matter. Verified rather than assumed: the
`settings.preference-write` family declares `defaultTier: "confirm_once"` with the install grant
setting `trusted_auto` separately (the epic's central rule, correctly applied); the undo stack is
keyed by `${actorUserId}:${chatId}`, matching the spec's "bound to actor **and** chat"; CAS,
`instance_settings` revision (forward infra, no consumer this PR — spec line 134 requires both
tables), and the audit CHECK widen are each their own task. The 20-entry undo cap was flagged by the
agent as an unconfirmed default; **confirmed** — the spec says "bounded" without a number.

**Gap found and closed: per-actor/per-tool rate limiting was absent.** The spec mandates it in the
same implementation-surfaces list the rest of the plan was built from, and pre-rejects the obvious
counter-argument: *"Bounded blast radius is not bounded frequency — an injected loop can otherwise
oscillate a setting indefinitely."* Task 9's no-op suppression is the other half of that bullet and
does not cover it — `light → dark → light` is never a no-op, so suppression never fires. Added as
**Task 12** with three constraints: build it **at the gateway**, not in settings (a settings-local
limiter cannot bound `chat.setResponseStyle`, which is on a different module and equally
oscillatable — and the generic version is the seam #1265/#1267 adopt later); a rate-limited call
reports **`denied`**, never a new `rate_limited` outcome, because the outcome set is closed and a new
value would mean a fourth migration; and it lands **last**, so a stall still leaves everything ahead
of it shippable. Failure to land it is an escalation and a stated gap in the PR body, never a silent
omission on a security-tier PR. The same bullet's metrics (hard-exclusion hits, repeated CAS
failures) are fold-in-if-cheap and explicitly not a blocker.

Its five flagged assumptions were accepted — four are self-correcting at typecheck. The fifth carries
a user-visible consequence to name in the PR body: with chat's own undo out of plan,
`chat.setResponseStyle` has no undo entry, so "change that back" works for the six settings tools and
silently does nothing for response style.

**Mid-doing:** #1264 building Tasks 0a→12; #1265 fixing the reopened T1 then T2. No PRs open. Both
security tier.

## Continuation note — 2026-07-27, both lanes building, coordinator at 70%

**Fleet:** #1264 `settings-1264-c` / pane `w1:p12T` (predecessors `7f52e0b8`, `d88f59be` reaped);
#1265 `relay-1265-3` / `38c461d9` / pane `w1:p12S`. Monitor `bjx9jyxt9` watches local worktree HEADs
and lane liveness by worktree path, so it survives pane renumbering — no update needed on a relay.

**Rate-limiting ruling survived the relay intact** — verified by grepping commit `6e269049`, not
assumed: the gateway-level placement, the `denied` outcome mapping, and the no-op-is-not-enough
rationale all made it into #1264's relay doc, which numbers it Task 13. Numbering differs from my
"Task 12"; content is what matters and it is correct.

**Process note — five contexts across this epic have now ended with zero code**, all in the
grounding phase. Two counter-measures are in force and both worked: order the plan to disk as the
next output with assumptions stated inline (four of #1264's five flagged assumptions are
self-correcting at typecheck), and put rulings in the handoff doc rather than pane messages, which
die at compaction. Saved as memory `mem_ms32dyxp_006b75eaf7e0`. The underlying question — tasks too
small, handoffs too thin, or normal relay cost — stays parked for Ben in `AWAITING-BEN.md` §2.

**Coordinator context at 70%.** Not relaying, per Ben's standing "keep going here" override; this
manifest is therefore the only durable record of the run and is current as of this note.

**Mid-doing:** both lanes building, no PRs open. #1264 runs Tasks 0a→13 (rate limiting last, and a
stall there is an escalation plus a stated PR gap, never a silent omission). #1265 fixes the reopened
T1 — the `guidance` read in `chat-tools.ts`, since the schema drop alone was not containment — then
continues T2→T7. Both are `security` tier: adversarial Opus QA with a posted `gh pr comment` verdict
before any merge, and whichever lands second rebases the exact counts in
`tests/unit/self-operation-manifests.test.ts` without loosening the assertion.

### 2026-07-27 — #1264 read-loop broken; both lanes building

**#1264 (`settings-1264-d`, pane `w1:p12V`, session `43e08f2d`).** Fourth context in the lane. The
first three produced **zero code** — all lost to grounding on a 1129-line plan. Diagnosed as
mechanical, not agent underperformance: the plan carries inline implementation code, so each
successor spent its whole context reading it and relayed with nothing built.

Intervention (commit `53be8ad0`, in the handoff doc so it survives compaction):

- **Whole-plan reads are banned.** Added a per-task line-range map (0a = 35–162, 0b = 163–187, …,
  11 = 1114–1129). One task per read, build, commit, then read the next range. Never read ahead.
- **Recorded the grounding already done** so no successor re-derives it: **migration number is
  `0175`**, not the plan's assumed 0167/0168 (the plan is wrong; #1265 ships no migration so nothing
  shifts it), and **tests extend the existing `tests/integration/*.test.ts` files** — the plan's
  per-package test-file and per-package command instructions are wrong for this repo.
- Told the lane that a fifth context ending with nothing committed means I stop it and park it for
  Ben under `AWAITING-BEN.md` §2, which is the open question this churn is evidence for.

**Result: the loop broke.** The lane is now mid-Task 0a with real code in the tree (revision column
on `app.preferences`, `packages/db/src/types.ts` updated). Doc-only commits on the branch before
this: `cc4dde76`, `05744bcc` (the plan), `91afad3c`, `6e269049`, `f19d5af4`, `4e8c1e8c` (Task 13
folded in per my rate-limiting ruling). It is at 67% context, so it may still relay mid-task —
acceptable now that the read discipline is written down and the next context starts from a map.

**#1265 (pane `w1:p12S`, session `38c461d9`).** Healthy. Two claims verified in the tree rather than
taken on report:

- T1 reopen fixed properly at `f9347444` — `cleanTopic({ label, guidance: undefined })` with a
  why-comment citing that the gateway validator strips nothing, plus an assertion on the existing
  integration test that the persisted row's `guidance` IS NULL. The earlier `e71f4f78` was cosmetic:
  it dropped `guidance` from the schema while the execute fn still read and persisted it.
- The prettier failure was **its own**, not pre-existing — introduced by its commit `4a5794f5`. Fixed
  at `e027c5db` (that file alone, explicit path); `prettier --check` now exits 0. The lane accepted
  the standing rule that any doc gets `prettier --write` before commit, because `format:check` is an
  early link of the CI gate and a warning there means the test suites never run at all.

Now on T2 (`SportsFollowsWriter` + `followTeam`/`unfollowTeam`).

**Reaped:** `w1:p12T` (session `98e3cd6b`). Exactly one live pane per lane, confirmed.

**Continuation note:** both lanes building, neither at PR yet. Next coordinator action is Phase 3 on
whichever opens first — both are `security` tier, so each needs adversarial Opus QA with a posted
`gh pr comment` verdict before merge, and neither auto-merges. Whichever lands second rebases the
exact counts in `tests/unit/self-operation-manifests.test.ts` **without** loosening the assertion to
a range.

### 2026-07-27 — #1264 Task 0a landed (first code in the lane)

`5851d825 feat(structured-state): add CAS revision column to app.preferences`. Verified
structurally (stat + file placement only — no diff read):

- Migration **`0175`**, matching the corrected number, in `packages/structured-state/sql/` — the
  owning module's dir, not `infra/postgres/migrations/`. Correct per the hard invariant.
- **No applied migration modified** (`--diff-filter=M` on `*.sql` is empty), so the hash check holds.
- Tests extend the existing `tests/integration/structured-state.test.ts` and
  `foundation-schema-catalog.test.ts` — the corrected convention, not the plan's wrong per-package
  instruction.

**Gap found by inspection, not by any test:** `packages/structured-state/src/manifest.ts:26`
`database.migrations` still lists only `0031`, `0070`, `0093` — the new `0175` is missing. A focused
module suite stays green with that array stale; this is the exact pattern that broke #254, where the
break stayed latent until the full `pnpm test:integration` at wrap-up. The agent *did* append the row
to `foundation-schema-catalog.test.ts`, which is the other half. Sent as a small self-contained
follow-up commit rather than folded into 0b, so 0a stays bisectable.

Also flagged forward: **0b's revision column is on `app.instance_settings`, a core-owned table**, so
that migration goes in `infra/postgres/migrations/` — not a module `sql/` dir.

**Process fix applied to both lanes.** Coordinator handoff docs live on `coord/1262-self-operation`,
which build agents cannot see from their own branches. Agents are now pointed at the absolute
cross-worktree path (`~/Jarv1s/.claude/worktrees/coord-1262/docs/coordination/...`) and the key
numbers are repeated inline in the pane message, so a ruling survives their compaction. #1264 was at
0% headroom when this was sent, with both messages queued.

**Corrected a stale note in `MEMORY.md`:** the full applied-migration list is asserted in
`tests/integration/foundation-schema-catalog.test.ts`, **not** `foundation.test.ts`. The memory body
was already right; the one-line index — which is what a session reads first — named the wrong file.

### 2026-07-27 — pre-existing manifest drift found; issue #1272 filed

The manifest-migrations gap I flagged on #1264 Task 0a turned out to be **wider than my flag**. The
agent's fix (`96edbcaa`, one file, verified against the directory listing) added three entries, not
one: `0111_preferences_worker_write.sql` and `0167_worker_entities_grant.sql` had been missing from
`packages/structured-state/src/manifest.ts` **before this epic started**. So the epic surfaced
pre-existing drift rather than creating it.

Root cause: structured-state has **no manifest-migrations pinning test**, while sports, chat,
connectors, and briefings all have one. Nothing compares the declared array to the `sql/` directory,
so the two diverged silently — the #254 failure shape again.

**Scope ruling:** the pinning test does **not** go into #1264. It is new work and this repo requires
a GitHub task issue before anything is built. Filed as **issue #1272**. What #1264 owes instead is a
line in its PR body stating that the array had drifted, that it was corrected here, and that no test
yet prevents recurrence — a fixed-but-unguarded gap that goes unmentioned reads as fully solved.

`0176` confirmed as the next free migration number for Task 0b (`0175` is the current repo-wide max).

**#1265 T2/T3 verified in the tree:** `62d8b375` uses `DataContextDb` throughout with no root Kysely
handle and no cross-module internal imports (111 tests green); `3e78b741` routes POST through
`SportsService.followTeam` while **DELETE `/api/sports/follows/:id` correctly stays on the raw
repository** inside `withDataContext`, carrying the required why-comment — REST already holds the row
id, so the service's `catalogKey` → id resolution is only needed by the assistant tool, which never
sees row ids. The binding ruling is honoured. #1265 is 3 of 7 tasks in; #1264 is 1 of 13.
