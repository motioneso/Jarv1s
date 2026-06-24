# Build Handoff — data-export-cleanup (#444) — SENSITIVE TIER

**Spec (approved):** GitHub issue #444
**GitHub issue:** #444
**Risk tier:** `sensitive` (touches the data-export path — export/delete. Gets standard QA + explicit invariant check on VaultContext usage, metadata-only payloads, and no secret leakage on the cleanup path.)
**Worktree:** ~/Jarv1s/.claude/worktrees/data-export-cleanup
**Branch:** data-export-cleanup (off origin/main @ 202c638b)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr pane run <pane> "<msg>"`)
**Coordinator session id:** `ses_111f40556ffeVraVZuie2X8ScJ`
**Run manifest:** docs/coordination/2026-06-24-chat-stability-batch.md

## ⚠️ CI STATUS (temporary — read first)

GitHub Actions is **disabled — billing paused**. **Local gate is the source of truth.** Do NOT run `gh pr checks`. Run `pnpm format:check && pnpm lint && pnpm typecheck` + the relevant vitest before push; record exit codes.

## Your task (#444 — three defects from the GLM review of #443)

The async data-export job (`packages/settings/src/data-export-jobs.ts`, `data-export-async-routes.ts`, `data-export-repository.ts`) has three correctness defects. Fix all three in this PR.

**Files (all under `packages/settings/src/`):**
- `data-export-jobs.ts` — Finding 2 + Finding 3
- `data-export-repository.ts` — Finding 2 (completeJob signature change) + Finding 1 (expiry sweep)
- Possibly `data-export-async-routes.ts` — if the download 410 path needs the cleanup hook for Finding 1

### Finding 1 — Orphaned export files accumulate on disk (data-retention leak)

Expired archive files are never deleted. Sensitive user exports sit on disk past their stated 24h lifetime indefinitely.

**Fix:** Add a vault-file cleanup sweep on expiry — delete the archive file (`exports/<jobId>.json` in the vault) when (a) the job record expires (24h TTL), and (b) when the download endpoint returns 410 Gone.

- Archives are written via `writeVaultFile(vaultCtx, "exports/${jobId}.json", ...)` at `data-export-jobs.ts:116`. Delete them via the existing vault remove op — see `packages/vault/src/vault-ops.ts:76` (`rm`) and `:152` (recursive remove). Use `VaultContext` ONLY, never raw `fs`.
- The expiry sweep: add to `data-export-repository.ts` (or wherever expired jobs are reaped) a step that calls vault remove on the archive path when marking a job expired.
- The 410 path: in `data-export-async-routes.ts`, the Gone response handler — confirm the archive is removed when the 410 is served (or, if the sweep already removed it, the 410 just confirms expiry).

**Invariant check (sensitive tier):** the cleanup path must use `VaultContext` only, must not leak the archive path in any API response/log, and must not delete files outside `exports/`.

### Finding 2 — `completed_at` set to `expiresAt` instead of `now()`

At `data-export-jobs.ts:119-120`:
```ts
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
await repository.completeJob(scopedDb, jobId, expiresAt);
```
`completeJob` (`data-export-repository.ts:47`) currently sets `completed_at` to the passed-in date — which is `expiresAt` (24h in the future), not the actual completion time. Wrong.

**Fix:** `completeJob` needs BOTH timestamps: `completed_at = now()` AND `expires_at = <the passed expiresAt>`. Change the signature to accept both (or compute `now()` inside), and set `completed_at = now()` distinctly from `expires_at`. Update the caller at `data-export-jobs.ts:120` accordingly.

### Finding 3 — Initial status update has stuck-pending failure mode

At `data-export-jobs.ts:59`:
```ts
await repository.updateJobStatus(scopedDb, jobId, "building");
```
If this throws, the job stays stuck in `pending` rather than being marked failed.

**Fix:** Wrap this initial status update so a throw marks the job `failed` (with the error message) instead of silently leaving it pending. Mirror whatever error-handling pattern the rest of the job uses for downstream failures.

## Step 4 — Verify (your gate)

```bash
pnpm exec vitest run tests/integration/data-export*.test.ts tests/integration/settings*.test.ts 2>/dev/null || pnpm exec vitest run tests/integration/settings.test.ts
pnpm typecheck
pnpm format:check
pnpm lint
```
If you can't find the exact test file, `grep -rln "data-export\|exportJob\|completeJob" tests/` to locate it. If no test covers the export path, ADD a test for the `completed_at = now()` fix (Finding 2) and the stuck-pending hardening (Finding 3) — these are the behavior changes. The sweep (Finding 1) is harder to unit-test; at minimum assert the archive file is gone after expiry.

Record all exit codes in your report.

## Build workflow

1. **Orient.** `cd ~/Jarv1s/.claude/worktrees/data-export-cleanup`. Confirm branch = `data-export-cleanup`. `pnpm install` if node_modules missing. `pnpm db:up` is required for integration tests — check if Postgres is already running (`docker ps | grep jarv` or similar); if not, start it.

2. **Read CLAUDE.md Hard Invariants — critical for this lane:**
   - **DataContextDb only** — repos accept `DataContextDb`, never root Kysely. `VaultContext` for all vault I/O. Finding 1 cleanup MUST go through `VaultContext`.
   - **Secrets never escape** — exports may contain user data; cleanup must not log/archive contents.
   - **Metadata-only job payloads** — if you touch pg-boss payloads, IDs only, no content.

3. **Plan is pre-approved** (the three Findings above). Execute directly.

4. **Build TDD where possible:** write/extend the test for Finding 2 first (assert `completed_at` ≠ `expires_at`), watch it fail, fix `completeJob`, watch it pass. Then Finding 3 (assert job marked failed on throw). Then Finding 1 (sweep + assert archive removed).

5. **Commit per finding** (3 commits) or as one commit — your call, but keep `git add` scoped to the files you changed.

6. **Commit message:**
   ```
   fix(data-export): vault cleanup sweep, completed_at=now(), stuck-pending hardening

   Three defects from the GLM review of #443:
   - Finding 1: delete archive file on expiry/410 (was leaking past 24h TTL)
   - Finding 2: completed_at now records actual completion, not expiresAt
   - Finding 3: initial 'building' status update wrapped — throw marks job failed

   VaultContext used for all cleanup. No archive contents logged.

   Closes #444
   ```

7. **Pre-push trio + rebase.** Integration tests require Postgres — if `db:up` is needed, run it before tests.

8. **Push and open PR:**
   ```bash
   git push -u origin data-export-cleanup
   gh pr create --title "fix(data-export): cleanup sweep + completed_at + stuck-pending hardening" \
     --body "Closes #444. Three defects from #443 review: vault cleanup on expiry (was leaking past 24h), completed_at=now() not expiresAt, and wrapped initial status update so a throw marks the job failed instead of leaving it stuck pending. Sensitive tier — VaultContext-only cleanup, no contents logged." \
     --base main
   ```

9. **Report to coordinator** (caveman-terse, but include the invariant attestation since this is sensitive tier):
   ```
   data-export-cleanup PR #<N> open. SENSITIVE tier. gate: vitest export ✓, typecheck ✓, format ✓, lint ✓. invariants: VaultContext-only cleanup ✓, no contents logged ✓, metadata-only payloads preserved ✓. branch data-export-cleanup. ready for QA.
   ```

10. **Stop.** Coordinator owns QA/merge/board/close.

## Your compact (non-negotiable)

- Work only in your worktree on `data-export-cleanup`.
- **Sensitive tier** — build to the invariant bar: VaultContext-only, no secret/content leakage, metadata-only payloads.
- CI down — local gate truth; record exit codes.
- Plan pre-approved — execute directly.
- Escalate blockers to `Coordinator` label via `herdr pane run`. If you hit a genuine design question (e.g. "should the sweep be a cron or inline?"), ESCALATE — don't decide forks yourself.
- Never touch board/milestones/issues/merge.
- Caveman for coordinator messages; conventional for commits/PR/code.
- Pre-push trio before every push.

## Collision notes

- You touch `packages/settings/src/data-export-*.ts` (+ possibly `packages/vault/src/vault-ops.ts` if a new remove helper is needed — prefer reusing the existing `rm` at L76).
- No other lane touches packages/settings or packages/vault in this wave.
- `web-search-key-observability` lane touches `packages/settings/src/web-search-key-routes.ts` and `packages/web-research/` — different files, no collision.
- No migrations, no schema changes. Do NOT add a migration for this — the sweep is logic-only.
