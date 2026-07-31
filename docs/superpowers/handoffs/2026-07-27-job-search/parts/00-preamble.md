# Job Search Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-07-26-job-search-module-design.md` (read it first — it holds
the rulings this plan implements)
**UI reference:** `apps/web/src/job-search-prototype/`, variant `?v=flow` (throwaway; direction
approved, visual style not locked)

**Goal:** Ship a Job Search external module that crawls public job portals, scores every posting on
two independent axes (Fit and Want), and surfaces the results through a board, a notification, a nav
badge, and the daily briefing.

**Architecture:** An external module at `external-modules/job-search/`, built exactly like
`external-modules/finance/` — a `jarvis.module.json` manifest plus a worker bundle and a web bundle,
owning five Postgres tables reached through `ctx.db`. Logic lives in a pure `src/domain/` layer with
no SDK imports so it unit-tests without a runtime; the worker layer is a thin adapter wiring SDK
ports into those functions. Six small core-platform additions are prerequisites (Phase 0) — each is
a generic seam every module gets, not job-search plumbing.

**Tech stack:** TypeScript (ES2022, `moduleResolution: bundler`), `@jarv1s/module-sdk/worker`, plain
`fetch` via `ctx.fetch`, Postgres + pgvector (768-dim, nomic-embed-text-v1.5), Vitest for unit and
integration, Playwright for e2e, `scripts/build-external-module.ts` for packaging.

## How to read this plan

**This plan carries contracts, invariants, and test cases. It deliberately does not carry
implementation code.** Exported types, function signatures, manifest JSON, and SQL DDL appear
verbatim, because those are decisions — a signature is how the next task's implementer learns what
this one produces, and a migration is hash-checked and can never be edited once applied. Function
bodies do not appear, because they are the implementer's work and pre-writing them buys nothing.

**Every task is test-driven, and this is stated once rather than repeated per task.** For each task:
write the failing tests from the behaviour statements in its **Tests** section, run them and watch
them fail, implement against the **Contracts** and **Constraints**, run them green, run the task's
**Verify** commands and confirm a real exit code, then commit with a `feat(job-search):` or
`test(job-search):` message and a one-line user-facing summary. Never pipe a gate to `tail` — a
command ending in `tail` reports exit 0 for a failing run.

Task numbering is frozen. Tasks cross-reference each other by number throughout, and by constraint
ID into the **Constraints proven against the tree** section below.

## Global Constraints

Every task's requirements implicitly include this section.

- **Two axes, never one score.** No screen, API response, export, tool result, or briefing line may
  present a blended, weighted, or averaged Fit/Want number. The two travel together and travel
  labelled.
- **Render from records, never from model prose.** Every UI element is built from a stored field. No
  screen region is "whatever the model wrote."
- **Structured failure causes.** Every failure carries portal id, kind
  (`rate_limited | login_required | parse_failed | network`), what was retrieved before it stopped,
  when the portal last worked, and what happens next. Never a bare "failed".
- **The triage score never reaches the screen.** It is a cost-control device. Only Fit and Want are
  displayed.
- **Recall protection.** The triage cut reserves a slice for postings outside the user's stated
  criteria but relevant to their broader profile. Filtering strictly to stated criteria is a spec
  violation.
- **No login-walled or paywalled sources.** A portal that demands an account hard-stops and disables
  itself with cause `login_required`. Never sign in to a job board.
- **No autonomous application submission.** Per-item human approval only.
- **`actorUserId` envelope trap.** The host spreads `actorUserId` onto every external tool input.
  Every strict validator MUST strip it at the worker boundary or the call dies with
  `unknown key: actorUserId`.
- **Metadata-only job payloads.** Queue payloads carry actor id, resource ids, job kind, idempotency
  key, and small command params. Never posting bodies, prompts, résumé content, or secrets.
