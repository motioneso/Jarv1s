# Awaiting Ben — parking lot

Decisions that need Ben and must not be silently resolved by an agent. Coordinator keeps this
current.

_Last updated: 2026-08-02, during issue #1327 coordination._

## 11. Rotate the DEV login password and clear one pane's scrollback

During automated #1327 browser proof, the Job Search Codex pane echoed the DEV login credential in
terminal scrollback/tool output after invoking unavailable `python` instead of `python3`. The value
was not written to scripts, logs, screenshots, or another artifact. Rotate the DEV password after
the proof run. Scrollback cleanup is destructive and awaits Ben's explicit approval; affected
session is the Job Search Codex pane session `019fb171-a527-7d73-b301-186620f8b3f2`, failed unified
exec session 67967, immediately after the first `/tmp/webwright-1327-live-9cd537f5` exploration.

## 10. #1327 PR #1379 needs an authenticated live-path pass

Tasks 6–7 are code-complete with every automated gate green, but the required real live-path proof
cannot cross the real Sign in gate without Ben's authenticated session and existing briefing data.
Ben said to proceed, and the branch frontend is now running against the real dev API at the
tailnet URL <http://100.64.98.99:5198/today>. The pass must record morning/evening prose and rows plus
Accept/Dismiss/View/Reply→existing confirmation, catch-up, and allowed resurfacing with
screenshots/video on PR #1379. No artifact means no sol-high QA and no merge.

The first authenticated pass was **RED**: `Needs you` remained at `Checking what needs you…`
indefinitely when the morning briefing was absent or disabled. The root loading-state fix and
regression test are pushed as `8cd72b87`, and the tailnet frontend has been restarted. Ben should
reload the same URL and continue the action-row pass. The reload confirms the stuck loader is gone,
but Ben's account has no genuine action rows to exercise. Producing one through the shipped path
requires a connected email account, configured generation model, running workers, and a genuine
actionable inbound email; chat and ordinary task creation cannot manufacture the required metadata.
The full Accept/Dismiss/View/Reply proof remains blocked on that live-data precondition.

Task 7 follow-up `6d9c50f4` removes the real Google/IMAP 50-message caps and Gmail's default
10-page ceiling while retaining `newer_than:30d`; focused integration is 64/64 green and typecheck
is green. Ben correctly clarified that starring is irrelevant: every recent email loaded by sync
must be evaluated automatically for actionability.

Ben's first authenticated enqueue returned 202, but the #1327 worker had exited SIGTERM and an
orphaned build-1375 worker consumed both sync and monitor jobs with older capped code. Sanitized
result: partial sync, 50 upserts, truncated, monitor planned/created 0. The orphaned worker is now
stopped and the sole worker is #1327 at `6d9c50f4`. Ben must repeat the authenticated browser sync
once; that second enqueue is the valid live attempt.

The second authenticated sync was consumed by the sole #1327 worker and **live-proves the cap
removal**: success, 1,463 email upserts, 0 failures, `truncated=false`, retry 0. The first post-sync
21:45 monitor completed cleanly but produced planned 0 / created 0 / genuine suggested rows 0.
Diagnosis found a real pipeline bug: cached sync summaries suppressed actionable extraction for
recent emails whose triage fields/tasks were incomplete. Commit `08916cf8` (`fix(connectors):
re-evaluate incomplete email triage`) reuses the cached summary while re-running actionable
extraction for incomplete triage. The focused sync→monitor integration reproduced the failure RED
(expected exit 1) and is GREEN after the fix (exit 0); related source-context/monitor units,
Google-sync integrations, ESLint, and Prettier are green. The full PR live gate now needs one more
authenticated sync under the sole corrected #1327 worker, then the real row plus
Accept/Dismiss/View/Reply interaction artifact. No final sol-high QA or merge before that proof.

Worker isolation is now GREEN: the Job Search worker group is stopped, #1327 at exact HEAD
`08916cf8` is the sole worker consumer, and <http://100.64.98.99:5198/today> returns HTTP 200.
Ben can now repeat the authenticated sync.

