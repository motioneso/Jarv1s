# Handoff — #1019: external-module navigation ABI (Option B)

You are a **build + dev-UAT agent**. Model: **Sonnet**. Tier: **sensitive** (module ABI /
cross-module contract / module-isolation + supply-chain). Coordinator: label `Coordinator`,
session `58a78927-385c-4b1d-8fa0-94db20255d6f` — report the PR number there.

Worktree: `.claude/worktrees/ext-nav-1019` (branch `ext-nav-1019`, off `origin/main` @ `031eb67e`).
STEP 1 `pnpm install`.

## Read first (in full)
- The APPROVED spec — read it completely, it is decision-dense and grounded in real code:
  `/home/ben/Jarv1s/.claude/worktrees/coord-2026-06-30-rfa-fleet/docs/superpowers/specs/2026-07-13-external-module-navigation-abi.md`
- `gh issue view 1019 --repo motioneso/Jarv1s` (root cause).

## What to build (per the spec — do not re-litigate the decisions)
Fix bug #1019: installed external/downloadable modules get **no nav item** because
`serializeExternalModule` (apps/api/src/server.ts ~line 905) hardcodes `navigation: []`.

Implement exactly what the spec decides. Summary of the 10 decisions (spec is authoritative):
1. **Optional `navigation`** field on the external manifest — NO schemaVersion bump; existing v1
   manifests with no navigation must still validate.
2. **Wire shape = existing `ModuleNavigationEntryDto`** (packages/shared platform-api.ts) — already
   in the response schema (do not trip fast-json-stringify: any field you emit must be declared in
   the shared schema). Manifest subset `{id,label,path,icon?,order?}`; reject built-in-only
   `permissionId`/`featureFlagId` for external modules.
3. **Isolation (critical):** manifest `path` is **module-relative**; `serializeExternalModule` is
   the single choke point that prefixes `/m/<moduleId>`. Validator rejects `..` `.` `//` `\` `?`
   `#`, segments `[a-z0-9-]`, ≤128. A module must never be able to declare a host/absolute route.
4. **Icon:** validated slug + safe fallback (`Layers3`) — Ben approved the slug+fallback posture
   over a strict allowlist. Add `briefcase` to the shell iconMap.
5. **Placement:** new labeled **"Modules"** nav section appended after "You"
   (app-route-metadata.ts buildShellNavigation tail). External entry ids MUST be
   `<moduleId>`-prefixed (anti-spoof vs HIDDEN_NAV_IDS / SECTION_OF). External entries never
   consult SECTION_OF.
6. **Caps:** 1–4 entries; label ≤40; id ≤64 (prefixed+unique); |order|≤10000; unknown keys
   rejected (mirror the #964 database-capability rule).
7. **job-search manifest:** declare a single root entry — `path: "/"`, label `"Job Search"`, icon
   `briefcase`. (Manifest change → packageHash drift → admin must re-enable; the dev-UAT covers it.)
8. **API:** add `navigation` to `ReconciledExternalModule`, carry it through reconcile, map+prefix
   in `serializeExternalModule`, drop the `[]`. Settings surface stays `[]`.
9. **Tests:** validator (rejects over-cap / traversal / absolute / unknown-key), reconcile carries
   navigation, `app.inject` on the modules API returns prefixed entries, `buildShellNavigation`
   renders the Modules section. **No migration** (manifest is on-disk; the DB row stores only
   id/status/hash — do NOT add a migration or touch foundation-schema-catalog).
10. **Dev-UAT is a HARD exit gate** (see below).

Add generous why-comments citing **#1019** at each guard (the prefix choke point, the validator
path rules, the caps).

## Dev-UAT — HARD exit gate (Ben's rule 2026-07-13)
Prove it on an **isolated dev stack** (NOT prod 1533, NOT the jarvis-uat-1006 stack). New project
name (e.g. `jarvis-uat-1019`) and a free port. Build the image from your branch or run the app
from source — whatever exercises the real API serialize + real shell nav.
- Owner via the real signup UI. Reuse the hardened env pattern at
  `/tmp/claude-1000/.../scratchpad/devproof/env.devproof` (override project + port).
- Playwright script (put it under `scripts/uat/` — seeds the #1000 harness): sign in → Settings →
  Instance modules → install job-search → (restart if activation needs it) → **assert a nav link
  labelled "Job Search" EXISTS in the shell nav** → **CLICK it** → assert the job-search page
  renders. **`page.goto` to `/m/job-search` (or any route) is FORBIDDEN** — the whole point of this
  fix is that the user reaches it by clicking the nav. Screenshot each step into the scratchpad
  devproof dir.
- Report in the PR + to Coordinator: nav link found + clicked (screenshot), page rendered.

## Gate + PR
- `pnpm verify:foundation` green; record exit codes.
- PR body: `Closes #1019`, base `main`, short user-facing "What's new"
  ("Downloaded modules now appear in the navigation menu after you install them — previously an
  installed module could only be reached by typing its URL").
- Report the PR number to the `Coordinator` pane. Tier **sensitive** → expect Opus/Fable review +
  the dev-UAT before the coordinator merges. **You do not merge.**

## Guardrails (hard)
- **Possible shared-shell collision:** the UX Coordinator owns the settings-shell lane (#986). Your
  edits to `apps/web/src/shell/app-shell.tsx` / `app-route-metadata.ts` are shell-nav, a different
  surface, but if you hit a conflict there, **message the `Coordinator` pane** — do not hand-resolve
  across lanes.
- **Do NOT edit any Instance-modules settings UI code** (UX-owned) — you only *drive* it via
  Playwright.
- No `git add -A` (explicit paths only). Do NOT touch `docs/coordination/`. Do NOT run repo-wide
  `pnpm format` — format only the files you changed.
- Scratchpad for UAT artifacts:
  `/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-coord-2026-06-30-rfa-fleet/58a78927-385c-4b1d-8fa0-94db20255d6f/scratchpad/devproof/`
