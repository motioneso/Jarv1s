# Handoff — Job Search module

**Date:** 2026-07-27 · **Branch:** `feat/job-search` (off `origin/main` @ `73e50847`)
**You are the coordinator for this module from here on.** The previous session is closed.

---

## What this is

Ben was laid off and is customer zero for a **Job Search** module in Jarvis. The design interview
is finished, the spec is approved, the UI direction is settled by a throwaway prototype. No product
code has been written yet.

The module is called **Job Search**. "Compass" was the title of Ben's source requirements doc only —
he explicitly rejected it as a product name. It survives solely as an old worktree directory name.
Do not use it in code, UI, docs, issues, or commits.

**Never reference any previous job-search build's failure history.** An earlier attempt was
abandoned; that history is not context, it is noise. Ben has said so directly.

---

## Where things stand

| Artifact                                                        | State                                               |
| --------------------------------------------------------------- | --------------------------------------------------- |
| `docs/superpowers/specs/2026-07-26-job-search-module-design.md` | **Approved.** Header still says "Draft" — fix that. |
| `docs/superpowers/plans/2026-07-26-job-search-module.md`        | 8179 lines. **Mid-rewrite — see below.**            |
| `apps/web/src/job-search-prototype/` + `main.tsx`               | Prototype, throwaway, committed on this branch      |
| GitHub epic + task issues                                       | **Do not exist yet.** First real action.            |
| Product code                                                    | None.                                               |

### The plan is mid-rewrite and that is the immediate job

The plan originally pre-wrote roughly 6000 lines of real implementation code. It went through six
adversarial Codex review rounds and **never converged** — blockers per round ran 5 → 4 → 4 → 6, all
`NOT LOCKED`. The findings were genuine each round but were mostly _new_ surface: every wholesale
rewrite of a task manufactured fresh code for the next round to attack. There is no floor to that
loop.

Ben's ruling, 2026-07-26: **"the plan doesn't need that kind of detail."**

A plan carries **contracts, invariants, and test cases**. Not implementations. The code gets written
against a real compiler, not pre-written in Markdown.

**This overrides the `superpowers:writing-plans` skill**, which mandates complete code in every step
and forbids placeholders. User instruction beats skill. Do not restore code to satisfy it, and do
not let a reviewer talk you into restoring it.

The rewrite was being staged as one part file per section, to be concatenated at the end.
**20 of 30 sections are drafted** and are in `parts/` here. `rewrite-method.md` holds the row map:
part file → source line span in the fat plan → done/not.

**Remaining: rows 06–15** — source lines 1822–4930 of the fat plan:

| Row | Part file                | Covers                        |
| --- | ------------------------ | ----------------------------- |
| 06  | `06-task02d-badge.md`    | Task 2d — nav badge seam      |
| 07  | `07-task02e-deadline.md` | Task 2e — worker deadline     |
| 08  | `08-task03-scaffold.md`  | Task 3 — module scaffold      |
| 09  | `09-task04-schema.md`    | Task 4 — tables + RLS         |
| 10  | `10-task05-records.md`   | Task 5 — domain records       |
| 11  | `11-task06-excludes.md`  | Task 6 — hard excludes        |
| 12  | `12-task07-dedupe.md`    | Task 7 — cross-portal dedupe  |
| 13  | `13-task08-triage.md`    | Task 8 — embedding triage     |
| 14  | `14-task09-score.md`     | Task 9 — Fit/Want scoring     |
| 15  | `15-task10-criteria.md`  | Task 10 — criteria extraction |

Then: concatenate `parts/` in numeric order into
`docs/superpowers/plans/2026-07-26-job-search-module.md`, run prettier, and verify.

### What to keep and what to cut when thinning

`thin-brief.md` here is the full standard. In short —

**Keep:** task boundaries and **frozen numbering** (tasks 17–23 are cross-referenced by number —
never renumber); ordering and dependencies; exact file paths; exported type and function
**signatures** verbatim; manifest JSON verbatim; **SQL DDL verbatim** (a migration is hash-checked
and can never be edited after it applies, so its DDL is a decision, not an implementation);
invariants and rulings with their `file:line` evidence; test cases stated as a name, what it
asserts, and why it would fail against a plausible broken implementation; verification commands
with expected exit codes.