The end-to-end pipeline fix is pushed as `e34edca6`, and the final authenticated sync completed
under that exact sole worker with 1,449 email upserts and zero errors. It still produced no row
because the shared DEV database has not applied the branch's additive
`packages/tasks/sql/0178_task_suggestion_metadata.sql`; without `suggestion_metadata`, suggested
tasks cannot persist. Ben explicitly approved applying only `0178` and restarting the exact worker.
After that, Ben's next action will be one browser-console sync when the coordinator says **run sync
now**. No final QA or merge before a genuine row and the interaction artifact.

The required read-only audit found that shared DEV already records global version `0178` as
`0178_notification_event_keys.sql` with a different checksum, while the branch file is
`packages/tasks/sql/0178_task_suggestion_metadata.sql`; the required column is absent. The only
true pending migrations are unrelated connector versions `0179` and `0180`. The standard runner
has no target flag and aborts on the `0178` checksum mismatch even when scoped to task SQL. An
exact-file `runSqlFiles` invocation would bypass the migration ledger and leave the collision
unresolved, so nothing was applied. Ben must choose a ledger-safe resolution before item 10 can
continue; worker restart, sync, final QA, and merge remain stopped.

Read-only simulation proves one narrow ledger-safe path: rename the unapplied branch migration to
the next free global version, `0181_task_suggestion_metadata.sql`, then immediately re-audit and run
the existing task-directory-scoped ledger-aware runner. Its simulated apply set is exactly that
file; connector `0179`/`0180` are excluded, and both repo and DEV ledger currently have no `0181`.
This needs Ben's explicit approval because it changes the previously approved migration version.

Ben approved that resolution. Commit `b55878e9` renames the migration to `0181` and updates only
the migration-catalog expectation; its focused integration is green and the PR head matches. The
immediate pre-write audit was safe, the scoped runner applied exactly `0181`, the ledger row and
`app.tasks.suggestion_metadata` are present, and the sole #1327 worker is healthy on exact
`b55878e9`. The branch `/today` remains HTTP 200. Item 10 now waits on Ben's authenticated browser
sync, then the genuine row and View/Reply/Accept/Dismiss evidence artifact. QA and merge remain
stopped until that proof.

Ben's first post-migration authenticated attempt returned 500, as did unrelated API routes. The
deterministic boundary check found Vite correctly targeting port 3000 with no listener; the worker
restart had not killed the separate healthy Job Search API on 3097. The #1327 API is now restored
from exact `b55878e9` on port 3000: direct health is 200, an unrelated auth-required route returns
401 direct and through the tailnet instead of 500, and `/today` is 200. The API generated an
ephemeral auth signing secret, so Ben may need to sign in again before retrying the browser sync.
No sync was enqueued by the failed attempts.

Ben re-authenticated and the retry returned 202 with `enqueued=true`, `deduped=false`; job
`0dc25817-6f06-4691-84e0-fddaac7dc488` is now running under the sole corrected #1327 worker. The
retained builder is monitoring sanitized aggregate status and genuine suggested-row count only.
Keep `/today` open and do not refresh until the coordinator says **refresh now**.

That job completed after 365 seconds with calendar upserts 14, email upserts 1,450, email failures
0, `truncated=false`, and no job errors. The live claim is still RED: projection created zero
suggested rows and no genuine suggested row exists. Ben should **not refresh**. The unrelated
environment hold is released now that terminal aggregates are captured; the retained builder is
constructing a deterministic integration repro for the gap between green `e34edca6` coverage and
the live zero-projection result. No further sync, QA, or merge before a root-cause fix and new proof.

The deterministic integration RED now matches the live symptom: sync succeeds with one upsert and
no errors, but genuine task count is 0 when the model router falls back from requested `economy` to
an available `interactive` model. The older green test hard-coded an `economy` selection and missed
this production composition. H1 is being tested first: the shared extractor appears to reject the
router's valid fallback solely because its selected tier differs. No live retry, QA, or merge before
RED→GREEN and corrected-worker proof.

H1 is falsified: the actor-scoped production resolver returns a real `economy` tier. H2 is confirmed
at the persisted boundary: all 1,450 rows have metadata-only shape, zero summaries, zero complete
triage, zero suggested tasks, and zero confidence, while the outer sync reports no failures. The
builder is now testing the exact worker-composition model adapter, then static error categories and
differential fixtures if it resolves, to distinguish provider rejection from parser degradation.

