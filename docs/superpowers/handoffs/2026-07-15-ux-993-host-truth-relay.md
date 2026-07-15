# Relay — #993 Host Truth (Slice 1)

**Spec (approved):** `docs/superpowers/specs/2026-07-15-settings-host-account-truth.md`
**Scope:** Delivery Slice 1 — Host truth only. Do NOT touch profile/email (Slice 2).
**Handoff:** `docs/superpowers/handoffs/2026-07-15-ux-993-host-truth.md` (read this too — has
Collision/Security Map, Run-Specific Bans, Verification/Proof requirements).
**Worktree/branch:** same worktree, `ux/993-host-truth` off `origin/main` `2f4f553d`.
**Coordinator:** exact label `UX Coordinator`, immutable session `019f6479-18a8-7782-ab34-a2e1d9c59c82`.
**Risk tier:** security.
**Status:** No code written. No plan written yet. Still in spec-vs-branch verification
(coordinated-build step ½). Next action: finish verification, then
`superpowers:writing-plans`, then escalate to coordinator and WAIT for approval before any edit.

## Verified against branch (confirmed real, safe to plan against)

1. **Collision #1 — shared Root-workspace predicate missing `JARVIS_HERDR_ROOT_TAB`:**
   - `packages/ai/src/adapters/multiplexer-resolve.ts` `decideMultiplexer()`, `herdrRootAvailable`
     (~line 38-40): only checks `env.JARVIS_HERDR_ROOT_PANE?.trim() || env.HERDR_PANE_ID?.trim()`.
     Missing `JARVIS_HERDR_ROOT_TAB`.
   - `packages/module-registry/src/chat-multiplexer.ts` `makeMultiplexerUsableProbe()`
     (~line 70-84): same bug, same fix needed.
   - `packages/ai/src/adapters/herdr-multiplexer.ts` `HerdrMultiplexer.resolveRoot()`
     (private, ~line 144-160) ALREADY correctly implements full 3-source precedence
     (`rootPaneOverride` → `rootTabOverride`/`env.JARVIS_HERDR_ROOT_TAB` →
     `env.JARVIS_HERDR_ROOT_PANE`/`env.HERDR_PANE_ID` → hard error). Use this as the reference
     shape for the new shared predicate (extract into `@jarv1s/ai`, per handoff item 1).
   - `grep -rn "JARVIS_HERDR_ROOT_TAB\|JARVIS_HERDR_ROOT_PANE\|HERDR_PANE_ID"` → exactly these 3
     non-test files. Blast radius fully identified.

2. **Collision #3 — POST install route not yet in route-guard allowlist:** trivially true, route
   doesn't exist yet. `packages/module-registry/src/route-guard.ts` (~lines 1-100) has
   `PLATFORM_UNGUARDED_ROUTES: ReadonlySet<RouteKey>` via `routeKey(method, pattern)`; already
   contains `routeKey("GET", "/api/admin/host/diagnostics")`. Add the new install route here.