**Cut:** function bodies; illustrative code that is not a contract; the five-step TDD ceremony
repeated per task (state once, globally, that every task is TDD and commits at the end).

### The ledger is the thing that survives

`rulings-ledger.md` (600 lines) holds every finding from review rounds 1–6 that is a **fact about
the tree** or a **decision taken**, with `file:line`, including the ones judged invalid. Six rounds
of review bought those. The code they critiqued is being deleted; **the constraints must not be.**
Sections A–M cover schema/RLS, worker runtime and lanes, AI budget, the module DB port, host fetch,
manifest/queues, notifications, chat surfaces, the web contract, briefings, test-harness realities,
product decisions already taken, and claims that were rejected or corrected.

`r6-status.md` records which round-6 findings were applied (5 of 12) and which were not (7). The
unapplied ones must still be honoured — as constraints now, not as code.

---

## Verification technique that works on this file

The plan is large and editing big spans with the Edit tool has failed here repeatedly. Draft into a
part file, then splice by index in `python3` with assertions on the boundary lines first, and
re-check landmark headings after each splice.

**Count NUL bytes in python3, never with grep:**
`python3 -c "print(open(p,'rb').read().count(b'\x00'))"`. Bash cannot embed a NUL, so
`grep -c $'\x00' file` degenerates to `grep -c ""` and matches every line. NUL bytes have been
written into this file before; the tell is `grep` returning _no output at all_ for the whole file.

Post-assembly checks: 23 `### Task` headings survive, NUL count 0, prettier exits 0.

---

## Decisions already taken (do not re-litigate)

From the spec's locked rulings and the design interview:

1. **Crawler in v1.** Real portals, real postings — not a manual-entry tracker.
2. **No paywalled or login-walled sources.** If a portal demands an account before it shows
   postings, the crawler **hard stops** for that portal and disables it with a stated cause. It
   never signs in and never uses stored user credentials against a job board. Ben has authorized
   working around anti-bot measures on _public_ pages for his own self-hosted instance; scraping
   behind a paywall is out.
3. **Fit and Want, never blended.** Two axes, 0–100, always labelled, always travelling together.
   No screen, API response, export, tool result, or briefing line may show a combined, weighted, or
   averaged score. The gap between the two numbers _is_ the product.
4. **Render from records, never from model prose.** Every element on every screen is built from a
   stored field. No screen region is "whatever the model wrote."
5. **Structured failure causes.** No bare "job search failed." Every failure carries which portal,
   what kind (`rate_limited | login_required | parse_failed | network`), what was retrieved before
   it stopped, when it last worked, and what happens next.
6. **The recall case is protected.** The triage cut reserves a slice for postings outside the
   user's stated frame, surfaced flagged as such. The stated frame is an input, not a fence. A
   triage that only keeps close matches to the stated criteria is a spec violation.
7. **Résumé is first-class**, one per search profile, versioned. Never transmitted to a job board —
   v1 does not submit applications.
8. **Real open conversation.** The job-search thread is a full-capability assistant session with
   the complete tool set, not a constrained wizard. It differs from the main thread only by seed
   prompt and scope.
9. **Chat lives in the core header control.** The module must **not** add its own chat button — the
   control already exists in the core header. One chat implementation, two renderings, N threads.
   A job-search thread must never appear in the main drawer transcript, and vice versa.
10. **Dynamic per-user fetch-host grants are DEFERRED.** v1 ships the three declared sources
    (Indeed, LinkedIn guest, freehire.me — the last covers ~50 ATS boards under one host).
    User-nominated portals move to a later milestone. This was Ben's call and it is settled.
11. **UI direction approved, visual style NOT locked.** Chat-only onboarding until the profile has
    criteria, then a dense console board. Style gets its own design pass later.

### Still open for Ben — two small ones

Spec §13. I picked defaults so they don't block; confirm or overrule when he's available.

