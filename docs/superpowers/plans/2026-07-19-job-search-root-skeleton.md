# Job Search Root Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `coordinated-build` and
> `superpowers:test-driven-development` to implement this plan task-by-task. The generic
> `executing-plans` and `subagent-driven-development` skills are disabled for coordinated Jarv1s
> builds.

**Goal:** Land the #1197 root-only PR that gates first-run users and exposes exactly the Overview,
Matches, Monitors, and Profile tabs needed by the later Lane D screens and Lane E onboarding UI.

**Architecture:** Keep the existing module runtime, router, read-only tool client, store, authored
states, and legacy screen implementations intact for this root-only PR. `Root` reads
`job-search.onboarding.get-state`; a small pure `RootView` renders either a Lane E placeholder or
the four-tab shell. The temporary Matches route reuses the existing opportunities screen until
the next Lane D PR replaces it, while accepting legacy `/opportunities/*` links so this PR remains
fully functional.

**Tech Stack:** TypeScript, host-provided React runtime, Vitest `renderToString`, Playwright mocked
e2e, esbuild external-module bundle.

---

## Verified branch state

- Branch `feat/1197-job-search-web` starts at current `origin/main` commit `d25d84e1`.
- `root.tsx` currently exposes five legacy tabs: Overview, Onboarding, Profile & resume, Monitors,
  Opportunities. It does not gate on `onboarding.get-state`.
- `kit.tsx` and `screens/matches.tsx` do not exist. The root-only PR must therefore retain the
  existing opportunities implementation behind the new Matches tab until the screen PR lands.
- `starter-drafts.ts`, old `screens/onboarding.tsx`, `screens/opportunities.tsx`, and
  `screens/opportunity-detail.tsx` still exist. Their deletion belongs to the later screen PR, not
  this dependency-unblocking root PR.
- Existing js06 tests assume mid-onboarding users can see the tab shell. They must be inverted:
  done users exercise the shell; first-run users see only the placeholder.

## Files

- Modify: `external-modules/job-search/src/web/root.tsx`
- Modify: `tests/unit/job-search-web-screens.test.tsx`
- Modify: `tests/e2e/js06-module-surface.spec.ts`

No shared host files, module contract files, styles, or screen files change in this PR.

### Task 1: Pin the new root contract with failing unit tests

**Files:**

- Modify: `tests/unit/job-search-web-screens.test.tsx`

- [ ] **Step 1: Import the pure root view**

Add this import beside the existing module web imports:

```ts
import { RootView } from "../../external-modules/job-search/src/web/root.js";
```

- [ ] **Step 2: Replace the legacy root-nav test with done and first-run cases**

Keep the contract-version test, then replace `Root renders module chrome and tab nav` with:

```ts
it("renders exactly the four approved tabs after onboarding", () => {
  const html = render(
    h(RootView, {
      path: "/",
      onboardingStep: "done",
      hostActions: { openAssistant: () => undefined }
    })
  );

  expect(html).toContain("Job Search");
  expect(html).toContain('aria-current="page"');
  for (const label of ["Overview", "Matches", "Monitors", "Profile"]) {
    expect(html).toContain(label);
  }
  for (const retired of ["Onboarding", "Profile &amp; resume", "Opportunities"]) {
    expect(html).not.toContain(retired);
  }
  expect(html).toContain('aria-live="polite"');
});

it("replaces the tab shell with the Lane E placeholder during first run", () => {
  const html = render(
    h(RootView, {
      path: "/",
      onboardingStep: "profile",
      hostActions: { openAssistant: () => undefined }
    })
  );

  expect(html).toContain("Setting up your job search");
  expect(html).toContain("Guided onboarding will appear here");
  expect(html).not.toContain("Job Search sections");
  expect(html).not.toContain('href="/m/job-search/matches"');
});
```

- [ ] **Step 3: Run the focused unit test and verify RED**

Run:

```bash
pnpm vitest run tests/unit/job-search-web-screens.test.tsx
```

Expected: FAIL because `RootView` is not exported and the root still renders legacy tabs without a
first-run gate.

### Task 2: Implement the minimum gated root shell

**Files:**

- Modify: `external-modules/job-search/src/web/root.tsx`

- [ ] **Step 1: Add the read query and state gate imports**

Keep existing runtime/router/styles/live-region imports. Add:

```ts
import { useToolQuery } from "./store";
import { outcomeGate } from "./states";
```

Remove the `OnboardingScreen` import. Keep legacy screen imports for this root-only PR.

- [ ] **Step 2: Replace the tab table and active-tab mapping**

Use the approved labels and routes, with one temporary legacy alias:

```ts
const TABS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Overview" },
  { to: "/matches", label: "Matches" },
  { to: "/monitors", label: "Monitors" },
  { to: "/profile", label: "Profile" }
];

function activeTab(path: string): string {
  if (path === "/") return "/";
  const first = `/${path.split("/")[1] ?? ""}`;
  // #1197: keep old opportunity-card links alive until the Matches rewrite lands.
  if (first === "/opportunities") return "/matches";
  return TABS.some((tab) => tab.to === first) ? first : "/";
}
```

- [ ] **Step 3: Route Matches through the current read-only opportunities screen**

Replace `RouteSwitch` with:

```tsx
function RouteSwitch(props: { path: string; hostActions: HostActions }): ReactNodeLike {
  const tab = activeTab(props.path);
  if (tab === "/matches") return <OpportunitiesScreen path={props.path} />;
  if (tab === "/monitors") return <MonitorsScreen />;
  if (tab === "/profile") return <ProfileScreen hostActions={props.hostActions} />;
  return <OverviewScreen hostActions={props.hostActions} />;
}
```

`OpportunitiesScreen` already parses bucket/hash by segment position, so both `/matches/*` and its
own temporary `/opportunities/*` links remain valid without changing that screen.

- [ ] **Step 4: Add the explicit Lane E placeholder and pure root view**

Add before `Root`:

```tsx
function FirstRunPlaceholder(): ReactNodeLike {
  return (
    <section className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">First run</span>
      <h1>Setting up your job search</h1>
      {/* #1193/#1197: Lane E replaces this dependency-safe placeholder with JobsOnboarding. */}
      <p>Guided onboarding will appear here.</p>
    </section>
  );
}

export function RootView(props: {
  path: string;
  onboardingStep: string;
  hostActions: HostActions;
}): ReactNodeLike {
  if (props.onboardingStep !== "done") {
    return (
      <div className="jsm-root" data-module="job-search">
        <style>{MODULE_STYLES}</style>
        <LiveRegion />
        <FirstRunPlaceholder />
      </div>
    );
  }

  const current = activeTab(props.path);
  return (
    <div className="jsm-root" data-module="job-search">
      <style>{MODULE_STYLES}</style>
      <LiveRegion />
      <header className="jsm-header">
        <span className="jds-eyebrow">Module</span>
        <h1>Job Search</h1>
      </header>
      <nav className="jsm-nav" aria-label="Job Search sections">
        {TABS.map((tab) => (
          <ModuleLink
            key={tab.to}
            to={tab.to}
            className={`jds-btn jds-btn--ghost jds-btn--sm${current === tab.to ? " jds-btn--secondary" : ""}`}
            aria-current={current === tab.to ? "page" : undefined}
          >
            {tab.label}
          </ModuleLink>
        ))}
      </nav>
      <RouteSwitch path={props.path} hostActions={props.hostActions} />
    </div>
  );
}
```

- [ ] **Step 5: Make `Root` fetch durable state and delegate to `RootView`**

Replace the existing `Root` body with:

```tsx
export function Root(props: { hostActions: HostActions }): ReactNodeLike {
  const path = useModulePath();
  const onboarding = useToolQuery<{ step: string } & Record<string, unknown>>(
    "job-search.onboarding.get-state"
  );
  return outcomeGate(
    onboarding,
    (state) => <RootView path={path} onboardingStep={state.step} hostActions={props.hostActions} />,
    { loadingLabel: "Loading job search" }
  );
}
```

- [ ] **Step 6: Run focused unit tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit the green root and unit-test slice**

```bash
git add docs/superpowers/plans/2026-07-19-job-search-root-skeleton.md \
  external-modules/job-search/src/web/root.tsx \
  tests/unit/job-search-web-screens.test.tsx
git commit -m "feat(job-search): gate the redesigned module shell" \
  -m "Job Search now reserves first-run setup for the guided onboarding and shows Overview, Matches, Monitors, and Profile after setup." \
  -m "Part of #1193" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3: Rewrite root-level mocked e2e coverage

**Files:**

- Modify: `tests/e2e/js06-module-surface.spec.ts`

- [ ] **Step 1: Define completed durable state for shell scenarios**

Add beside monitor fixtures:

```ts
const onboardingDone = {
  step: "done",
  completed: {
    resume_intake: true,
    resume_critique: true,
    resume_approval: true,
    profile: true,
    sources_schedule: true,
    review_enable: true
  },
  gates: { resumeApproved: true, profileApproved: true, monitorEnabled: true }
};
```

- [ ] **Step 2: Make shell tests done-by-default without changing shared mocks**

Inside `mountModule`, replace the final module-mock call with:

```ts
await mockExternalWebModuleFromDist(page, {
  ...options,
  invokeFixtures: {
    "job-search.onboarding.get-state": onboardingDone,
    ...options?.invokeFixtures
  }
});
```

This avoids changing `tests/e2e/mock-modules.ts`, which is shared with other concurrent lanes.

- [ ] **Step 3: Replace the obsolete onboarding-handoff scenario**

Delete `#916 onboarding handoff: editable focused draft, never auto-submitted`. Add:

