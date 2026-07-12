# Relay 2 — 866-herdr-install

**Spec:** `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md`
**Coordination handoff (read-only, don't edit):** `docs/coordination/handoffs/2026-07-09-866-herdr-install.md`
**Branch/worktree:** `build/866-herdr-install`, this worktree. Off `origin/main@33270eef`.
**Coordinator:** label `Coordinator` — resolve fresh via `herdr pane list` every time, never a
cached session id or `…-N` (it changed once already this run, from `dd8b3920-...` to
`71f71d9a-bb4e-4089-9c8b-0af25068c346` — expect it may change again).

## State: still coordinated-build step 1 (plan-writing), no code, no commits.

Supersedes `2026-07-09-866-herdr-install-relay.md` (read that first for full grounding detail —
still accurate, not repeated here). This doc only adds what changed since: **both blockers
resolved**, plus locked-in design decisions for the plan.

## Blockers — RESOLVED, do not re-ask Coordinator

1. **Herdr release source:** `https://github.com/ogulcancelik/herdr`, GitHub Releases, per-arch
   binary assets. Latest stable non-prerelease = `v0.7.3`. Independently verified (downloaded both
   Linux binaries to scratchpad, hashed, cross-checked size + `file` output vs `gh release view
   --json assets`):
   - `herdr-linux-x86_64` → sha256 `043ef43ecbabda28465dcff1eec3184518150d567b8b8f20cda9c6c88770641d`
   - `herdr-linux-aarch64` → sha256 `ea490094f2c7c39099870857d00c64c628ef7b5eba1967df4258033455ee2cb1`
   Both real ELF binaries, correct arch, size matches GitHub API metadata exactly.
2. **curl/wget in runtime image:** ABSENT (confirmed via full `Dockerfile` read — runtime stage
   installs only `tmux git ca-certificates bubblewrap`). Coordinator APPROVED Node's built-in
   `https` module as the fetch mechanism for `scripts/install-herdr.sh` (no curl|sh, no new apt
   dependency).

## Grounding (from relay-1, still valid — file/line pointers)

- `packages/ai/src/adapters/multiplexer-resolve.ts` — unchanged, reuse `decideMultiplexer`,
  `MultiplexerKind`, `MultiplexerSource` as-is.
- `packages/module-registry/src/chat-multiplexer.ts` — `probeChatMultiplexerAvailability` (static
  boot-time) vs unused `makeMultiplexerUsableProbe` (live, bounded 1500ms/kind) — wire the latter in.
- `packages/settings/src/routes.ts` GET/PUT `/api/admin/chat-multiplexer` ~line 620-663 — both
  serve static `dependencies.chatMultiplexerAvailability`; needs live probe + active-mux info.
  `SettingsRoutesDependencies` interface `chatMultiplexerAvailability?` field ~line 127.
- `packages/settings/src/host-diagnostics.ts` (full file, 139 lines) — `buildHostDiagnostics` /
  `assertDiagnosticsSafe`, pure DTO builder, takes `available: ChatMultiplexerAvailability` as
  input already — no code change needed here itself, just what its caller passes.
- `packages/settings/src/host-diagnostics-routes.ts` (94 lines) — `GET /api/admin/host/diagnostics`
  also consumes the same static snapshot.
- **Decision (locked in, tell Coordinator in plan message, don't re-litigate):** make
  `/api/admin/host/diagnostics` live too, reusing the same composition-root probe result — it's the
  same underlying fact (is a mux usable right now) and serving it stale from one endpoint while the
  other is live would be an inconsistent, confusing UI split. No good reason to keep one on
  restart-cadence.
- Composition root: single call site `probeChatMultiplexerAvailability(env)` in
  `packages/module-registry/src/index.ts` `registerBuiltInApiRoutes` ~line 1608, threaded to both
  routes ~line 1699. `@jarv1s/ai` already imported here (confirmed) — module-isolation-safe to call
  `decideMultiplexer`/`makeMultiplexerUsableProbe` from this file.
- `packages/shared/src/platform-api.ts` — `ChatMultiplexerSettingsDto` ~line 518 currently
  `{ multiplexer, available }` only; `chatMultiplexerSettingsSchema` ~lines 523-536 has
  `additionalProperties: false` at outer AND nested levels — **any new field must be added to BOTH
  the DTO type and the schema properties/required, or fast-json-stringify silently strips it** (see
  memory `fast-json-stringify-schema-strip` — recurring trap, bitten before on #859/#885).
  `HostDiagnosticsInfo`/`HostDiagnosticsDto`/`hostDiagnosticsSchema` section starts nearby — **not
  yet fully read to the end of its properties/required block; successor should finish that read
  before editing it.**
- `apps/web/src/settings/settings-admin-panes.tsx` `HostPane()` lines 681-838, hardcoded tmux
  `<Note>` at lines 753-761 (has a `Ben 2026-07-08` comment) — replace with mux-aware copy for 4
  cases: active tmux / active herdr / env-override present / herdr-installed-but-not-usable.
  Current UI already treats `mux?.available.herdr === true` as "usable" semantics — preserve, don't
  repurpose.
- `infra/docker-compose.prod.yml` line 78 `JARVIS_MULTIPLEXER: tmux` hardcoded (the root problem);
  line 74 `JARVIS_CLI_TOOLS_PREFIX=/data/cli-tools` + line 104 named volume `jarv1s-cli-tools`
  already persist across container replacement — **quick re-check this still holds (1 grep), not
  fresh discovery** — no compose change anticipated beyond maybe removing the hardcoded line 78 if
  the spec calls for defaulting to auto-detect (check spec wording).
- No existing install/exec HTTP route (confirmed absent, consistent with spec non-goal).
- `apps/web/src/api/client-admin.ts` has `getChatMultiplexerSettings`/`setChatMultiplexerSettings`.

## New DTO fields to add (plan should spec exact shape)

`ChatMultiplexerSettingsDto` gains, alongside existing `multiplexer`/`available`:
- `active: MultiplexerKind | null` — result of `decideMultiplexer` given current setting + env + probe
- `activeSource: MultiplexerSource | null` — same call's source tag (env/configured/auto)
- `envOverride: MultiplexerKind | null` — raw `JARVIS_MULTIPLEXER` env value if set, else null
- `herdrInstalled: boolean` — binary-present-on-PATH fact, independent of "usable" (root-pane check)

Update `chatMultiplexerSettingsSchema` in the same file (both outer object and any nested
`additionalProperties: false` block) to declare all four new properties + add to `required` as
appropriate (nullable ones need `type: ["string","null"]` pattern — check how existing nullable
fields in this file are declared and match it).

## Next steps for successor (resume coordinated-build exactly here)

1. Finish reading `hostDiagnosticsSchema`'s full properties/required block in `platform-api.ts`
   (was mid-read at relay time).
2. Quick grep-recheck `infra/docker-compose.prod.yml` line ~78 for `JARVIS_MULTIPLEXER` (confirm
   still hardcoded `tmux`, decide per spec wording whether to remove/change it).
3. Write the plan: `superpowers:writing-plans` → save to
   `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md`. Must cover: (a) DTO +
   schema additions above; (b) composition-root wiring (`makeMultiplexerUsableProbe` +
   `decideMultiplexer` call, threaded to BOTH chat-multiplexer routes AND host-diagnostics route —
   per the "make both live" decision above); (c) `scripts/install-herdr.sh` — per-arch (`uname -m`)
   selection between the two pinned URL+SHA256 pairs above, Node `https` module download, verify
   SHA-256 before install, install to `${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin/herdr`,
   idempotent (skip if already-correct version present), executable, no args required, no
   `curl|sh`; (d) `HostPane()` mux-aware copy rewrite consuming the new DTO fields, 4 cases per
   spec. TDD tasks, exact file paths, full code, no placeholders.
4. Run the plan's self-review checklist (spec coverage / placeholder scan / type consistency).
5. Message Coordinator (resolve label fresh via `herdr pane list` first) with the plan path.
   **STOP and wait for approval before writing any code.**
6. On approval: TDD build task-by-task (no `subagent-driven-development`/`executing-plans` —
   drive inline per `coordinated-build`), commit each task green,
   `Co-Authored-By: Claude` trailer, explicit `git add <path>` only.
7. Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main &&
   git rebase origin/main`) before every push.
8. `coordinated-wrap-up` at Exit Criteria — PR + report to Coordinator. Never merge, never touch
   board/milestones/issue-closing.

## Bans still in force

Worktree/branch only, explicit `git add` paths (never `-A`), never touch `docs/coordination/`, no
secrets in any doc/payload/log, elevated QA bar (`/security-review` + `/code-review` — Opus flagged
this as a privilege-boundary + supply-chain spec), STOP+escalate if the build seems to need a route
the spec's "no web API install route" non-goal forbids.