- **Briefing detail levels** — default: headline-count / top-matches / full-read, as spec'd.
- **Dismissed postings** — default: stay hidden, but resurface if the criteria later change, with
  the reason shown.

---

## Traps that have already cost real time

All carry `file:line` evidence in `rulings-ledger.md`. The load-bearing ones:

- **A browser cannot call a `write` tool at all.** `packages/ai/src/routes.ts:645-668` creates a
  pending assistant action and returns **403 `confirmation_required`** before `execute`. So the
  board's dismiss action must go through `runQueue`, not `invokeTool`.
- **A worker handler cannot enqueue.** The only production enqueue path is
  `POST /api/modules/:id/queues/:name/run`, gated on `allowManualRun`. So crawl → triage → score
  must run in ONE invocation.
- **Per-module serialization is a security boundary.** `ExternalModuleWorkerRuntime` keeps one child
  process and one mutable `state.current` per module; every child RPC dispatches through whichever
  invocation occupies that slot. Ruling: key the `states` map by `` `${module.id}:${lane}` ``.
  `WorkerLane` is `"queue" | "tool" | "briefing"`.
- **The flat 30 s invocation timeout is real and unfixed** (`worker-runtime.ts:88-92`). It counts
  host RPC latency, so a slow `ai.generateStructured` eats the module's budget. Failure is
  invisible: a `failed / handler_error` audit row with nothing logged, because `runHandler` in
  `packages/ai/src/gateway/gateway.ts` swallows throws with a bare `catch {}`. This is why Phase 0
  grew from five core tasks to six — a genuine blocker in the tree, not a design preference. Tell
  Ben that when you next report.
- **The `actorUserId` envelope trap.** The host spreads `actorUserId` onto every external tool
  input. Strict unknown-key validators MUST strip it at the worker boundary or every call dies with
  `unknown key: actorUserId`.
- **`ctx.fetch` is not WHATWG fetch.** `host-fetch` rejects IP literals and ports, requires
  HTTPS/443, and rejects DNS answers resolving to loopback or private space.
- **No transaction control in the module DB port.** A `FOR UPDATE` CTE does not refresh a
  statement's READ COMMITTED snapshot, so `MAX(version)+1` races. Use
  `INSERT … SELECT max(version)+1 … ON CONFLICT DO NOTHING RETURNING` with bounded retry.
- **External-module JSX needs an explicit `key?: string` prop** on every keyed component — modules
  compile with their own `h` factory so `key` isn't compiler-stripped. Only `pnpm typecheck` covers
  this.

### Two test tiers — do not confuse them

A previous session got this wrong and wasted effort proposing to build a harness that already
exists.

- **`tests/e2e/` is the MOCKED tier, by design.** All specs intercept routes;
  `playwright.config.ts` starts only Vite on `http://127.0.0.1:4173`. No API, no worker, no DB.
  A real-stack test must not live here.
- **`tests/uat/` is the REAL-STACK tier.** `pnpm test:uat` → `tests/uat/run-uat.ts`;
  `tests/uat/provisioner.ts` boots a prod-shaped Docker Compose stack. **External-module precedent
  already exists**: finance ships `finance-budget.uat.spec.ts`, `finance-feed.uat.spec.ts`,
  `finance-reports.uat.spec.ts`. Job Search's Task 22 models those.
- **`pnpm dev:instance` does not exist in this tree.** It was a repo-reset casualty. Nothing should
  depend on it.
- The only genuine harness gap is a small provisioner delta: a fixture HTTP origin reachable from
  **inside the worker container**, and `JARVIS_E2E_MODULE_FETCH_BASE` in the worker's env **before
  it boots**.

Ben's standing rule that every UI/UX feature ships with an e2e test on a real instance is satisfied
by the **uat** tier.

---

## Process gates you must honour

- **Anything built needs a GitHub `task` issue (`Part of #N`) plus an approved spec, before code.**
  Both gates. The spec exists; the issues do not. Create the epic and its child tasks off the
  frozen task numbering before writing any product code.