3. **Collision #4 — stale script comment:** `scripts/install-herdr.sh` header (lines 6-7, read in
   full — 95 lines total) says: *"Deliberately host-operator-run only — no Jarv1s API route may
   call this (spec 2026-07-08-herdr-install-and-attach-hint.md non-goal)."* Must be reconciled
   (the approved #993 spec explicitly supersedes this) WITHOUT weakening the pinned-version /
   per-arch-SHA256 / idempotent-skip / no-curl(node https) guarantees in the rest of the script.
   Script mechanics untouched otherwise — only the header comment changes.

4. **Collision #8 — standalone Log level row must be removed, DTO field stays:**
   `apps/web/src/settings/settings-admin-panes.tsx` "Logging" Group, standalone "Log level" Row at
   ~lines 829-835 — delete this Row/Group. `logLevel` field stays in
   `packages/shared/src/platform-api.ts` `HostDiagnosticsInfo`/`hostDiagnosticsSchema` (already a
   flat field, not part of `checks`) — becomes collapsed read-only metadata per spec Decision 2/3
   (under the new `<details>` disclosure), not deleted from the DTO.

5. **Decision 1 (Install Herdr one-click) does not exist yet:** confirmed via full read of
   `HostPane()` in `apps/web/src/settings/settings-admin-panes.tsx` (~lines 600-838). Current
   `installGuidanceNote()` is TEXT-ONLY (`docker compose exec jarv1s scripts/install-herdr.sh`),
   no button/action exists. `attachHintNote()` mentions only `JARVIS_HERDR_ROOT_PANE`/
   `HERDR_PANE_ID` in its broken-config note — needs `JARVIS_HERDR_ROOT_TAB` added once the shared
   predicate lands.

6. **Decision 2 (derived health summary) does not exist anywhere:** confirmed — no
   Healthy/Needs-attention/Action-required computation in backend
   (`packages/settings/src/host-diagnostics.ts`, full read, 139 lines) or frontend. Current UI
   flat-maps `diag.checks` with no ordering/summary. `buildHostDiagnostics()` builds exactly 3
   fixed checks: `database`, `pgboss`, `multiplexer` ("Session multiplexer"). Spec wants: derived
   summary FIRST (Healthy/Needs attention/Action required), failures+warnings sorted before
   passes, each non-pass check gets fixed recovery copy + one safe next action, raw metadata
   (uptime/environment/version/commit/host/port/deployMode/restartCommand/moduleCount/
   routeCount/logLevel) moves under collapsed `<details>`. Action renamed "Run diagnostics" →
   "Check system health". Per spec wording ("The page derives an overall summary from checks") —
   my working assumption is this is a BROWSER-side derivation (no new backend DTO field needed for
   the summary itself), but this was NOT yet fully settled — confirm during plan-writing; if the
   summary needs to be server-computed for any reason (e.g. shared with a future non-JS consumer),
   flag as a fork to the coordinator rather than deciding solo.

7. `packages/shared/src/platform-api.ts` lines 580-729 read: `HostDiagnosticStatus`
   (`"pass"|"warn"|"fail"`), `HostDiagnosticCheckDto {id,label,status,detail}`,
   `HostDiagnosticsInfo`, `HostDiagnosticsDto extends HostDiagnosticsInfo` (+multiplexer,
   available, checks, latestAvailableVersion, releaseNotes), `hostDiagnosticsSchema`
   (`additionalProperties:false`, full `required` array incl. `logLevel`),
   `getHostDiagnosticsRouteSchema`. **Any new/changed DTO field must be added here AND its
   `required`/`properties` AND covered by an `app.inject` test** (fast-json-stringify silently
   drops undeclared fields — known recurring trap, see agentmemory
   `fast-json-stringify-schema-strip`).

8. `packages/settings/src/host-diagnostics-routes.ts` (full read, 101 lines):
   `registerHostDiagnosticsRoutes()` → `GET /api/admin/host/diagnostics`. Admin check runs FIRST
   inside `withDataContext`, before any 503-from-missing-provider branch (non-admin can't
   distinguish states — mirror this ordering for the new install route). DB ping + chat-
   multiplexer-setting read happen inside DB context; `pgBossInstalled()` +
   `getChatMultiplexerStatus()` run OUTSIDE it.

9. `packages/settings/src/host-diagnostics.ts`: `assertDiagnosticsSafe()` — defense-in-depth
   secret/URL scanner over all DTO string fields (`FORBIDDEN_SECRET_KEYS`,
   `CONNECTION_URL`/`CREDS_IN_URL` regexes). **Any new string field added to the DTO must be added
   to this scanner's `strings` array too.**

10. `packages/settings/src/repository.ts`: `externalModuleAuditWriter(scopedDb)` pattern at line
    305, table `app.admin_audit_events` (SELECT ~823, INSERT ~920) — reuse this pattern for the
    herdr-install audit write (handoff item 5: "Reuse Settings audit events; add no table or
    migration"). **NOT YET fully read** (need exact `AuditWriter` type shape / INSERT column list
    around lines 280-340 and 890-940 before finalizing the plan's audit-write task).

11. `packages/settings/src/routes-module-registry.ts` (full read, 272 lines) — strong structural
    template for the new install route: two-phase `withDataContext` (authorize+precheck in one
    call, THEN do out-of-band work OUTSIDE any DB context — e.g. `dist.download(...)` here is the
    analog for the herdr-install `execFile` call — THEN a second `withDataContext` call to record
    state + audit via `requireRequestId(accessContext)`). Uses `HttpError` from
    `@jarv1s/module-sdk`, `handleRouteError` from `./routes-serializers.js`.

12. `packages/cli-runner/src/install-service.ts` (full read, 802 lines) — a DIFFERENT domain
    (npm/artifact CLI-provider install with staging/promote/rollback) but useful for its
    execFile-discipline conventions: `TmuxIo`-style `deps.io.run(...)` (execFile-style, not
    shell), bounded `withTimeout()` helper (Promise.race + clearTimeout), structured
    `{state:"installed"|"error", ...}` results (never throws for expected failures — only throws
    `InstallBadRequestError` for in-flight/blocked, mapped to 400 by caller), per-key `Mutex` +
    synchronous `inFlight` Set check BEFORE any await (so a re-entrant call can never race past the
    check — this is the strongest available precedent for handoff item 7's "process-local
    single-flight lock" — mirror the synchronous-Set-check-before-await pattern, NOT the whole
    Mutex-per-provider machinery since herdr-install is a single fixed action, not per-provider).
    `redactInstallMessage()` / `redactNpm()` — pattern for sanitizing error messages before they
    reach the structured result (relevant since herdr-install must return structured state, not
    raw stdout/stderr per handoff bans).

## NOT yet done — pick up here

1. Read `packages/settings/src/routes.ts` and `apps/api/src/server.ts` (composition root) — needed
   to know exact DI wiring pattern for the new install route + its executor dependency.
2. Finish reading `packages/settings/src/repository.ts` around lines 280-340 and 890-940 for the
   exact audit-writer shape to mirror.
3. Search for any EXISTING single-flight/in-flight-lock precedent narrower than
   install-service.ts's per-provider Mutex (`grep -rn "single-flight\|inFlight\|singleFlight"
   packages --include="*.ts"`) — not yet run. If nothing simpler exists, design a minimal
   process-local flag (not a full Mutex class) for the ONE fixed herdr-install action, marked with
   the exact required comment: `ponytail: process-local lock; use a database advisory lock if API
   replicas are introduced`.
4. Read `infra/docker-compose.prod.yml` and resolve whether ANY compose changes are in scope for
   Slice 1. The approved (2026-07-15) spec does NOT explicitly restate the older superseded
   draft's compose-passthrough ask as a Locked Decision — current read is this is OUT of scope for
   Slice 1 (UI copy /"exact deployment guidance" after install is enough), but this was not fully
   confirmed. If still ambiguous when picked back up, flag it to the coordinator as a fork rather
   than deciding solo.
5. Read `apps/web/src/styles/settings-panes.css` only if the plan turns out to need new CSS for
   the install button/loading state or health-summary banner (preserve jds-* primitives / raw
   colors only in `tokens.css`, per CLAUDE.md Design-fork Discipline).
6. Once verification is complete: invoke `superpowers:writing-plans` →
   `docs/superpowers/plans/2026-07-15-993-host-truth.md`. Plan must cover, as separate TDD tasks:
   - shared Root-workspace predicate extraction (unit tests FIRST, per handoff item 1) +
     refactor both call sites to use it.
   - DTO/schema additions for whatever new fields the install action / health summary need (if
     any land server-side), each with an `app.inject` coverage test (handoff item 2).
   - route-guard allowlist entry for the new POST install route (handoff item 3).
   - `scripts/install-herdr.sh` header-comment reconciliation only (handoff item 4).
   - audit-write reuse via `app.admin_audit_events` (handoff item 5).
   - one injected execFile-style executor function + route wiring, no shell, no request-derived
     args, bounded timeout, structured result (handoff item 6).
   - process-local single-flight lock with the exact `ponytail:` comment (handoff item 7).
   - remove standalone Log-level UI row; keep DTO field as collapsed metadata (handoff item 8).
   - frontend: Install button + status states (Installed/Usable/needs-Root-workspace-guidance),
     health-summary derivation + ordering + recovery copy, "Check system health" rename,
     collapsed `<details>` for raw metadata.
   - Verification checklist coverage from spec's "Host truth" Verification section (see spec file
     lines 142-151) — non-admin rejection, Root tab/pane/runtime-pane unit tests, request-input
     exclusion unit test, concurrent-install integration test, timeout/failure audit test,
     success-triggers-fresh-status test, health-summary ordering/recovery-copy test.
7. Message coordinator per `coordinated-build` step 1: "plan ready for 993-host-truth: <path>.
   Approve, or flag a fork." Then STOP — do not write implementation code until approval received.

## Reminders

- Caveman/terse mode for all coordinator messages.
- `herdr pane list` FIRST, confirm EXACTLY ONE pane holds label `UX Coordinator`, before messaging.
- Never `git add -A`; stage explicit paths only.
- Full gate before wrap-up: `pnpm verify:foundation`; pre-push trio
  `pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main && git rebase origin/main`.
- Security risk tier: adversarial Opus QA + live UAT + Ben's explicit merge sign-off required
  before merge, per handoff.