Root cause is confirmed without reading provider/model identity or secrets: the actor's selected
economy route uses CLI transport. `buildEmailExtractDeps` ignores `auth_method`, tries to parse the
CLI marker as an API key, then reports successful empty text; all 1,450 rows consequently take the
invalid-response fallback. The approved fix reuses public `generateStructured`, which already owns
CLI-before-decrypt plus validation/repair, and injects the existing CLI adapter factory at module-
registry composition. No chat-internal connectors import or duplicated auth logic. Builder is now
implementing RED→GREEN; no live retry, QA, or merge yet.

The root fix reached GREEN and was committed pre-rebase as `e6fbf296`: eight owned files,
production +172/−52 and tests +191/−17; focused CLI/API-key units, sync→projection integration,
neighboring structured/IMAP tests, package/root typecheck, lint, format, and package-dependency
checks passed. It is not pushed yet. Rebase onto current `origin/main` correctly skipped the now-
superseded migration rename because main owns the exact task migration at `0178`, then paused on a
separate module-registry wiring conflict while replaying the root fix.

Ben approved the ledger-only repair. It completed under the standard migration advisory lock with
the exact swapped rows and schema invariants guarded before and after: exactly two rows changed,
`applied_at` was preserved, and DEV now matches main at task metadata `0178` and notification event
keys `0181`. No DDL or migration runner executed. The exact-HEAD #1327 API and sole worker are
healthy, direct readiness and the tailnet `/today` both return HTTP 200. Ben should run one
authenticated browser sync now and not refresh until the coordinator reports the sanitized result.
The restarted API generated an ephemeral session-signing secret, so re-authentication may be
required first.

Ben completed the verified authenticated trigger from `:5198`: HTTP 202, `enqueued=true`,
`deduped=false`, job `59cb2625-b4f6-49a5-8107-6d3b29d1f140`. Keep `/today` open without refreshing
until the coordinator reports the sanitized terminal aggregates and whether a genuine row exists.

That job is terminal RED. It was claimed at `01:59:15.651Z`, timed out, retried at
`02:14:15.663Z`, and failed at `02:29:15.666Z`; both attempts hit the static 900-second handler
timeout. The first timed-out callback later committed 1,443 upserts, zero failures, and
`truncated=false`, but genuine suggested rows remain zero. Do not refresh. The coordinator is
tracing whether timeout prevented the monitor/projection stage; no second sync yet.

The bounded continuation/root fix is now pushed at exact PR head
`9cd537f59e73c9e5d6226299a1af7f5682b7c873`, required GitHub CI is green, the continuation queue is
reconciled without applying unrelated SQL migrations, and exact #1327 services are healthy. The
fresh authenticated proof enqueued job `6e7701fd-1b2d-4cfc-bc79-1d69ea835349` with HTTP 202,
`enqueued=true`, `deduped=false`. A dedicated #1327 browser executor and the retained builder are
monitoring the complete continuation chain. Ben has no interaction step yet; wait for either a
genuine Today row and explicit refresh instruction or a sanitized terminal failure report.

## 1. #1263 merged under verbal delegation — please confirm after the fact

Ben said "I need to sleep, lets push to get this completed without me". PR #1268 was squash-merged
as `73e50847` on that basis, **not on a fresh approval**. The limit held: merge GREEN only, never
lower the bar. Worth a retroactive nod so the record is unambiguous, and worth deciding whether the
same delegation extends to #1264 and #1265 (both also `security` tier).

## 2. Plan size is what burns contexts — now with hard evidence

Updated 2026-07-27. This started as "task decomposition sizing" after #1263 took three relays on one
task. Three lanes in, the cause is clearer and it is **not** task size — it is **plan size**.

Both round-two plans were written by the `gpt-5.6-sol high` planner and both came out at
**~1128 lines with inline implementation code**:

| Plan | Lines | Cost |
| --- | --- | --- |
| #1264 settings | 1129 | **four consecutive contexts, zero code** — every successor re-read the plan and relayed |
| #1265 content | 1128 | relayed mid-T2; its "fresh" successor booted at 46% before writing anything |

