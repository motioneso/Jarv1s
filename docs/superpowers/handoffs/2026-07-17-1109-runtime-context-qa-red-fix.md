# #1109 runtime-context — QA RED fix (post-PR #1126)

Branch/worktree: `build/1109-runtime-context` @
`/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`. PR: #1126 (open, was green,
now has a blocking QA finding).

## Verified real (read the files myself, not just trusting the QA report)

`apps/api/package.json`:
```
"dev": "pnpm --dir ../.. build:app-map && tsx watch src/server.ts",
"start": "tsx src/server.ts",
```
`start` (used by dev-compose) skips `build:app-map`; `dev` doesn't.

`infra/docker-compose.yml` `api` service runs `pnpm start:api` → `pnpm --filter @jarv1s/api start`
→ `tsx src/server.ts`, no artifact generation step.

`packages/module-registry/src/index.ts:2089-2090` (added by `bf9e0acf`, pre-existing on this
branch, not new #1109 work): `createAppMapReadService({ artifact: loadAppMap(APP_MAP_ARTIFACT_PATH), ... })`
called unconditionally at server bootstrap.

`packages/settings/src/app-map.ts:27-33` `loadAppMap()` does `readFileSync(path)` — throws
ENOENT if `dist/app-map.json` doesn't exist yet.

**Net: dev-compose `api` boot crash-loops** — `start` never generates the artifact `loadAppMap`
requires. Prod image is fine because `scripts/build-app.ts:79` shells out to `build:app-map`
during the Docker build itself, before `start` ever runs.

QA verdict comment: https://github.com/motioneso/Jarv1s/pull/1126#issuecomment-5003131589

## Fix

Make `apps/api/package.json`'s `start` script generate the app-map artifact first, same as
`dev` does — e.g. `"start": "pnpm --dir ../.. build:app-map && tsx src/server.ts"` (verify the
relative `--dir` path from `apps/api`, matches `dev`'s existing pattern one line above). Confirm
`build:app-map` (`tsx scripts/build-app-map.ts`, root `package.json:39`) is safe/fast to run on
every prod-compose boot too (it already runs there via the Docker build step, so re-running is
likely idempotent — verify, don't assume).

## Next steps

1. TDD not required for a one-line script fix, but do verify: `docker compose -f
   infra/docker-compose.yml up api` (or equivalent smoke) actually boots green post-fix, not just
   `pnpm start:api` locally.
2. Commit (explicit path, not `-A`), push to `build/1109-runtime-context`.
3. Re-run pre-push trio + rebase-check; get CI green (esp. the "Compose deployment smoke" check
   that RED-flagged this).
4. Reply/re-report on the PR QA thread (comment above) once CI is clean — do not merge, do not
   touch board/issue.

## Reminders

- Never edit applied migrations; explicit `git add` paths only.
- This branch shares its base with #1110 (PR #1122, open) — expect both lanes' commits in the
  diff until one merges; not scope creep.
- Coordinator label / QA thread: re-resolve fresh, don't trust a stale pane id.
