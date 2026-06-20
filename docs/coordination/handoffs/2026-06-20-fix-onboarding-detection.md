# Build handoff — fix onboarding detection for Docker deploy (#341 + #343)

**Coordinator:** GLM/opencode `ses_11cb3c6d3ffePR9wnuZWtKZ7vR` (pane `w1:p58`, label `Coordinator`).
**Date:** 2026-06-20.
**Branch / worktree:** `fix-onboarding-detection-341-343` at `/home/ben/Jarv1s/.claude/worktrees/fix-onboarding-detection-341-343` (off `origin/main` `13f9d0a`).
**Issues:** [#341](https://github.com/motioneso/Jarv1s/issues/341) (provider-CLI false-negative), [#343](https://github.com/motioneso/Jarv1s/issues/343) (herdr false-positive).
**Tier:** `sensitive` (deploy/env contract change + provider/onboarding surface; no auth/RLS/secret/schema surface). Auto-merge after verified GREEN + per-merge digest to Ben.

## Context — why this exists
Ben's MacBook Docker deploy (#306 acceptance) exposed two onboarding-detection bugs. Both are confirmed against `origin/main` (`13f9d0a`). Root causes are diagnosed; your job is the surgical fix + tests + gate. **Do NOT redesign** — implement the locked decisions below.

The containerized deploy architecture (ADR 0008): the API runs in a container; the **tmux server + AI CLIs (claude/codex/gemini) run on the HOST**. The container ships only the thin tmux client. Compose mounts only the CLI **auth/config dirs** read-only (`~/.claude`→`/host-home/.claude:ro`, etc.) and the per-uid tmux socket — **NOT** the CLI binaries or their bin dirs.

## Bug #343 — herdr false-positive (multiplexer detection)
**File:** `packages/module-registry/src/chat-multiplexer.ts` (`makeMultiplexerUsableProbe`, ~line 64-74).
**Root cause:** the probe returns `decideMultiplexer({ configured: kind }).ok`. `install.sh` pins `JARVIS_MULTIPLEXER=tmux` into the env file, so `decideMultiplexer` (`packages/ai/src/adapters/multiplexer-resolve.ts:46-49`) honors the **env override first** and returns `{ ok: true, kind: "tmux" }` **regardless of the `configured` argument**. The probe reads only `.ok` → both `multiplexerUsable("tmux")` AND `multiplexerUsable("herdr")` return `true` whenever the override is set.
**Locked fix:** `multiplexerUsable(kind)` must report whether THAT SPECIFIC kind is installed/usable, NOT funnel through `decideMultiplexer` (which has env-override + auto-fallback semantics appropriate for resolution, not per-kind availability). Implement directly:
- `tmux` ⇔ `isInstalled("tmux")`
- `herdr` ⇔ `isInstalled("herdr") && herdrRootAvailable` (root-pane check: `JARVIS_HERDR_ROOT_PANE` or `HERDR_PANE_ID` present — same condition `decideMultiplexer` uses at `multiplexer-resolve.ts:38-41`)

Keep using `createBinaryProbe(env).has(bin)` for `isInstalled`. Keep the `boundedProbe` wrapper. Do NOT change `decideMultiplexer`/`resolveMultiplexer` (they're correct for resolution).

## Bug #341 — provider-CLI false-negative (container can't see host CLIs)
**Files:** `packages/ai/src/cli-availability.ts` (`cliAvailable`, ~line 18-37), `packages/module-registry/src/chat-multiplexer.ts` (`makeCliPresentProbe`, ~line 77-79), `install.sh` (the `FOUND_CLI` loop ~line 95-103).
**Root cause:** `cliAvailable` runs `command -v claude|codex|agy` **inside the container**, where the CLIs don't exist (host-only per ADR 0008; only auth dirs mounted). `install.sh` already detects host CLIs but discards the result.
**Locked fix — operator-declared env contract (no new host mounts):**
1. `install.sh`: in the `FOUND_CLI` loop, accumulate the detected set and write `JARVIS_HOST_CLIS=<comma-list>` into `env.production.local` alongside the other appended host-bridge paths (the `>> "$ENV_FILE"` block ~line 165). Use the canonical binary names `claude`, `codex`, `gemini`/`agy` — map `agy`→`google` kind consistently with `cli-availability.ts`'s `PROVIDER_BINARY`. Only append on `FIRST_RUN=1` (same gate as the other appended paths).
2. `cliAvailable(providerKind)`: consult `process.env.JARVIS_HOST_CLIS` FIRST — if set, return whether the kind's binary is in the comma-list. If the env var is unset, fall back to the existing local `command -v` (unchanged behavior for non-containerized/host installs + tests).
3. Keep it presence-only (no auth probing here).

**Env contract:** `JARVIS_HOST_CLIS` = comma-separated binary names present on the host (e.g. `claude,codex,gemini`). Empty/unset ⇒ fall back to local probe. Document the key in `docs/operations/deploy.md` prereqs table + the install.sh comment block.

## Tests (required)
- `#343` regression: with `JARVIS_MULTIPLEXER=tmux` set and herder NOT installed, `multiplexerUsable("herdr")` returns `false` and `multiplexerUsable("tmux")` returns `true` (when tmux installed). Cover the herdr root-pane condition (false without `JARVIS_HERDR_ROOT_PANE`/`HERDR_PANE_ID`, true with it + installed). Existing `multiplexer-resolve` tests must stay green.
- `#341` tests: `cliAvailable` returns true/false from `JARVIS_HOST_CLIS` membership (including the `agy`/`google` mapping); falls back to `command -v` when unset. Add/extend tests in `tests/unit/` near the existing cli-availability/multiplexer tests.
- Keep all existing onboarding tests green (`tests/unit/onboarding-resume.test.ts`, `tests/e2e/onboarding.spec.ts`, `tests/e2e/mock-onboarding-api.ts`).

## Hard constraints (coordinator-run invariants)
- **Scope format + staging to YOUR changed paths only.** NEVER run repo-wide `pnpm format` or `git add -A` — the shared coordinator tree carries foreign uncommitted edits (`README.md`, `docs/superpowers/specs/2026-06-18-wellness-adversarial-remediations.md`, `pr*.diff`) that you must NOT sweep in. Stage explicit paths.
- **Do NOT touch** `docs/coordination/`, the gate/audit scripts, `package.json`, `check-file-size` config, or any migration. No gate-weakening.
- **Run the gate on an ISOLATED DB** (create it first): `docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE jarvis_build_341_343;"` then `JARVIS_PGDATABASE=jarvis_build_341_343 pnpm verify:foundation` + `pnpm audit:release-hardening`. Capture real exit codes (write to a file + `$?`, never pipe to `tail`/`grep`). Retry `verify:foundation` once on the "tuple concurrently updated" signature (cluster-global grant collision) — not on other failures.
- Ensure your worktree is clean of stray untracked `.md` before `format:check` (it breaks the gate).

## Done = report to `Coordinator`
When the PR is open, head pushed, merge state CLEAN, and your gate + focused tests are GREEN: post a concise status to the `Coordinator` label via `herdr pane run` with PR URL + head SHA + exit codes. Then STOP (the coordinator runs independent QA + merge). Do not merge yourself.