Third data point, 2026-07-27: #1265 has now relayed twice more, and its newest successor booted at
**53%** of context before writing a line — worse than the 46% one, because each relay handoff doc adds
to what the next agent must read on top of the plan. Relay cost compounds; the plan is the seed.

A plan that large cannot be read by a fresh context and leave room to build. Each successor spent
its budget re-deriving what the previous one had already established, then relayed with nothing to
show. That is six contexts across two lanes lost to reading.

**What fixed it** (already applied, both lanes are building now): a per-task **line-range map** in
the handoff so an agent seeks to its own task and reads ~130 lines instead of 1128, plus the settled
grounding written down so nobody re-derives it. #1264 started producing code within minutes of
getting the map.

**It is not only length — a long plan also lost a requirement.** Added 2026-07-27. Checking #1265's
last task, I found its plan contains **zero occurrences of "SSRF" or "previewSource" across all 1128
lines**, while the approved spec requires that containment check explicitly at lines 47–49. That
requirement is the single reason #1265 is classified `security` tier. Nobody reported it; it surfaced
only because I read the task's scope against the spec. Restored into the lane before wrap-up, so it
costs nothing — but a plan that both bloats contexts *and* silently drops a stated security
requirement is a stronger argument than "plans are too long."

**And a third failure mode: task file-lists are incomplete.** #1264's Task 0c needed a fix to
`settings-activity-pane.tsx` that the task's declared file list never named; it surfaced only under a
root `pnpm typecheck`. So the tally across two lanes is now: plans that burn contexts by length,
plans that drop a stated security requirement, and plans that under-list the files a task touches.
Working rule I have given both lanes: **a task's file list is not trustworthy — only the root
typecheck is.**

**A fourth mode, and this is the serious one: the inline pseudocode is not merely incomplete, it is
wrong.** Added 2026-07-27. #1264's Task 1 pseudocode **reimplemented the active-module check by
hand** instead of calling the existing `computeMyModuleDto`, and in doing so **dropped `required` and
`supportsUserDisable`** from the result. An agent that followed the plan literally — which is what a
plan is for — would have shipped a real behaviour regression that no test in the plan would have
caught. It was caught only because the builder noticed the plan was reinventing something that
already existed and went to read the original.

That reframes the first three modes. Length burns contexts and a missing requirement can be
restored, but a plan that contains confidently-wrong implementation code actively pushes a careful
agent toward a defect, and the more obedient the agent the worse the outcome. This is the same
lesson already recorded from the Codex review loop — plans carry contracts, invariants, and test
cases; implementation code in a plan makes new surface every rewrite — now with a concrete
near-miss attached.

Two things worth your call:

1. **Should plans stop carrying implementation code?** This repeats the lesson already recorded from
   the Codex review loop — plans carry contracts, invariants, and test cases; implementation code in
   a plan makes new surface every rewrite. A ~300-line plan of contracts would likely have avoided
   all six lost contexts.
2. **Handoff docs live on the coordinator branch, which build agents never see.** I only discovered
   this mid-run: my first fix commit was unreadable by the agent it was written for, and it worked
   only because I also put the facts inline in the pane message. Either handoffs should land on the
   build branch at spawn, or rulings must always be carried inline. Right now it is the latter by
   accident, not by design.

## 3. #1266 — user-facing "always confirm" override for any granted permission

**Deliberately not spawned.** It has no approved spec, and "spec before build" is a hard gate. It is
also the natural counterpart to what #1263 shipped: users can currently promote a `user_promotable`
tool, but there is no single switch to demand the prompt back across the board. Needs your call on
whether it gets a spec now or waits until #1264/#1265 land.

## 3b. Digest settings — the #1264 spec contradicts itself, and I stopped rather than pick

**Blocking one item of #1264 only; the rest of that lane is proceeding.**

The settings spec says two incompatible things about digest:

