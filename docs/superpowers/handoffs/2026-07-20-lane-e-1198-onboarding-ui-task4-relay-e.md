# Lane E #1198 onboarding UI — Task 4 relay (e)

Same worktree/branch (`feat/1198-onboarding-ui`), don't create new one. Supervisor: pane label
`Coord 1193 Supervisor 5` — re-resolve fresh via `herdr pane list`, never reuse a pane_id from any
doc. No push/PR without explicit supervisor grant. DB-less only: no `verify:foundation`, no DB.

Full Task 4 assertion list + Task 5 gate command block: relay (b)
(`docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui-task4-relay-b.md`) — still
authoritative, don't re-read design mockup/plan.

## State

HEAD `5a71cf93`. Relay (d)'s guess (stale first-run assertion, dead FailClosed branch) was WRONG —
don't re-derive, verified below. Real bug found + fixed: `bootstrapOnboarding` in
`external-modules/job-search/src/web/screens/onboarding/index.tsx` awaited
`handle.seedOnboarding()` unguarded; a rejection left `outcome` state null forever (permanent
loading spinner, not the FailClosed heading). Now wrapped in try/catch → returns
`{kind:"error", message}`. Typecheck clean, committed.

## Root cause (why js06 first-run test hangs) — confirmed, don't re-derive

`POST /api/chat/module-onboarding` (hit by `seedOnboarding` via
`apps/web/src/api/client.ts:852 seedModuleOnboarding`) has **no mock route anywhere in
`tests/e2e/`** — grepped, confirmed empty. `requestJson` throws `ApiError` on non-2xx/network
fail → now caught by the fix above → error state — but the test still needs the route mocked so
it actually proceeds into the real onboarding UI (that's the point of the test).

## Next: 3 concrete edits, in order

1. **Add the missing mock route.** In `tests/e2e/mock-chat-api.ts`, inside
   `registerMockChatRoutes`, add (matching the existing `/api/chat/clear`/`/api/chat/privacy`
   pattern at lines 55-74):
   ```ts
   await page.route(
     (url) => url.pathname.endsWith("/api/chat/module-onboarding"),
     async (route) => {
       await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
     }
   );
   ```
   This is global (used by every `mockApi` call, not just job-search) — correct, since
   `js1198-job-search-onboarding.spec.ts` (Task 5, step 6-9, not yet started) will need it too.

2. **Fix stale fixture key** in `tests/e2e/js06-module-surface.spec.ts` line 163: `resume.evidence`
   is `[{ claim: "Design system ownership" }]` but `index.tsx` reads `evidence.claimText`
   (confirmed via `model.ts`/`index.tsx` read). Change `claim` → `claimText`. Low-risk, prevents an
   `undefined` list item + React key warning when `CritiqueCard` renders (see #3 — it will render
   for this fixture).

3. **Rewrite the stale assertion**, `tests/e2e/js06-module-surface.spec.ts` lines 291-305 (test
   `"first-run state still replaces every tab with the Lane E placeholder"`). **Confirmed via
   reading `model.ts` `derivePhase`/`PROFILE_ORDER` in full** (don't re-derive): the fixture's
   `profile.active.fields` (defaultFixtures, all 5 fields populated) makes `toProfileProgress`
   mark all 5 profile substeps complete, so `PROFILE_ORDER.find(...)` returns `undefined` → `??
   "dealbreakers"` fallback fires. **Resolved phase = `"dealbreakers"`**, index 7 of
   `PHASE_ORDER` (confirmed in `index.tsx`). `buildLocalRows` renders rows 0-7 inclusive, so the
   `resume_approval` `CritiqueCard` row **is** in the DOM (hence fixture fix #2 matters) and the
   active control is `MultiControl` with `cta="Set dealbreakers"`, `skip="None of these"`, options
   include `"On-site 5 days/week"`, `"Below comp floor"`, `"No equity"` (confirmed in `index.tsx`
   ~L416-420 and `controls.tsx` `MultiControl` ~L90-150).

   Replace body with (still after `mountModule`+`page.goto` unchanged, still same override
   fixture):
   ```ts
   await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
   await expect(page.getByRole("button", { name: "Set dealbreakers" })).toBeVisible();
   await expect(page.getByRole("button", { name: "None of these" })).toBeVisible();
   ```
   (Adjust to whatever the actual scripted copy-row text is — grep `phaseRows`/the dealbreakers
   copy string in `index.tsx` for the exact prose if you want a copy-row assertion too; not
   required, the control assertion is the load-bearing one.)

   **Run to confirm GREEN before committing:**
   `pnpm exec playwright test tests/e2e/js06-module-surface.spec.ts --project=chromium`. Don't
   trust prediction — read the actual result.

   Commit all three edits together (they're one fix):
   `test(job-search): mock seed-onboarding route and fix js06 first-run assertion for composed render`

## Then: relay (b) steps 6-9 (unchanged, not yet started)

6. Write RED `tests/e2e/js1198-job-search-onboarding.spec.ts` skeleton per relay (b)'s exact
   requirements list. **Commit the moment it's RED for the right reason** — hard supervisor
   directive, repeated 3x now.
7. Implement fixtures/mocks inline, get all three e2e specs green together (`js1198` + `js06` +
   `assistant-surface`). Commit with the EXACT message from relay (b):
   ```
   test(job-search): cover guided onboarding flow

   User-facing summary: Job Search onboarding now has browser coverage for upload, approvals, denial, recovery, and completion.

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
8. Run the full Task 5 gate (verbatim block in relay (b) and (d)):
   ```bash
   pnpm build:external:job-search
   pnpm vitest run tests/unit/external-module-job-search-handlers-onboarding.test.ts tests/unit/external-module-job-search-handlers-resume.test.ts tests/unit/external-module-job-search-manifest.test.ts tests/unit/job-search-web-onboarding.test.tsx tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.tsx tests/unit/external-module-job-search-bundle.test.ts
   pnpm exec playwright test tests/e2e/js1198-job-search-onboarding.spec.ts tests/e2e/js06-module-surface.spec.ts tests/e2e/assistant-surface.spec.ts --project=chromium
   pnpm check:design-tokens
   pnpm check:file-size
   pnpm format:check
   pnpm lint
   pnpm typecheck
   ```
   All must exit 0 — vitest-only is explicitly NOT accepted as gate-ready evidence.
9. Re-resolve `Coord 1193 Supervisor 5` fresh via `herdr pane list`, report gate-ready with full
   commit list + command evidence — including the `resume_approval` plain-buttons judgment call
   (relay (c)), the `claim`/`claimText` fixture fix (this relay), and the new
   `bootstrapOnboarding` error-handling fix (commit `5a71cf93`) — or report any blocking error
   verbatim, never skip a check silently.

## Constraints (unchanged, repeat)

DB-less only (no `verify:foundation`, no DB). No push/PR without explicit supervisor grant. Stage
only your own files when committing (never `git add -A` on the shared worktree). Leave the
untracked stale doc `docs/superpowers/handoffs/2026-07-20-lane-e-1198-onboarding-ui.md` alone —
not superseded by us, not ours to clean up.
