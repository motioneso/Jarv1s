# Relay handoff — #656 sports module (r7 → r8)

**Continuation of a coordinated build.** You are the successor to `Build-656-sports-r7`. Resume in
the SAME worktree on the SAME branch under the Coordinator. Read this doc IN FULL, then resume via
the `coordinated-build` skill.

Run: `2026-06-30-rfa-fleet` · Issue: #656

## Coordinates

- **Worktree:** `~/Jarv1s/.claude/worktrees/656-sports-module`
- **Branch:** `coord/656-sports-module`, HEAD `b051e692` (do NOT branch off; keep committing here)
- **Bootstrap:** `[ -d node_modules ] || pnpm install` — node_modules already exists; do NOT
  reinstall.
- **Coordinator:** Herdr label **`Coordinator`** (Codex). Resolve fresh by label each time via
  `herdr pane list`; confirm EXACTLY ONE pane holds it before messaging; session id is authority,
  label is routing, the `…-N` pane number is ephemeral (reflows) — never address/reap by a bare
  number.
- **Spec/plan:** `docs/superpowers/specs/2026-06-30-sports-module.md`,
  `docs/superpowers/plans/2026-07-01-sports-module.md` (15 tasks). Risk tier: standard (module
  isolation + owner-only RLS on `app.sports_follows`).

## Done (committed on this branch)

- **Tasks 1–9** — package + shared contract (`packages/shared/src/sports-api.ts`), catalog,
  migration `0133_sports_follows` (owner-only RLS), source interface + cache, repository, ESPN
  source (fixtures, no live net), service, routes (`registerSportsRoutes`), briefing tool + manifest
  - package index. (Earlier r-sessions.)
- **Task 10 — `ca03c959`** — registered sports in `module-registry` (LOADER-SEAM 1 + 2):
  `packages/module-registry/src/{index.ts,package.json}`, `pnpm-lock.yaml`, foundation migration-row
  `{ version: "0133", name: "0133_sports_follows.sql" }`, unit `tests/unit/sports-registry.test.ts`,
  RLS-isolation `tests/integration/sports-follows-repository.test.ts`.
- **Task 11 — `b051e692`** — briefing section (LOADER-SEAM 3):
  - `compose.ts`: `sports.followedFactsToday` gathered via shared `gatherToolSection` into a
    **selection-gated** `<external_source type="sports">` block. Allow-list `format` emits the
    compact fact string only (no URLs, no scores-object passthrough). `sports` reserved in
    `TRUST_BOUNDARY` + the channel comment, alongside `web_research`.
  - `routes.ts`: `defaultToolNamesFor` now **exported**; `sports.followedFactsToday` added to the
    **morning + evening** default arms only — NOT `weekly_review` (Coordinator ruling: today-scoped
    facts don't belong in a retrospective default).
  - Guards: section-render test in `tests/unit/briefings-compose.test.ts`; new
    `tests/unit/briefings-default-tools.test.ts` pins morning/evening membership + weekly_review
    exclusion.
  - **Side-effect fix (in-scope):** `compose.ts` tripped the 1000-line file-size gate (+24 over
    993). Extracted the pure `fallback()` renderer into new `packages/briefings/src/fallback.ts`
    (behavior byte-identical; `Section` newly exported for the import; type-only imports → no runtime
    cycle). `compose.ts` now 977. **Trusted-preamble constants (`TRUSTED_INSTRUCTIONS_*`,
    `TRUST_BOUNDARY`) MUST stay in `compose.ts`** — `tests/unit/briefings-prompt-isolation.test.ts`
    scrapes that source file for them.
  - **Task 10 registration fallout fixed:** `tests/integration/briefings.test.ts` full-registry
    assertions — `sports` added to the manifest-ID `toEqual` list (between `weather` and `notes`) and
    to `getBuiltInSqlMigrationDirectories()` tail (`.at(-5)`, later indices shifted). Verified
    against real runtime order.

### Verification at relay (all GREEN)

- typecheck `@jarv1s/briefings`, eslint, prettier, `check:file-size` — clean on all touched files.
- Unit: `briefings-compose` + `briefings-default-tools` + `briefings-prompt-isolation` (39).
- Integration (local PG `localhost:55433/jarv1s`, quiet): `briefings-synthesis` injection-canary
  (40), `briefings.test` (21), `source-behaviors` (3).
- Confirmed sports registers **no** source-behavior (source-behaviors list unaffected) and
  `module-enablement.test.ts` uses a fixed fixture manifest set (not the live registry) — no further
  registry-enumeration fallout beyond briefings.test.ts + foundation.test.ts (both fixed).

## Left to do — Tasks 12–15 (DO NOT START until the Coordinator directs)

Coordinator instruction: **report your pane id + `agent_session.value` and await coordinator
approval before starting Task 12.**

- **Task 12** (plan L1195) — Web registration (LOADER-SEAM 4): route, nav metadata, query keys, API
  client. Note: `apps/web/src/app-route-metadata.ts` holds the route union; weather has no web-route
  precedent there.
- **Task 13** (L1260) — Sports page UI + CSS (plan §4.6a). At Task 13, cheaply try Open Design /
  Jarvis Design System source first; if unavailable, author from the §4.6a taxonomy and note the
  fallback. Preserve the authored design system (`jds-*`, serif headings / mono eyebrows / sans
  body; raw colors only in `apps/web/src/styles/tokens.css`); only a small local `RationaleChip` if
  none exists; watch the 1000-line file-size gate on new CSS/TSX.
- **Task 14** (L1324) — Settings follow-picker pane.
- **Task 15** (L1364) — README loader-seam ledger + full-gate close-out (`pnpm verify:foundation`),
  then `coordinated-wrap-up` (PR + report). Coordinator owns QA/merge/board.

## Constraints to keep (Ben + Coordinator, verbatim intent)

- **Explicit staging only.** Never `git add -A`/`.`. Stage only your task's files.
- **Do NOT stage** `.claude/context-meter.log`, the copied `docs/coordination/…` handoff, or
  `docs/superpowers/plans/2026-07-01-sports-task11-briefing-section.md` (intentionally untracked).
  This relay doc under `docs/superpowers/handoffs/` IS an intentional commit.
- **No repo-wide format.** (Single-file `prettier --write` on your own touched files is fine — do it
  before committing docs, or the successor's `format:check` fails on them.)
- Preserve the **single chat-visible `sports.followedFactsToday` tool** decision — no new tools; no
  rich `sports.scores`.
- **RLS / DataContextDb / AccessContext untouched.** Owner-only on `app.sports_follows`; no admin
  bypass; `AccessContext` is `{ actorUserId, requestId }` only. Repositories take `DataContextDb`.
- Module isolation: sports collaborates only via its manifest + declared APIs. Forced
  composition-root wiring stays tagged `// LOADER-SEAM(sports):`.
- Test placement: repo tests live under `tests/unit` + `tests/integration` (root `vitest.config.ts`
  does NOT pick up `packages/*/src` tests). Do not add `packages/sports/src/__tests__/*`.
- Relay again at ~80–100k tokens or the instant you see a compaction summary.

## First actions for the successor

1. `[ -d node_modules ] || pnpm install`; confirm branch `coord/656-sports-module`, HEAD `b051e692`.
2. Run the `coordinated-build` required recalls (state + RLS/migration/frontend rows).
3. Message the Coordinator (label `Coordinator`): your pane id + `agent_session.value`, "r8 driving,
   awaiting go for Task 12." Wait for approval before any code.
