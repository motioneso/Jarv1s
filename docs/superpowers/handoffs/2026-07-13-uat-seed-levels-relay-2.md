# Relay — #1025 UAT seed levels (Task 8 only remains)

Build agent, tier **sensitive**. Coordinator: label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f` — report PR number there. Worktree:
`.claude/worktrees/uat-seed-1025` (branch `uat-seed-1025`). `[ -d node_modules ] || pnpm install`.

## Authoritative build reference

**`docs/superpowers/plans/2026-07-13-uat-seed-levels.md`** (committed, corrected — read it, not
any older doc). Task 8 is at plan line ~1087. Read by section, don't front-load.

## Done (committed) — Tasks 1-7 ALL COMPLETE

- `522a91a6` Task 2, `0173b42a` Task 3, `c6be9420` Task 4, `0a082a33` Task 5 (3/4 chunks),
  `ba6bb516` Task 5 finished (job-search chunk), `e41b6481` Task 6 (level composition + CLI),
  `c5cf0597` Task 7 (provisioner wiring + compose `seed` service). See prior relay
  (`2026-07-13-uat-seed-levels-relay.md`) and git log for full detail — do not re-derive, settled.
- Task 7 note not in the plan's code block but required: the `seed` compose service needed
  `volumes: [jarv1s-vault-data:/data/vaults]` added (mirrors the `jarv1s` service's mount) —
  the notes chunk writes through `VaultContext` at its real default (`getVaultBaseDir()` →
  `/data/vaults`, no env override inside the compose network), so without the mount it would
  fail/silently write into the container's ephemeral layer.
- Task 7 also required fixing `tests/unit/uat-provisioner.test.ts`'s pre-existing
  `bareSeedHook({ projectName: "uat-test" })` call — `SeedHook` gained a required `level` field,
  so that call now passes `level: "bare"` too. `pnpm exec tsc --noEmit -p .` is clean re:
  provisioner/levels/job-search/cli; full `pnpm typecheck` not yet run (do it as part of Task 8's
  `verify:foundation`).

## Next steps — Task 8 only (plan line ~1087)

1. Run `pnpm verify:foundation` — full local gate. Fix anything red. If CI is unavailable, record
   the exact local commands + exit codes used in the PR description per CLAUDE.md.
2. Pre-push trio + rebase onto latest `main` (check `docs/superpowers/plans/2026-07-13-uat-seed-levels.md`
   Task 8's section for the exact trio commands this plan specifies — read that section only).
3. Open PR: base `main`, body includes `Part of #1000`, `Closes #1025`. Call out the `multi-user`
   level's intentional `throw` (deferred to fast-follow issue #1030) in the PR body per the plan's
   Task 6 note — this is a known, permanent scope cut for this PR, not an oversight.
4. Include the user-facing summary CLAUDE.md requires (release-note language) — this is
   dev/ops-only tooling (a UAT seed CLI + compose service), so the honest summary is "not
   user-visible; internal QA tooling for #1000's UAT harness."
5. Report the PR number to Coordinator (label `Coordinator`, session
   `58a78927-385c-4b1d-8fa0-94db20255d6f`). **Do not merge.**

## Verified environment notes (don't re-derive)

- Dev Postgres is `jarv1s-postgres` container, host port 55433 — matches `packages/db/src/urls.ts`
  defaults with no env overrides needed.
- Run single test files with `npx vitest run <path>` (not `pnpm --filter @jarv1s/root exec
  vitest` — that filter matches no project in this worktree).
- `/data/vaults` (the real `getVaultBaseDir()` default) does not exist on this dev host outside
  Docker — any local test touching `VaultContext` must override `JARVIS_VAULT_ROOT` to a
  `mkdtemp` dir (see `notes.test.ts` / `levels.test.ts` for the pattern). Inside the compose
  network (prod-shaped `seed` service) the real default resolves via the new volume mount instead.
- `docker compose -f infra/docker-compose.prod.yml config -q` needs `POSTGRES_PASSWORD`,
  `JARVIS_IMAGE_TAG`, `JARVIS_UAT_SEED_CONFIRM`, and more app secrets to fully interpolate (dev
  host has none set) — partial validation up through the `seed` block parsing cleanly is sufficient
  evidence the YAML is well-formed; full interpolation isn't a realistic local check.

## Guardrails (unchanged)

No `git add -A`. Don't touch `docs/coordination/`. No repo-wide `pnpm format` — only
`prettier --write` files you authored. No new migration. Full CLAUDE.md Hard Invariants apply.