```ts
test("first-run state replaces every tab with the Lane E placeholder", async ({ page }) => {
  await mountModule(page, {
    invokeFixtures: {
      "job-search.onboarding.get-state": {
        step: "profile",
        completed: { resume_intake: true, resume_critique: true, resume_approval: true },
        gates: { resumeApproved: true, profileApproved: false, monitorEnabled: false }
      }
    }
  });

  await page.goto("/m/job-search");

  await expect(page.getByRole("heading", { name: "Setting up your job search" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
  for (const label of ["Overview", "Matches", "Monitors", "Profile"]) {
    await expect(page.getByRole("link", { name: label })).toHaveCount(0);
  }
});
```

- [ ] **Step 4: Update shell labels and fail-closed navigation**

In the real-data test, assert visible links `Overview`, `Matches`, `Monitors`, and `Profile`; remove
the old `3 of 6 steps complete` assertion.

Replace the disabled-route click loop with direct routes, because a disabled/root-gated module
correctly exposes no navigation:

```ts
for (const path of ["", "/matches", "/monitors", "/profile"]) {
  await page.goto(`/m/job-search${path}`);
  await expect(disabledHeading.first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Job Search sections" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run now" })).toHaveCount(0);
}
```

- [ ] **Step 5: Keep root-PR screenshots focused on available legacy-backed screens**

Rename the screenshot test to `overview/monitors — ${theme}`. Remove the onboarding navigation and
screenshot block. Change its initial readiness assertion to the visible `Job Search` heading. Full
four-screen screenshots are added by the later screen PR.

- [ ] **Step 6: Run mocked Playwright and verify GREEN**

Run:

```bash
pnpm exec playwright test tests/e2e/js06-module-surface.spec.ts --project=chromium
```

Expected: PASS with the built real module bundle.

- [ ] **Step 7: Commit the green root e2e rewrite**

```bash
git add tests/e2e/js06-module-surface.spec.ts
git commit -m "test(job-search): cover the gated module shell" \
  -m "No additional user-visible changes; mocked browser coverage now follows the approved first-run and four-tab flow." \
  -m "Part of #1193" \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 4: Verify and commit the root-only PR slice

**Files:**

- Modify: `external-modules/job-search/src/web/root.tsx`
- Modify: `tests/unit/job-search-web-screens.test.tsx`
- Modify: `tests/e2e/js06-module-surface.spec.ts`

- [ ] **Step 1: Build the external module and run focused checks**

Run:

```bash
pnpm build:external:job-search
pnpm vitest run tests/unit/job-search-web-screens.test.tsx tests/unit/job-search-web-core.test.tsx
pnpm exec playwright test tests/e2e/js06-module-surface.spec.ts --project=chromium
```

Expected: all commands exit 0.

- [ ] **Step 2: Run required frontend and foundation gates**

Run:

```bash
pnpm check:design-tokens
pnpm verify:foundation
```

Expected: both commands exit 0.

- [ ] **Step 3: Confirm the diff is root-only and files stay below the size gate**

Run:

```bash
git diff --check
git diff --stat
wc -l external-modules/job-search/src/web/root.tsx
```

Expected: only the three planned files plus this approved plan are changed; `root.tsx` remains far
below 1000 lines.

- [ ] **Step 4: Confirm committed scope and clean tree**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: clean status and exactly the two planned green commits.

- [ ] **Step 5: Stop at the PR boundary**

Use `coordinated-wrap-up` to run the pre-push trio, rebase on fresh `origin/main`, rerun the full
gate, push, and open the root skeleton PR. PR body must contain the user-facing summary, testing
evidence, and `Part of #1193`. Do not begin kit/screen/deletion work until the coordinator confirms
this PR has landed and supplies the next branch/base instruction.

## Self-review

- Spec coverage: first-run durable-state gate, exact four-tab shell, root-first PR boundary,
  read-only module data access, module isolation, authored loading/disabled states, mocked e2e,
  bundle build, design-token check, and full foundation gate are covered.
- Deliberately deferred: `kit.tsx`, four Park Press screen rewrites, old-file deletions, sources.list
  rendering, and full screen screenshots. Adding them now would violate the handoff's root-only
  first PR and collide with Lane E's dependency point.
- Placeholder scan: no unresolved implementation steps. Lane E placeholder is explicit approved
  product behavior for this PR and carries its ownership comment.
- Type consistency: `RootView` uses the same `HostActions` contract as `Root`; durable root query
  needs only `step`; legacy screens retain their existing contracts.