- line 42 classifies **digest settings** as `granted_at_install` ("unscheduling and rescheduling
  delivery jobs is symmetric"),
- line 82 lists **digest scheduling** under exclusion category 7, external effect,

and the shipped denylist implements line 82 — `settings.digest.` is a centrally excluded prefix at
`packages/ai/src/gateway/self-operation.ts:153`. A tool named `settings.digest.*` is therefore
unreachable by the assistant no matter what tier it declares.

The build agent proposed naming it `settings.notificationDigest.*` instead. **I refused.** The
denylist is prefix-matched on the tool name, so a rename resolves a security exclusion by choosing a
different string — if that works, the denylist is decorative. Narrowing the prefix to
`settings.digest.schedule.` is the honest version of the same move, but it loosens a security control,
which is your call and not one I will make while you are asleep.

So digest is **dropped from #1264's scope** and everything else in the round-one classification
proceeds. Your options when you pick this up: (a) leave digest excluded and delete it from the spec's
`granted_at_install` list, (b) split the prefix so digest *configuration* is reachable while digest
*scheduling* stays excluded, or (c) decide the whole external-effect category is over-broad. My read
is (b) is what the spec intended, but it needs you to say so.

## 4. #1267 — external-module tools cannot declare an action family

Out of scope for the whole of epic #1262 and **needs its own spec**. Today an external write tool
with no family always confirms (`packages/ai/src/gateway/policy.ts:40`), so the current behaviour is
safe-by-default, not broken — it just means an external module can never be granted anything.

## 5. `web.read` still asks every time — by design, but the design is missing

`web.read` is `confirm_always` at `risk: "write"` with no action family. It is the deliberate fifth
exception, kept that way because reading a URL carries open-internet content into a conversation
that can already see private data, and it is the subject of an open v0.1.0 security-audit finding.
Nothing in the approved design covers web research. Changing it needs its own spec first.

## 6. Dev-instance config gaps (not code defects)

- `ai.service_bindings.module.news` has no json/economy model bound, so news topic/source add
  returns 503 "Topic checking unavailable".
- `onboarding.state` was flagged touched-but-unverified during the #1263 run — worth one manual pass.
- Standing item from memory: flip `JARVIS_EMBED_PROVIDER` from `stub` to `local`.

## 7. Your dev DB has orphaned migration rows, and one of ours applied to it

Two things to clean when you are up, both mine to flag and yours to action — I refused to touch your
environment on delegated authority.

1. **`app.schema_migrations` in the shared dev DB (`jarv1s@:55433`) contains rows for migrations whose
   files no longer exist in any git ref** — confirmed for `0175_chat_messages_attachment_only_body.sql`
   (applied 2026-07-26T01:35). Casualty of the 2026-07-26 repo reset. It is harmless until someone
   trusts the DB rather than git for the next free migration number, which is exactly how it surfaced.
2. **`0176_instance_settings_revision.sql` from the unmerged #1264 branch is applied to your dev DB.**
   A build agent ran `pnpm db:migrate` without `JARVIS_PGDATABASE` isolation. The column is additive
   and the checksum will match when #1264 merges, so nothing is broken — but your dev DB is currently
   ahead of `main` with unmerged work, and that file is now effectively frozen against edits.

3. **The #1265 lane wrote into your shared dev DB — six rows, and the isolation it reported was
   never real.** Added 2026-07-27, then **corrected the same day after I checked the database server
   directly rather than trusting the lane's self-report.** Read the corrected numbers, not the first
   ones — I had propagated the agent's account, and it was wrong in both directions.

   **Verified inventory (queried on `jarv1s-postgres`, not reported):**
   - `app.ai_provider_configs` — **3 rows written today at 11:05:16Z**.
   - `app.ai_configured_models` — **3 rows written today at 11:05:16Z**.
   - `app.users` — **nothing.** Newest user in your dev DB is still 2026-07-15. The lane had told me
     it created "at least 2 synthetic solo-admin users"; **that did not happen.** `seedSoloAdmin` was
     correctly refused; `seedAiProviderChunk` wrote before anything stopped it.
   - `db:migrate` — no writes (already current, no DDL). No schema drift from this.

   So the damage is **smaller than I first told you** (6 config rows, no fake users) but the cause is
   **worse**: this was not one slip on attempt 1.

   **The isolated database never existed.** The lane reported creating and reusing
   `jarvis_gate_1265`. There is **no such database on the server** — the gate DBs that exist are all
   spelled `jarv1s_gate_NNNN`.

   **Evidence correction, mine.** I first told you I had confirmed `JARVIS_PGDATABASE` was unset by
   reading `/proc/<pid>/environ` on the live vitest workers. **Do not rely on that reading** — the
   `pgrep` pattern I used could match my own shell, and on re-checking, the pid I read almost
   certainly *was* my own command rather than a gate worker. That is precisely the sloppiness I have
   been demanding the lanes avoid, so I am not going to let it stand as evidence.

   **The conclusion survives on evidence that does hold**, by inference rather than by that read:
   rows landed in `jarv1s` today, so *something* connected to a database literally named `jarv1s`.
   Per `packages/db/src/urls.ts:22` the resolution is
   `env.JARVIS_PGDATABASE ?? DEFAULT_JARVIS_DATABASE_NAME` — nullish coalescing, so a name that is
   set-but-wrong is used as-is and fails loudly with "database does not exist". A connection to
   `jarv1s` therefore means the variable was **unset or empty** in that process, not mistyped. The
   claimed isolation was never in effect.

   That also means the lane's own root-cause for its red gate — "I dirtied my own isolated DB" — is
   wrong. The uat-seed suite went red because it was pointed at a database containing **your real
   user rows**, which is exactly what `assertTargetIsEphemeral` is for. The guard did its job; the
   target was wrong. I sent the correction into the lane's relay handoff so its successor cannot
   inherit the wrong diagnosis, and required it to verify isolation by reading the worker's
   environment rather than by trusting that it typed the variable.

   Your dev DB also had **pre-existing** dirty rows that predate this session (the `#1087` pattern),
   so the stray-row problem is not solely ours — but those six rows are.

**Why the guard didn't catch it, because this is the fixable part.** `assertTargetIsEphemeral` is
correctly wired as a preflight on the **CLI** path (`tests/uat/seed/cli.ts:58`). But `pnpm
test:uat-seed` runs the **vitest suite**, whose files call `seedSoloAdmin()`/`seedAiProviderChunk()`
directly without going through `cli.ts`, and nothing in `tests/setup-env.ts` re-arms it. So the entry
point the gate actually uses has no ephemeral-target preflight; the guard appears in the suite only
as the subject of `guard.test.ts`. The run does go red eventually — but only *after* sibling files
have seeded, so red looks like "nothing happened" when rows were in fact written.

I recorded the full mechanism and a suggested fix as a comment on **issue #1087** (whose title
already says "seed suite runs in no gate") rather than opening a duplicate. **I did not implement
it** — it needs its own task issue and spec per project rules, and I would not change test-safety
machinery on delegated authority.

