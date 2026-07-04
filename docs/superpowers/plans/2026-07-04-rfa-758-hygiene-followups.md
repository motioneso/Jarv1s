# RFA-758 Hygiene Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the actionable subset of GitHub issue #758's batched LOW-severity hygiene findings (from the 2026-07-04 adversarial PR review) and consciously document the rest as deferred.

**Architecture:** Eight independent, unrelated small fixes across onboarding, priority scoring, settings, and dead-code removal. No shared design — each task is a self-contained diff.

**Tech Stack:** TypeScript, React, Vitest (SSR `renderToString` only — this repo deliberately has no jsdom/@testing-library; see `tests/unit/settings-appearance-pane.test.tsx:64` and `tests/unit/sports-page.test.tsx:17-18`).

## Global Constraints

- No handoff doc exists in this worktree for `rfa-758-hygiene-followups` (only 3 other fleet docs present in `docs/coordination/handoffs/2026-07-04-rfa-fleet/`). Source of truth is GitHub issue #758 body (fetched via `gh issue view 758 --json body`). Coordinator label is `Coordinator` (confirmed via `herdr pane list`, exactly one pane, `w1:p70`, cwd `.../coord-2026-06-30-rfa-fleet`).
- This is a chore/cleanup batch, not a new feature/module — CLAUDE.md's "spec before build" gate does not apply.
- One PR against issue #758 covering items with code changes (1–5, 8); items 6–7 documented as consciously deferred in the PR body, no code change.
- Full gate before PR: `pnpm format:check && pnpm lint && pnpm typecheck`, then `pnpm verify:foundation`.
- Stage only files touched by each task — never `git add -A`.

---

### Task 1: Clear IMAP credentials from onboarding state after successful connect (#677)

**Files:**

- Modify: `apps/web/src/onboarding/google-connector-step.tsx:124-132` (the `connectImap` mutation)

**Interfaces:**

- Consumes: existing `setImapUsername`, `setImapPassword`, `setImapTestResult` setters already declared at lines 81-83.
- Produces: nothing consumed by later tasks.

Current code (lines 124-132):

```tsx
const connectImap = useMutation({
  mutationFn: () => connectImapConnection(imapInput),
  onSuccess: () =>
    Promise.all(
      GOOGLE_CONNECT_SUCCESS_QUERY_KEYS.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey })
      )
    ).then(() => setMode("connected"))
});
```

- [ ] **Step 1: Edit `onSuccess` to clear IMAP state**

Replace with:

```tsx
const connectImap = useMutation({
  mutationFn: () => connectImapConnection(imapInput),
  onSuccess: () =>
    Promise.all(
      GOOGLE_CONNECT_SUCCESS_QUERY_KEYS.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey })
      )
    ).then(() => {
      setImapUsername("");
      setImapPassword("");
      setImapTestResult(null);
      setMode("connected");
    })
});
```

- [ ] **Step 2: Verify no existing test locks in the old behavior**

Run: `grep -rn "connectImap\|imapPassword" tests/` — expect no matches (no test exists for this component today, per repo search).

- [ ] **Step 3: Typecheck the file**

