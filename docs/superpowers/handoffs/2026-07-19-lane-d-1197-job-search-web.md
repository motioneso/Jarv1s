# Lane D handoff — Job Search web rewrite: root + four screens

**Issue:** task #1197 (Part of feature #1193) · **Spec (source of truth):**
`docs/superpowers/specs/2026-07-19-job-search-embedded-onboarding.md` — read IN FULL, especially
§Module UI and the prototype→app token mapping table. Read `AGENTS.md` and the issue body first.

## Mission

Full replacement of the Job Search module's web UI with the approved Park Press design. **The
design doc is king** — Ben's explicit direction: none of the existing UI needs to be preserved;
prototype copy is verbatim.

Design source: `docs/superpowers/design/job-search-onboarding/module/*.jsx.txt`
(JobsOverview / JobsMatches / JobsMonitors / JobsProfile) + `kit.jsx.txt`. These are reference
JSX — translate to the module's real stack and app tokens.

1. **Root skeleton FIRST, as its own PR** — new `root.tsx`: tabs Overview/Matches/Monitors/
   Profile + a first-run gate placeholder (`get-state.step !== "done"` → placeholder that Lane E
   will replace with the onboarding screen). This de-conflicts Lane E; land it before the screen
   PRs.
2. **New `kit.tsx`** — Eyebrow, Strap, SectionHead, FitBadge, Meta, Confidence — mapped per the
   spec's token table. Prototype mono labels render as `--font-sans` letterspaced uppercase
   (mono is retired app-wide); `tabular-nums` for numerics. Raw colors only via existing
   `tokens.css` names from the mapping table.
3. **Per-screen PRs**: screens/{overview,matches,monitors,profile}.tsx. Boards render from
   `sources.list` — **no Workday row** (no adapter exists; ratified copy delta).
4. **Delete** `starter-drafts.ts`, old `onboarding.tsx`, `opportunities.tsx` (no stale concepts
   left behind). **Keep** runtime.ts, api.ts, store.ts, router.ts, states.tsx plumbing. Module
   web tool access stays READ-only (`src/web/api.ts`) — not superseded.
5. **Rewrite the js06 e2e suites** for the new screens.

## Exit criteria (from issue #1197)

Mocked e2e per screen; bundle hygiene (no own React, no core-internal imports — declared module
contract only); full gate green. Size L, 3–4 PRs, base `main`.

## Process

- Work ONLY in your assigned worktree/branch; never touch the shared checkout `~/Jarv1s`; stage
  explicit paths only — never `git add -A`.
- First step: `pnpm install` (fresh worktree).
- Module isolation: no core-internal imports; only the declared web contract. Empty/loading
  states use existing authored patterns. No emoji in UI (FileText-style glyphs instead).
- File-size gate: all source (incl. CSS) ≤1000 lines — split by section proactively.
- Generous why-comments citing issue #1197/#1193. Each PR body: user-facing summary + "Part of
  #1193".
- `pnpm verify:foundation` green (real exit code) before each PR. Dev box is NOT headless — bind
  Vite to 0.0.0.0 for any live check.
- **Do NOT merge your PRs** — push, open PR, report done; coordinator runs independent QA and
  merges.

## Start

1. `pnpm install`
2. Read spec §Module UI + issue #1197 + the four design `.jsx.txt` files + current
   `external-modules/job-search/src/web/`.
3. PR 1 = root skeleton (announce when it's open — Lane E depends on it), then screens.
