# Relay — js-09-acceptance (2026-07-12, relay 3: after Tasks 2+3)

Successor: finish JS-09 acceptance harness (issue #938, epic #913). You are Fable (hard
policy: Job Search builder = Fable). Same worktree/branch: `feat/js-09-acceptance` off
`ba4ed180`. Coordinator label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f`
(resolve pane fresh by label; verify session id before anything destructive).

## State

- Plan APPROVED: `docs/superpowers/plans/2026-07-11-js-09-acceptance.md`. Read BY TASK, never
  in full. Coordinator already told relay #3 in progress + Tasks 2/3 done (2026-07-12 ~00:45).
- Mission doc: `docs/coordination/handoff-js-09-acceptance.md` (READ ONLY — never `git add`
  anything under `docs/coordination/`).
- **Task 1 DONE `26a7ce7f`**: `tests/integration/external-module-job-search-acceptance.test.ts`
  (6 tests green). See prior relay doc `2026-07-12-js-09-acceptance-relay.md` for its shape.
- **Task 2 DONE `84446cdc`**: `tests/integration/job-search-provider-independence.test.ts`
  (4 tests green ~5s) — real `HttpApiAdapter` against a local node:http fake serving BOTH wire
  shapes (Anthropic `/v1/messages` tool_use vs OpenAI `/v1/chat/completions` json_schema),
  through real `createModuleWorkerAiBridge`; byte-identical module-visible results; no
  identifier leakage. Plus package-wide identifier sweep added to
  `tests/unit/external-module-job-search-bundle.test.ts` (src/ + dist/worker.js vs PROVIDER_RE);
  one bounded module fix: `external-modules/job-search/src/web/api.ts:71` comment reworded
  ("CLAUDE.md" matched /claude/i).
- **Task 3 DONE `d6280362`**: `scripts/job-search-acceptance-evidence.ts` (counts-only
  renderer, fail-closed validation, CLI) + `tests/unit/job-search-acceptance-evidence.test.ts`
  (4 green) + package.json script `evidence:job-search`. CLI smoke-tested clean
  (`pnpm evidence:job-search -- --results <json>`; results JSON keys: runCounts{scheduledRuns,
  ingested,suppressedDuplicates,evaluated}, dedup{secondRunNewOpportunities,
  secondRunNewEvaluations}, gates{verifyFoundation,releaseHardening,moduleBuild,isolationSuite,
  failClosedSuite,lifecycleSuite}, sevenDayResult).
- Trio (format:check, lint, typecheck) exit 0 at `d6280362`.

## Next steps (in order)

1. **Plan Task 4** (~line 509 — read that section first): full gate + bounded defect fixes +
   evidence dry-run.
2. Wrap up via `coordinated-wrap-up`: pre-push trio + `git fetch origin main && git rebase
   origin/main` before push. PR body MUST state sentinel constants + scan pattern (below) and
   that evidence destination = counts-only comment on issue #938 (never committed). Report PR
   to Coordinator (terse). Never merge/board/close.

## Constants for PR body (do not re-derive)

- Sentinels: `JS09-ACCEPT-RESUME-SENTINEL-93d1c4`, `JS09-ACCEPT-PROFILE-SENTINEL-93d1c4`,
  `JS09-ACCEPT-QUERY-SENTINEL-93d1c4`.
- Scan pattern PROVIDER_RE:
  `/openai|anthropic|claude|gemini|gpt-|mistral|llama|sonnet|haiku|deepseek|bedrock|vertex/i`

## Hard-won facts (do not re-derive)

- **Integration suites: `pnpm tsx scripts/test-integration.ts <file>`** — bare vitest refuses
  the shared DB. Unit suites: plain `pnpm vitest run <file>`.
- Root package.json version is `0.0.0` (evidence CLI prints it; fine — regex allows it).
  Discovery needs `coreVersion: "0.1.0"` override (root 0.0.0 fails manifest compat).
- Provider-create auto-discovery (#870) probes `GET ${baseUrl}/v1/models` — wire fakes must
  404 unknown paths WITHOUT JSON.parsing empty bodies (uncaught throw hangs provider create).
- Spawned worker uses REAL clock → monitor `dueTime: "00:00"`, `timezone: "UTC"`.
- Fixture fetch seam: rpc `fetch.request` → `{status, headers, bodyBase64}`.
- agentmemory: `mem_mrhgqq4s_bc77eaa6a5a1` (project jarv1s).

## Approval bars + cadence (unchanged)

- (a) cross-owner/admin denials paired with positive controls, no BYPASSRLS; (b) sentinel scan
  proves no private content in payloads/logs/evidence. Defect fix needing migration/endpoint/
  schema → STOP, escalate. Zero new migrations; explicit-path `git add` only; risk tier
  `security`; terse caveman comms to Coordinator; conventional prose in commits/PR.
- Meter 70% warning or compaction summary seen → message Coordinator, `relay` skill, successor
  Fable. Files < 1000 lines.
