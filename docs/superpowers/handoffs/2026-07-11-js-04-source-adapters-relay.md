# Relay — JS-04 source adapters (#933)

Successor: you are the SAME lane continuing. Model must be `claude-fable-5` (Ben's directive for
this run). Resume via `coordinated-build`; plan is APPROVED — do NOT re-plan, do NOT re-ask.

## Pointers (read by section, never in full)

- **Plan (approved, execute as written):** `docs/superpowers/plans/2026-07-11-js-04-source-adapters.md`
  — 11 TDD tasks with complete code. Read ONE task at a time.
- **Build handoff (rules/bans):** `docs/coordination/2026-07-11-js-04-build-handoff.md` — untracked,
  coordinator-only file: READ it, NEVER commit it.
- Spec: `docs/superpowers/specs/2026-07-10-job-search-js-04-source-adapters.md` (already verified
  current against branch — skip re-verification).
- Branch `feat/js-04-source-adapters` in THIS worktree, rooted at origin/main `aaa0888f`.

## Coordinator

Label `Coordinator` (verify EXACTLY ONE pane, fresh `herdr pane list`), session id authority
`58a78927-385c-4b1d-8fa0-94db20255d6f`. Plan approved 2026-07-11 with all 3 forks confirmed
(monitor.save query → normalized board config; +3 tools = 17 total; courtesy 60 min). Tag
escalations [SECURITY]/[SSRF]/[DESIGN-FORK].

**Approval corrections/mandates (apply during build):**

1. Compliance metadata must NOT attribute review to Ben → add `reviewedBy: "coordinator/automated"`
   to `AdapterCompliance` (types.ts) and set it on all three adapters; keep `status: "allowed"`,
   `reviewedAt: "2026-07-11"`, policy URLs as in plan. Expose `reviewedBy` in `SourceAdapterInfo` /
   sources.list output + tests.
2. NON-NEGOTIABLE: Task 8 adversarial SSRF tests drive the REAL `createHostPinnedFetch` from
   `@jarv1s/host-fetch` with injected resolve/request fakes — not a mock of it.
3. Zero migrations; `monitor.run` stays JS-05 stub.

## State

- **Done + committed:** Task 1 fixtures `5c30a449` (`tests/fixtures/job-search/` + README).
- **In flight (uncommitted, on disk):** Task 2 red test
  `tests/unit/external-module-job-search-adapters-sanitize.test.ts` — verified failing (module
  missing). Expectations updated vs plan: adjacent block tags → `\n\n` (one test comment marks it);
  control-char case uses backslash-u escape notation.
- **Next action:** implement `external-modules/job-search/src/adapters/sanitize.ts` per plan Task 2
  Step 3, make tests green, commit; then Tasks 3–11 in order.

## Known plan warts (fix while implementing, already agreed)

- Plan Task 2 `collapse()` shows a control-char regex with LITERAL control bytes — author it as
  `/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g` with `// eslint-disable-next-line no-control-regex`.
  It must also scrub raw C1 chars (test pins U+009F). Keep `\t` until the `[ \t]+` collapse.
- Plan Task 4 `mapWorkMode(locations.some(...) ? "remote" : undefined)` → write directly:
  `locations.some((l) => /\bremote\b/i.test(l)) ? ("remote" as const) : undefined`.
- Task 4 note: export `truncateUtf8` from `domain/opportunities.ts` + re-export via domain barrel.

## Run bans (unchanged)

- `git add` explicit paths only; never `-A`/`.`; never repo-wide format.
- Commits: conventional + user-facing summary line + trailer
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Pre-push trio before EVERY push: `pnpm format:check && pnpm lint && pnpm typecheck` + fetch/rebase
  origin/main. Full gate at wrap-up (`coordinated-wrap-up`, PR `Closes #933`).
- Prettier the fixture/docs you author before committing (format:check covers md).
- Shared-PG caution: skip `test:integration` if another session is mid-build; record command+exit.

## Fixture facts (save a probe)

First-job assertion values: greenhouse id `8503792002`, url
`https://job-boards.greenhouse.io/gitlab/jobs/8503792002`, `first_published`
`2026-04-17T05:58:03-04:00`, location `Remote, Italy`, offices `[Italy]`, content is
entity-ESCAPED HTML. Lever[0]: id `33538a2f-d27d-4a96-8f05-fa4b0e4d940e`, hostedUrl
`https://jobs.lever.co/leverdemo/<id>`, createdAt `1553186035299`, workplaceType `hybrid`,
allLocations `["Arlington, TX"]`, commitment `Regular Full Time (Salary)`, salaryRange `null`.
Ashby jobs[0]: id `03e2d4e1-73ad-4f09-a058-2eb9ce34c2bc`, jobUrl
`https://jobs.ashbyhq.com/ramp/<id>`, isListed `true`, isRemote `true`, publishedAt
`2026-07-07T20:47:09.753+00:00`, location `Remote (US)`, secondary `[San Francisco, CA; New York,
NY (HQ)]`, employmentType `FullTime`, compTier `$151K – $231K • Offers Equity • Multiple Ranges`.
Use `jq` on `tests/fixtures/job-search/*.json` for anything else.

## Context discipline

Fresh budget: BUILD. Commit per task. Relay only past ~80% meter with real progress. Message the
Coordinator "relayed, safe to reap" flow is already done for THIS predecessor — you only report at
wrap-up or on blockers.
