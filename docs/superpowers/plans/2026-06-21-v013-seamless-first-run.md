# Plan — v0.1.3 seamless first-run fixes

Branch `v013-seamless-fixes` off `origin/main` (f7f7e63). Tier: **sensitive** (deploy-ops auth
config + the #347 single-active-login gate). Handoff:
`docs/coordination/handoffs/2026-06-21-v013-seamless-fixes.md`. Plan PRE-APPROVED by Ben in the
handoff; coordinator gives the build go.

Each task commits green (TDD: red test → green impl), `git add` only that task's files,
`Co-Authored-By: Claude Opus 4.8`.

---

## Fix 1 — Remove the multiplexer onboarding step entirely

**Why:** only tmux is offered in a container; the step is pure noise. Wizard goes welcome →
provider-connect. Backend still defaults `JARVIS_MULTIPLEXER=tmux` (runtime mux machinery in
`@jarv1s/ai` / `module-registry` / `chat` STAYS — it's chat-runtime, not onboarding).

**Scope of "multiplexer" that is ONBOARDING and dies (verified by grep):**

- `apps/web/src/onboarding/multiplexer-step.tsx` — DELETE
- `apps/web/src/onboarding/multiplexer-options.ts` — DELETE
- `apps/web/src/onboarding/onboarding-wizard.tsx` — drop `"multiplexer"` from `FOUNDER_ORDER`
  (line 23), drop the rail entry (FOUNDER_RAIL line 35), renumber the remaining mono labels
  (cliAuth "01", connectors "02"), remove the conditional render (lines 310–312), drop the import.
- `apps/web/src/onboarding/resume.ts` — drop multiplexer from step ordering if referenced.
- `apps/web/src/api/query-keys.ts` + `apps/web/src/api/client.ts` — drop any
  onboarding-multiplexer-selection query key + client call IF now unused (grep; keep settings-admin
  multiplexer pane wiring — that's a different surface).
- `packages/shared/src/onboarding-api.ts` — remove `OnboardingMultiplexerStepDto` + the
  `multiplexer` field from `OnboardingStepsDto` (+ its zod schema).
- `packages/settings/src/onboarding-routes.ts` — stop assembling/persisting the multiplexer step in
  the status route + assembler; remove the multiplexer probe from onboarding status. (Keep any
  server-side default of tmux; the settings-admin multiplexer choice route is a SEPARATE surface —
  do not touch it.)

**Backend default check:** confirm nothing in onboarding _persisted_ the multiplexer choice as a
required gate. `JARVIS_MULTIPLEXER=tmux` is already written by setup-prod.ts (line 141) and the
container forces tmux. If onboarding completion depended on a "multiplexer.done" flag, remove that
dependency (onboarding done = provider connected). Grep `onboarding-chat-availability` +
`assembleOnboardingStatus` to confirm.

**Tests:**

- DELETE `tests/unit/onboarding-multiplexer-step.test.tsx`, `tests/unit/onboarding-multiplexer-options.test.ts`.
- UPDATE `tests/unit/onboarding-resume.test.ts` (step-order assertions: welcome→cliAuth→…).
- UPDATE `tests/integration/onboarding.test.ts` + `onboarding-provider-install.test.ts` (drop
  multiplexer-step assertions; assert step list no longer contains multiplexer).
- UPDATE `tests/unit/onboarding-chat-availability.test.ts` if it asserts a multiplexer dependency.
- UPDATE `tests/unit/onboarding-status-route.test.ts` (DTO shape).
- UPDATE e2e: `tests/e2e/mock-onboarding-api.ts`, `tests/e2e/onboarding.spec.ts` (flow no longer
  has the control-channel step).

**Tasks:**

1. (red) Update `onboarding.test.ts` + `onboarding-resume.test.ts` to expect NO multiplexer step →
   they fail. (green) Edit shared DTO + onboarding-routes + wizard + resume; delete the two step
   files + their two unit tests; fix e2e mock + spec. Run `pnpm test:tasks`-equiv onboarding suite +
   web typecheck. Commit.

---

## Fix 2 — Hide codex from onboarding (offer Claude/anthropic only, data-driven allowlist)

**Why:** codex (`openai-compatible`) headless login can't complete on a server and bricked chat via
the single-active gate. Onboarding must offer ONLY providers with a guaranteed-working headless
login — currently `anthropic` only. NOT a change to the AI module / settings / catalog.

**Where:** the onboarding provider list is assembled server-side in
`packages/settings/src/onboarding-routes.ts` (the `installableByKind` block, ~lines 520–556) and
the frontend renders `props.step.providers` (`apps/web/src/onboarding/cli-auth-step.tsx`,
data-driven — no UI change needed beyond losing the now-absent codex card).

**Plan:** introduce a documented allowlist in the onboarding route module:

```ts
// Onboarding offers ONLY providers whose HEADLESS login is guaranteed to complete on a
// server (no interactive browser callback the operator can't reach). Today that is anthropic
// (claude setup-token paste flow). codex/openai-compatible headless login cannot complete on a
// server and bricked chat via the single-active gate (v0.1.2 live test) — re-add here the moment
// its headless login is real. This is ONBOARDING PRESENTATION only; the AI module / settings /
// catalog still support every provider.
const ONBOARDING_LOGINABLE_PROVIDER_KINDS = ["anthropic"] as const;
```

Filter the providers passed to the onboarding status DTO to those in the allowlist (intersect with
the existing catalog `supported`/installable set). Keep it provider-agnostic at the engine layer —
this is a presentation allowlist, not a hardcoded engine provider.

**Tests:**

- `tests/unit/onboarding-status-route.test.ts` (or the route test): assert the assembled onboarding
  providers include `anthropic` and EXCLUDE `openai-compatible` even when the catalog marks it
  supported/installable.
- Adjust any test asserting codex appears in onboarding provider list.

**Tasks:** 2. (red) Route test asserts onboarding providers = anthropic-only (no codex) → fails. (green) Add
the allowlist constant + filter in onboarding-routes. Commit.

---

## Fix 3 — Auto-configure better-auth trusted-origins for the deploy host (#379)

**Why:** a real deploy is reached over LAN/tailnet/domain, not localhost; today
`JARVIS_AUTH_TRUSTED_ORIGINS=http://localhost:${webPort}` only → signup fails "Invalid origin".

**install.sh (host — sees the real LAN IP; the setup container cannot):**

- Before the setup invocation (~line 206), derive a public origin:
  - If `JARVIS_PUBLIC_ORIGIN` set: full origin (`https://host` / `http://host:port`) used as-is; a
    bare host/IP → `http://<host>:${WEB_PORT}`.
  - Else detect primary LAN IPv4: `ip route get 1.1.1.1` → parse `src <ip>`; fallback first
    non-loopback token of `hostname -I`. → `http://<ip>:${WEB_PORT}`.
  - If nothing resolves, skip (localhost-only, current behavior — non-fatal).
- Pass `-e JARVIS_PUBLIC_ORIGIN="$PUBLIC_ORIGIN"` into the `docker compose … run … setup` line.

**scripts/setup-prod.ts:**

- Build `JARVIS_AUTH_TRUSTED_ORIGINS` = dedup-join of `http://localhost:${webPort}` + any
  `JARVIS_PUBLIC_ORIGIN` (already normalized to a full origin by install.sh; if a bare host slips
  through, normalize defensively to `http://<host>:${webPort}`).
- **Existing `JARVIS_AUTH_TRUSTED_ORIGINS` env override still wins** (line 57 semantics preserved):
  if set explicitly, use it verbatim.
- Update the post-deploy note (lines 162–165) to PRINT the resolved trusted origins + how to
  override via `JARVIS_PUBLIC_ORIGIN` / `JARVIS_AUTH_TRUSTED_ORIGINS`.
- Factor the origin-merge into a small pure exported helper `deriveTrustedOrigins({ webPort,
publicOrigin, override })` so it's unit-testable without writing the env file.
- `JARVIS_AUTH_BASE_URL`: leave `http://localhost:3000` — the web nginx proxies `/api` to the api
  intra-container, so the api's own base URL is localhost-correct. Note this in a comment; do NOT
  change unless a test proves a remote cookie/redirect break (out of scope — better-auth validates
  the request Origin header against trustedOrigins, which is what #379 fixes).
- `readTrustedOrigins` (packages/auth) already comma-splits/trims/filters — UNCHANGED.

**Tests:**

- NEW `tests/unit/setup-prod-trusted-origins.test.ts` exercising `deriveTrustedOrigins`:
  - localhost only when no publicOrigin/override.
  - localhost + host origin when `JARVIS_PUBLIC_ORIGIN=http://192.168.1.50:5173`.
  - bare-host publicOrigin normalized to `http://host:webPort`.
  - dedup (publicOrigin == localhost collapses).
  - explicit `JARVIS_AUTH_TRUSTED_ORIGINS` override wins verbatim.

**Tasks:**
3a. (red+green) Add `deriveTrustedOrigins` helper + its unit test; wire setup-prod.ts to use it +
update the env render + post-deploy note. Commit.
3b. Edit install.sh: LAN-IP/JARVIS_PUBLIC_ORIGIN detection + pass-through. (Shell — verify with
`bash -n install.sh` + a manual dry echo of the detection logic; no unit harness for the .sh.)
Commit.

---

## Fix 4 — Stuck/abandoned login auto-releases the single-active gate (ADDITIVE, must NOT weaken #347)

**Why:** even with codex hidden, a hung/abandoned login must never permanently brick chat. Today
the gate is held while `isLoginActive()` is true = an in-memory `LoginService.flow` OR a live
`jarv1s-login-*` tmux session on disk. The per-flow `armDeadline` (`DEFAULT_LOGIN_TIMEOUT_MS =
600_000`) already reaps an in-memory flow, but: (a) a disk `jarv1s-login-*` session stranded by a
failed kill (`.catch(()=>undefined)`) makes `isLoginActive()` true with NO in-memory flow + NO
timer → permanent brick until restart; (b) the `unref()`'d timer can be starved.

**ADDITIVE fix — a periodic max-age sweep. Does NOT touch the admission mutex semantics.** Once a
stale disk session is killed and `this.flow` cleared, `isLoginActive()` naturally returns false and
the gate reopens. Login ⟂ chat ⟂ other-logins exclusivity is unchanged.

**New helper (additive, in cli-chat-engine.ts):** `listLoginMuxSessionsWithAge(io)` →
`{ provider, ageMs }[]` via `tmux list-sessions -F "#{session_name} #{session_created}"` (epoch
seconds), age = now − created\*1000. Leave `listLoginMuxSessions` untouched.

**LoginService.reapStaleLogins(maxAgeMs):**

- List sessions-with-age; for any `ageMs > maxAgeMs`: `killLoginMuxSession(io, provider)`; if
  `this.flow?.provider === provider` clear its timer + `this.flow = null`; drop the paste buffer
  (reuse `deleteLoginBuffer`). Best-effort/catch-swallow (a sweep must never throw).
- Bound default = `DEFAULT_LOGIN_TIMEOUT_MS` (10 min) — matches the existing overall login lifetime,
  so the periodic sweep is a disk-level backstop to the in-memory timer, not a new policy.

**Server drive (server.ts):** after `startupSweep()` in `start()`, start a `setInterval`
(`unref()`'d) every N seconds (e.g. 30s) calling `host.reapStaleLogins()` (a thin engine-host
pass-through to `loginService?.reapStaleLogins()`); `clearInterval` in `stop()`. The interval only
sweeps DISK sessions older than the bound — it never preempts an active/extended flow within its
lifetime.

**engine-host:** add `reapStaleLogins(maxAgeMs?)` that delegates to
`this.deps.loginService?.reapStaleLogins(maxAgeMs)` (no-op if no login service). Does NOT acquire
the admission mutex (it only mutates LoginService.flow + kills a tmux session; the next gate check
reads fresh disk state).

**Tests (`tests/unit/cli-runner-login.test.ts`):**

- Extend the mock io to support `list-sessions -F "#{session_name} #{session_created}"` (return
  name+created per live session; track a created epoch per session, controllable).
- A `jarv1s-login-anthropic` session older than the bound + NO in-memory flow → `reapStaleLogins`
  kills it → `isLoginActive()` returns false → a subsequent `beginLogin`/`launch` is admitted (gate
  released).
- A FRESH session (age < bound) is NOT reaped (active login protected).
- Reaper with `this.flow` matching the stale provider clears the flow.
- `#347 NOT weakened`: with a fresh live login flow, `reapStaleLogins` is a no-op and a concurrent
  chat `launch` STILL throws `CliChatUnavailableError` (exclusivity intact).

**Tasks:**
4a. (red) Add `listLoginMuxSessionsWithAge` + a unit test. (green) implement. Commit.
4b. (red) LoginService.reapStaleLogins test (stale reaped + gate released; fresh kept; #347 intact)
→ fails. (green) implement reapStaleLogins + engine-host pass-through + server interval. Commit.

**ESCALATE `[DESIGN-FORK]`** to the coordinator IF the reaper cannot be done without changing the
admission mutex acquire/release or the `isLoginActive` semantics. Current design is fully additive,
so no fork expected.

---

## Gate + finish

- Full local gate, REAL exit code: `JARVIS_PGDATABASE=jarvis_qa_v013 pnpm verify:foundation`;
  capture `VF_EXIT`. CI unavailable — don't trust it.
- Pre-push trio + fresh rebase: `pnpm format:check && pnpm lint && pnpm typecheck`;
  `git fetch origin main && git rebase origin/main`.
- `coordinated-wrap-up`: push `v013-seamless-fixes`, open PR (title per handoff), body references
  #379 + the 4 fixes + VF_EXIT + head SHA. Report to coordinator. Do NOT touch board/milestone/merge.
