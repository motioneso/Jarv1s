# Relay 3 — 866-herdr-install

**Spec:** `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md`
**Branch/worktree:** `build/866-herdr-install`, this worktree. Off `origin/main@33270eef`. No
code changes, no commits yet — pure grounding session.
**Coordinator:** label `Coordinator` — resolve fresh via `herdr pane list` every time (session id
is authority, `…-N` pane number reflows). Heads-up already sent this relay.

## State: still coordinated-build step 1 (plan-writing). Grounding is now COMPLETE — go straight
to `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md`.

Supersedes relay + relay-2 docs (same dir) — read only if something below is unclear; otherwise
skip them, everything needed is here. Both prior blockers (herdr release source, curl absence)
were already resolved in relay-2 — see that doc if you need the pinned URL/SHA256 pairs again:
`herdr-linux-x86_64` sha256 `043ef43ecbabda28465dcff1eec3184518150d567b8b8f20cda9c6c88770641d`,
`herdr-linux-aarch64` sha256 `ea490094f2c7c39099870857d00c64c628ef7b5eba1967df4258033455ee2cb1`,
release repo `github.com/ogulcancelik/herdr` v0.7.3. Runtime image has no curl/wget — use Node
`https` module in the install script.

## Locked design (write this straight into the plan, no re-deriving)

