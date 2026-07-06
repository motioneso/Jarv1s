# Relay 3 — #668 Sports Feedback Pass (build agent)

Continue via `coordinated-build`. Issue: https://github.com/motioneso/Jarv1s/issues/668

## Where

- Branch/worktree: `coord/668-sports-feedback-build` @ `~/Jarv1s/.claude/worktrees/668-sports-feedback-build` (unchanged — resume in place, skip `pnpm install`).
- Spec: `docs/superpowers/specs/2026-07-01-sports-feedback-pass-design.md`
- Plan (authority, follow verbatim): `docs/superpowers/plans/2026-07-01-sports-feedback-pass.md` — 7 tasks.
- Prior handoffs (superseded): `docs/superpowers/handoffs/2026-07-01-668-sports-feedback-relay.md`,
  `docs/superpowers/handoffs/2026-07-01-668-sports-feedback-relay-2.md`
- Coordinator: Herdr label `Coordinator` — resolve fresh by label, do not trust any pane-id noted
  in prior docs.

## Done (this relay)

- Task 1 (CSP img-src) fully complete, tests green, typecheck 0, **committed**: `4bfb7531`
  "#668 feat(sports): CSP img-src follows SportsSource image hosts".
- Task 2 (source enrichment) IN PROGRESS, **uncommitted / dirty** — this is expected TDD mid-state
  (RED), do not discard:
  - `packages/sports/src/source/__fixtures__/nfl-news.json` — rewritten with `images`/`categories`
    per plan Step 1. Done.
  - `tests/unit/espn-source.test.ts` — added the two new `it(...)` blocks from plan Step 2
    (`"parses news images and provider team tags"`, `"carries the provider team id on listTeams"`).
    Confirmed RED before implementing (Step 3 done).
  - `packages/shared/src/sports-api.ts` — `Headline` interface gained `imageUrl`/`teamKeys`;
    `headlineSchema` `required` + `properties` updated. Step 4 done.
  - `packages/sports/src/source/sports-source.ts` — added `SourceTeamRef extends TeamRef` and
    `SourceHeadline extends Headline` interfaces; `SportsSource.listTeams`/`getHeadlines` signatures
    changed to return `SourceTeamRef[]`/`SourceHeadline[]`. Step 5 done.
  - `packages/sports/src/source/espn-source.ts` — `listTeams` returns `SourceTeamRef[]`
    (`sourceTeamId: team?.id ?? null`, `satisfies SourceTeamRef`); `getHeadlines` rewritten per
    plan Step 6 snippet (image + `sourceTeamIds` extraction); unused `Headline`/`TeamRef` type
    imports removed (now unused after the `Source*` extends move). Step 6 done.
  - **NOT started:** plan Step 7 (service plumbing in `packages/sports/src/sports-service.ts` —
    cache types `SportsCache<SourceHeadline[]>` / `SportsCache<SourceTeamRef[]>`,
    `headlinesByComp: Map<string, SourceHeadline[]>`, `buildHero`/`buildCard` param types), Step 8
    (fixture updates: `tests/unit/sports-service.test.ts` `nflHeadlines`/`h1`,
    `tests/unit/sports-page.test.tsx` `makeOverview()` headlines, `tests/unit/sports-routes.test.ts`
    fake source headlines/teams + leak-pin assertions, check
    `tests/unit/web-sports-client.test.ts`), Step 9 (run tests + typecheck — will currently FAIL,
    `sports-service.ts` doesn't compile against the new seam types yet), Step 10 (commit).

Exact dirty files right now (`git status --short`):

```
 M packages/shared/src/sports-api.ts
 M packages/sports/src/source/__fixtures__/nfl-news.json
 M packages/sports/src/source/espn-source.ts
 M packages/sports/src/source/sports-source.ts
 M tests/unit/espn-source.test.ts
?? .claude/context-meter.log   (leave alone — not this task's file)
```

## New scope folded in by Coordinator this relay (all still to build)

Ben added 5 `/sports` dogfood feedback items to land inside #668 (no separate issue). Keep them as
a final task after Task 2–7 (or interleave into Task 6/7 if more natural) — they are page-only,
independent of the Task 2–7 DTO work above. Investigation already done, ready to implement:

1. **Header wording too stiff.** `apps/web/src/sports/sports-page.tsx` `PageHeader` (~line 71-92):
   `<h1 className="sp-title">Followed</h1>` and the `sp-lede` paragraph ("Your teams first — latest
   results and what's next — then the wider slate and the headlines that matter.") read too
   textbook. Rewrite to feel less stiff — Ben's own words, no spec constraint on exact copy.
2. **Remove green "Sports" kicker label.** Same `PageHeader`, the `<div className="sp-kicker">`
   block (line ~75-78: `<LiveDot /> Sports`) — app shell header already shows "Sports" via the nav,
   this is redundant. Remove the kicker div (or just the "Sports" text + keep/drop `LiveDot` per
   your judgement — check what `LiveDot` communicates elsewhere before dropping it entirely).
3. **Remove the word "Cached" from header copy.** Same `PageHeader`, `sp-top__aside` →
   `sp-preview__lbl` (line ~87): `{props.degraded ? "Cached" : "Live"}`. Replace "Cached" with a
   non-jargon word (e.g. "Recent") — keep the Live/non-live binary, just don't say "cached".
4. **Fix the "Manage" link — currently lands on Today instead of team management.** Root cause
   found: `sports-page.tsx` line 27 `const SETTINGS_HREF = "/settings/modules/sports";` — this path
   doesn't match any route in `apps/web/src/app.tsx` (only `/settings` is registered), so it falls
   through the catch-all `<Route path="*" element={<Navigate to={webRoutePath("today")} .../>} />`
   at app.tsx:215 → lands on Today. Correct fix uses two existing deep-link seams, do NOT build new
   routing:
   - `apps/web/src/settings/settings-page.tsx` (~line 186-194, comment tagged `#369`) honors a
     `?section=` query param on `/settings` — `"modules"` is a valid `PERSONAL_SECTIONS` id (line
     133 of that file).
   - `apps/web/src/settings/settings-personal-data-panes.tsx` `ModulesPane` (~line 690-713) further
     honors a `?module=<id>` param via `resolveModuleSettingsDeepLink` + `MODULE_SETTINGS_SURFACES`
     (generated, declared in `apps/web/src/vite-env.d.ts`) — routes straight into that module's
     settings surface via `ModuleSettingsRouter` if `findModuleSettingsEntrySurface("sports", ...)`
     resolves. `OPTIONAL_MODULES` (line 686) already includes `"sports"` and there's a `sports:
     Trophy` icon mapping (line 99), suggesting sports already has a modules-list entry — **not yet
     confirmed** whether sports has a *registered settings surface* (i.e. whether
     `findModuleSettingsEntrySurface("sports", MODULE_SETTINGS_SURFACES)` resolves to something,
     which would land the user on a specific pane vs. just the generic Modules list). Verify before
     shipping: grep the sports package / module-registry for a settings-surface registration
     (search `MODULE_SETTINGS_SURFACES`'s source — it's a generated const per `vite-env.d.ts`, find
     the generator/config that populates it, likely keyed off module manifests under
     `packages/*/src/manifest.ts` or a settings-surface field in `sportsModuleManifest`). If sports
     has no settings surface (team-follow management doesn't live in Settings), the "team
     management experience" may actually be intended to live *on the /sports page itself* (there's
     already a follow/unfollow affordance somewhere per Task 4 of the plan — check) — if so, escalate
     to Coordinator: "Manage" may need to open an in-page picker, not a Settings deep link, and that
     is a product decision, not something to guess.
   - Fallback minimal fix regardless: change `SETTINGS_HREF` to
     `"/settings?section=modules&module=sports"` — this is strictly better than today's dead link
     even if it just lands on the generic Modules list (rather than 404-into-Today), and is a safe
     interim if the deeper surface doesn't resolve.
5. **Nav icon for Sports needs a better graphic (ball/trophy).** Feedback location
   `.nav-group > .module-link > svg > path` in the left app nav. Root: `packages/sports/src/manifest.ts`
   line 43 already declares `icon: "trophy"` on the module's nav entry — so the *intent* is already
   trophy, but whatever renders `.nav-group > .module-link` icons from that string id may be mapping
   it to a generic/wrong SVG. NOT YET FOUND: the icon-name → SVG/lucide-component resolver for
   `ModuleNavigationEntryDto.icon` strings in the app shell (`apps/web/src/shell/app-shell.tsx` was
   the last file grepped, mid-search when this relay fired — grep there first for how `icon` string
   values like `"house"` (todayNavEntry) get turned into rendered SVGs, and either fix the mapping
   for `"trophy"` or confirm the current icon already renders a trophy glyph and the feedback wants a
   *different* trophy/ball glyph — Ben's exact words: "needs a better image. A ball or trophy or
   something", implying current render doesn't read as either).

None of items 1-5 conflict with the Task 2-7 plan file — they are pure `sports-page.tsx` /
`settings-*` / shell copy+link fixes, additive to the plan, not contradicting any step. No need to
edit the plan doc; just execute these as an added task (call it Task 8) after Task 7, or fold 1-3
into whichever Task 6/7 commit touches `sports-page.tsx` header markup if that's still open when you
get there — your call, note the choice in your own commit.

## Next (resume exactly here)

1. Finish Task 2 Steps 7-10 (plan lines 412-458) — service plumbing, fixture updates across the 4
   test files, run `pnpm vitest run tests/unit/espn-source.test.ts tests/unit/sports-service.test.ts
   tests/unit/sports-routes.test.ts tests/unit/sports-page.test.tsx`, `pnpm typecheck`, commit
   exactly the paths in plan Step 10 (plus `web-sports-client.test.ts` if touched).
2. Continue Tasks 3-7 in order, exactly as written in the plan (full snippets in the plan doc).
3. Execute the 5 new feedback items above as a final task (Task 8), committed separately
   (`#668 fix(sports): ...` — split into 1-2 commits by concern, your judgement).
4. Invoke `coordinated-wrap-up` per the standard closeout (pre-push trio, push, PR, comment on
   #668, report to Coordinator). Do not touch board/milestones/merge.

## Guardrails (unchanged)

No `docs/coordination/` edits. No `git add -A`/`git add .` — explicit paths only. Task-scoped
`#668`-prefixed commits. Escalate spec/plan contradictions instead of guessing — item 4/5 above
already flag exactly where to escalate if the deep-link doesn't fully resolve. Relay again at
~80-100k tokens or on compaction-summary sighting.