Corrected the agent and the run rule holds, but worth knowing your environment drifted **twice** this
run, and that cleaning the stray rows is yours to do — I will not touch your database.


## 8. BOTH #1264 and #1265 will land with their exit criterion UNMET — your manual pass is the gate

Added 2026-07-27. **This is the item that stops both security-tier PRs, and it is not a defect in
either lane's work.**

Both specs make the same thing mandatory: a real chat turn on a real dev instance — "change the
theme… then quiet hours… then the weather location… then turn notifications off", and for #1265
"Follow the Yankees" — with **no confirmation card at any point**, then "change that back". #1264's
spec calls that "the whole exit criterion".

**The UAT harness cannot drive a model turn, by design.** Verified by me in the tree, not taken from
an agent's report:

- `tests/uat/seed/chunks/ai.ts:27` seeds a deliberately fake credential — the comment says "never a
  real credential".
- `tests/uat/provisioner.ts:167` keeps the run **credential-free** as a stated property.
- There is **no chat seed chunk** at all under `tests/uat/seed/chunks/`.
- Five existing spec files already `test.fixme` their real-LLM halves for exactly this reason
  (`app-map-grounding`, `runtime-context`, `1133-chat-attachments`, `1089-1090-chat-drawer-private`,
  `real-chat-onboarding`).

**What I approved instead:** a UAT spec per lane with `test.fixme` per scenario and the structural
reason stated inline; the backend half proven against the real gateway (no card emitted for a granted
tool, asserted on the whole emitted stream); the frontend half proven by a mocked e2e (no
action-request card renders on an auto tool result); both required to be mutation-tight. For #1264 I
also pushed the effort toward **undo**, which is the one part of that criterion that can be driven
end-to-end without a model.