- **Module owns everything.** No core changes except where core is genuinely missing a capability
  other modules would also want. Three such changes are identified and justified in spec §10; each
  needs its own task issue.
- **Never edit an applied migration** — the runner hash-checks. Module SQL lives in the module's
  own `sql/` directory, never `infra/postgres/migrations/`.
- **Never trust a "done."** Full gate with a real exit code. **Never `| tail`** — a background
  command ending in `tail` masks a failing gate as exit 0.
- Do not spawn subagents, run workflows, or use deep research unless Ben asks. A Codex review round
  is the sanctioned exception when the work calls for one.
- **Never `git add -A` / `git add .`** — other sessions share the wider tree. Stage explicit paths.
- **Never bare `git stash` / `git stash pop`** — the stash stack is shared across worktrees.
- Ben wants concision. A few lines per report, plain English, lead with results.
- The prototype under `apps/web/src/job-search-prototype/` and its `main.tsx` mount are
  **throwaway**. Delete both before this branch merges, and leave a pointer to this branch on the
  implementation issue.

---

## State as of 2026-07-27 (steps 1–4 done)

Committed: `fa205ccc`, on `feat/job-search`. The plan is assembled and verified — prettier exit 0,
0 NUL bytes, 5386 lines, 27 `### Task` headings. The "23" in step 3 below counts **numbered** tasks;
the four lettered Phase 0 sub-tasks (2b–2e) bring it to 27, and the committed fat plan had 27 too, so
numbering is intact and frozen. The one intended heading change is Task 22, now "UAT test on the real
prod-shaped stack" (K8/M6: `pnpm dev:instance` does not exist; `pnpm test:uat` is the harness).

Step 4's conformance read found **one real hole, in three places: nothing rendered a conversation.**
Spec §7 makes onboarding a full chat interface and lists three match actions; the plan had chips-only
onboarding and Dismiss alone. Spec §8's "Discuss opens the thread with the posting as a rendered
record card" had no owner. Task 22 phases 3 and 6 already asserted a chat no task built. Fixed inside
the frozen numbers: Task 19 renders `assistantSurface.Surface`; Task 20 gains `discuss.tsx`,
Discuss + Open posting; Task 22 gains a Discuss journey phase. No new host seam — `localRows` and
`submitTurn({controlContext})` both already exist. Also fixed: Task 5 now defines `Profile`,
`ProfileState`, `ProfileContext`, `BriefingDetail` (the store referenced them, no task declared
them), and Task 17 binds `profile.surfaceKey` rather than `profile.id`, matching Task 4's column.

**Open for Ben, beyond the two spec questions:** there is no per-profile delete tool. Account
deletion cascades (every table is `ON DELETE CASCADE`), so NFR-7 holds, but a user cannot remove one
search of several. Not a spec requirement, so it was flagged rather than built.

## State as of 2026-07-27 (steps 5–7 done)

**Step 5 (the optional Codex round) was skipped, deliberately.** It is optional in this doc, an
independent conformance read had just found and fixed real defects, and Ben watches token spend.
Recorded here rather than silently omitted. If anyone wants it later, it is still one round only.

**Step 6:** the spec header is flipped to `Approved` / `2026-07-27`, with an approval note recording
the two open questions as non-blocking and dynamic fetch-host grants as deferred out of v1
(commit `2ab07ed3`).

**Step 7:** epic #1280 and 27 child `task` issues are open, all labelled `RFA`, all on the "Issue and
Roadmap Work" board at **Ready**. Numbering is frozen and the mapping is arithmetic for Tasks 3–23
(issue = 1284 + task number):

