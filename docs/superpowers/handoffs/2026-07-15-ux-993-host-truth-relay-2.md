# Build Handoff — #993 Host Truth (relay 2)

**Spec (approved):** `docs/superpowers/specs/2026-07-15-settings-host-account-truth.md`
**Scope:** Delivery Slice 1 — Host truth only. Do NOT implement Slice 2 (profile/account/email).
**Worktree/branch:** this worktree, `ux/993-host-truth` off `origin/main` `2f4f553d`
**Coordinator:** exact label `UX Coordinator`. Confirm session id via `herdr pane list` before
messaging — do not trust a cached id from an older doc.
**Build skill:** `coordinated-build`. Relay again immediately on the next context-meter 70%
warning or compaction summary — don't wait for a "natural" stopping point.

## Done (committed)

**Task 1 — shared Root-workspace predicate.** Commit `ea9c2d77`. New
`packages/ai/src/adapters/root-workspace.ts` exports `isRootWorkspaceConfigured(env)`, honoring
all 3 vars (`JARVIS_HERDR_ROOT_TAB`, `JARVIS_HERDR_ROOT_PANE`, `HERDR_PANE_ID`). Wired into both
`decideMultiplexer` (`multiplexer-resolve.ts`) and `makeMultiplexerUsableProbe`
(`module-registry/chat-multiplexer.ts`), exported from `@jarv1s/ai` index. Covered by unit tests
in `tests/unit/ai-root-workspace.test.ts` (5 cases) plus one new case each in
`ai-multiplexer-resolve.test.ts` and `chat-multiplexer-usable.test.ts`. All verified: tests green,
typecheck clean, prettier/eslint clean. Nothing else is uncommitted — `git status` is clean except
`.claude/context-meter.log` (leave unstaged, it's noise).

## Research already done — do NOT re-derive

A fork already read the files below in the prior session. Trust this summary; only re-read a file
if something here looks wrong once you're implementing against it.

- **DI wiring pattern**: mirror `apps/api/src/module-distribution-port.ts` (85 lines) for a new
  `apps/api/src/herdr-install-port.ts` exporting `createHerdrInstallPort(server, apiServerConfig, options)`.
  Wire it in `apps/api/src/server.ts` next to the `moduleDistribution` port construction (~line
  465) and pass into `registerSettingsRoutes` deps (~line 528).
- **Route file**: new sibling `packages/settings/src/host-install-routes.ts` (NOT appended into
  `host-diagnostics-routes.ts`). Follow the two-phase `withDataContext` template in
  `packages/settings/src/routes-module-registry.ts`: phase 1 = authorize (admin-only, via
  `assertAdminUser`, always first inside the transaction) + precheck inside one `withDataContext`
  call; phase 2 = the actual `execFile` work OUTSIDE any DB context; phase 3 = a second
  `withDataContext` call to record state + write the audit event. Wire the new route into
  `packages/settings/src/routes.ts` right after the existing `registerHostDiagnosticsRoutes(...)`
  call (~line 826-834).
- **Audit write**: `SettingsRepository.insertAuditEvent(scopedDb, {actorUserId, action, targetType,
  targetId, metadata, requestId})` is already a PUBLIC method (`repository.ts` ~line 907-929) —
  call it directly. No need for the `externalModuleAuditWriter` closure indirection (that's a
  convenience wrapper for external-module code specifically, not a required pattern). No new
  table/migration/columns needed.
- **Single-flight lock**: precedent at `packages/chat/src/live/chat-session-manager.ts` lines
  274-291 (`ensureSession`) uses a `Map` per-key. Since herdr-install is one fixed action (not
  per-key), use a simpler module-level `let installInFlight: Promise<Result> | null = null`,
  synchronous check before await, cleared in `finally`. Required comment verbatim: `ponytail:
  process-local lock; use a database advisory lock if API replicas are introduced`.
- **Executor**: one injected `execFile`-style function, no shell, no request-derived args, bounded
  timeout (mirror the `withTimeout()` helper shape in `packages/cli-runner/src/install-service.ts`),
  structured `{state, ...}` result — never raw stdout/stderr in the response or logs.
- **Compose scope**: `infra/docker-compose.prod.yml` confirmed OUT of scope for Slice 1 — only
  hit was a plain `JARVIS_MULTIPLEXER: tmux` env default at line 139, no install-related
  service/volume/mount. No compose changes needed.
- **`packages/shared/src/platform-api.ts`** (lines 580-729): existing `HostDiagnosticStatus`,
  `HostDiagnosticCheckDto`, `HostDiagnosticsInfo`, `HostDiagnosticsDto`, `hostDiagnosticsSchema`
  (strict `additionalProperties:false`), `getHostDiagnosticsRouteSchema`. Any new DTO field for
  install-status/health-summary MUST be added to the Fastify response schema AND covered by an
  `app.inject` test, or fast-json-stringify silently drops it (recurring project trap — see
  `fast-json-stringify-schema-strip` in agentmemory). If any new field is a string, also add it to
  `assertDiagnosticsSafe()`'s `strings` array in `packages/settings/src/host-diagnostics.ts`.

## Still unresolved — do not decide solo, flag to coordinator if it blocks the plan

- **Health-summary derivation (browser-side vs server-side)**: spec Locked Decision 2 requires one
  derived summary (Healthy/Needs attention/Action required) ordered failures-and-warnings-first.
  `buildHostDiagnostics()` currently builds exactly 3 fixed checks with no ordering/summary logic
  today. Whether the summary is computed client-side from the existing 3 checks (no new DTO field)
  or server-computed (needs a new DTO field + schema + test) was flagged as open in the prior
  relay and never settled. Pick the simpler option (client-side, no new field) if it satisfies the
  spec cleanly; otherwise flag to `UX Coordinator` before implementing.
- **Route-guard allowlist semantics for the new POST install route**: `PLATFORM_UNGUARDED_ROUTES`
  in `packages/module-registry/src/route-guard.ts` already contains
  `routeKey("GET", "/api/admin/host/diagnostics")`. Re-read `route-guard.ts` to confirm what
  "unguarded" actually means in this codebase (publicly reachable without an extra guard layer, vs
  something else) BEFORE deciding whether the new POST install route needs the SAME treatment as
  the GET diagnostics route or the OPPOSITE. This was flagged UNVERIFIED in the prior relay and
  still is — resolve it first, it gates the route-guard plan item.
- **`scripts/install-herdr.sh` header reconciliation**: lines 6-7 currently say the API may never
  call this installer. The approved spec supersedes that; update ONLY the header comment to
  reflect Slice 1's Locked Decision 1, without touching pinned-version/per-arch-SHA256/idempotent-
  skip/no-curl script mechanics.

## Next concrete steps (in order)

1. Re-check the route-guard semantics question above (5 min read).
2. Decide health-summary derivation placement (client vs server) — default to client-side unless
   the spec text forces server-side.
3. Invoke `superpowers:writing-plans` → write
   `docs/superpowers/plans/2026-07-15-993-host-truth.md` covering: Task 1 (mark complete, cite
   `ea9c2d77`), herdr-install port + route + wiring, route-guard entry, script header
   reconciliation, audit write, executor + single-flight lock, DTO/schema additions +
   `app.inject` tests, frontend changes in `apps/web/src/settings/settings-admin-panes.tsx`
   (Install button + status states, health-summary render + "Check system health" rename +
   collapsed `<details>`, remove standalone Log-level row), and the full Verification checklist
   from spec lines 142-151 (Host truth section only).
4. `herdr pane list`, confirm exactly one `UX Coordinator` pane (also check for any other
   concurrent session touching this worktree/branch — a second #993 session was seen active around
   the time of the prior relay; coordinate via `herdr-pane-message` before any tree-wide action if
   one is still live).
5. Message coordinator (caveman/terse): "plan ready for 993-host-truth: <path>. Approve, or flag a
   fork." Then STOP — no implementation edits until approval.
6. After approval: build task-by-task with TDD, commit per task, `pnpm verify:foundation` before
   wrap-up, `coordinated-wrap-up` for the PR. Remember: security risk tier — adversarial Opus QA +
   live UAT + Ben's explicit merge sign-off required before merge, per spec and original build
   handoff (`docs/superpowers/handoffs/2026-07-15-ux-993-host-truth.md`).

## Run-specific bans (unchanged, still apply)

Work only in this worktree/branch. Stage explicit paths, never `git add -A`. Never touch
`docs/coordination/`, board, milestones, merge state. Never add a generic shell route or
request-controlled command/URL/path/version/argument. Never emit installer stdout/stderr/secrets
in responses or logs. Do not implement profile/account/email (Slice 2).
