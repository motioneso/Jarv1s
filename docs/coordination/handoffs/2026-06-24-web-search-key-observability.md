# Build Handoff — web-search-key-observability (#448)

**Spec (approved):** GitHub issue #448
**GitHub issue:** #448
**Risk tier:** `routine`
**Worktree:** ~/Jarv1s/.claude/worktrees/web-search-key-observability
**Branch:** web-search-key-observability (off origin/main @ 202c638b)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr pane run <pane> "<msg>"`)
**Coordinator session id:** `ses_111f40556ffeVraVZuie2X8ScJ`
**Run manifest:** docs/coordination/2026-06-24-chat-stability-batch.md

## ⚠️ CI STATUS (temporary — read first)

GitHub Actions is **disabled — billing paused**. **Local gate is the source of truth.** Do NOT run `gh pr checks`. Run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest before push; record exit codes.

## Your task (#448 — two LOW-severity follow-ups from GLM review of #447)

Bundle both into one PR.

### L-2 — No observability when a stored Brave key fails to decrypt

`resolveWebSearchProvider` (`packages/web-research/src/providers.ts`) catches a resolver throw (bad keyring / corrupted envelope) and silently falls back to `JARVIS_BRAVE_SEARCH_API_KEY` env key. Correct behavior (don't break chat), but an operator gets **zero signal** that a configured instance key is unusable.

**Fix:** Thread a `warn`-level logger into the resolver and emit a `web_search.key_decrypt_failed` event (metadata only — NEVER the key or ciphertext). The web-research module is deliberately db/dependency-free and `ToolContext` carries no logger, so the seam must be injected from the composition root (module-registry) into the resolver, OR log inside the injected `readBraveSearchApiKey` resolver where the cipher already lives. Read the code first to pick the cleaner injection point.

- **Hard rule:** the log payload must contain ONLY metadata (event name, maybe provider name). NEVER the key, ciphertext, envelope, or any derived value. This is a CLAUDE.md Hard Invariant ("Secrets never escape").

### L-3 — `assertAdmin` duplicated

`packages/settings/src/web-search-key-routes.ts` (~lines 38–50) re-implements the admin gate already in `routes.ts` as `assertAdminUser` (~lines 247/265/285/321 — confirm exact definition by grepping). Behavior matches (401 missing user / 403 non-admin), but the duplication is a maintenance hazard.

**Fix:** Export the existing `assertAdminUser` helper from `routes.ts` (or wherever it's canonically defined) and reuse it in `web-search-key-routes.ts`. Delete the duplicate `assertAdmin` function. If the signatures differ slightly, adapt the caller — do NOT change the canonical helper's signature without checking all call sites.

**Files:**
- `packages/web-research/src/providers.ts` (L-2 — logger injection + warn emit)
- `packages/web-research/src/index.ts` or `manifest.ts` (L-2 — wire the logger at composition root)
- `packages/settings/src/routes.ts` (L-3 — export `assertAdminUser`)
- `packages/settings/src/web-search-key-routes.ts` (L-3 — import + use canonical helper, delete local `assertAdmin`)
- Possibly the composition root / module-registry that wires web-research (read the code to find it)

## Step 3 — Verify (your gate)

```bash
# Find and run the relevant tests:
grep -rln "web-search\|webSearch\|braveSearch\|resolveWebSearchProvider\|assertAdmin" tests/ packages/*/test/ 2>/dev/null
pnpm exec vitest run <relevant test files>
pnpm typecheck
pnpm format:check
pnpm lint
```
If no test covers the decrypt-failure path, ADD a minimal test that asserts the warn is emitted (not the key) when the cipher throws — use a mock logger that captures calls. Record exit codes.

## Build workflow

1. **Orient.** `cd ~/Jarv1s/.claude/worktrees/web-search-key-observability`. Confirm branch = `web-search-key-observability`. `pnpm install` if node_modules missing.

2. **Read CLAUDE.md Hard Invariants:**
   - **Secrets never escape** — the new log MUST be metadata-only. No key, no ciphertext, no envelope.
   - **Module isolation** — web-research is deliberately db/dependency-free. The logger injection must respect that boundary (inject a tiny logger interface, not a db handle).

3. **Plan is pre-approved** (L-2 + L-3 above). Execute directly.

4. **L-3 first** (smaller, mechanical): export `assertAdminUser`, swap the duplicate in web-search-key-routes, run tests. Commit.

5. **L-2:** read `providers.ts` and the composition root. Pick the cleaner injection point (prefer logging inside the injected `readBraveSearchApiKey` resolver — keeps web-research db-free). Add the warn emit. Add the test. Commit.

6. **Commit message:**
   ```
   fix(web-search): log undecryptable Brave key (L-2) + dedup assertAdmin (L-3)

   L-2: resolveWebSearchProvider silently fell back to env key when the stored
   instance key failed decrypt — operators got zero signal. Thread a warn-level
   logger and emit web_search.key_decrypt_failed (metadata only; never the
   key/ciphertext) so a misconfigured key is diagnosable.

   L-3: web-search-key-routes re-implemented assertAdminUser from routes.ts.
   Export the canonical helper and reuse it; delete the duplicate.

   Closes #448
   ```

7. **Pre-push trio + rebase.**

8. **Push and open PR:**
   ```bash
   git push -u origin web-search-key-observability
   gh pr create --title "fix(web-search): log undecryptable key + dedup assertAdmin" \
     --body "Closes #448. L-2: warn on Brave key decrypt failure (metadata-only, never the key). L-3: reuse canonical assertAdminUser instead of the duplicate in web-search-key-routes." \
     --base main
   ```

9. **Report to coordinator** (caveman-terse):
   ```
   web-search-key PR #<N> open. gate: vitest ✓, typecheck ✓, format ✓, lint ✓. L-2 logger metadata-only ✓ (no key/ciphertext in payload). branch web-search-key-observability. ready for QA.
   ```

10. **Stop.** Coordinator owns QA/merge/board/close.

## Your compact (non-negotiable)

- Work only in your worktree on `web-search-key-observability`.
- CI down — local gate truth; record exit codes.
- Plan pre-approved — execute directly.
- **L-2 log payload is metadata-only.** If you find yourself about to log anything resembling the key/ciphertext/envelope — STOP, that's a Hard Invariant violation.
- Escalate blockers to `Coordinator` label via `herdr pane run`.
- Never touch board/milestones/issues/merge.
- Caveman for coordinator messages; conventional for commits/PR/code.
- Pre-push trio before every push.

## Collision notes

- You touch `packages/web-research/src/providers.ts` (+ index/manifest for wiring) and `packages/settings/src/routes.ts` + `web-search-key-routes.ts`.
- `data-export-cleanup` lane touches `packages/settings/src/data-export-*.ts` — DIFFERENT files in the same package, no overlap.
- No other lane touches web-research.
- No migrations, no schema, no auth surface (the assertAdmin dedup is a refactor of an existing gate, not a new auth path).
