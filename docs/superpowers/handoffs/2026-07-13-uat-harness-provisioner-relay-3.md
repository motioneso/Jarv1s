# Relay 3 — uat-harness-provisioner (#1024)

**Spec:** `docs/superpowers/specs/2026-07-12-dev-uat-harness.md` (coordinator's worktree only).
**Plan:** `docs/superpowers/plans/2026-07-13-uat-harness-provisioner.md` (committed `754f3d0a`,
amended `9378b3dc`, reformatted `9fa7ae05`).
**Branch/worktree:** `uat-harness-1024`, this worktree. Off `origin/main` @ `cdf66df0` (rebase
still needed — not yet done this lane).
**Coordinator:** Herdr label `Coordinator`, session `58a78927-385c-4b1d-8fa0-94db20255d6f` (w1:pE6
at doc-write time) — **resolve fresh by label+session id, never a baked `…-N`**.
**Risk tier:** sensitive (dev-only privileged compose orchestration; no BYPASSRLS on runtime roles).
**Prior relay:** `docs/superpowers/handoffs/2026-07-13-uat-harness-provisioner-relay-2.md`
(superseded — covered pre-Task-7 state, now done).

## State — Task 7 DONE, Task 8 partially done

Commits since relay-2:
```
82eae325 fix(uat): export compose-interpolation env vars + add missing module-credential key (#1024)
9fa7ae05 style(uat): prettier formatting pass on Task 7 bugfix files (#1024)
```

### Task 7 — live verification run: COMPLETE

Ran `pnpm uat:provision:smoke` for real against `infra/docker-compose.prod.yml`. Found and fixed
**two real bugs** the live run caught that unit tests could not (this validates Task 7's whole
purpose):

1. **Compose `${...}` interpolation gap.** `writeUatEnvFile()` wrote `POSTGRES_PASSWORD` /
   `JARVIS_CLI_RUNNER_RPC_SECRET` / `JARVIS_WEB_PORT` / `JARVIS_DOCKER_SUBNET` only into the env
   FILE (`env_file:` → container env only). Compose's own YAML `${...}:?` interpolation needs real
   `process.env` vars — `env_file:` never feeds it (this is the documented
   `deploy-compose-env-trap` failure class). Silent part: without the fix, subnet/port would have
   silently fallen back to PROD's `10.251.0.0/24` / `1533` instead of erroring. Fixed by adding
   `uatComposeInterpolationEnv({webPort})` (new export in `tests/uat/provisioner.ts`) and
   `Object.assign(process.env, uatComposeInterpolationEnv({webPort}))` inside `main()`'s retry loop
   (must re-run per retry since `webPort` changes each iteration).
2. **Missing `JARVIS_MODULE_CREDENTIAL_SECRET_KEY`.** App container crash-looped unhealthy —
   `resolveKeyring` (from #918 Slice 2, landed after this plan was authored) requires this key in
   any non-dev/test `NODE_ENV`. Added to `writeUatEnvFile()`'s template, value
   `22222222222222222222222222222222` matching `.github/workflows/ci.yml`'s convention.

Both fixes are unit-tested (`tests/unit/uat-provisioner.test.ts`: new
`uatComposeInterpolationEnv` describe block + an added assertion on the module-credential-key
line in the `writeUatEnvFile` block). `pnpm typecheck` / `pnpm lint` / targeted vitest all green
pre-reformat; `pnpm format:check` fixed via targeted `prettier --write` on exactly the 3 touched
files (`9fa7ae05`) — verified pre-existing-vs-mine via stash/pop before touching the plan doc.

**Verified evidence (record these numbers in the PR body):**
- With build (`pnpm uat:provision:smoke`): wall-clock **44305ms**, reachable at **19534ms**.
- Without build (`JARVIS_UAT_BUILD=0`, provision-only timing): wall-clock **44629ms**, reachable at
  **19752ms**.
- `assertNoLeakedResources` passed clean on every run (checked via
  `docker ps/volume/network --filter "name=uat-"` regex `^uat-[0-9a-f]+_` to isolate this run's
  resources from unrelated host state).
- Did NOT build the spec §4.5 template-DB-clone optimization — explicitly deferred per plan.

## What's left — finish Task 8 (read plan's final section only)

1. **Re-verify lint/typecheck post-reformat** (format:check already reconfirmed green after
   `9fa7ae05`; lint/typecheck were last green on pre-reformat code — prettier changes should be
   semantically inert but re-run both to be sure):
   ```
   pnpm lint && pnpm typecheck
   ```
2. `git fetch origin main && git rebase origin/main` — not yet done this lane.
3. Full gate: `pnpm verify:foundation`. Record exit code + anything worth citing. Fix-and-rerun if
   non-zero before proceeding.
4. Invoke **`coordinated-wrap-up`**: open PR against `main`. Body must include:
   - `Part of #1000`, `Closes #1024`
   - "What's new" note verbatim: *"Internal: adds the ephemeral-instance provisioner that future
     end-to-end UAT tests run against."*
   - Both Task 7 wall-clock/reachable numbers above, the leak-check result, and a short note on the
     two bugs found/fixed (cite `82eae325`).
5. Report the PR number to the `Coordinator` Herdr pane (resolve fresh by label+session id at that
   time — the session id above may be stale by then if Coordinator itself relayed).
6. **Do NOT merge.** Sensitive tier — Coordinator does QA + invariant walk first.

## Guardrails (unchanged, repeat)

- No `git add -A` — explicit paths only. `.claude/context-meter.log` is never mine to stage.
- Don't touch `docs/coordination/`; don't run repo-wide `pnpm format`.
- No new migration; don't touch `foundation-schema-catalog`.
- Any blocker → escalate to `Coordinator`, don't improvise.
- Pre-push trio + rebase before pushing (step 1-2 above ARE that trio for this push).

## Relay trigger for this handoff

Context-meter hit the 70% warning right after confirming `format:check` green post-`prettier
--write`. Committed the formatting fix (`9fa7ae05`, real progress past the trigger) before writing
this doc, per `coordinated-build` guidance. Successor should move straight to Task 8 step 1 above —
no re-planning, no re-escalation; Task 7 is fully done and verified.