- **Secrets never escape** to frontend responses, logs, pg-boss payloads, exports, or AI prompts.
- **All module tables FORCE RLS, owner-only**, including for admins. No `BYPASSRLS`.
- **Provider-agnostic AI.** Capability requests only. No hardcoded provider or model.
- **Never edit an applied migration.** Module SQL lives in `external-modules/job-search/sql/`, never
  `infra/postgres/migrations/`.
- **Design tokens only.** `apps/web/src/styles/tokens.css` is the only file permitted hex/rgb
  literals. `--font-sans` and `--font-display` only — no mono (retired 2026-07-08), no serif (sports
  nameplate only).
- **1000-line cap** on every source file including CSS (`pnpm check:file-size`).
- **No module-level chat button.** The core header already has one. The module must not add its own.
- **Module id is `job-search`, display name "Job Search".** The word "Compass" appears nowhere in
  code, UI, or docs.
- **`pnpm test:integration <file>` does not narrow to that file.** The script is
  `tsx scripts/test-integration.ts tests/integration` (`package.json:49`) and it forwards
  `process.argv.slice(2)` straight into `vitest run` (`scripts/test-integration.ts:68,97`), so the
  baked-in directory arrives as a filter alongside yours and matches everything. Every
  `pnpm test:integration …` command below runs the **whole** integration suite — expected, not a
  mistake, and it takes minutes. Name the file anyway: it documents what the step checks. To iterate
  on one file, take the runner's passthrough branch (`test-integration.ts:19-21`) by setting
  `JARVIS_PGDATABASE` yourself and calling vitest directly — that skips the per-run database
  isolation, so use a scratch database, never the shared dev one.
- **Every task ends green on its own gate**, and the milestone ends green on
  `pnpm verify:foundation` with a real exit code.

## Decisions required before Phase 1 (Ben)

**1. Dynamic per-user fetch-host grants are assumed DEFERRED.** Spec §10.1 is a hard blocker for
"add your own job portal": `packages/host-fetch/src/policy.ts:assertValidFetchHosts` requires
literal lowercase hostnames validated at manifest load, so a module physically cannot fetch a host
the user names at runtime. v1 ships the declared sources; `freehire.me` alone covers ~50 ATS boards
under one declared host. User-nominated portals become their own spec and milestone. If Ben wants
them in v1, this plan grows a Phase 0 task and the milestone gets materially bigger — his call, not
the implementer's.

**2. Phase 0 is six core changes, not two.** Grounding against the tree turned up four platform gaps
behind features Ben asked for by name, on top of the embedding port and the briefing seam: an in-app
notification port (`ModuleWorkerContext` has no `notify`), a nav badge (`navigation[]` entries are
`{id,label,path,icon?,order?}` — no badge field), per-profile chat threads (surfaces are fully built
server-side; only `apps/web/src/shell/app-shell.tsx` hardcodes one stream), and the invocation
deadline (Task 2e). All are generic seams every module would use, which is the bar Ben set for
touching core — "if it's something that would make sense to add to the core and then expose it to
this new module, that's fine." Weighed against his other ruling — "the module should just touch the
module, not the core" — this is his call to confirm. **If he declines any of them, cut the
corresponding module feature rather than faking it inside the module.**

Everything else in the spec is in scope.

---

## File Structure

**Phase 0 — core (all additive; every one a generic seam, none job-search-specific):**

