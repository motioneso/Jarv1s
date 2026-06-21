# Build Handoff — v0.1.3 seamless first-run fixes

**Goal:** make onboarding work first-try for a real user with NO operator intervention (they can't ask anyone to restart anything). Found during the v0.1.2 live deploy test. Branch `v013-seamless-fixes` off main `f7f7e63`. Tier: **sensitive** (deploy-ops auth config + the #347 single-active-login gate). Build to that bar.
**Coordinator:** label `Coordinator`, session `11d3e71c-5d93-4983-8b63-6a0d266c28ab` (escalate via herdr-pane-message; re-resolve the live pane by label each time).
**Build skill:** invoke `coordinated-build`. Plan is PRE-APPROVED in this doc (Ben signed off the 4 fixes); escalate only on a real fork. **Caveman mode** to the coordinator.

## Setup
`git fetch origin main && git checkout -b v013-seamless-fixes origin/main` (HEAD `f7f7e63`). `[ -d node_modules ] || pnpm install`. JARVIS_PGDATABASE=jarvis_qa_v013 for DB tests.

## The 4 fixes (all locked by Ben)

### 1. Remove the multiplexer onboarding step ENTIRELY
Only tmux is offered, so the step is pure noise. Remove the multiplexer step from the founder wizard flow (`apps/web/src/onboarding/onboarding-wizard.tsx` — the step ordering / `FOUNDER_ORDER`/`FOUNDER_RAIL`; the step component `multiplexer-step.tsx` + `multiplexer-options.ts`). The wizard should go straight from welcome → **provider connect**. Delete the now-dead multiplexer step component/option module + their tests + any nav/rail entry + the `/api/onboarding/...` multiplexer-selection wiring IF it's now fully unused (grep before deleting; if the backend still persists a multiplexer choice elsewhere, default it to tmux server-side and stop collecting it in the UI). Remove dead vocabulary in the same pass (no stale "multiplexer step" refs).

### 2. Hide codex from onboarding — offer ONLY working providers (Claude)
Codex (`openai-compatible`) headless login CANNOT complete on a server and it bricked chat via the single-active gate during the live test. The onboarding provider-connect step (`apps/web/src/onboarding/cli-auth-step.tsx`, data-driven from the catalog `supported` set + `LOGIN_ADAPTERS`) must offer ONLY providers with a guaranteed-working headless login — **currently `anthropic`/Claude only**. Introduce a clear, documented allowlist (e.g. `ONBOARDING_LOGINABLE_PROVIDER_KINDS = ['anthropic']`) or filter so codex/openai-compatible is NOT shown in onboarding. Keep it data-driven/easy to re-add codex when its headless login is real (a comment saying so). This is onboarding-only — do NOT rip codex out of the AI module / settings / catalog.

### 3. Auto-configure better-auth trusted-origins for the deploy host (#379)
A real deploy is reached over LAN/tailnet/domain, not localhost. Today `scripts/setup-prod.ts` derives `JARVIS_AUTH_TRUSTED_ORIGINS=http://localhost:${webPort}` only → signup fails "Invalid origin" from any non-localhost URL (hit live; manual workaround was editing the env + recreating api). FIX so a fresh `install.sh` just works:
- **`install.sh` (runs on the HOST — it can see the real LAN IP; the `setup` container CANNOT):** detect the primary LAN IPv4 via `ip route get 1.1.1.1` (parse `src`), fallback to first non-loopback `hostname -I`. Honor an explicit **`JARVIS_PUBLIC_ORIGIN`** override (full origin like `https://jarvis.example.com`, or a bare host/IP → assume `http://<host>:${WEB_PORT}`). Pass the resulting origin(s) into the `setup` step.
- **`scripts/setup-prod.ts`:** build `JARVIS_AUTH_TRUSTED_ORIGINS` = `http://localhost:${webPort}` + the host LAN origin + any `JARVIS_PUBLIC_ORIGIN` (comma-joined, deduped). Existing `JARVIS_AUTH_TRUSTED_ORIGINS` env override still wins if set.
- Print a one-line post-deploy note showing the trusted origins + how to override. Keep `readTrustedOrigins` comma-parsing (already correct).
- (Revisit `JARVIS_AUTH_BASE_URL=http://localhost:3000` only if needed for remote cookie/redirect correctness; the web nginx proxies `/api` so localhost base may be fine — verify, note if changed.)

### 4. Stuck/abandoned login auto-releases the single-active gate (defense-in-depth) — **ADDITIVE, must NOT weaken #347**
Even with codex hidden, a login that hangs/abandoned must never permanently brick chat. The cli-runner already does a startup sweep of `jarv1s-login-*` + late-success reap (`packages/cli-runner/src/*`). ADD a **max-age reaper**: a login session/admission that has been held longer than a bounded timeout (pick a sane default, e.g. the existing login start/overall timeout — reuse §L.7 timeouts if present) is reaped (kill the tmux login session + release the admission gate + reconcile DB state to `error`/`cancelled`). This is an EXTENSION of the existing reap — **do NOT change the #347 single-active admission mutex semantics** (login ⟂ chat ⟂ other logins stays intact). If this can't be done cleanly/additively, STOP and escalate `[DESIGN-FORK]` to the coordinator rather than touching the gate core.

## Constraints
- Honor all CLAUDE.md Hard Invariants. No secrets in logs/payloads/prompts. Provider-agnostic (the hide-codex allowlist is onboarding presentation, not a hardcoded provider in the engine). `@jarv1s/shared` no `node:*`.
- `git add` only your own changed files (never `git add -A` — shared tree). Co-Authored-By your real model.
- Remove dead code/vocabulary in the same pass as each change (Ben's no-stale-concepts rule).

## Gate + finish
Run the FULL local gate with REAL exit codes (`pnpm verify:foundation`, capture VF_EXIT; CI is unavailable, don't trust it). Add/adjust tests: multiplexer step gone (wizard flow test), onboarding offers Claude-only (not codex), setup-prod trusted-origins includes the host origin, the login max-age reaper releases the gate. Fresh `git rebase origin/main` before push. Push `v013-seamless-fixes`, open a PR (title `fix: seamless first-run onboarding+deploy (v0.1.3) — drop multiplexer step, hide codex, auto trusted-origins, login gate auto-release`, body referencing #379 + the 4 fixes + VF_EXIT + SHA). Report PR# + evidence to the coordinator. Do NOT touch board/milestones/merge.
