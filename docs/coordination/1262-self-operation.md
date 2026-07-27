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