Run: `pnpm --filter @jarv1s/web typecheck` (or repo-root `pnpm typecheck` if no per-package script)
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/onboarding/google-connector-step.tsx
git commit -m "fix(onboarding): clear IMAP credentials from state after connect (#677)"
```

---

### Task 2: Muted priority sources are excluded, not just deprioritized (#751)

**Files:**

- Modify: `packages/priority/src/scoring.ts` (function containing lines 184-186)
- Modify: `packages/chat/src/priority-consumer.ts:58-75` (`rankChatContext`)
- Modify: `tests/unit/priority-scoring.test.ts:351-382` (existing "muted source caps score at low" test)
- Modify: `tests/unit/chat-priority-consumer.test.ts` (add exclusion test)

**Interfaces:**

- Consumes: `rankPriorityCandidates(input: { model, candidates, now, timeZone, focusReadiness })` from `packages/priority/src/index.ts` — signature unchanged.
- Produces: `rankPriorityCandidates` return type unchanged (`PriorityResult[]`), but muted-source candidates are now absent from the array entirely rather than present with `band: "low"`.

Read `packages/priority/src/scoring.ts` in full first — the exact function containing lines 184-186 and how `rankPriorityCandidates` iterates `candidates` was not re-verified after the context checkpoint; confirm the loop structure before editing (it maps each candidate to a scored result, then sorts/tie-breaks). The fix: filter out candidates whose `source` is in `model.mutedSources` **before** scoring (or filter the final results array by dropping any result whose source is muted) rather than only capping score. Prefer filtering early in `rankPriorityCandidates` (before the per-candidate scoring loop) so scoring work isn't wasted on candidates that will be dropped.

- [ ] **Step 1: Update the failing/changing test first** — in `tests/unit/priority-scoring.test.ts`, replace the "muted source caps score at low" test (lines 351-382) with:

```ts
it("muted source is excluded from results entirely", () => {
  const mutedModel: PriorityModelPreferenceV1 = {
    ...DEFAULT_MODEL,
    mutedSources: ["email"]
  };

  const candidates: PriorityCandidate[] = [
    {
      source: "email",
      title: "Urgent email",
      signalType: "needs_reply",
      textForAnchorMatch: ["urgent email"]
    },
    {
      source: "tasks",
      title: "Normal task",
      textForAnchorMatch: ["normal task"]
    }
  ];

  const results = rankPriorityCandidates({
    model: mutedModel,
    candidates,
    now: NOW,
    timeZone: TZ,
    focusReadiness: []
  });

  expect(results.find((r) => r.source === "email")).toBeUndefined();
  expect(results).toHaveLength(1);
  expect(results[0]!.source).toBe("tasks");
});
```

- [ ] **Step 2: Run to verify it fails**
      Run: `pnpm vitest run tests/unit/priority-scoring.test.ts -t "muted source"`
      Expected: FAIL (email candidate still present, band "low").

- [ ] **Step 3: Implement the filter in `packages/priority/src/scoring.ts`**

Find the top-level `rankPriorityCandidates` export (or the function that calls the per-candidate scorer whose body contains the `if (model.mutedSources.includes(candidate.source))` block at lines 184-186). Remove that cap-to-low block from the scorer, and instead filter `candidates` up front, e.g. near the start of `rankPriorityCandidates`:

```ts
const activeCandidates = candidates.filter((c) => !model.mutedSources.includes(c.source));
```

then use `activeCandidates` everywhere `candidates` was previously used for scoring/sorting. Keep the 200-candidate cap check (`"rejects more than 200 candidates"` test) operating on the _input_ `candidates` array, not the filtered one, so that test's behavior is unchanged — confirm by reading the existing cap-check code before editing.

- [ ] **Step 4: Run to verify it passes**
      Run: `pnpm vitest run tests/unit/priority-scoring.test.ts`
      Expected: all tests PASS, including the 200-candidate cap test and all other existing tests in the file (regression check).

- [ ] **Step 5: Update `rankChatContext` test to assert exclusion** — add to `tests/unit/chat-priority-consumer.test.ts` inside `describe("chat priority consumer")`:

```ts
it("excludes muted-source candidates from chat context", () => {
  const model: PriorityModelPreferenceV1 = {
    version: 1,
    mode: "balanced",
    anchors: [],
    mutedSources: ["email"],
    updatedAt: "2026-06-27T00:00:00Z"
  };
  const candidates = [
    {
      source: "email" as const,
      title: "Muted email",
      textForAnchorMatch: ["muted email"]
    },
    {
      source: "tasks" as const,
      title: "Visible task",
      textForAnchorMatch: ["visible task"]
    }
  ];
  const ranked = rankChatContext(candidates, model, "2026-06-27T12:00:00Z", "America/Los_Angeles");
  expect(ranked.find((r) => r.source === "email")).toBeUndefined();
  expect(ranked).toHaveLength(1);
});
```

Note: `rankChatContext` (in `packages/chat/src/priority-consumer.ts:58-75`) calls `rankPriorityCandidates` internally — once Step 3's filter lands in scoring.ts, this test should pass without any change to `priority-consumer.ts` itself. Read the function body to confirm it doesn't have its own separate muted-source handling that also needs removal (the original grounding found none, but re-verify).

- [ ] **Step 6: Run full priority + chat suites**
      Run: `pnpm vitest run tests/unit/priority-scoring.test.ts tests/unit/chat-priority-consumer.test.ts`
      Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/priority/src/scoring.ts tests/unit/priority-scoring.test.ts tests/unit/chat-priority-consumer.test.ts
git commit -m "fix(priority): exclude muted sources from ranked results instead of only deprioritizing (#751)"
```

---

### Task 3: Quiet-hours time inputs no longer PUT invalid/empty values (#753)

**Files:**

- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx` (`GeneralPane`, quiet-hours time inputs, currently around lines 918-931 — re-confirm exact lines before editing since Task 1/2 edits don't touch this file)
- Test: `tests/unit/settings-quiet-hours-pane.test.tsx` (add a test for the new pure helper)

**Interfaces:**

- Produces: a new pure exported helper `isValidQuietHoursTime(value: string): boolean` (or reuse-equivalent name) that later tasks don't depend on — self-contained.

This repo has no jsdom/@testing-library (see Global Constraints), so the fix must be verified via a **pure helper function** extracted from the component, unit-tested directly, rather than via simulated typing. Do not build a generic debounce utility — scope this to the two quiet-hours time inputs only.

- [ ] **Step 1: Write the failing test** — add to `tests/unit/settings-quiet-hours-pane.test.tsx`:

```ts
import { isValidQuietHoursTime } from "../../apps/web/src/settings/settings-personal-data-panes.js";

describe("isValidQuietHoursTime", () => {
  it("accepts valid HH:MM", () => {
    expect(isValidQuietHoursTime("22:00")).toBe(true);
    expect(isValidQuietHoursTime("07:05")).toBe(true);
  });
  it("rejects empty string and malformed values", () => {
    expect(isValidQuietHoursTime("")).toBe(false);
    expect(isValidQuietHoursTime("24:00")).toBe(false);
    expect(isValidQuietHoursTime("7:5")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**
      Run: `pnpm vitest run tests/unit/settings-quiet-hours-pane.test.tsx -t "isValidQuietHoursTime"`
      Expected: FAIL (export doesn't exist yet).

- [ ] **Step 3: Add the helper and wire it into the two time inputs**

In `apps/web/src/settings/settings-personal-data-panes.tsx`, add near the top-level helpers (module scope, not inside `GeneralPane`):

```ts
export function isValidQuietHoursTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
```

This mirrors the backend's `isValidHHMM` in `packages/settings/src/quiet-hours-routes.ts:95-97` (kept separate/duplicated intentionally — no shared package boundary exists between web and settings for this one regex, and introducing one is out of scope for a LOW hygiene fix).

Then change the two `<input type="time">` `onChange` handlers (currently `onChange={(event) => updateQuietHours({ start: event.currentTarget.value })}` and the `end` equivalent) to guard on validity — only call `updateQuietHours` when the new value is valid, so an empty/in-progress value never reaches the mutation:

```tsx
onChange={(event) => {
  const value = event.currentTarget.value;
  if (isValidQuietHoursTime(value)) updateQuietHours({ start: value });
}}
```

(mirror for `end`). Read the current input's `value={quietHours.start}` binding first — since the input stays controlled by `quietHours.start` (server state) and only commits on valid values, clearing the field will visually revert to the last committed value once the component re-renders, which is acceptable per the issue's "no data corruption, just a rough edge" framing — confirm this matches by reading the full `GeneralPane` render path around these inputs before editing.

- [ ] **Step 4: Run to verify it passes**
      Run: `pnpm vitest run tests/unit/settings-quiet-hours-pane.test.tsx`
      Expected: all PASS, including the pre-existing "renders backend quiet-hours values" test (regression check).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-personal-data-panes.tsx tests/unit/settings-quiet-hours-pane.test.tsx
git commit -m "fix(settings): guard quiet-hours time inputs against empty/invalid PUT (#753)"
```

---

### Task 4: Remove dead MemoryPanel CSS and dead token alias (#712)

**Files:**

- Modify: `apps/web/src/styles/kit-chat.css` (delete lines 926-984)
- Modify: `apps/web/src/styles/tokens.css` (delete line 245, the `--provisional-opacity` alias)
- Modify: `tests/unit/unstyled-surfaces-css.test.ts:18-19` (remove `.memory-panel` and `.memory-toggle` from the asserted selector list)

**Interfaces:** None — pure deletion, no exports change.

Confirmed during grounding: zero references to `.memory-panel`, `.memory-panel-header`, `.panel-heading`, `.memory-settings`, `.memory-facts`, `.memory-toggle`, or `--provisional-opacity` anywhere in `apps/web/src/**/*.tsx`. (The `packages/priority` false-positive grep hits on "memory-settings"/"memory-facts" in `apps/web/src/api/query-keys.ts:70-71` are unrelated React Query cache-key strings, not CSS class usage — leave that file untouched.)

- [ ] **Step 1: Update the test first (it currently locks in the dead CSS)** — in `tests/unit/unstyled-surfaces-css.test.ts`, remove `".memory-panel"` and `".memory-toggle"` from the selector array (lines 18-19), leaving the other 7 selectors intact.

- [ ] **Step 2: Run to verify the test still passes with CSS unchanged**
      Run: `pnpm vitest run tests/unit/unstyled-surfaces-css.test.ts`
      Expected: PASS (removing assertions can't break a passing test).

- [ ] **Step 3: Delete the dead CSS block**

Delete lines 926-984 of `apps/web/src/styles/kit-chat.css` in full (confirmed this is the exact tail of the file — line 984 is the last line, ending `}`). The block starts right after `.source-tray__snippet { ... }` and begins with `.memory-panel {`.

- [ ] **Step 4: Delete the dead token line**

Delete line 245 of `apps/web/src/styles/tokens.css`: `--provisional-opacity: var(--governor-opacity);`

- [ ] **Step 5: Run the full unit suite for regressions**
      Run: `pnpm vitest run tests/unit/unstyled-surfaces-css.test.ts`
      Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/styles/kit-chat.css apps/web/src/styles/tokens.css tests/unit/unstyled-surfaces-css.test.ts
git commit -m "chore: remove dead MemoryPanel CSS and unused --provisional-opacity token (#712)"
```

---

### Task 5: Delete orphaned settings-data-source-model.ts (#752)

**Files:**

- Delete: `apps/web/src/settings/settings-data-source-model.ts`
- Delete: `tests/unit/web-settings-data-source-model.test.ts`

**Interfaces:** None — confirmed via grep that no file other than its own test imports this module, and no barrel `index.ts` re-exports it.

- [ ] **Step 1: Re-confirm no importer exists (defense against drift since grounding)**
      Run: `grep -rln "settings-data-source-model" apps/web/src apps/web tests --include=*.ts --include=*.tsx`
      Expected: only `tests/unit/web-settings-data-source-model.test.ts` and the source file itself.

- [ ] **Step 2: Delete both files**

```bash
git rm apps/web/src/settings/settings-data-source-model.ts tests/unit/web-settings-data-source-model.test.ts
```

- [ ] **Step 3: Run full unit suite to confirm nothing else referenced it**
      Run: `pnpm vitest run`
      Expected: no new failures (any failure here means Step 1's grep missed an importer — investigate before proceeding, do not force-delete).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete orphaned settings-data-source-model (#752)"
```

Do NOT touch `packages/email/src/manifest.ts`'s `email.capture-tasks` behavior or the `email.briefings`/`calendar.briefings` double-rendering in this task — both are pre-existing color noted in the issue, not actionable checkboxes; call them out in the PR description as observed-but-deferred (removing a user-facing settings toggle or its declared behavior is a product call, not hygiene).

---

### Task 6 & 7: Document deferred items, no code change (#749, #678)

**Files:** None modified — these become PR description content only.

- [ ] **Step 1: Draft the PR description's "Deferred" section** (used verbatim in the wrap-up PR body):

```markdown
## Deferred (no code change)

- **#749** — `upsertPersonProjection`'s `ON CONFLICT` key is user-controlled `id` only
  (`packages/people/src/repository.ts:261-298`). RLS already blocks cross-user overwrite
  today. The issue frames this as worth a defense-in-depth look only _if_ the
  conflict-resolution logic changes later — no actionable gap exists today, so no change
  made here.
- **#678** — `SportsOverviewResponse.degraded` is set by the backend
  (`packages/sports/src/sports-service.ts`) but unread anywhere in `apps/web/src`. Removing
  a field from a shared API response contract is a small architecture call, not pure
  hygiene, so it's left in place and flagged for a future dead-code pass rather than
  decided unilaterally here.
```

No test steps — this task produces documentation only, verified by inclusion in the final PR body during wrap-up.

---

### Task 8: Add `is-active` styling coverage for sports team picker (#691)

**Files:**

- Modify: `packages/sports/src/settings/index.tsx` (export `SearchResults` and `CompetitionGroup`, currently unexported)
- Modify: `tests/unit/settings-sports-pane.test.tsx` (add 2 tests)

**Interfaces:**

- Produces: named exports `SearchResults` (props: `{ query, competitions, followsByKey, onToggle, pending }`) and `CompetitionGroup` (props: `{ competition, followsByKey, onToggle, pending, expanded, onToggleExpand }`) from `packages/sports/src/settings/index.tsx` — both already exist as internal function components with these exact prop shapes; only the `export` keyword is being added, no signature change.

This repo's convention for this file already exports pure helpers (`filterTeams`, `leagueMatches`) directly for unit testing — extend the same pattern to these two presentational components so they can be rendered standalone via `renderToString`, consistent with the no-jsdom convention (Global Constraints).

- [ ] **Step 1: Add `export` to the two component declarations**

In `packages/sports/src/settings/index.tsx`, change:

```tsx
function SearchResults(props: {
```

to:

```tsx
export function SearchResults(props: {
```

and change:

```tsx
function CompetitionGroup(props: {
```

to:

```tsx
export function CompetitionGroup(props: {
```

- [ ] **Step 2: Write the two new tests** — add to `tests/unit/settings-sports-pane.test.tsx`:

```ts
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import SportsSettings, {
  filterTeams,
  leagueMatches,
  SearchResults,
  CompetitionGroup
} from "../../packages/sports/src/settings/index.js";

// ... (keep existing imports/fixtures; TWO_LEAGUES already defined in this file)

describe("is-active styling coverage (#691)", () => {
  const epl = TWO_LEAGUES.find((c) => c.competitionKey === "epl")!;
  const followed = new Map([
    [
      "epl::team.ars",
      { id: "f1", competitionKey: "epl", teamKey: "team.ars", createdAt: "2026-01-01T00:00:00Z" }
    ]
  ]);

  it("marks a followed team is-active in search results, unfollowed team not", () => {
    const html = renderToString(
      createElement(SearchResults, {
        query: "premier",
        competitions: [epl],
        followsByKey: followed,
        onToggle: () => {},
        pending: false
      })
    );
    expect(html).toContain("is-active");
    expect(html).toMatch(/sp-team is-active/);
  });

  it("marks a followed team is-active in the expanded competition group, unfollowed team not", () => {
    const html = renderToString(
      createElement(CompetitionGroup, {
        competition: epl,
        followsByKey: followed,
        onToggle: () => {},
        pending: false,
        expanded: true,
        onToggleExpand: () => {}
      })
    );
    expect(html).toContain("is-active");
    expect(html).toMatch(/sp-team is-active/);
  });

  it("does not mark an unfollowed team is-active", () => {
    const html = renderToString(
      createElement(CompetitionGroup, {
        competition: epl,
        followsByKey: new Map(),
        onToggle: () => {},
        pending: false,
        expanded: true,
        onToggleExpand: () => {}
      })
    );
    expect(html).not.toContain("is-active");
  });
});
```

Note: `followsByKey`'s value type is `SportsFollowDto` per the component's prop type — check the exact field names on `SportsFollowDto` (`packages/shared` types) before finalizing the fixture object; the grounding above used `{ id, competitionKey, teamKey, createdAt }` matching the existing `FOLLOWS_KEY` fixtures already in this same test file (see the "marks a followed team active" test), so reuse that exact shape.

- [ ] **Step 3: Run to verify new tests pass**
      Run: `pnpm vitest run tests/unit/settings-sports-pane.test.tsx`
      Expected: all PASS, including the 3 new tests.

- [ ] **Step 4: Commit**

```bash
git add packages/sports/src/settings/index.tsx tests/unit/settings-sports-pane.test.tsx
git commit -m "test(sports): cover is-active styling in search-results and expanded-group views (#691)"
```

---

### Task 9: Full gate and PR

- [ ] **Step 1: Pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Fix anything red before proceeding.

- [ ] **Step 2: Rebase on latest main**

```bash
git fetch origin main && git rebase origin/main
```

- [ ] **Step 3: Full gate**

```bash
pnpm verify:foundation
```

Record the exit code. If CI is unavailable, this local run is the record of truth per CLAUDE.md.

- [ ] **Step 4: Push and open PR, then hand off to `coordinated-wrap-up`**

PR title: `chore: hygiene follow-ups from 2026-07-04 adversarial PR review (#758)`
PR body includes: summary of items 1-5 and 8 fixed, the Deferred section from Task 6/7, and `Closes #758` only if the coordinator confirms all 8 checkboxes should close the issue (defer to coordinator — deferred items 6/7 might mean the issue should stay open or get re-filed narrower; ask, don't assume).

## Self-Review Notes

- Coverage: all 8 issue items have a task (5 code-fix tasks, 1 test-only task, 1 documentation-only task covering 2 items).
- Task 2 (scoring.ts) explicitly flags "re-verify function structure before editing" since grounding for the exact surrounding code happened in a prior context window — this is intentional caution, not a placeholder.
- Task 3 introduces one new exported pure helper (`isValidQuietHoursTime`) — no signature drift risk since nothing else in the plan consumes it.
- Task 8's exports are additive-only (no behavior change to `SportsSettings` default export).
