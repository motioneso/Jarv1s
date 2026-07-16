# Spec — #1081: cli-tools volume deploy-drift auto-reconcile

**Status:** Fable-approved (delegated auth, 2026-07-16). Option A (boot drift-reconcile + session-drop-on-reinstall) **plus** Option B's runbook line. Lane H, backend. **No migration.**

## Root cause

Bumping a bundled CLI-tool version only rebakes the recipe catalog into the image; the binary lives in the persistent named volume `jarv1s-cli-tools` (`/data/cli-tools`), which survives `docker compose pull && up -d`. The version-aware reinstall (`InstallService.runInstall` → `tryIdempotentNoop`, `packages/cli-runner/src/install-service.ts:225/571`) is reachable ONLY via the admin RPC `installProvider` (`engine-host.ts:384`), triggered solely by `POST /api/onboarding/provider-install`. Neither boot (`startupSweep`, engine-host.ts:472 — GC only) nor engine launch (`ensureProviderLaunchReady`, `provider-first-run.ts:120` — trust/onboarding only) probes the version. So after a bump the instance silently runs the stale binary until an admin clicks Install (bit us live in #1079).

## Decided design (locked)

- **H1 — boot drift-reconcile (the fix).** In the cli-runner boot path (engine-host `startupSweep`, after the existing GC sweeps, still BEFORE `server.listen`), iterate `Object.keys(catalog)`; for each provider that is **already installed** (its `bin/<binary>` symlink resolves executable), call the existing `installService.installProvider(provider)`. That internally runs `tryIdempotentNoop` → cheap no-op when `--version` matches the baked recipe, reinstall when it drifted. **Do NOT fresh-install providers with no existing release** — leave those to the explicit admin action (today's behavior). Because this runs at boot before any engine session exists, the stale-REPL problem cannot arise on the `pull && up -d` path — the container restart already dropped every old PTY, and the first post-boot session picks up the fresh binary.
- **H2 — session-drop fold-in (running-instance reinstall).** Surface `binaryChanged: boolean` on the `installProvider` result (true only when a real reinstall replaced the binary, i.e. not `alreadyInstalled`). The api's `/api/onboarding/provider-install` route, when `binaryChanged`, drops+relaunches live chat sessions for that provider (the `POST /api/chat/clear`-equivalent) so a mid-run admin reinstall never leaves a stale resident REPL. Boot reconcile (H1) sets no sessions, so it needs no drop.
- **H3 — Option B surfacing (doc + warning).** Add the post-deploy runbook line (deploy doc) documenting the manual fallback (`provider-install` + `chat/clear`) as belt-and-suspenders, and surface a drift warning in AI-admin when baked-recipe version ≠ installed-volume version.

## Files

- `packages/cli-runner/src/engine-host.ts` (startupSweep reconcile loop), `install-service.ts` (`installProvider`/`runInstall` result carries `binaryChanged`; helper: is-provider-installed probe reusing `binPath`/`isExecutable`).
- api provider-install route (`packages/settings/src/onboarding-routes.ts` or the chat route owning session-clear) — session-drop on `binaryChanged`.
- Result type in `packages/shared/src/*` install/onboarding API schema (add `binaryChanged`; remember fast-json-stringify strips undeclared fields).
- Deploy runbook doc + AI-admin drift-warning surface.

## Tests

- Boot reconcile: installed-but-drifted provider → reinstalled at boot; version-matched provider → no-op (no reinstall); uninstalled provider → left untouched.
- `binaryChanged` true only on a real reinstall, false on idempotent no-op.
- Session-drop invoked exactly when `binaryChanged` on the running-instance install path.

## Constraints

Per-agent `JARVIS_PGDATABASE`. Full `verify:foundation` real exit code. No migration — if one seems unavoidable, STOP and report. Generous why-comments citing #1081 (H1/H2/H3). PR vs main referencing #1081; do NOT merge, do NOT redeploy.

## Exit criterion

Dev-runtime proof: install version X into the volume, restart the runner with a recipe pinning Y≠X, confirm the boot reconcile upgraded the volume to Y with no admin action and the first chat turn runs Y.

## Resolution note (implementation PR)

H1 and H2 shipped as specced, with the full test matrix from the Tests section above. H3's
runbook line shipped in `docs/operations/deploy.md`. H3's AI-admin drift-warning UI was
**split out to a follow-up issue (#1100)**: the AI-admin "LLM Providers" pane's
`cliAvailable` flag is populated by a local `command -v` presence probe running inside the
api container (`packages/ai/src/cli-availability.ts`, ADR 0008 host-CLI contract) — a
completely separate mechanism from the cli-runner sidecar's `InstallService`/`ProviderCatalog`
this spec fixed. The api process does not currently talk to cli-runner's RPC for this DTO at
all, so wiring a real version-drift comparison through means a new RPC/wire-type surface
across module-registry — a separate feature needing its own spec per the project's
build-needs-a-task-issue rule, not a same-PR addition. Not a functional gap: H1 already
self-heals the underlying drift automatically at boot; #1100 is pure observability.
