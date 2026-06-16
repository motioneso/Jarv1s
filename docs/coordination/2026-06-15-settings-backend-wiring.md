# Coordination Run — 2026-06-15-settings-backend-wiring

**Date:** 2026-06-15
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `9e61c873-2ed8-47e9-82a4-05357a342163`** (match `agent_session.value` in `herdr pane list`). _(Predecessor `50bba9e9` relayed 2026-06-15; `bac25ddc` relayed 2026-06-15; `0dadd466` adopted 2026-06-15, relayed 2026-06-15; `aef38af5` adopted 2026-06-15 mid-Wave-3, relayed 2026-06-16; `a5665490` adopted 2026-06-16 overnight, relayed 2026-06-16; `465f51d1` adopted 2026-06-16, relayed 2026-06-16; `ce8b93c5` adopted 2026-06-16, relayed 2026-06-16; `9e61c873` adopted 2026-06-16 — successor must update this line.)_ Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. ⚠️ **Pane numbers (`w…-N`) reflow on every restart/split/reap — do NOT trust any pane number written in this file as an identifier; resolve the pane fresh by label+session at read time.** Agents escalate to the **label** (routing, re-claimable); the coordinator merges only when its own pane's **session id** (immutable, NOT the pane number) matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off**
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 1 (#278 db-125 sensitive @ 2831ea5). Relay triggers at 2. Prior: 1 (#275 backup-restore-70, routine). Relay executed 2026-06-16 ~06:50 PDT by `a5665490`. THERMAL: strict one-gate-at-a-time (96°C alert). Future gates: `nice -n 15` / `--no-file-parallelism`. Ben awake, actively working. Prior history
(pre-relay, predecessor `50bba9e9`): 3 merges (#245/#264, #235/#265, #249/#267) + #266 e2e fix + 8
specs banked.

**(pre-relay note, historical)** RELAY had been DEFERRED (documented exception) — rationale: (a) Ben's weekly Claude ~77%, a relay spawns a fresh Claude coordinator
(token cost he's watching); (b) no compaction summary seen (the real tripwire); (c) currently
mid-spec-grill with Ben — a handoff would interrupt the live thread. **HARD RULE: if a compaction
summary appears, relay IMMEDIATELY, merge nothing.** Next build wave OR context pressure → relay
first. Manifest fully flushed; a successor can adopt instantly.

**CONTINUATION NOTE (for any successor):** Wave 1 done. **8 specs banked & committed** in
`docs/superpowers/specs/2026-06-15-*`: persona #240, chat-model #241, export #238, notes-ingest
#248, source-behavior-policy #247, memory-provenance #242, inferred-patterns #243 (+ #244
corrections being grilled now — rec: rejections-only honest log over the #243 shared store).
Remaining to grill: #244 (finishing), admin-AI #252/#253, host #255, connector-health #254;
#246 OAuth = own milestone. No builds running. Next action likely: Ben picks a Wave 2 (build banked
specs) — note migration-serialization (#238/#242/#243/#248/#241/#253 need migrations, claim # at
merge) + file collisions (AI-pane cluster #240/#241/#252/#253; memory-pane cluster #242/#243/#244).

**Epic:** #234 Settings backend wiring (design pass → real). Source-of-truth checklist:
`docs/settings-design-backend-followups.md`. The 2026-06-14 design pass shipped the UI; these
tasks wire placeholders to real backends.

**CI:** GitHub Actions was billing-blocked (jobs refused to start); Ben added $10 to the Actions
budget 2026-06-15. CI triggers only on push/tag/PR (no manual dispatch) — the **first PR this run
opens confirms CI is truly unblocked**. Default = CI-trust (`gh pr checks`); first QA agent must
confirm CI actually executed before relying on it, local-gate (`pnpm verify:foundation`) as backstop.

> This is the coordinator's externalized memory. Keep it CURRENT — it is what lets a fresh
> coordinator adopt this run after a self-handoff. GitHub is the source of truth for
> spec/issue/board status; this file holds only in-flight operational state.

## 🌙 OVERNIGHT AUTONOMOUS RUN (Ben asleep — directive 2026-06-15 ~23:45 PDT)

**Mission:** work through GitHub issues that need **NO spec and NO Ben input** — bug fixes, small
follow-ups, well-specified low-risk cleanups — accumulating them on ONE review branch for Ben's
morning review. Keep ALL dev standards. **Do NOT wait for input; Ben is asleep.** Run the loop
until the queue is dry, then write the HTML report (see END CONDITION).

**ONE-BRANCH MODEL (no `main` merges overnight):**
- Integration branch = **`overnight-batch-2026-06-16`** (pushed; base = origin/main `8594d2d`).
  Worktree `.claude/worktrees/overnight-batch`.
- Each completed+QA'd lane is merged (`git merge --no-ff <lane-branch>`) **INTO the batch branch**,
  then pushed. **NOTHING merges to `main` tonight.**
- Open ONE PR `overnight-batch-2026-06-16 → main` ("🌙 Overnight batch — review in AM, DO NOT
  auto-merge") when the FIRST lane integrates; it accumulates the whole diff = Ben's morning review
  = the real gate (this is also the security-tier sign-off for #247 etc.).
- Per-lane PRs (build agents open PRs → main via wrap-up) are only CI signal + QA targets; after
  integrating, CLOSE each with "integrated into overnight batch PR #<N>".
- Do NOT close issues / move board / close milestones tonight — that happens when Ben merges to main
  in the AM. Track state here + in the final report.

**MODEL-BY-TIME (hard rule):**
- Coordinator = **Sonnet** always (relay successors spawned `claude --model sonnet`).
- Dev builders **before 00:45 PDT 2026-06-16** = **Claude `--model sonnet`**.
- Dev builders **at/after 00:45 PDT 2026-06-16** = **Codex ONLY** (`herdr agent start … -- codex
  exec --dangerously-bypass-approvals-and-sandbox`), for as long as Codex quota lasts; fall back to
  Sonnet only if Codex is exhausted again. Compare `date` (machine IS PDT) at each spawn.
- One-shot internal subagents: Sonnet for mechanical, Opus only for genuine security/design
  adjudication.

**IN-FLIGHT (finish + integrate):** Wave 3 #241 (sensitive), #243 (sensitive), #247 (security; has
worker-RLS migration). Let the 3 Sonnet builders finish → QA each → integrate into the batch branch.
#241/#243 both touch `client.ts` + `chat/routes.ts` → integrate one, the other rebases keep-both.
#247 security lands on the review branch — FLAG prominently in the AM report.

**PER-LANE LOOP:** spawn builder (right model by time) into Agents tab `w653f42bef3ac02:6` (resolve
by label) → builds in its own worktree off CURRENT batch HEAD (sees prior work) → on done spawn
`coordinated-qa` (Sonnet; Opus for security-surface lanes) → if green: merge lane→batch, push, close
per-lane PR → next. QA trusts CI (`gh pr checks`), don't re-run the gate unless red. **2 failed QA
cycles on a lane → SKIP it (note in report), move on — never stall the whole run on one issue.**

**STANDARDS (enforced):** per-lane full gate green; file-size ≤1000 lines (decompose); per-agent
`JARVIS_PGDATABASE`; NEVER edit `apps/web/src/onboarding/**` (OnboardingProviderCheck owns it) or
`docs/coordination/**` (coordinator-only); stage only own paths (never `git add -A`); never edit
applied migrations; module isolation; secrets never escape.

**EXCLUDE from the queue:** all `[spec]` (#222, #224–#232, #270), epics, `[question]` (#11, #14),
held (#239 deletion, #251 alt sign-in), OAuth #246 (own milestone), every Settings `#234` child task
(spec-gated) EXCEPT the in-flight ones, and anything needing a product/design decision or a risky
un-specced migration.

**RELAY:** Sonnet coordinator; relay on context pressure or merge counter (every 2 integrations);
successor bootstrap MUST say "OVERNIGHT AUTONOMOUS — Ben asleep; run the loop; don't wait for input;
switch builders to Codex at/after 00:45 PDT; write the HTML report when the queue is dry."

**END CONDITION:** queue dry (all INCLUDE issues built+integrated or SKIPped-with-reason) → write
**`docs/coordination/overnight-report-2026-06-16.html`** for Ben: per-issue (what changed, files,
tier, QA/CI result, integrated y/n), the batch PR link + final `git diff --stat`, SKIPped items +
why, anything needing his decision/security review, and model/time notes. Then idle (low-frequency
`ScheduleWakeup`) until Ben returns.

**QUEUE:** full build-ready queue in **`docs/coordination/overnight-queue-2026-06-16.md`** — 20
INCLUDE/INCLUDE-PARTIAL issues ranked by blast radius (#131, #70, #145, #128, #158, #125, #114,
#117, #146, #136, #159, #167, #143, #142, #169, #150, #122, #147, #163, #123), with per-issue safe
sub-findings + collision rules. SKIPPED (need Ben): #260, #156, #151, #207.

**⚠️ RELEVANCE CHECK (Ben directive 2026-06-16, MANDATORY per lane):** most queue items are
2026-06-10 OTNR audit findings; much has merged since, so some may be **stale/superseded/already
fixed**. EVERY build lane's FIRST step is: confirm each assigned sub-finding STILL reproduces in the
current code (the file/line/pattern still exists and isn't already resolved). Skip stale
sub-findings; **if the whole issue is superseded, do NOT build — report "superseded, nothing to do"
to the Coordinator and stop.** The Coordinator records every superseded/skipped item in the AM report.
Bake this instruction into every handoff/spawn prompt.

## Parallel non-dev agents (coordinate, don't collide)

- **GeminiCopyPass** (gemini, tab `:3`, pane resolve by label) — copy/brand pass: de-AI user-facing
  text. Isolated worktree `.claude/worktrees/copy-pass`, branch `overnight-copy-pass-2026-06-16`
  (rules in that worktree's `GEMINI_RULES.md`). Scope = UI copy + user docs; OUT: onboarding/**,
  docs/coordination/**, docs/superpowers/**, tests, migrations, the in-flight dev-lane files. Opens
  its own PR → coordinator integrates its branch into `overnight-batch` LAST (after dev lanes;
  resolve conflicts keep-both: dev logic + Gemini copy). It reaches the coordinator via the
  `Coordinator` label.
- **OnboardingProviderCheck** (codex, tab `:3`, pane resolve by label) — **STOPPED on Codex 5h usage
  limit until 00:45 PDT 2026-06-16**; has uncommitted onboarding work in the SHARED main worktree.
  **At/after 00:45, resume it** (`herdr pane send-text`+Enter) and brief it: (a) its usage window
  reset; (b) the user DB was cleared 2026-06-15 (Ben's onboarding test) — fine to proceed; (c) the
  overnight one-branch plan — finish its onboarding-provider-check work, then get its changes onto a
  branch for integration into `overnight-batch` (it SHARES the main worktree with the coordinator,
  so it must stage ONLY its own `apps/web/src/onboarding/**` paths and must NOT disturb the
  coordinator's `docs/coordination/` manifest commits or run `git add -A`). It owns onboarding/** —
  dev lanes still banned from editing there.

## Spec status (Ben directive 2026-06-15)

Ben authorized starting the **no-spec, no-dependency** subset immediately. Wave 1 tasks build
against the shipped design + the follow-ups-doc backend contract + the task issue body — no
separate `docs/superpowers/specs/` file. Every later (spec-gated) task is grilled + specced before
it enters the queue.

## Queue

| Spec / contract | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| --------------- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| follow-ups doc → Memory review/forget; issue #245 | #245 | sensitive | **MERGED** (#264 squash, origin/main bae32ce) | — | — | — | #264 ✓ |
| follow-ups doc → Profile identity; issue #235 | #235 | sensitive | **MERGED** (#265 squash, main 7d27dba; CI green) | — | — | #265 ✓ |
| follow-ups doc → Locale; issue #249 | #249 | routine | **MERGED** (#267 squash, main 46680a3; locale-routes.ts new file, routes.ts 999) | — | — | #267 ✓ |

**✅ WAVE 1 COMPLETE** (2026-06-15): #245 + #235 + #249 all merged (+ #266 e2e CI fix). All
no-spec/low-risk settings-wiring done. main green, CI trustworthy.

**✅ WAVE 2a COMPLETE** (2026-06-15, coordinator `bac25ddc`): both Codex lanes merged. main green @ `8594d2d`.

**🔨 WAVE 3 IN PROGRESS** (coordinator `aef38af5`): **lanes TRANSFERRED Codex→Claude 2026-06-15 ~23:35 PDT** (Ben directive — Codex quota window; the 3 Codex builders were stopped mid-finish, all work was already COMMITTED on-branch so nothing lost). Now 3 **Claude (Sonnet 4.6)** builders in Agents tab `w653f42bef3ac02:6` finishing + opening PRs via coordinated-build/wrap-up. New session ids below. ⚠️ Pane numbers reflow — always resolve by label. **⚠️ BUILDER MODEL = SONNET (Ben, always): spawn Claude build agents with `claude --model sonnet …` — cost over speed. (Opus slip caught+corrected 2026-06-15; weekly at 79%.)**

| Spec | Issue | Tier | Status | Agent label | Session id (stable) | Branch | DB | PR |
| ---- | ----- | ---- | ------ | ----------- | ------------------- | ------ | -- | -- |
| chat-model-override | #241 | sensitive | **✅ INTEGRATED** into overnight-batch PR #273 (7ec9cfe). PR #274 closed. Issue #241 closed. QA GREEN (ad7c56208d68b5ff7). Migration 0091 placeholder. | ChatModel-241 | `f439e37e-f715-42f0-9596-d96056ddc291` | chat-model-override-241 | jarvis_build_chatmodel241 | #274 closed → #273 |
| inferred-patterns | #243 | sensitive | **✅ INTEGRATED** into overnight-batch PR #273 (00:25 PDT). Per-lane PR #271 closed. CI green (VF PASS 6m45s, both smokes PASS). QA green. Migration 0092 placeholder (assign at batch→main merge). | Inferred-243 | `8d17dc42-9979-4352-9e9c-5a0e62930235` | inferred-patterns-243 | jarvis_build_inferred243 | #271 closed → #273 |
| source-behavior-policy | #247 | **security** | **✅ INTEGRATED** into overnight-batch PR #273 (Ben sign-off 2026-06-16 AM). PR #272 closed. Merge conflict resolved: kept both 0092+0093 in foundation.test.ts. Migration placeholder 0093. Fast-follow: add worker-role RLS test for app.preferences. | SourceBhv-247 | `1320d63a-eed8-4db5-9c58-d4b311afb80e` | source-behavior-policy-247 | jarvis_build_sourcebhv247 | #272 closed → #273 |

### 🔁 RELAY → continuation note for successor coordinator (`0dadd466` → successor)

**mid-doing:** Wave 3 is building — all 3 plans approved and agents in TDD flow. No PRs open at relay time. Successor picks up supervision immediately.

- **Lock:** successor sets lock line to ITS session id + resets `merges_since_relay` to 0, commits.
- **Spec-file trap (CONFIRMED):** specs were committed to local main but NOT pushed to `origin/main` (push rejected — origin ahead due to Wave 2a squash-merges diverging from local main; onboarding Codex has uncommitted changes in main worktree, so `git pull --rebase` is unsafe). **Fix applied:** spec files copied directly into each worktree. If successor creates NEW worktrees, must copy specs manually too. Do NOT attempt `git pull` on main while onboarding Codex has uncommitted edits there.
- **Pane-ID confusion (confirmed bug in agents):** Codex agents reliably misreport their own pane ID (they all claim to be in pane `-2` / label `Codex`). Always find an agent by its **label** (`herdr pane list` → match `label` field) and send to that pane id — never use the pane id the agent reports in its escalation.
- **Plan approvals already given:**
  - #241: instance-wide model-metadata reads approved; credential cols must be excluded from all responses.
  - #243: suppression table + signature-based suppression + extraction guard pre-insert approved.
  - #247: new `@jarv1s/source-behaviors` pkg approved; PreferencesRepository injected as port; route split into new file; Task-0 spec restore.
- **Merge order:** #247 first (no migration), then whichever of #241/#243 finishes first, 2nd rebases keep-both on `apps/web/src/api/client.ts` + `packages/chat/src/routes.ts`. After 2 sensitive merges → relay immediately.
- **After #243 merges → queue #244 corrections-log** (spec at `docs/superpowers/specs/2026-06-15-corrections-log.md`; sensitive; shares suppression store built by #243; migration needed).
- **Security-tier held (Ben merge sign-off required):** #238 export, #248 notes-ingest. Can build, cannot auto-merge.
- **Unspecced (grill before queueing):** #252/#253 admin AI (same admin pane as #241 — wait until #241 merges before queuing to avoid collision), #254 connector health, #255 host.
- **Cross-session constraint:** onboarding Codex (`OnboardingProviderCheck` pane, unrelated) owns `apps/web/src/onboarding/**` — ban all agent edits there.
- **merges_since_relay = 0** (reset at successor adoption).

| Spec | Issue | Tier | Status | PR |
| ---- | ----- | ---- | ------ | -- |
| persona-personalization | #240 | sensitive | **✅ MERGED** (#269 squash, origin/main `8594d2d`; no migration; rebased keep-both on #268; issue #240 closed; worktree+branch reaped). QA aa1317e green (no conflict markers, keep-both confirmed, all sensitive invariants incl. preview rate-limit+401). DB `jarvis_build_persona240`. | #269 ✓ |
| memory-provenance | #242 | sensitive | **✅ MERGED** (#268 squash, origin/main `6770046`; migration `0090_chat_memory_facts_provenance.sql` landed; issue #242 closed; reaped). QA a35b73ba green, all invariants pass. DB `jarvis_build_memprov242`. | #268 ✓ |

**merges_since_relay = 2** (#268 + #269, both sensitive) → **RELAY EXECUTED 2026-06-15** by `bac25ddc`.
**⚠️ Backend collision pattern (confirmed AGAIN):** specs in different frontend clusters STILL collide
on `apps/web/src/api/client.ts` + `packages/chat/src/routes.ts` (each adds a route+client method) —
same class as Wave 1 #235/#249. #268 landed first; #269 rebased keep-both cleanly. **This will recur
for #241/#243 — serialize their MERGES (rebase the 2nd), don't merge blind.**

### 🔁 RELAY → continuation note for successor coordinator

- **Lock:** successor must set the lock line (top of file) to ITS session id + reset
  `merges_since_relay` to 0, then commit (the adoption ritual).
- **PENDING bookkeeping (deferred under no-deferral rule — successor closes):** move GitHub **project
  board** items for **#240 and #242 to Done**; check any matching boxes on epic **#234**; milestone
  stays OPEN (many tasks remain). Issues #240/#242 are already CLOSED (canonical). Update
  `docs/settings-design-backend-followups.md` to tick persona + provenance if it tracks them.
- **main = `8594d2d`, green. Next free migration = `0091`** (0090 landed via #268).
- **Unblocked followers (predecessors now merged) — banked specs ready to build:**
  - AI-pane: **#241 chat-model override** (after #240 ✓). Migration. Will touch the SAME shared files
    as #240 (client.ts, chat/routes.ts, settings-ai-pane.tsx).
  - memory-pane: **#243 inferred-patterns** (after #242 ✓), then **#244 corrections-log** (strict
    after #243 — shares store). Both migrations.
  - #241 ∥ #243 are different clusters so can BUILD in parallel, but both touch `client.ts`
    (+likely chat/routes.ts) → **serialize their MERGES** (whichever is 2nd rebases keep-both).
- **Held security-tier (Ben merge sign-off):** #238 export (has async-job piece), #248 notes-ingest.
- **Unspecced (grill before queueing):** #252/#253 admin AI, #254 connector health, #255 host;
  #246 OAuth = own milestone.
- **Cross-session constraint STILL LIVE:** an onboarding Codex is editing `apps/web/src/onboarding/**`
  + onboarding tests — keep banning edits there in every handoff (no settings spec needs it).
- **Build flow that worked:** Codex `exec --dangerously-bypass-approvals-and-sandbox` per lane, locked
  spec = approved plan (no interactive plan handshake — codex is one-shot, exits after opening PR →
  poll for PRs). Per-lane `JARVIS_PGDATABASE`. QA = bg `Agent` (general-purpose, run_in_background,
  isolation worktree, model sonnet) invoking the `coordinated-qa` skill → compact verdict. Merge gate
  = QA-green + core CI green (Verify-foundation + 2 compose-smokes; "Build and publish images" is
  non-required, branch protection has NO required contexts). Rebase collisions via a fresh Codex agent
  in the existing worktree (keep-both), then re-QA the integrated head.

- **Cluster serialization (followers held until predecessor merges):** AI-pane #240 → then #241;
  memory-pane #242 → then #243 → #244. Security-tier #238/#248 held for own handling (Ben sign-off).
- **Cross-session constraint:** an onboarding Codex is editing `apps/web/src/onboarding/**` +
  onboarding tests — both Wave 2a handoffs ban edits there (neither spec needs it anyway).
- **Codex flow:** locked spec = approved plan (no interactive plan-approval handshake — codex exec
  is one-shot autonomous); **poll for PRs**, then QA. Codex may need a manual Enter on sandbox prompts.

**⚠️ BUILDER-RUNTIME WINDOW (Ben directive 2026-06-15 23:26 PDT):** the **current 3 Codex
lanes finish on Codex**, but any **NEW wave spawned before 12:45 AM PDT on 2026-06-16 must use
Claude (`claude`) builders** — Codex quota is exhausted until then. **At/after 12:45 AM PDT
2026-06-16 (~01:00, very soon), swap back to Codex-only** builders. So: don't spawn new Codex build
agents before 00:45 PDT 2026-06-16; if a wave is ready in that short window use Claude
`--permission-mode bypassPermissions` builders (stock coordinated-build interactive flow); after
00:45 PDT it's Codex again. (Machine clock IS Pacific/PDT — compare `date` directly.)

**Build runtime = Codex** (Ben directive 2026-06-15 — spare Claude weekly limit, at 76%) — _see
the builder-runtime window above; default suspended only for a wave spawned before 12:45 AM PDT
2026-06-16_. Flow:
Claude plans → coordinator validates/approves → **Codex `exec` builds + opens PR** → coordinator
QA → merge. Codex builders spawned via `herdr agent start … -- codex exec
--dangerously-bypass-approvals-and-sandbox`; per-agent `JARVIS_PGDATABASE` for DB-touching tasks
(prof = `jarvis_build_prof235`). Codex won't push escalations reliably → **poll for PRs**.

Status vocabulary: `queued` → `building` → `awaiting-plan-approval` → `blocked` →
`pr-open` → `qa` → `qa-failed`/`rework` → `awaiting-ben-signoff` (security) → `merged`
(or `handed-off` when relayed to a fresh session).

## Dependency / merge order

- **Parallel now:** #245 (Codex) + #235 (Codex). #245 is fully independent (UI-only, existing
  routes). #235 establishes the injected `preferencesRepository` port in `packages/settings`.
- **Serialized chain:** #235 → #249. ⚠️ **Phase-0 map missed a BACKEND collision** (it tiered only
  frontend files): #235 and #249 BOTH edit `packages/settings/src/routes.ts`,
  `packages/shared/src/platform-api.ts`, `apps/web/src/api/client.ts`. Plus `routes.ts` is at
  966/1000 — #235 takes it to ~999, so #249 **cannot append** locale routes there.
  **#249 resolution (when it builds, after #235 merges):** rebase on merged main; **reuse the
  injected `preferencesRepository` port** #235 added (do NOT add `@jarv1s/structured-state` as a
  settings dep, do NOT `new PreferencesRepository()`); put locale routes in a **new file**, not
  `routes.ts`. This also fixes the module-isolation inconsistency in #249's original plan.
- **Merge order:** #245 and #235 either order; #249 strictly after #235.

## CI-fix side-quest (Ben priority 2026-06-15: fix CI before resuming specs)

- `main` has 2 failing **wellness** Playwright e2e (`guided-check-in-can-be-saved`,
  `manage-meds-add-medication`) — stale selectors after the picker redesign (#262 radial wheel,
  pass-5). They slipped in because CI was down (billing) through wellness passes #261–263.
- **fix-e2e** agent (Herdr **Claude Sonnet**, restart-safe; Codex impractical for iterative
  Playwright + sandbox prompts; bg Agent dies on disconnect) building on branch `wellness-e2e-fix`
  off origin/main → PR to main → CI-verify → merge. Then `main` is green.
- **#235/#265 is BLOCKED on this**: its CI red is ONLY these 2 unrelated wellness e2e. Once the
  e2e fix merges, rebase #265 → green → merge (no waiver needed). prof code already QA-GREEN.
- Spec grilling resumes (next in doc order) **after** e2e is fixed (Ben).

## Decisions (coordinator, keep fleet moving)

- **Module-isolation pattern for settings→preferences = INJECTION** (duck-typed port in
  `settings/routes.ts` + concrete `PreferencesRepository` injected from `module-registry`), per
  #235's plan. #249's original "add the dep directly" approach is **rejected**. (Hard Invariant:
  module isolation. Decided by coordinator — clear, no security/data-loss stakes — informed Ben.)

- **#247 worker RLS grant on `app.preferences` = APPROVED Option A** (coordinator `aef38af5`,
  2026-06-15). Briefings worker (`jarvis_worker_runtime`) must read `app.preferences` for
  calendar/email briefing prefs; 0031 grants/policies prefs to `jarvis_app_runtime` only → worker
  job permission-fails. Option B (skip scheduled briefings) violates spec; C (prefs in job payload)
  violates metadata-only — both Hard-Invariant violations. A is the established
  `*_worker_runtime_grants` pattern (chat 0036, connectors 0069, briefings 0085): NEW migration in
  `packages/structured-state/sql/` — `GRANT SELECT … TO jarvis_worker_runtime` + extend
  `preferences_select` policy to the worker role, owner-scoped `owner_user_id =
  app.current_actor_user_id()`, no BYPASSRLS, SELECT-only. **Retiers #247 to security** (Opus QA +
  Ben sign-off). Migration # claimed at merge. Worker must set the actor GUC before SELECT.

## Backlog (gated — not yet queued)

- **Specs banked (approved, ready to build) — 8 total:** #240 persona, #241 chat-model
  (admin-gated), #238 export (security), #248 notes-ingest v1 (security; local + NotesSource seam),
  #247 source-behavior policy (sensitive; registry-driven), #242 memory-provenance (sensitive),
  #243 inferred-patterns (sensitive; reject=delete+suppress), #244 corrections-log (sensitive;
  Option B — LLM-captured via extract-facts + shares store with #243). **Memory cluster fully
  specced.** All in `docs/superpowers/specs/2026-06-15-*`.
- **NEW future milestone:** **MCP notes-source** (#248 phase 2) — outbound MCP client + resources +
  per-user server config; net-new (existing MCP infra is Jarvis-as-server, tools-only). Own spec.
- **Spec-needed (grill before queueing):** #243 memory patterns, #244 corrections log, #246 OAuth
  (own milestone), #247 cal/email behaviors, #252 admin AI test-conn, #253 routing persistence,
  #254 connector health, #255 host control.
- **Migration-serialized (claim # at merge; next free = 0090, wellness at 0089):** #242, #244,
  likely #243/#253/#238/#248/#254.
- **Security-tier (Ben merge sign-off):** #237 sessions, #246 OAuth, #248 notes-ingest, #252
  admin AI, #255 host control.
- **HELD / out-of-scope (do not build):** #239 account deletion, #251 alt sign-in.

## Migration-number broker

Multiple live wellness/calendar/briefings worktrees can add migrations concurrently (wellness owns
top = 0089). **Rule:** migration-bearing #234 PRs claim their number **at merge time, not author
time**, and rebase the migration number before merge to avoid hash-conflict collisions. Wave 1 has
**no** migration-bearing task, so no broker action needed yet.

## CI waivers

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| ~~Verify-foundation / 2 wellness e2e~~ — **MOOT/RESOLVED**: root-caused as stale selectors after picker redesign; fixed by **#266** (test-only) merged to main (`f6ab159`). No waiver needed; prof rebased on green main. | #265 | n/a | #266 fix merged; main CI green | resolved — no waiver |

## Outstanding escalations

- [x] **CI restored** (Ben re-enabled 2026-06-15). Reopen #265 fired run 27592173609 → back to
      **CI-trust** for the gate (restart-immune; background bash QA kept dying on disconnections).
      prof #265 code-review already GREEN; merge when CI green. #238 export Q2 = **async job** (recorded
      for resume). Spec grilling **PAUSED** per Ben until build side settles.
- [ ] **QA agent spawn pattern:** `coordinated-qa` is NOT a registered Agent subagent_type — spawn
      `general-purpose` (run_in_background + isolation worktree) and instruct it to invoke the
      `coordinated-qa` **skill** via the Skill tool. (mem-245 QA = bg agent a7a8.)
- [x] #240 persona — spec written + Ben-approved.
- [~] #241 chat-model override — Q1=admin-gated (C); **awaiting Ben's Q2 (gate granularity:
      global / per-model allowlist / per-user)**; recommended per-model allowlist.

## Reaped sessions

- <none yet>

### 🔁 RELAY → continuation note for successor coordinator (`a5665490` → successor)

**Relaying 2026-06-16 ~06:50 PDT.** Ben is AWAKE and actively working. Keep queuing lanes.

**mid-doing:**
- **#247 integrated** into overnight-batch PR #273 (Ben sign-off). PR #272 closed.
- **#243 integrated** into overnight-batch PR #273. PR #271 closed.
- **#131 vault** — SUPERSEDED (all findings already fixed in current code).
- **ChatModel-241 (#241)** — **PR #274** open. CI all-green (4/4). QA agent `a2de0ab57f8c21f9c` running — sub-verifier `abef4a4425ba19979` checking allowedModels/allowed field mismatch (still live). Merge target: overnight-batch PR #273. **Sensitive tier.** Successor: resume QA agent via SendMessage to `a2de0ab57f8c21f9c`; if GREEN merge into overnight-batch, push, comment+close PR #274, close issue #241. If RED relay finding to ChatModel-241 pane for fix.
- **Backup-70 (#70)** — **✅ INTEGRATED** into overnight-batch @ dde7ca1. PR #275 closed. Issue #70 closed.
- **Calendar-145 (#145)** — SUPERSEDED (all 3 findings fixed in 7ef3146). Issue #145 closed.
- **Auth-128 (#128)** — **PR #276** open. VF=0, audit=0. **QA GREEN** (`a4ac028c0074aa0a8`). CI pending (all 3 checks). Fix1+Fix2 TDD green; Fix3 superseded. Follow-up issue #277 filed. Merge target: overnight-batch PR #273. **Routine tier.** Successor: wait for CI green (`gh pr checks 276`) then merge into overnight-batch, push, comment+close PR #276, close issue #128.
- **merges_since_relay = 1** (#70). Next merge hits 2 → relay again immediately after.
- **Next queue (after #241+#128 integrate):** #158 jobs, #125 db, #114 vault/secrets — see overnight-queue-2026-06-16.md. Use Codex builders (Ben directive).
- **Overnight-batch PR #273** open (overnight-batch-2026-06-16 → main). Do NOT merge to main.
- **OnboardingProviderCheck** (Codex pane resolve by label) — working in main worktree on onboarding-provider-check-2026-06-16 branch. Stage only apps/web/src/onboarding/**. Do not disturb.
- **GeminiCopyPass** — integrate LAST after all dev lanes.
- **Queue** — after #241 and #70 integrate, continue with #145 → #128 → #158 → etc. per `docs/coordination/overnight-queue-2026-06-16.md`. Do relevance check per lane FIRST.
- **Batch PR #273** — open, `overnight-batch-2026-06-16 → main`. Do NOT merge to main; Ben reviews.
- **OnboardingProviderCheck** — still idle. Briefed but Codex agent didn't pick up. Try again.
- **GeminiCopyPass** — paused at copy-pass worktree. Resume AFTER dev lanes; integrate LAST.
- **THERMAL** — strict one-gate-at-a-time (single test-gate peaks ~94°C). Alert at sustained ≥96°C. Ben watching. Future gate spawns: prefix with `nice -n 15` or use `--no-file-parallelism`.
- **Migration counter** — next free = 0094 (0090=mem-prov, 0091=chatmodel-override-placeholder, 0092=inferred-patterns, 0093=source-behaviors). Claim at merge not author time.
- **Lock:** successor sets lock line to ITS session id + resets merges_since_relay to 0.

### 🔁 RELAY → continuation note for successor coordinator (`ce8b93c5` → successor)

**Relaying 2026-06-16 (Ben awake, actively working). merges_since_relay = 2 → relay rule fired.**

**OVERNIGHT AUTONOMOUS — Ben awake; keep queuing lanes; use Codex builders; write HTML report when queue is dry.**

**mid-doing:**
- **#241 chat-model-override** — **✅ INTEGRATED** into overnight-batch PR #273 @ 7ec9cfe. PR #274 closed. Issue #241 closed. QA GREEN. Migration 0091 placeholder (claim at batch→main merge).
- **#128 auth-128** — **✅ INTEGRATED** into overnight-batch PR #273 @ 14d8336. PR #276 closed. Issue #128 closed. QA GREEN. Follow-up issue #277 filed.
- **overnight-batch HEAD: 14d8336** (overnight-batch-2026-06-16, pushed).
- **Batch PR #273** open (`overnight-batch-2026-06-16 → main`). Do NOT merge to main; Ben reviews at AM.
- **No active build agents.** All Wave 3 complete. Ready for next wave.
- **Next queue (Codex builders, Ben directive):** #158 jobs, #125 db — see `docs/coordination/overnight-queue-2026-06-16.md` for ranked list and safe sub-findings. Do RELEVANCE CHECK first per lane (many are 2026-06-10 OTNR audit findings; much has merged since). Then #114 vault/secrets, etc.
- **#158 jobs** — **SUPERSEDED** (all 3 safe sub-findings already fixed).
- **#125 db** — **✅ MERGED** into overnight-batch @ 2831ea5 (PR #278 merged, issue #125 closed). CI 3/3 green. Sensitive.
- **#114 vault/secrets** — **SUPERSEDED** (`assertNoSymlinkEscape` in vault-ops.ts already does full realpath walk; GCM: already fixed in secret-cipher.ts).
- **#117 RLS** — **SUPERSEDED** (migration 0059_admin_tables_rls.sql already has ENABLE+FORCE RLS on instance_settings and admin_audit_events).
- **#146 memory** — **building** (worktree `.claude/worktrees/memory-146`, branch `memory-146`). Live: RLS policies for `chat_memory_facts` need `TO jarvis_app_runtime, jarvis_worker_runtime` clauses (new migration, claim number at merge). Agent: `Memory-146`, Codex.
- **OnboardingProviderCheck** (Codex pane, resolve by label `OnboardingProviderCheck-2`) — working in main worktree on branch `onboarding-provider-check-2026-06-16`. Stage only `apps/web/src/onboarding/**`. Do NOT disturb. Owns onboarding/**; ban all dev lane edits there.
- **GeminiCopyPass** — integrate LAST after all dev lanes. Branch `overnight-copy-pass-2026-06-16`, worktree `copy-pass`.
- **Migration counter** — next free = 0094. Claim at merge not author time.
- **THERMAL** — strict one-gate-at-a-time. `nice -n 15` prefix on gate spawns. Alert at sustained ≥96°C.
- **Per-merge digest to Ben:** PR #274 (sensitive, QA green, migration 0091); PR #276 (routine, QA green, auth hardening fix).
