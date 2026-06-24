# Build Handoff — embed-provider-cli-runner (#453)

**Spec (approved):** GitHub issue #453
**GitHub issue:** #453
**Risk tier:** `routine`
**Worktree:** ~/Jarv1s/.claude/worktrees/embed-provider-cli-runner
**Branch:** embed-provider-cli-runner (off origin/main @ 202c638b)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr pane run <pane> "<msg>"` after confirming `herdr pane list` shows EXACTLY ONE pane with this label)
**Coordinator session id:** `ses_111f40556ffeVraVZuie2X8ScJ`
**Run manifest:** docs/coordination/2026-06-24-chat-stability-batch.md

## ⚠️ CI STATUS (temporary — read first)

GitHub Actions is **disabled — billing paused**. `main` shows red on every commit but this is **NOT a code failure**. **Local gate is the source of truth.**

- **Do NOT run `gh pr checks`** — always red from billing.
- Local gate: `pnpm format:check && pnpm lint && pnpm typecheck` before every push. Record exit codes in your report.

## Your task (#453 — verbatim from issue)

The `cli-runner` compose service (`infra/docker-compose.prod.yml`, service block starting ~line 266) does NOT pass `JARVIS_EMBED_PROVIDER` (nor `JARVIS_EMBED_MODEL`). In prod, inside `jarv1s-cli-runner-prod`, the var is unset. It "works" only because `getEmbeddingProviderConfig()` (`packages/memory/src/embedding-provider-config.ts:30`) falls through to `local`. The chat engine's `notes.search` runs in cli-runner, so the query-side embedding provider silently diverges from the rest of the stack — produces meaningless search rankings with no diagnostic.

**Fix:** Pass `JARVIS_EMBED_PROVIDER` (and `JARVIS_EMBED_MODEL`) into the `cli-runner` service's `environment:` block in `infra/docker-compose.prod.yml`, using `${JARVIS_EMBED_PROVIDER:-local}` interpolation so it honors the operator's env / `env.production.local` the same way api/worker already do.

**Reference — how api/worker do it:** Look at the `api:` and `worker:` service blocks earlier in the same file. They already interpolate these vars. Mirror that exact pattern for `cli-runner`.

**Files:**
- Modify: `infra/docker-compose.prod.yml` ONLY (the `cli-runner:` service block, ~L266)

**Step 1 — Read the existing pattern.** Find the `api:` and `worker:` service blocks in `infra/docker-compose.prod.yml`. Note how they pass `JARVIS_EMBED_PROVIDER` and `JARVIS_EMBED_MODEL` (likely as `JARVIS_EMBED_PROVIDER: ${JARVIS_EMBED_PROVIDER:-local}` and a similar line for the model). Replicate this in the `cli-runner:` service's `environment:` map.

**Step 2 — Add to cli-runner's environment block.** Do NOT remove existing keys. Add the two new lines alongside the existing `JARVIS_*` env vars in cli-runner's `environment:` map. Use the same `${VAR:-default}` interpolation style as api/worker.

**Step 3 — Verify (this is your gate, since CI is down):**
```bash
pnpm format:check     # must be green (prettier checks yaml)
pnpm lint             # must be green
pnpm smoke:compose    # if it exists and runs locally; if it requires CI/Docker daemon you don't have, skip and note it
```
Also manually sanity-check the yaml parses:
```bash
python3 -c "import yaml; yaml.safe_load(open('infra/docker-compose.prod.yml'))" && echo "yaml OK"
```
Record exit codes in your report.

## Build workflow (follow this — you cannot auto-load the coordinated-build skill)

1. **Orient.** `cd ~/Jarv1s/.claude/worktrees/embed-provider-cli-runner`. Confirm `git branch --show-current` = `embed-provider-cli-runner`. If `node_modules` missing: `pnpm install` once.

2. **Read CLAUDE.md** Hard Invariants. This lane touches infra config — honor "pgvector image" invariant (don't touch the postgres image line) and "Metadata-only job payloads" (irrelevant here, but stay aware).

3. **Plan is pre-approved** (the Fix section above). Execute directly. Do NOT write a separate plan doc.

4. **Edit** `infra/docker-compose.prod.yml`. Make the cli-runner environment block match api/worker for the two embed vars. Use `git diff` to review before committing.

5. **Commit:**
   ```
   fix(infra): pass JARVIS_EMBED_PROVIDER and JARVIS_EMBED_MODEL to cli-runner

   The cli-runner sidecar (hosts the chat engine + notes.search) was missing
   JARVIS_EMBED_PROVIDER / JARVIS_EMBED_MODEL, silently falling through to
   the `local` default. Query-side embeddings diverged from api/worker when
   an operator set a non-default provider — producing meaningless search
   rankings with no diagnostic. Mirror the api/worker interpolation pattern.

   Closes #453
   ```
   - `git add infra/docker-compose.prod.yml` ONLY.
   - Commit on your branch. Do NOT push yet.

6. **Pre-push trio + rebase:**
   ```bash
   pnpm format:check && pnpm lint && pnpm typecheck
   git fetch origin main && git rebase origin/main
   ```

7. **Push and open PR:**
   ```bash
   git push -u origin embed-provider-cli-runner
   gh pr create --title "fix(infra): pass JARVIS_EMBED_PROVIDER/MODEL to cli-runner" \
     --body "Closes #453. cli-runner was missing the embed-provider env vars, silently using the local default while api/worker honored operator config — query-side embeddings diverged with no diagnostic." \
     --base main
   ```

8. **Report to coordinator** (caveman-terse) via `herdr pane run <pane> "<msg>"` against the unique `Coordinator` label:
   ```
   embed-provider PR #<N> open. gate: format ✓, lint ✓, typecheck ✓, yaml-parse ✓. branch embed-provider-cli-runner. ready for QA.
   ```
   If `herdr pane list` shows 0 or >1 Coordinator pane, halt and wait.

9. **Stop.** Coordinator owns QA/merge/board/close.

## Your compact (non-negotiable)

- Work only in your worktree on `embed-provider-cli-runner`.
- CI down — local gate is truth; record exit codes.
- Plan pre-approved — execute directly, no separate plan doc.
- Escalate blockers to `Coordinator` label via `herdr pane run`.
- Never touch board/milestones/issues/merge.
- Caveman for coordinator messages; conventional for commits/PR/code.
- Pre-push trio before every push.

## Collision notes

- You touch `infra/docker-compose.prod.yml` ONLY (cli-runner service env block).
- No other lane touches infra compose in this wave.
- Do NOT touch the `api:`, `worker:`, `web:`, or `postgres:` service blocks — only `cli-runner:`.
- No migrations, no schema, no auth surface.