| Task | Issue | Task | Issue | Task | Issue | Task | Issue |
| ---- | ----- | ---- | ----- | ---- | ----- | ---- | ----- |
| 1    | #1281 | 2e   | #1286 | 8    | #1292 | 15   | #1299 |
| 2    | #1282 | 3    | #1287 | 9    | #1293 | 16   | #1300 |
| 2b   | #1283 | 4    | #1288 | 10   | #1294 | 17   | #1301 |
| 2c   | #1284 | 5    | #1289 | 11   | #1295 | 18   | #1302 |
| 2d   | #1285 | 6    | #1290 | 12   | #1296 | 19   | #1303 |
|      |       | 7    | #1291 | 13   | #1297 | 20   | #1304 |
|      |       |      |       | 14   | #1298 | 21   | #1305 |
|      |       |      |       |      |       | 22   | #1306 |
|      |       |      |       |      |       | 23   | #1307 |

Each issue carries `Part of #1280`, a pointer to its plan section, and the constraints most likely to
be got wrong — it is a signpost, not a substitute for reading the plan section.

Step 8's report to Ben was delivered. **Building has started at Phase 0, Task 1 (#1281).**

### Task 1 grounding already done — do not re-derive

- **Do NOT bump `MODULE_WORKER_CONTRACT_VERSION`.** The plan says to decide from the host check; the
  check is at `worker-runtime.ts:177` and is an **exact match** (`version !== MODULE_WORKER_CONTRACT_VERSION`
  → `protocol` failure). The plan's second branch says bump on exact match, but that reasoning does
  not survive contact with the code: the constant is `1 as const`
  (`packages/module-sdk/src/index.ts:641`), the manifest validator hardcodes
  `workerContractVersion !== 1` (`external/validate.ts:416`), and the SDK type is the literal `1`.
  Bumping under an exact-match check **bricks every already-built worker bundle** the moment the host
  ships, for no gain — `ctx.embed` is purely additive and an old worker never calls `embed.*`. Leave
  it at 1, change nothing in finance, and state this deviation and its reason in the commit body.
- **Both RPC construction sites confirmed**, and `embeddingProvider` must be **required** on both
  input types so a missed site is a typecheck failure: `apps/api/src/external-module-tools.ts:44`
  (assistant-tool dispatch) and `apps/worker/src/external-module-job-handler.ts:67` (the queue path
  the scheduled crawl actually runs on).
- **Where the embed branches go:** beside `fetch.request` at `worker-rpc-host.ts:130`, after
  `const params = record(rawParams)` (`:129`) and **before** the `withDataContext` call at `:152`.
  `ai.generateStructured` (`:197`) is inside that call and is the wrong neighbour.
- `ExternalModuleRpcError`'s code union is at `worker-rpc-host.ts:26-47` and calls `super(code)`, so
  the message is the bare code — tests must assert on the new `detail`, never on `message`.

Resume by implementing Task 1 against its plan section (`plans/2026-07-26-job-search-module.md`,
"### Task 1"), then Verify, then commit and move to #1282.

## Start

1. `pnpm install` — this is a fresh worktree with no `node_modules`.
2. Read this doc's siblings: `thin-brief.md`, then `rulings-ledger.md` (skim the section headers,
   read A–M as you need them), then `rewrite-method.md` for the row map.
3. Finish the plan rewrite: draft rows 06–15 into `parts/`, concatenate all 30 in numeric order
   into `docs/superpowers/plans/2026-07-26-job-search-module.md`, prettier, then verify — 23
   `### Task` headings, 0 NUL bytes, prettier exit 0. **Do not end your turn between rows;** the
   previous session stalled that way and idled for hours.
4. Read the assembled plan end to end yourself and check it against the spec: every spec
   requirement maps to a task, no contract references a type no task defines, no task name drifts
   between its definition and its uses.
5. Optionally run one Codex adversarial round against the thinned plan
   (`gpt-5.6-sol`, `high`, `-s read-only`). If you do: tell the reviewer the plan **deliberately
   carries no implementation code**, so "this step doesn't show how" is not a finding. Aim it at the
   contracts, the invariants, the DDL, the ordering, and whether the test cases would actually catch
   a broken implementation. Apply what comes back and **stop** — do not open another round.
6. Flip the spec header from "Draft for approval" to approved, dated.
7. Create the GitHub epic and child task issues off the frozen numbering.
8. Report to Ben: the plan's final shape, the two open spec questions, and the Phase 0 sixth task.
   Then start building.
