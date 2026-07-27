### Task 19: Onboarding screen

The screen a profile shows before it has criteria: what the search is for, how far along the
conversation is, and nothing that pretends to be results.

**Depends on:** Task 10 (`ONBOARDING_STEPS`, `completedSteps`), Task 18 (`Root`'s branch).

**Files**

- Create: `external-modules/job-search/src/web/screens/onboarding.tsx`
- Test: `tests/unit/job-search-web-onboarding.test.tsx`

**Constraints**

- **Progress comes from the record, never from the transcript.** The chips render from the
  `completedSteps` array on the `profile.list` result — the domain layer decides what is done
  (Task 10), and the screen displays it. A screen that inferred progress from what the model said
  would be UI made of model output.
- Port the markup from the prototype's `.jp-onb` block and the styles from `flow.css`, renaming the
  `jp-` prefix to the module's own.
- **Tokens only** — `pnpm check:design-tokens` fails on a literal colour.

**Tests** (`tests/unit/job-search-web-onboarding.test.tsx`)

1. **One chip per `ONBOARDING_STEPS` entry, with the done ones marked from `completedSteps`.**
   Fails against a screen that hardcodes its own step list, which would drift the moment Task 10's
   steps change.
2. **An empty profile renders the "nothing gets crawled until we both know what we're looking for"
   copy, not a spinner.** An empty profile is a finished state waiting on the user, not a load in
   progress, and a spinner tells the user to wait for something that will never arrive.
3. **No table, no rail, and no source strip during onboarding** — asserts each is absent. There are
   no results yet, and chrome that implies otherwise is the thing this screen exists to avoid.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-web-onboarding.test.tsx && pnpm check:design-tokens   # exit 0
```

---
