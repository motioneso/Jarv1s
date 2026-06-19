# Build Handoff — AI Provider & Model Visibility (#299 design half)

**You are `Build-AIPMV`, a build agent under the Jarv1s dev Coordinator (Claude session `43dde6d9`, Herdr label `Coordinator`).**
You run on **agy / Gemini** with `--dangerously-skip-permissions`. You do NOT have the superpowers skills; this doc is fully self-contained — follow it exactly.

## Mission

Implement the approved spec **`/home/ben/Jarv1s/docs/superpowers/specs/2026-06-18-ai-provider-model-visibility.md`** (READ IT IN FULL FIRST). It makes AI provider/model metadata **audience-scoped**: admin-only full inventory, a member-safe narrow summary, onboarding booleans, and runtime capability-only access. This is a **security-tier** lane (it narrows non-admin exposure of provider/model metadata).

## Locked decisions (do NOT re-litigate)

- **Member labels:** for admin-owned/shared models, members see only the model display label + capability/tier + stable model id, and a generic **"Instance default"** style provider label. **Do NOT expose provider/vendor display names to members.** (Ben, 2026-06-19.)
- No data migration unless the admin-owned/shared-provider distinction is genuinely not derivable from existing rows (spec §Implementation Shape). Prefer additive endpoints/DTOs.
- `tasks.delete`/recurrence files are off-limits (owned by #297) — do not touch them.

## Workspace

- **Worktree (your cwd):** `/home/ben/Jarv1s/.claude/worktrees/ai-provider-model-visibility`
- **Branch:** `ai-provider-model-visibility` (already created off `origin/main` `70529ba`). Stay on it.
- **STEP 1:** `pnpm install` in the worktree before anything else.

## How to work (TDD, task-by-task)

1. Read the spec in full. Skim the current AI surface: `packages/ai/src/routes.ts`, `packages/ai/src/manifest.ts`, the AI repository, the web callers under `apps/web/src` that call `/api/ai/providers` / `/api/ai/models`, and the onboarding completion logic.
2. Write a SHORT implementation plan to `/home/ben/Jarv1s/.claude/worktrees/ai-provider-model-visibility/AIPMV-PLAN.md` (file list + endpoint/DTO shapes + which web callers change). Then **proceed to build** — do not block waiting for approval; the Coordinator reviews asynchronously and will message you if a redirect is needed.
3. For each change: write the failing test first, make it pass, keep the gate green. Honor the spec's **Verification** section as your acceptance contract (every bullet there must have a corresponding passing test):
   - non-admin cannot call admin provider/model inventory routes;
   - member onboarding status returns booleans (no provider inventory);
   - member chat-override choices include only active, allowed, chat-capable models;
   - revoked/disabled providers/models absent from member-visible choices;
   - contract test: admin DTO contains no credential payload fields.

## Hard invariants (blockers if violated)

- **Secrets never escape:** no credential payloads, API keys, tokens, decrypted CLI auth, raw provider test errors, or env values in any response, log, pg-boss payload, export, or prompt.
- **Module isolation:** onboarding/settings call AI-owned public APIs — never read AI tables directly. Repositories take a `DataContextDb` handle, never a root Kysely instance.
- **No admin RLS bypass; private by default.** Non-admin provider inventory must NOT grow as a side effect.
- **Never edit applied migrations.** If a migration is truly needed, add a NEW forward file in the owning module's `sql/` dir (NOT `infra/postgres/migrations/`). Avoid migrations if possible.

## DB for tests (isolated — avoid colliding with other sessions)

```bash
pnpm db:up   # shared Postgres (already running on localhost:55433)
PGPASSWORD=postgres psql -h localhost -p 55433 -U postgres -c "CREATE DATABASE jarvis_build_aipmv;" 2>/dev/null || true
export JARVIS_PGDATABASE=jarvis_build_aipmv
JARVIS_PGDATABASE=jarvis_build_aipmv pnpm db:migrate
```
Run all DB-touching tests with `JARVIS_PGDATABASE=jarvis_build_aipmv` exported.

## Discipline (Coordinator will reject violations)

- **Stage ONLY your own changed files** with explicit `git add <path>` — NEVER `git add -A` / `git add .` (a shared tree has other sessions' uncommitted work).
- **Do NOT run repo-wide `pnpm format`.** Format only files you changed (`pnpm prettier --write <paths>`).
- **Do NOT touch `docs/coordination/`** (coordinator-only) or tasks recurrence files (#297).
- Commit messages end with: `Co-Authored-By: agy (Gemini) <noreply@google.com>`.

## Gate + wrap-up (when implementation is done)

1. Full gate with REAL exit codes (write to file, never pipe to tail/grep):
```bash
JARVIS_PGDATABASE=jarvis_build_aipmv pnpm verify:foundation > /tmp/aipmv-vf.log 2>&1; echo "VF_EXIT=$?"
pnpm audit:release-hardening > /tmp/aipmv-audit.log 2>&1; echo "AUDIT_EXIT=$?"
```
   If `verify:foundation` fails with `tuple concurrently updated`, that's cluster-grant contention — just retry it once.
2. Pre-push: `pnpm prettier --check <your changed files>`, `pnpm lint`, `pnpm typecheck` — all green.
3. Push: `git push -u origin ai-provider-model-visibility`
4. Open the PR:
```bash
gh pr create --title "feat(ai): audience-scoped provider/model visibility (#299)" \
  --body "Implements docs/superpowers/specs/2026-06-18-ai-provider-model-visibility.md (#299 design half). Admin-only inventory + member-safe summary + onboarding booleans + runtime capability-only. Member labels use generic 'Instance default' (no vendor names). Builder: agy/Gemini under Coordinator. VF_EXIT=<>, AUDIT_EXIT=<>."
```
5. **Report to the Coordinator** by writing your final status to **`/tmp/aipmv-status.txt`** (the Coordinator polls this file):
```
BUILD_DONE
PR_URL=<url>
HEAD=<git rev-parse HEAD>
VF_EXIT=<n>
AUDIT_EXIT=<n>
NOTES=<anything the reviewer should know, e.g. deviations, the AIPMV-PLAN.md path>
```

## If you get stuck

Write `BLOCKED` + your question to `/tmp/aipmv-status.txt` and stop. Do NOT guess on security-sensitive forks. The Coordinator polls that file and will respond.

Begin now: `pnpm install`, then read the spec.
