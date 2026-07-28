# Job Search — live state (updated 2026-07-28)

Pointer doc. Nothing here is a recap; each line tells you where to look.

## Where it stands

Epic #1280. The module is installed, running, and **proven live end to end** on the dev instance:
sign in → Job Search → board of scored roles → click a role → inspector opens beside it →
Discuss → Jarvis returns a substantive fit/want verdict. A human can walk this today.

Branch `feat/job-search`. Landed commits:

- `14abc59b` — board and match inspector usable end to end (layout, host `jds-table`,
  selected-row marking, scroll-into-view)
- `a1548f23` — search runs actually produce scored matches
- crawler relevance: one free-text query per title, never all titles joined
  (see [[job-board-query-one-title-per-request]] for why)
- Fit/Want render as a number plus a proportional bar (host `jds-score`)

## Try it

`http://192.168.50.36:5197` — sign in as `ben@ben.com`. Credentials in
[[dev-instance-lan-spinup-trusted-origins]] memory.

## Restart loop after any module change

Scratchpad `$SP` =
`/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-job-search/3dfd5b33-2e51-4c28-ac09-03d48971c180/scratchpad`
(export it inline in every Bash call — it does not persist).

1. `pnpm build:external:job-search` (repo root)
2. `bash $SP/restart-api.sh`
3. `until grep -q "Server listening" "$SP/devapi.log"; do :; done`
4. `bash $SP/reenable.sh` — **must print `patch=200`**; `patch=000` means the API wasn't up yet
5. `bash $SP/restart-worker.sh` if worker code changed

Logs: `$SP/devapi.log`, `$SP/devworker.log`. `psql` is not on PATH — use
`docker exec jarv1s-postgres psql -U postgres -d jarv1s`. Tables are `app.job_search_*`; the score
columns are `fit` and `want`, not `fit_score`/`want_score`. `test-results/drive18.mjs` (gitignored)
drives the whole flow headlessly and screenshots into `$SP/live18/`.

## Gates run

`pnpm typecheck` green. `pnpm test:unit` green at 488 files / 3812 tests (the unit entry point is
`tsx scripts/test-unit.ts` — there is no `vitest.unit.config.ts`). **`pnpm verify:foundation` has
not been run** — format, lint, and integration are unverified. Needs a fresh exported gate DB, see
[[gate-db-isolation-mandatory]].

## Open

1. **Discuss appends to the profile's thread**, so opening it replays the onboarding Q&A. This is
   deliberate and documented in `screens/discuss.tsx`'s header (one conversation per profile).
   Changing it is a design fork and needs Ben's ruling, not a patch.
2. **Onboarding design pass unfinished** — weak `jds-card--sunken` card/ground separation, the bare
   "Resolved." confirmation, the `SET` eyebrow exposing a raw action name, "Behind the scenes /
   1 step" chrome, the model directing users to "your drawer".
3. **Park Press mockup not reconciled.** Claude Design project `Jarvis — Park Press Design System`,
   `projectId 0501fab4-7c60-457d-9a46-b717d55e16c9`. `get_file` elides anything over ~4KB, so
   `ui_kits/job-search-onboarding/JobsOnboarding.jsx` (23.5KB) and the design handoff README
   (13.5KB) are still unread. The mockup's mono eyebrows are superseded — mono was retired
   2026-07-08.
4. **Host changes need their own review line.** `components-core.css` (`jds-table`, `jds-sr-only`,
   selected-row) and `surface.tsx` / `assistant-surface.css` affect every module surface, not just
   this one.
5. **Coordination debt** — the module was installed and migrations run against the shared dev DB
   without a `herdr-pane-message` heads-up to other worktree sessions.
6. Filed and unassigned: #1333, #1335, #1336, #1337, #1340. `MANUAL-TEST.md` and its published
   artifact predate real behaviour and are stale.

## Standing rules that bite here

Ben's instruction is *"keep looping until a human could go e2e"* — do not file issues for this run,
do not stop to ask. Never `git add -A`; stage explicit paths on the `commit` itself. Never touch
`jarv1s-prod-*` or 10.252. Full rule set: `CLAUDE.md` plus the rulings ledger in this directory.
