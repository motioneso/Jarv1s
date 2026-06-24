# Plan — Notes Source: Host-Folder Transport (issue #449)

**Status:** Draft (pending Ben's approval before build)
**Date:** 2026-06-23
**Grounded on:** `origin/main` @ `bc703a89` (preflight green, HEAD == origin/main)
**Issue:** [#449 — Notes Source connector — folder transport, ingest-only (v1)](https://github.com/motioneso/Jarv1s/issues/449)
**Supersedes (partially):** `docs/superpowers/specs/2026-06-23-notes-source-connector-folder-transport.md` — see "Spec reconciliation" below.

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## Why this plan exists

The approved spec (2026-06-23) describes building the notes connector from scratch. A **prior plan** (`docs/superpowers/plans/2026-06-22-notes-folder-ingest.md`) already shipped ~70%: the `@jarv1s/notes` module, `POST /api/notes/sync` route, `notes.sync` pg-boss queue + worker, the `PUT/GET /api/me/notes-source` settings routes, and the `JARVIS_NOTES_ROOTS` env-var allowlist + traversal guard (`packages/notes/src/path-guard.ts`).

**But the prior plan left a hole the spec correctly identified:** Jarvis runs in a Docker container. The worker process can only read files that are mounted into the container. `resolveNotesRoots()` (in `packages/settings/src/notes-source-routes.ts:26`) + `assertWithinRoot` (in `packages/notes/src/path-guard.ts`) validate paths and guard traversal — but **nothing actually mounts the host folder into the container.** As shipped, the feature is non-functional on the production box: the path validates, the guard passes, then `readdir` hits an empty/missing directory.

This plan closes that gap: **the container-reaches-host layer (bind mount) + the two spec features the prior plan didn't ship (15-min heartbeat, wired settings card).** It does not rebuild what works.

---

## Spec reconciliation (what changes vs. the 2026-06-23 spec)

The spec's _goal_ and _invariants_ stand. Three architectural decisions are reversed to match shipped reality, because the shipped code is simpler, already integrated, and already security-guarded — unwinding it would be pure churn against the Development Standards ("do not accept a refactor that only moves complexity around").

| Spec says                                                                                       | This plan does                                                                                                                                        | Reason                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bind mount to **fixed `/data/external-notes`** + per-user `VaultContext` root resolver override | Bind mount to **fixed `/data/external-notes`** (kept) + `JARVIS_NOTES_ROOTS=/data/external-notes` auto-set by install.sh (replaces resolver override) | The shipped `resolveNotesRoots()` + `assertWithinRoot` guard already does path validation generically; pointing it at the mount target reuses it with zero app-code change. The `VaultContext` resolver override is moot — notes never used `VaultContext`.                          |
| New Notes Source connector record OR dedicated notes table                                      | **No table.** Keep the shipped `app.preferences` key (`notes-source-path`)                                                                            | Shipped design uses the existing preferences KV. No new SQL, no `foundation.test.ts` migration-list edit, no new RLS policy. Simpler.                                                                                                                                                |
| `IngestionService.ingestVault(accessCtx, vaultCtx)` is the entrypoint                           | **Keep the shipped direct path:** notes worker uses `MemoryRepository` + raw `fs` + `assertWithinRoot`                                                | The shipped worker is correct and tested. Routing it through `IngestionService`/`VaultContext` would add an abstraction that earns nothing — `VaultContext` is for the user-scoped writable vault (`/data/vaults/<uid>`), a different concept from a read-only mounted notes folder. |

**Kept from the spec:** bind mount via compose override file, `:rw` for future write-back, `install.sh` env-var-driven wiring, 15-min heartbeat, Sync-now UI card, read-only-v1 invariant, all hard invariants (RLS, metadata-only payloads, module isolation).

---

## Locked decisions

1. **Mount target = fixed neutral path `/data/external-notes`.** Operator names only the _host_ path (`JARVIS_NOTES_VAULT_HOST_PATH`); the container always sees `/data/external-notes`. install.sh derives `JARVIS_NOTES_ROOTS=/data/external-notes` from the same var so the shipped app code sees a stable path with no app-code change.
2. **Override file, not base compose.** `infra/docker-compose.notes.yml` is `-f`'d in **only** when `JARVIS_NOTES_VAULT_HOST_PATH` is set. Unset → file never loads → no mount → no broken `${VAR:?}` parse error. (Honors spec §infra.)
3. **`:rw`** even though v1 is read-only — write-back (slice #2) needs no mount change. (Honors spec.)
4. **15-min heartbeat = `*/15 * * * *`, per-actor, worker-side `boss.schedule`.** Mirrors `packages/briefings/src/schedule.ts` (the correct precedent — it does both `schedule` _and_ `unschedule`, matching the notes set/clear lifecycle; `tasks-recurrence` only ever schedules and has no unschedule to copy). UTC for v1 (single-operator box); per-actor TZ is a future refinement, not a v1 blocker. One schedule row per actor (`pgboss.schedule` keyed by `actorUserId`).
5. **Schedule reconciled on settings change**, not at boot. `PUT /api/me/notes-source` (set path → `boss.schedule`), null path → `boss.unschedule`. Same lazy-reconcile shape as briefings. No boot-time scan.
6. **Last-sync stats persisted to preferences** (`notes-last-sync` key, JSON `{at, ingested, skipped, errors, lastError}`). The settings card needs them; the job result is currently discarded post-enqueue. **Write on both success and failure paths** — with `retryLimit: 0` + `deleteAfterSeconds: 300`, a heartbeat failure self-deletes in 5 min with no trace; the card must be able to distinguish "never synced" from "failing every 15 min."
7. **Multi-user = single-operator assumption for v1.** One mount, one configured user. Documented as the limitation the git transport (#2) removes. (Honors spec locked-decision #7.)

---

## Scope

**In v1 (this plan):**

- `infra/docker-compose.notes.yml` bind-mount override (api + worker → `/data/external-notes:rw`).
- `install.sh` gains `JARVIS_NOTES_VAULT_HOST_PATH` probe → writes `JARVIS_NOTES_ROOTS=/data/external-notes` to env file + appends `-f infra/docker-compose.notes.yml` to all compose invocations.
- `scripts/setup-prod.ts` writes `JARVIS_NOTES_ROOTS` when the host path is configured (so it survives in the canonical env file, not just install.sh appends).
- 15-min pg-boss heartbeat: `packages/notes/src/schedule.ts` + reconcile on settings PUT + worker-side registration.
- Last-sync stats: worker writes `notes-last-sync` preference on job completion; settings route exposes it.
- Settings UI card wired to real APIs (`GET/PUT /api/me/notes-source`, `POST /api/notes/sync`, last-sync read). Replaces the `NotWired` stub.

**Not v1 (named, deferred — same as spec):** write-back, git/WebDAV transport, headless Obsidian, CLI/MCP/REST, non-Obsidian sources, per-actor TZ, multi-user self-service.

---

## Invariants honored (checklist)

- [ ] **VaultContext for vault I/O** — N/A for notes (notes uses its own guarded `fs` path, deliberately bypassing `VaultContext` per the shipped design). No regression.
- [ ] **Owner-only / private by default** — preferences rows + `memory_chunks` rows are owner-scoped via existing RLS. No new tables.
- [ ] **Metadata-only job payloads** — `{ actorUserId, sourcePath }` already in `ALLOWED_PAYLOAD_KEYS`. Schedule payload = `{ actorUserId }` only.
- [ ] **Module isolation** — `@jarv1s/vault` untouched. Notes calls public `@jarv1s/memory` APIs.
- [ ] **No new container** — bind mount only, rides existing api + worker.
- [ ] **No file mutation in v1** — `:rw` mount is for slice #2; v1 code only reads.
- [ ] **Never edit applied migrations** — no new SQL in this plan.
- [ ] **1000-line file limit** — new files are small; verify with `pnpm check:file-size`.

---

## Design-fork analysis (steelman the rejected option)

**Fork:** "Mount straight to the operator-named path" (e.g. mount `~/notes` → `~/notes` in-container, set `JARVIS_NOTES_ROOTS=~/notes`).

**Steelman:** the container path mirrors the host path, so debugging is intuitive (`docker exec ... ls ~/notes` matches the operator's mental model). No install.sh derivation step.

**Why rejected:**

1. The host path may not exist in-container (UID/home layout differs) — mirroring invites confusion when `~` doesn't exist in the image.
2. `install.sh` would need to propagate the raw host path into two places (compose `source:` and `JARVIS_NOTES_ROOTS`) with no derivation benefit.
3. A fixed neutral target (`/data/external-notes`) matches the existing `/data/vaults` convention and is rotation-proof — the operator can re-point the host path without touching app config.
4. The spec's planning session already chose this; no new information overturns it.

---

## File Map

**New files:**

- `infra/docker-compose.notes.yml` — bind-mount override (api + worker).
- `packages/notes/src/schedule.ts` — `reconcileNotesSchedule(boss, actorUserId, hasPath)` + `NOTES_SYNC_CRON`.
- `tests/integration/notes-schedule.test.ts` — schedule reconcile + 15-min cron + one-row-per-actor.

**Modified files:**

- `install.sh` — probe `JARVIS_NOTES_VAULT_HOST_PATH`; when set, export `JARVIS_NOTES_ROOTS=/data/external-notes` into setup env + collect `-f infra/docker-compose.notes.yml` into a `COMPOSE_FILES` array applied at all 5 call sites (lines 212, 238, 282, 294, 310).
- `scripts/setup-prod.ts` — write `JARVIS_NOTES_ROOTS=/data/external-notes` to `env.production.local` when `JARVIS_NOTES_VAULT_HOST_PATH` is set (idempotent section, alongside the host-CLI append pattern).
- `packages/settings/src/notes-source-routes.ts` — `PUT` calls `reconcileNotesSchedule` on path set/clear; new `GET /api/me/notes-last-sync` reads the `notes-last-sync` preference.
- `packages/shared/src/notes-api.ts` — add `GetNotesLastSyncResponse` + route schema.
- `packages/notes/src/jobs.ts` — `sourcePath` becomes optional in `NotesSyncJobPayload`; when absent (the scheduled path), resolve from the `notes-source-path` preference via the injected `PreferencesRepository` from `@jarv1s/structured-state` (already a notes dep — see `notes-sync-routes.ts:8`). On both success and failure, write the `notes-last-sync` preference. `RegisterNotesJobWorkersOptions` gains `preferencesRepository: PreferencesRepository` (`@jarv1s/structured-state`, **not** settings' internal `ProfilePreferencesPort` — that would cross module isolation).
- `packages/notes/src/index.ts` — re-export schedule helpers.
- `packages/module-registry/src/index.ts` — inject `PreferencesRepository` into `registerNotesJobWorkers` deps.
- `apps/web/src/settings/settings-personal-data-panes.tsx` — replace `DEFAULT_VAULT` stub (lines 313–489) with real API calls + Sync-now button + last-sync display.

**No changes to:** `packages/connectors/*`, `packages/vault/*`, `packages/memory/*`, any SQL migration, `foundation.test.ts`.

---

## Tasks

### Task 1 — Bind-mount override file

**Files:** create `infra/docker-compose.notes.yml`

**Content:**

```yaml
# Notes Source bind-mount override. `-f`'d in ONLY when
# JARVIS_NOTES_VAULT_HOST_PATH is set (install.sh gates this). Unset var +
# this file loaded = hard compose parse error, so the file is opt-in.
# v1 is read-only; :rw is reserved for write-back (slice #2).
services:
  api:
    volumes:
      - ${JARVIS_NOTES_VAULT_HOST_PATH:?set JARVIS_NOTES_VAULT_HOST_PATH}:/data/external-notes:rw
  worker:
    volumes:
      - ${JARVIS_NOTES_VAULT_HOST_PATH:?set JARVIS_NOTES_VAULT_HOST_PATH}:/data/external-notes:rw
```

**Verification:**

- [ ] `JARVIS_NOTES_VAULT_HOST_PATH=/tmp docker compose -f infra/docker-compose.yml -f infra/docker-compose.notes.yml config` parses without error.
- [ ] Without the `-f`, `docker compose -f infra/docker-compose.yml config` still parses (base unaffected).
- [ ] With `-f` and the var unset, compose errors out (fail-closed).

---

### Task 2 — install.sh wiring

**Files:** modify `install.sh`

**Working-dir note:** install.sh `cd`s into `COMPOSE_DIR` at line 79, so `COMPOSE_NAME` is a bare basename relative to CWD. The override `-f` must likewise be a **bare `docker-compose.notes.yml`** (sibling of the base file in the same dir), not an absolute path — otherwise `-f` resolution breaks after the `cd`.

**Changes:**

1. Near the existing env probes (after `HOST_UID`/`HOST_GID` capture, ~line 90), probe `NOTES_VAULT_HOST_PATH` (read from env or prompt; default empty).
2. Convert `COMPOSE_NAME` (single string, line 80) to a `COMPOSE_FILES` array: `COMPOSE_FILES=(-f "$COMPOSE_NAME")`; when `NOTES_VAULT_HOST_PATH` is non-empty, append `-f docker-compose.notes.yml` (bare name — same dir after the `cd`).
3. Replace the `-f "$COMPOSE_NAME"` at the **real compose invocation call sites only** — not the echo/log strings:
   - Line 212 (`build api web`)
   - Line 238 (`run --rm setup`)
   - Line 282 (`up $UP_FLAGS`) ← the only site that strictly _needs_ the mount; the others are harmless-but-unnecessary and included for compose-parse consistency (a `config`/`build` that parses the override is a free correctness check).
   - Line 294 (`exec -T api ...`) — uses the running container; `-f` is cosmetic here, leave as-is to avoid touching a post-up call. **Only patch 212, 238, 282.**
   - **Do NOT patch 283 (`die` message) or 310 (`warn` message)** — those are log strings, not invocations; expanding `COMPOSE_FILES` inside them reads oddly and is pure churn.
4. Pass `-e JARVIS_NOTES_VAULT_HOST_PATH="$NOTES_VAULT_HOST_PATH"` to the `run setup` invocation (line 238) so setup-prod.ts can see it.

**Verification:**

- [ ] `bash -n install.sh` parses.
- [ ] Dry-run with `NOTES_VAULT_HOST_PATH=` (empty): `COMPOSE_FILES=(-f docker-compose.prod.yml)`, behavior identical to today.
- [ ] Dry-run with `NOTES_VAULT_HOST_PATH=/tmp/notes`: `COMPOSE_FILES=(-f docker-compose.prod.yml -f docker-compose.notes.yml)`, expands correctly at all 3 patched sites.
- [ ] Operator-facing message: when set, note "bind-mounting $NOTES_VAULT_HOST_PATH → /data/external-notes".

---

### Task 3 — setup-prod.ts writes JARVIS_NOTES_ROOTS

**Files:** modify `scripts/setup-prod.ts`

**Changes:**

- After the existing fixed-key writes, add an idempotent section: if `process.env.JARVIS_NOTES_VAULT_HOST_PATH` is non-empty, append `JARVIS_NOTES_ROOTS=/data/external-notes\n` to the env file. (The mount target is fixed; the app sees the stable path regardless of host path.)
- Respect the existing idempotency guard (the script refuses to overwrite — this only runs on first write, which is correct: re-pointing the host path is an operator env-file edit, not a setup rerun).

**Verification:**

- [ ] Unit: `setup-prod-trusted-origins.test.ts` pattern — add a sibling test asserting `JARVIS_NOTES_ROOTS` appears iff the host-path env is set.
- [ ] `pnpm typecheck` green.

---

### Task 4 — 15-min schedule module

**Files:** create `packages/notes/src/schedule.ts`; modify `packages/notes/src/index.ts`

**Reference (mirror this, not tasks-recurrence):** `packages/briefings/src/schedule.ts:50-101` — the correct precedent because it does **both** `schedule` _and_ `unschedule`, matching the notes set/clear lifecycle. `tasks-recurrence` only ever schedules (always-on, never clears) so it has no unschedule precedent to copy.

**Shape:**

```ts
import type { PgBoss } from "pg-boss";
import { assertMetadataOnlyPayload } from "@jarv1s/jobs";
import { NOTES_SYNC_QUEUE } from "./manifest.js";

export const NOTES_SYNC_CRON = "*/15 * * * *";
const NOTES_SYNC_TZ = "UTC";

// Scheduled payload is {actorUserId} only — the handler resolves sourcePath from
// the notes-source-path preference at run time (see Task 6 handler change).
// This keeps the preference the single source of truth and avoids snapshotting
// the path into the schedule row (a host re-point via PUT reconciles automatically).
export async function reconcileNotesSchedule(
  boss: PgBoss,
  actorUserId: string,
  hasPath: boolean
): Promise<void> {
  if (hasPath) {
    const data = { actorUserId };
    assertMetadataOnlyPayload(data);
    await boss.schedule(NOTES_SYNC_QUEUE, NOTES_SYNC_CRON, data, {
      tz: NOTES_SYNC_TZ,
      key: actorUserId
    });
  } else {
    // Two-arg form, per briefings/src/schedule.ts:75 — unschedule(queueName, key).
    // NOT a concatenated "name__key" string.
    await boss.unschedule(NOTES_SYNC_QUEUE, actorUserId);
  }
}
```

**Why `{actorUserId}` only is safe here (and was a blocker before):** the original draft scheduled `{actorUserId}` but left `handleNotesSyncJob` requiring `sourcePath` (`jobs.ts:63` destructures it, `:72` `realpath`s it). Scheduled job → `realpath(undefined)` → throws → silent failure (`retryLimit: 0`, `deleteAfterSeconds: 300`). The handler change in Task 6 (resolve `sourcePath` from the preference when absent) is what makes the lean payload viable. **Task 4 and Task 6 must land together.**

**Verification:**

- [ ] `pnpm typecheck` green.
- [ ] Integration: `PUT` with a path → `SELECT * FROM pgboss.schedule WHERE name='notes.sync'` returns one row with `key=<actorUserId>`, `cron='*/15 * * * *'`, `data='{"actorUserId":"<uuid>"}'`.
- [ ] Integration: `PUT` with null → row gone.

---

### Task 5 — Reconcile schedule on settings PUT

**Files:** modify `packages/settings/src/notes-source-routes.ts`; add `boss` to `NotesSourceRoutesDependencies`.

**Changes:**

- Inject `PgBoss` into the route dependencies (composition root wires it — find where `registerNotesSourceRoutes` is called and add the boss arg).
- After a successful `PUT` (both set-path and clear-path branches), call `reconcileNotesSchedule(boss, actorUserId, path !== null)`.
- Errors from reconcile must not poison the 200 — log and continue (schedule self-heals on next PUT; same swallow-and-continue pattern as tasks recurrence).

**Verification:**

- [ ] Integration test: `PUT` with a valid path → one schedule row; `PUT` with null → row gone.
- [ ] `pnpm test:integration` (notes suite) green.

---

### Task 6 — Handler resolves `sourcePath` when absent + last-sync stats on both paths

**Files:** modify `packages/notes/src/jobs.ts`, `packages/module-registry/src/index.ts`, `packages/settings/src/notes-source-routes.ts`, `packages/shared/src/notes-api.ts`

**Handler change (unblocks the heartbeat in Task 4):**

- `NotesSyncJobPayload.sourcePath` becomes `readonly sourcePath?: string`.
- In `handleNotesSyncJob`, if `sourcePath` is undefined, resolve it from the `notes-source-path` preference via the injected `PreferencesRepository` (`@jarv1s/structured-state`). This makes the preference the single source of truth: manual POST passes `sourcePath` explicitly (current behavior, unchanged); the scheduled fire omits it and the handler looks it up. A re-point via `PUT` is picked up on the next 15-min tick with no schedule-row rewrite.
- `RegisterNotesJobWorkersOptions` gains `preferencesRepository: PreferencesRepository` from `@jarv1s/structured-state` (already a notes dep — `notes-sync-routes.ts:8` imports from `@jarv1s/structured-state`). **Not** settings' internal `ProfilePreferencesPort` — that would cross module isolation.

**Stats persistence (both paths):**

- Wrap the existing ingest loop so the `notes-last-sync` preference is written on **both** success and failure. With `retryLimit: 0` + `deleteAfterSeconds: 300` (`jobs.ts:37-39`), a heartbeat failure self-deletes in 5 min with no trace — without an error write, the settings card cannot distinguish "never synced" from "failing every 15 min."
- Success payload: `{ at, ingested, skipped, errors }`. Failure payload: `{ at, ingested: 0, skipped: 0, errors: 0, lastError: "<message>" }`.
- New `GET /api/me/notes-last-sync` route reads the preference, returns parsed JSON or `{ at: null }`.
- Add `GetNotesLastSyncResponse` + schema to `packages/shared/src/notes-api.ts`; register route in settings manifest.

**Dedupe sanity check (manual fire + cron together):** queue is `policy: "exclusive"` (`jobs.ts:36`) and the POST route uses `singletonKey: notes-sync:<actorUserId>` (`notes-sync-routes.ts:46`). Confirm the cron-enqueued job (no `singletonKey` on `boss.schedule`) interacts sanely: if an exclusive-policy queue dedupes by payload+key, a manual + cron collision should resolve to one run, not a 409. Verify the exact exclusive-policy semantics against pg-boss v12 before relying on it; if cron jobs need the same `singletonKey`, the schedule's `data` can't carry it (singleton key is set at `send`, not `schedule`) — in which case document the worst case (one job errors, self-deletes, next tick succeeds) as acceptable for v1.

**Verification:**

- [ ] Integration: run a sync job via the worker with no `sourcePath` in payload + a set preference → resolves path and ingests.
- [ ] Integration: run a sync job that throws → `GET /api/me/notes-last-sync` returns `{ at, lastError }`.
- [ ] `pnpm test:integration` green.

---

### Task 7 — Worker-side schedule ownership

**Files:** modify `apps/worker/src/worker.ts` (or wherever notes workers register)

**Changes:**

- Confirm `WORKER_BOSS_OPTIONS = { schedule: true }` (line 31) already covers notes — the worker's boss evaluates `pgboss.schedule` rows. No new code expected; verify the notes schedule registered in Task 5 is evaluated by the worker process, not the API process (API runs `schedule:false`).
- If notes workers aren't registered on the worker boss yet, wire `registerNotesJobWorkers` into the worker's boot (it may already be there via module-registry — verify).

**Verification:**

- [ ] Unit: `worker-schedule-mode.test.ts` pattern — assert `pgboss.schedule_mode` log emits `schedule: true`.
- [ ] Manual: schedule row present → worker emits a `notes.sync` job every 15 min.

---

### Task 8 — Wire the settings UI card

**Files:** modify `apps/web/src/settings/settings-personal-data-panes.tsx` (lines 313–489)

**Changes:**

- Remove `DEFAULT_VAULT` sample data + `NotWired` stub.
- `useQuery(queryKeys.notes.source, getNotesSource)` for linked-path state.
- `useMutation` → `putNotesSource({ path })` on folder choose; `putNotesSource({ path: null })` on unlink.
- "Sync now" button → `postNotesSync()` → toast with jobId; invalidate last-sync query.
- `useQuery(queryKeys.notes.lastSync, getNotesLastSync)` for stats display.
- Keep the existing folder chooser UX (`VaultChooser`); validate against `SERVER_FS.roots` client-side, server validates authoritatively.
- Behaviors toggles (`VAULT_BEHAVIORS`): leave as-is for v1 if they're not backed by anything real — file a follow-up. Do NOT fake-persist them.

**Verification:**

- [ ] `pnpm dev:web` + `pnpm dev:api`: link folder → state persists on reload; Sync now → 202 → last-sync updates.
- [ ] `pnpm test:e2e` green (add a notes-settings spec if the e2e harness covers settings).
- [ ] `pnpm build:web` green.
- [ ] `pnpm check:file-size` — confirm `settings-personal-data-panes.tsx` stays under 1000 lines (currently ~788; this adds ~60 net).

---

### Task 9 — Full gate + memory save

- [ ] `pnpm verify:foundation` green.
- [ ] `pnpm audit:release-hardening` green.
- [ ] `pnpm audit:preflight` — confirm still grounded at HEAD (or note the new SHA if commits landed).
- [ ] Save durable memory: "notes connector container-reaches-host layer — bind mount `/data/external-notes`, install.sh derives `JARVIS_NOTES_ROOTS`. Spec-vs-shipped divergence resolved by adopting shipped `JARVIS_NOTES_ROOTS` design + adding the missing mount."
- [ ] Update the 2026-06-23 spec's status line + add a "Reconciled by 2026-06-23-notes-source-host-folder plan" pointer.

---

## Open questions to resolve before/during build

1. ~~**`boss.unschedule` key shape**~~ (Resolved: pg-boss v12 signature is `unschedule(name, key)`; Task 4 has been updated).
2. **Schedule TZ** — UTC for v1 (single-operator). If Ben's box prefers America/Los_Angeles or similar, set in `NOTES_SYNC_TZ`. Trivial to change later.
3. **Behaviors toggles** — the existing `VAULT_BEHAVIORS` switches in the UI have no backend. Confirm with Ben: hide them in v1, or leave visible-but-inert with a tooltip? Lean: hide, file follow-up.
4. **Operator UX in install.sh** — prompt for `JARVIS_NOTES_VAULT_HOST_PATH` interactively (y/n → path), or env-var-only (silent if unset)? Lean: env-var-only for v1 (matches `JARVIS_HOST_CLIS` pattern); add a prompt in a later onboarding-polish slice.

---

## Verification (end-state, matches spec §Verification)

- [ ] Bind-mounted vault on the box: Sync-now ingests `.md` files; recall surfaces them in chat.
- [ ] Re-run is idempotent (no duplicate index rows); deleting a note removes only its index row, never a file.
- [ ] 15-min heartbeat enqueues + runs the identical job (observable as recurring `notes.sync` jobs in pg-boss).
- [ ] Vault files are byte-identical before/after ingest (read-only proof — `sha256sum` before/after).
- [ ] `pnpm verify:foundation` + `pnpm audit:release-hardening` green.