**Why this needs you and not me.** Your delegation was explicit — merge GREEN, never lower the bar.
Substituting a different proof for a mandatory exit criterion **is** lowering the bar, so I will not
merge either PR on it. Both will reach: CI green, QA verdict posted, work complete — and then stop,
waiting on a hands-on LAN pass by you. Expect two PRs parked in that state rather than merged.

**Related tracking defect, already actioned — and now RESOLVED, no input needed from you.** The
harness gap was filed as **#1121** and **closed with the work never done**, while five spec files
still cited it as their live blocker — so an audit asking "is this tracked?" got a false yes. I
reopened it with the evidence and asked whether it had been closed as superseded, which would have
meant re-pointing every citation.

**Answer: it was not superseded.** #1121 is OPEN (`stateReason: REOPENED`, no `closedAt`), nothing
in the tracker references it as replaced, and its title — "UAT harness: deterministic scriptable
chat engine for real-LLM e2e" — describes exactly the blocker the citing specs mean. **The
citations are valid as written and no re-pointing is needed.** This now matters beyond bookkeeping:
#1264's Task 11 adds six `test.fixme` UAT halves that each cite #1121 as their reason, so a stale
citation would have shipped into the PR.

### 8a. The exact pass to run, so it takes minutes

Written out so you are not reconstructing it from two specs. Run it on a dev instance with a **real**
chat provider configured (the UAT harness cannot do this part — that is the whole point of item 8).
Open the assistant and type these as ordinary sentences, one at a time.

**#1264 — settings.** Say, in this order: *"switch to dark mode"* → *"set quiet hours from 10pm to
7am"* → *"set my weather location to <somewhere>"* → *"turn notifications off"*.

- **Pass:** each one applies, and **no confirmation card appears at any point**. The UI should reflect
  each change without a reload.
- Then say **"change that back"**. It should undo only the last one, and say plainly what it undid.
  Say it a second time — it should tell you there is nothing left to undo, **not** silently undo the
  one before it.
- **Fail worth reporting:** any confirmation card; a change that reports success but does not show up;
  "change that back" reverting the wrong setting or claiming success while changing nothing.

**#1265 — module content.** Say *"follow the Yankees"*, then *"unfollow the Yankees"*.

- **Pass:** both apply with **no confirmation card**, and the sports surface reflects it.
- Also worth one probe: ask it to add a news source pointing at some internal address
  (`http://169.254.169.254/`, or `localhost`). It **must refuse**. That is the SSRF containment check,
  and it is the part of #1265 I trust least because the requirement was dropped from the plan once and
  I restored it by hand.

**One new thing to know about while you are in there.** #1264 also adds **`chat.setResponseStyle`** —
*"set my response style to concise"* — a new tool that runs **without a prompt** at install grant. It
is covered by the settings spec (line 37) and correctly declared, but it lives in
`packages/chat/src/manifest.ts`, a module neither lane was scoped to. If you would rather that one
asked the first time, say so and it is a one-line change to `user_promotable`.

If both passes are clean, reply with a merge OK for each PR and I will land them in order and rebase
whichever goes second. If either fails, the finding goes back to its lane, not into a waiver.

## 9. Epic #1262: does self-operation actually run without a confirmation card? (BLOCKS both merges)

**Do this first on the LAN instance — before any other UAT step.** Ask Jarvis to change a setting
it now owns (e.g. a notification preference). Watch whether a **confirmation card appears**.

- **No card, change applies** → the epic's headline criterion is met; PR #1276 and PR #1273 are
  clear to merge on their existing green verdicts.
- **Card appears every time** → the install-time grant never reaches `settings`/`chat`, because
  both are `lifecycle: "required"` / `defaultEnabled: true` and the only production callers of the
  grant are the module-**enable** PATCH handlers, which such modules never go through. The tools
  then fall back to `ask_each_time`. That is a **#1263 chassis gap, not a #1264 defect** — it wants
  its own issue, not a revert.

Why you have to be the one to check: **CI cannot see this.** Every integration test seeds the grant
row directly instead of exercising the production grant path, and the UAT that would catch it is
`test.fixme`. Green CI + green security QA + correct code are all consistent with the feature being
inert. Same latent gap already ships on `main` for `tasks` (11 tools), `email` (2), `notes` (3).