**1. New composition function** in `packages/module-registry/src/chat-multiplexer.ts`:
add `makeChatMultiplexerStatusProbe(env = process.env)` returning
`(configured: ChatMultiplexerChoice) => Promise<LiveChatMultiplexerStatus>` where
`LiveChatMultiplexerStatus = { available: ChatMultiplexerAvailability; herdrInstalled: boolean;
active: MultiplexerKind | null; activeSource: MultiplexerSource | null; envOverride:
MultiplexerKind | null }`. Body: reuse existing `makeMultiplexerUsableProbe(env)` (already
correct + fully tested at `tests/unit/chat-multiplexer-usable.test.ts` — do not touch its logic)
for `available.tmux`/`available.herdr`; `createBinaryProbe(env).has("herdr")` for
`herdrInstalled` (presence only, no root-pane gate — this is what makes the "installed but not
usable" HostPane case distinguishable from `available.herdr`); `decideMultiplexer({ env,
configured, isInstalled: (b) => probe.has(b) })` (from `@jarv1s/ai`, already imported-available,
just add to the existing `@jarv1s/ai` import line) for `active`/`activeSource`; raw
`env.JARVIS_MULTIPLEXER` (lowercased/trimmed, `"tmux"|"herdr"` else `null`) for `envOverride`.
**Delete** `probeChatMultiplexerAvailability` (the old sync boot-snapshot fn, lines 42-47 of that
file) — becomes fully dead once the composition root switches to the live probe; its one call
site is `packages/module-registry/src/index.ts:1608`.

**2. DTO/schema** in `packages/shared/src/platform-api.ts`:
- **Do NOT import `MultiplexerKind`/`MultiplexerSource` from `@jarv1s/ai`** — `@jarv1s/shared` is
  Vite-bundled into the frontend and its only dependency is `@jarv1s/priority` (checked
  `packages/shared/package.json`); pulling in `@jarv1s/ai` (server-only, node-heavy) would violate
  the browser-bundle boundary. Instead redeclare locally in platform-api.ts:
  `export type MultiplexerKind = "tmux" | "herdr";` /
  `export type MultiplexerSource = "env" | "configured" | "auto";` (string-literal compatible with
  the `@jarv1s/ai` originals, just a duplicate declaration — same pattern already used for
  `ChatMultiplexerChoice` at line 390).
- `ChatMultiplexerSettingsDto` (line 518) gains `active: MultiplexerKind | null`,
  `activeSource: MultiplexerSource | null`, `envOverride: MultiplexerKind | null`,
  `herdrInstalled: boolean`, alongside existing `multiplexer`/`available`.
- `chatMultiplexerSettingsSchema` (line 523, `additionalProperties: false`) needs all 4 new
  properties added to both `properties` and `required` — nullable ones use
  `type: ["string","null"]` with `enum` (see `version`/`commit` pattern at
  hostDiagnosticsSchema line 643-644 for a working example, though those don't have enum — use
  `{ type: ["string","null"], enum: ["tmux","herdr",null] }` for the Multiplexer-kind ones).
  **This is the fast-json-stringify trap** (memory `fast-json-stringify-schema-strip`) — any field
  missing from the schema gets silently dropped from the response even though the route handler
  returns it; verify via `server.inject` in the integration test, not just TS types.
- `HostDiagnosticsDto`/`hostDiagnosticsSchema` (lines 578-663): **no field changes needed** —
  already has `multiplexer`/`available`; only the *source* of `available` changes (live probe
  result instead of static snapshot), which is a caller-side change, not a schema change.

**3. Composition root** `packages/module-registry/src/index.ts`:
- Line 1608 `const availability = probeChatMultiplexerAvailability(env);` → replace with
  `const getChatMultiplexerStatus = makeChatMultiplexerStatusProbe(env);` (import swap on the
  existing import block ~line 251).
- Line 1699 `chatMultiplexerAvailability: availability,` → thread the new function reference
  instead, e.g. `getChatMultiplexerStatus,` — this flows through `deps` (the merged
  `BuiltInRouteDependencies` object built at line ~1684) to `module.registerRoutes?.(server,
  deps)` for every built-in module including settings.
- `BuiltInRouteDependencies` interface (~line 379, currently
  `readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };`)
  → change type to the new probe-function signature (optional, same as before).
- Settings module wiring at index.ts line 785 (`chatMultiplexerAvailability:
  deps.chatMultiplexerAvailability,`) → thread the function through unchanged in shape, just
  renamed/retyped.

**4. `packages/settings/src/routes.ts`**:
- `SettingsRoutesDependencies.chatMultiplexerAvailability` (line 127) → replace with a
  `getChatMultiplexerStatus?: (configured: ChatMultiplexerChoice) => Promise<LiveChatMultiplexerStatus>`
  field (import `LiveChatMultiplexerStatus` type from `@jarv1s/module-registry`'s
  chat-multiplexer export — check it's re-exported from that package's index; if not, add it,
  settings already imports from `@jarv1s/module-registry`? **verify this import path exists
  before assuming** — settings currently does NOT import module-registry (grep first); if it
  doesn't, define the awaited-response shape inline in routes.ts instead of importing a type
  cross-module, to respect module isolation (settings must not reach into module-registry
  internals — check CLAUDE.md "Module isolation" hard invariant). Simplest safe option: type the
  dependency field as an inline function type matching the shape, no cross-module type import.
- GET handler (line 620-638): call `await dependencies.getChatMultiplexerStatus?.(multiplexer)`
  (after fetching `multiplexer` from the repo) and spread its fields into the response, falling
  back to a safe default `{ available: {tmux:false,herdr:false}, herdrInstalled:false,
  active:null, activeSource:null, envOverride:null }` when the dependency is absent (same
  fail-closed pattern as the current `?? { tmux:false, herdr:false }`).
- PUT handler (line 640-663): same pattern, called with the just-written `multiplexer` value so
  the echoed `active`/`activeSource` reflect the new setting immediately (no need for the client
  to re-fetch to see the effect of its own write).
- `registerHostDiagnosticsRoutes` call (line 700-708): still passes
  `chatMultiplexerAvailability` — change to pass the new probe fn (or just the `.available` slice
  it needs) so `host-diagnostics-routes.ts` line 82 sources `available` live too, per the "make
  both live, same underlying fact" decision (do not duplicate the 4 new fields into
  HostDiagnosticsDto — only `available` needs to go live there, confirmed in point 2 above).

**5. `packages/settings/src/host-diagnostics-routes.ts`**: `HostDiagnosticsRoutesDependencies`
line 15 `chatMultiplexerAvailability` field → same retype to accept a live-probe callable (or
have routes.ts pre-resolve `.available` before calling `buildHostDiagnostics`, whichever is
less invasive — prefer resolving in routes.ts's own handler since it already awaits the probe for
the sibling route, avoids a second cross-cutting type change). Line 82 swaps the `??` fallback
source from the static field to the resolved live value.

**6. `apps/web/src/settings/settings-admin-panes.tsx` `HostPane()`** (lines 681-838): replace the
hardcoded tmux `<Note>` at lines 753-761 with mux-aware copy, 4 cases per spec: active tmux (keep
current `docker compose exec jarv1s tmux ls` / `tmux attach -t jarv1s-live-<thread>` copy) /
active herdr (`docker compose exec jarv1s herdr pane list` as discovery command + herdr
attach/read guidance) / env-override present (`mux?.envOverride` non-null — show override source
note so operators understand a selected setting may not match active runtime behavior) / herdr
installed-but-not-usable (`mux?.herdrInstalled && !mux?.available.herdr` — show "root pane
required" message + the `docker compose exec jarv1s /app/scripts/install-herdr.sh` pointer from
the spec, though that's really the "not installed" case — re-read spec's exact 4-case wording,
`docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md` §"Attach Hint", before
writing the switch). Existing `mux?.available.herdr === true` "usable" semantics at line 708 are
preserved as-is (untouched) — only the Note block changes. Check
`apps/web/src/api/client-admin.ts` for `getChatMultiplexerSettings`/`ChatMultiplexerSettingsDto`
usage — likely just a type import, should pick up new fields automatically once shared's DTO
changes; confirm no local narrowing/omission of fields there.

**7. New file `scripts/install-herdr.sh`**: per spec — per-arch (`uname -m`) selection between
the two pinned URL+SHA256 pairs above, fetch via Node's `https` module (no curl/wget in image,
confirmed absent — full Dockerfile read in relay-2), verify SHA-256 before install, install to
`${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin/herdr`, idempotent (skip if already-correct
version/hash present), chmod +x, no args required for the common path, no `curl | sh` anywhere.

## Test files to extend (all exist already, follow their existing patterns)

- `tests/unit/chat-multiplexer-usable.test.ts` — do not modify (tests `makeMultiplexerUsableProbe`
  directly, still valid, reused as-is by the new probe fn).
- `tests/integration/chat-multiplexer-admin.test.ts` — extend the two "admin GET/PUT" `it`
  blocks (lines 86-116) to assert the 4 new response fields (`typeof` checks at minimum;
  optionally set `process.env.JARVIS_MULTIPLEXER` before a request and assert `envOverride`
  reflects it, since `server.inject` re-runs the route handler live and the probe reads
  `process.env` per-call — mutate/restore env around that one test).
- `tests/integration/host-diagnostics-admin.test.ts` / `host-diagnostics-unit.test.ts` — check
  these still pass; add an assertion that `available` reflects live state if not already covered.
- `tests/unit/settings-admin-panes.test.tsx` — extend for the 4 HostPane copy cases (read this
  file FIRST before writing new cases — not yet read this relay, may already have a mock-DTO
  fixture pattern to follow).

## Next steps for successor (resume coordinated-build exactly here)

1. Read `tests/unit/settings-admin-panes.test.tsx` and
   `tests/integration/host-diagnostics-admin.test.ts` (only two files not yet read this relay).
2. Grep-check whether `packages/settings` already imports anything from `@jarv1s/module-registry`
   (module-isolation direction check for point 4 above) before deciding the type-threading
   approach.
3. `superpowers:writing-plans` → save to
   `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md`. Bite-sized TDD tasks,
   exact file paths, full code, no placeholders. Cover all 7 points above.
4. Run the plan's self-review checklist (spec coverage / placeholder scan / type consistency).
5. Message Coordinator (resolve label fresh via `herdr pane list` first) with the plan path.
   **STOP and wait for approval before writing any code.**
6. On approval: TDD build task-by-task, commit each task green, `Co-Authored-By: Claude` trailer,
   explicit `git add <path>` only.
7. Pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck` + `git fetch origin main &&
   git rebase origin/main`) before every push.
8. `coordinated-wrap-up` at Exit Criteria — PR + report to Coordinator. Never merge, never touch
   board/milestones/issue-closing.

## Bans still in force

Worktree/branch only, explicit `git add` paths (never `-A`), never touch `docs/coordination/`, no
secrets in any doc/payload/log, elevated QA bar (`/security-review` + `/code-review` — Opus
flagged this as a privilege-boundary + supply-chain spec), STOP+escalate if the build seems to
need a route the spec's "no web API install route" non-goal forbids.