| File                                                        | Responsibility                                                                                     | Task  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| `packages/module-sdk/src/worker.ts`                         | add `ctx.embed` to `ModuleWorkerContext`                                                           | 1     |
| `packages/module-registry/src/external/worker-rpc-host.ts`  | service `embed.*` and `notify.post` RPC methods                                                    | 1, 2b |
| `packages/module-sdk/src/index.ts`                          | `briefing` + `navigation[].badge` on `JsonJarvisModuleManifest` (L740 — there is no `manifest.ts`) | 2, 2d |
| `packages/module-registry/src/external/validate.ts`         | keep those blocks through manifest reconstruction (it drops unknowns)                              | 2, 2d |
| `packages/briefings/src/compose-shared.ts`                  | `ComposeDeps.invokeExternalBriefing?` injected invoker                                             | 2     |
| `apps/api/src/…` composition root                           | wire the invoker to the module runtime                                                             | 2     |
| `packages/module-sdk/src/worker.ts` + notifications package | `ctx.notify` port → existing in-app notification store                                             | 2b    |
| `apps/web/src/shell/chat-surface-key.ts` (new)              | hash (moduleId, key) into a surface that passes `CHAT_SURFACE_PATTERN`                             | 2c    |
| `apps/web/src/shell/app-shell.tsx`                          | honour the surface argument the seam already anticipates                                           | 2c    |
| `packages/notifications/src/repository.ts` + `routes.ts`    | per-module unread counts (`unreadByModule`) beside the existing total                              | 2d    |
| `packages/shared/src/notifications-api.ts`                  | `unreadByModule` on the DTO **and the response schema**                                            | 2d    |
| `apps/web/src/shell/…nav`                                   | render the module's unread count on a nav entry that opts in                                       | 2d    |
| `packages/module-registry/src/external/worker-runtime.ts`   | stall budget + hard ceiling + queue/tool/briefing lanes                                            | 2e    |

**Phase 1+ — the module:**

| File                                                        | Responsibility                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| `external-modules/job-search/jarvis.module.json`            | manifest: tools, queues, schedules, storage, tables, hosts |
| `external-modules/job-search/package.json`                  | artifact package metadata                                  |
| `external-modules/job-search/tsconfig.json`                 | copy of finance's, `jsx: react`, `jsxFactory: h`           |
| `external-modules/job-search/sql/0001…0006_*.sql`           | five tables + pgvector column, all FORCE RLS owner-only    |
| `src/domain/records.ts`                                     | every record type + `FailureCause`. No logic.              |
| `src/domain/criteria.ts`                                    | conversation output → structured `SearchCriteria`          |
| `src/domain/excludes.ts`                                    | stage-1 hard-exclude filter                                |
| `src/domain/triage.ts`                                      | stage-2 embedding cut, incl. the reserved recall slice     |
| `src/domain/score.ts`                                       | stage-3 prompt construction + Fit/Want result validation   |
| `src/domain/dedupe.ts`                                      | cross-portal posting identity                              |
| `src/domain/surface.ts`                                     | new-match counting + briefing payload shaping              |
| `src/domain/store-port.ts`                                  | storage interface the handlers are written against         |
| `src/adapters/types.ts`                                     | `Portal`, `CrawlResult`, `CrawlFailure`                    |
| `src/adapters/{freehire,linkedin}.ts`                       | one file per source                                        |
| `src/worker/index.ts`                                       | `defineModuleWorker` registration only                     |
| `src/worker/ports.ts`                                       | per-invocation dependency set (finance `ports.ts` pattern) |
| `src/worker/validate.ts`                                    | strict input validation; strips `actorUserId`              |
| `src/worker/store-sql.ts`                                   | `ctx.db` implementation of `store-port`                    |
| `src/worker/stages/{crawl,score}.ts`                        | the two pass stages — pure functions, never registered     |
| `src/worker/handlers/*.ts`                                  | the handlers actually named in the manifest                |
| `src/web/index.ts`                                          | web entrypoint                                             |
| `src/web/root.tsx`                                          | onboarding-vs-board branch                                 |
| `src/web/screens/{onboarding,board,inspector,settings}.tsx` | one screen each                                            |
| `src/web/styles.css`                                        | module styles, tokens only                                 |

**Tests:**

| File                                   | Covers                                      |
| -------------------------------------- | ------------------------------------------- |
| `tests/unit/job-search-*.test.ts`      | the whole domain layer, no SDK, no network  |
| `tests/integration/job-search.test.ts` | RLS, payload shape, `actorUserId` stripping |
| `tests/uat/specs/job-search-board.uat.spec.ts` | the required real-stack UI path       |

---
