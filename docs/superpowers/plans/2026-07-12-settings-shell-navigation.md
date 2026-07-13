# Settings shell, navigation, and IA hardening (#986) — Implementation Plan

> **For agentic workers:** Execute task-by-task inline (superpowers execution skills are disabled
> in this repo by coordinated-build). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four #986 build slices: grouped shell IA, merged Account & preferences /
People & access destinations, URL-addressable configurable-module list/detail with a shared
back control, and a bounded/responsive rail.

**Architecture:** One grouped registry per mode (`PERSONAL_GROUPS`/`ADMIN_GROUPS`) flattened for
lookup/coercion, replacing today's flat `PERSONAL_SECTIONS`/`ADMIN_SECTIONS` arrays in
`settings-page.tsx`. Section state moves from consume-and-delete `?section=` to durable
`useSearchParams` history pushes. Module list/detail gets the same URL treatment via a new
`module` param contract. `ModuleSettingsRouter`'s success path grows a shared **Back to modules**
control. CSS changes are confined to `settings.css` (owned file); no pane-specific CSS files are
touched.

**Tech Stack:** React 18 + react-router `useSearchParams`, Vitest (jsdom + `renderToString`),
Playwright.

## Global Constraints (verbatim from spec, all reverified against `origin/main` `3ca138eb` on
this branch before writing this plan)

- Stable IDs: merged personal destination keeps id `profile`; merged admin destination keeps id
  `people`. Remove `general` and `identity` from every registry.
- `Account & preferences` and `People & access` remain permission-gated exactly as `profile`/
  `people` are today (`isInstanceAdmin`) — no auth/API change.
- URL is truth: `?section=<id>` pushes history; local storage is fallback-only for no-query loads.
- Module detail: `?section=modules&module=<id>`; **Back to modules** replaces (`replace: true`) to
  drop `module`; browser Back from detail restores the list.
- `ModuleSettingsRouter`'s successful-surface render path must gain the shared back control (the
  three fallback branches already have `RouterBackButton` — do not duplicate, factor it out).
- Modules list must show every current toggleable row **plus** required rows that have an
  implemented settings destination (legacy `CONFIG_IDS`, `CAT_BY_ID`, or a contributed surface
  with `hasEntry`). Required rows get no toggle switch.
- Keep `PaneHead`/`Group`/`Row`/`Field`/`Select`, serif/mono/sans conventions, `jds-*` tokens. No
  new component library or raw colors.
- File-size gate: 1000 lines/file. `settings-personal-data-panes.tsx` (906 lines) and
  `settings-admin-panes.tsx` (849 lines) are close to the ceiling — watch line count each edit;
  split into a focused file only if a task would cross 1000.
- Owned paths only (see spec collision map). Do **not** touch `InstanceModulesPane`, external-module
  job files, or `#1000` harness/selector code.

---

## File Structure

| File | Change |
| --- | --- |
| `apps/web/src/settings/settings-navigation.ts` | Add `SettingsSectionGroup<Id>` type + `flattenSettingsGroups` helper (pure, reused by both modes). `coerceSettingsSectionId` unchanged. |
| `apps/web/src/settings/settings-page.tsx` | Replace flat `PERSONAL_SECTIONS`/`ADMIN_SECTIONS` with `PERSONAL_GROUPS`/`ADMIN_GROUPS` (+ flattened derivations). Drop `general`/`identity` types and imports. Section selection pushes `?section=` via `setSearchParams` (no more consume-and-delete `useEffect`); initial render reads `searchParams.get("section")` directly, falling back to storage, falling back to first section. Non-admin URL to an admin id renders personal fallback (admin pane never mounts). Nav renders one group label + its buttons per group (replacing the single "Personal settings"/"Admin / Setup" heading div). |
| `apps/web/src/settings/settings-personal-panes.tsx` | Rename pane heading "Profile & account" → "Account & preferences"; append the moved General content (Locale, Quiet hours) after existing Sessions/Export/Delete order per spec's Account & preferences ordering (Identity → Account → Locale → Quiet hours → Sessions/export/delete). |
| `apps/web/src/settings/settings-personal-data-panes.tsx` | Remove `GeneralPane` (content moved to `settings-personal-panes.tsx`; delete the export). `ModulesPane`: switch `view` local state to be driven by `?module=` in the URL (push on open, `replace` delete on explicit back, browser Back already restores via popstate since it's a real URL param now); replace `visibleUserToggleModules` call with new `visibleConfigurableModules` + local `hasImplementedSettings` predicate; pass `onBack` through to `ModuleSettingsRouter` unchanged (router now renders the control itself). If this file would cross 1000 lines after moving General content in, split `GeneralPane`'s old body was already deleted (net negative), so no split needed — recheck line count at the end of Task 4. |
| `apps/web/src/settings/settings-admin-panes.tsx` | `PeoplePane`: append registration controls (from `IdentityPane`) as a new "Registration" `Group` before "Pending approval", update heading if needed (stays "People & access"). Delete `IdentityPane` export and its auth-provider negative note. |
| `apps/web/src/settings/settings-module-view-model.ts` | Replace `visibleUserToggleModules` with `visibleConfigurableModules(modules, hasImplementedSettings)`. |
| `packages/settings-ui/src/router.tsx` | Factor `RouterBackButton` call into the successful-surface branch of `ModuleSettingsRouter` (render it above `<Surface>` inside the same wrapper, matching the fallback branches' pattern). |
| `apps/web/src/styles/settings.css` | Bound `.set2__nav` height with `overflow-y: auto` at desktop widths; keep focus-visible outline reachable inside the scroll container; widen/relax `.pane__desc`/`.fld__hint`/`.fld__row > input` max-widths so they use the detail column instead of a fixed ch-cap well short of `.set2__pane`'s available width. |
| `tests/unit/web-settings-navigation.test.ts` | Add coverage for grouped flatten helper + URL-truth coercion (non-admin admin-id fallback). |
| `tests/unit/web-settings-module-view-model.test.ts` | Replace `visibleUserToggleModules` tests with `visibleConfigurableModules` cases: required+implemented visible, required+no-destination hidden, toggle rows unaffected. |
| `tests/unit/settings-page-priorities.test.tsx` | Update string assertions for new group labels ("Your account" nav group replaces "Personal settings"); keep the two existing admin/non-admin assertions passing. |
| `tests/e2e/settings-shell.spec.ts` | New file — the five Playwright scenarios from spec §Automated acceptance. |

---

## Task 1: Grouped registry types + flatten helper

**Files:**
- Modify: `apps/web/src/settings/settings-navigation.ts`
- Test: `tests/unit/web-settings-navigation.test.ts`

**Interfaces:**
- Produces: `interface SettingsSectionGroup<Section extends SettingsSectionLike> { readonly label: string; readonly sections: readonly Section[] }` and `function flattenSettingsGroups<Section extends SettingsSectionLike>(groups: readonly SettingsSectionGroup<Section>[]): readonly Section[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/web-settings-navigation.test.ts — add below existing describe block
import { flattenSettingsGroups } from "../../apps/web/src/settings/settings-navigation.js";

describe("settings group flattening", () => {
  it("flattens groups in declared order", () => {
    const groups = [
      { label: "A", sections: [{ id: "one" }, { id: "two" }] },
      { label: "B", sections: [{ id: "three" }] }
    ];
    expect(flattenSettingsGroups(groups).map((s) => s.id)).toEqual(["one", "two", "three"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/web-settings-navigation.test.ts`
Expected: FAIL — `flattenSettingsGroups` not exported.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/settings/settings-navigation.ts — append
export interface SettingsSectionGroup<Section extends SettingsSectionLike> {
  readonly label: string;
  readonly sections: readonly Section[];
}

export function flattenSettingsGroups<Section extends SettingsSectionLike>(
  groups: readonly SettingsSectionGroup<Section>[]
): readonly Section[] {
  return groups.flatMap((group) => group.sections);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/web-settings-navigation.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-navigation.ts tests/unit/web-settings-navigation.test.ts
git commit -m "feat(settings): add grouped-registry flatten helper"
```

## Task 2: Module view-model — configurable visibility

**Files:**
- Modify: `apps/web/src/settings/settings-module-view-model.ts`
- Test: `tests/unit/web-settings-module-view-model.test.ts`

**Interfaces:**
- Consumes: `SettingsModule` (existing).
- Produces: `function visibleConfigurableModules(modules: readonly SettingsModule[], hasImplementedSettings: (module: SettingsModule) => boolean): readonly SettingsModule[]` — replaces `visibleUserToggleModules` (delete it; only ModulesPane and this test import it).

- [ ] **Step 1: Write the failing test** — replace the existing "keeps the personal module switcher to additional modules only" test:

```ts
it("shows toggleable rows plus required rows with an implemented settings destination", () => {
  const hasSettings = (m: SettingsModule) => m.id === "briefings";
  const visible = visibleConfigurableModules(
    [
      moduleRow({ id: "briefings", name: "Briefings", required: true }),
      moduleRow({ id: "chat", name: "Chat", required: true }),
      moduleRow({ id: "sports", name: "Sports" }),
      moduleRow({ id: "finance", name: "Finance" })
    ],
    hasSettings
  );
  expect(visible.map((m) => m.name)).toEqual(["Briefings", "Sports", "Finance"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/web-settings-module-view-model.test.ts`
Expected: FAIL — `visibleConfigurableModules` not exported.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/settings/settings-module-view-model.ts — replace visibleUserToggleModules
export function visibleConfigurableModules(
  modules: readonly SettingsModule[],
  hasImplementedSettings: (module: SettingsModule) => boolean
): readonly SettingsModule[] {
  return modules.filter((module) => !module.required || hasImplementedSettings(module));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/web-settings-module-view-model.test.ts`
Expected: PASS (all cases, including untouched `settingsModuleControlModel` tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-module-view-model.ts tests/unit/web-settings-module-view-model.test.ts
git commit -m "feat(settings): show required modules with implemented settings destinations"
```

## Task 3: Router — shared Back to modules on the success path

**Files:**
- Modify: `packages/settings-ui/src/router.tsx`
- Test: `tests/unit/module-settings-router.test.tsx` (existing — extend, don't replace)

- [ ] **Step 1: Write the failing test** — read `tests/unit/module-settings-router.test.tsx` first to match its existing mock/render pattern, then add:

```tsx
it("renders the shared back control when a surface loads successfully", async () => {
  // follow the file's existing render/mount pattern for a successful surface case,
  // then assert:
  expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/module-settings-router.test.tsx`
Expected: FAIL — no "Back" button rendered on the success path today.

- [ ] **Step 3: Implement** — wrap the successful-surface return in `ModuleSettingsRouter`:

```tsx
// packages/settings-ui/src/router.tsx — replace the final return block (lines ~52-64)
return (
  <ModuleSettingsErrorBoundary surface={surface} onBack={props.onBack}>
    <RouterBackButton onBack={props.onBack} />
    <Suspense
      fallback={<RouterPaneHead title={`${surface.moduleName} settings`} desc="Loading…" />}
    >
      <Surface
        onBack={props.onBack}
        onSelectSection={props.onSelectSection}
        onNavigate={props.onNavigate}
      />
    </Suspense>
  </ModuleSettingsErrorBoundary>
);
```

Note: `RouterBackButton` is defined below in the same file already (used by the three fallback
functions) — no new import needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/module-settings-router.test.tsx`
Expected: PASS. Also run `pnpm test:unit -- tests/unit/module-settings-ui-contract.test.ts` and
`tests/unit/module-settings-deep-link.test.ts` to confirm no regression — those are outside this
task's file list but exercise the same router.

- [ ] **Step 5: Commit**

```bash
git add packages/settings-ui/src/router.tsx tests/unit/module-settings-router.test.tsx
git commit -m "feat(settings-ui): shared Back to modules control on the loaded-surface path"
```

## Task 4: Merge Account & preferences (personal) and remove General

**Files:**
- Modify: `apps/web/src/settings/settings-personal-panes.tsx`
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx` (delete `GeneralPane` + its now-unused imports: `getLocaleSettings`, `putLocaleSettings`, `getQuietHoursSettings`, `putQuietHoursSettings`, `DEFAULT_LOCALE_SETTINGS`, `DEFAULT_QUIET_HOURS`, `LocaleSettingsDto`, `QuietHoursSettingsDto`, `isValidQuietHoursTime` stays only if still used elsewhere in the file — grep before deleting)
- Test: `tests/unit/settings-page-priorities.test.tsx` (no change needed yet — group-label rename is Task 6)

- [ ] **Step 1: Write the failing test** — add to a settings-personal-panes test file if one exists, else create `tests/unit/settings-personal-panes.test.tsx` following the `renderToString` pattern from `settings-page-priorities.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ProfilePane } from "../../apps/web/src/settings/settings-personal-panes.js";

describe("ProfilePane merged Account & preferences", () => {
  it("renders locale and quiet hours alongside identity/account", () => {
    const html = renderToString(
      <ProfilePane
        me={{
          user: { id: "u1", email: "u@example.test", emailVerified: true, name: "U", status: "active", isInstanceAdmin: false, isBootstrapOwner: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
          profilePrefs: { addressed: null },
          hasPasswordCredential: true
        }}
        onNavigate={() => {}}
      />
    );
    expect(html).toContain("Account & preferences");
    expect(html).toContain("Quiet hours");
    expect(html).not.toContain("Auth provider configuration");
  });
});
```

(Wrap in whatever QueryClientProvider the existing pane tests use — check `settings-people-pane.test.tsx` or `settings-quiet-hours-pane.test.tsx` for the required test harness/providers before finalizing this step; those panes already query the same endpoints.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/settings-personal-panes.test.tsx`
Expected: FAIL — "Account & preferences" / "Quiet hours" not present in `ProfilePane` output yet.

- [ ] **Step 3: Implement** — in `settings-personal-panes.tsx`: change `PaneHead title="Profile & account"` to `title="Account & preferences"`; move the `Locale` and `Quiet hours` `Group`s (with their queries/mutations) from the old `GeneralPane` body into `ProfilePane`, inserted after the "Account" `Group` and before `<Sessions />`, per spec order (Identity → Account → Locale → Quiet hours → Sessions/export/delete). Import `getLocaleSettings`, `putLocaleSettings`, `getQuietHoursSettings`, `putQuietHoursSettings`, `DEFAULT_LOCALE_SETTINGS`, `DEFAULT_QUIET_HOURS`, `isValidQuietHoursTime`, `Select`, `Switch` into this file. Then delete `GeneralPane` entirely from `settings-personal-data-panes.tsx` and its export.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/settings-personal-panes.test.tsx`
Expected: PASS. Then run the full settings unit suite to catch any other file importing `GeneralPane`:

Run: `grep -rn "GeneralPane" apps/web/src tests` — must return zero results outside this commit's diff before proceeding.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-personal-panes.tsx apps/web/src/settings/settings-personal-data-panes.tsx tests/unit/settings-personal-panes.test.tsx
git commit -m "feat(settings): merge General into Account & preferences"
```

## Task 5: Merge People & access (admin) and remove Identity

**Files:**
- Modify: `apps/web/src/settings/settings-admin-panes.tsx`
- Test: `tests/unit/settings-admin-panes.test.tsx` (extend existing)

- [ ] **Step 1: Write the failing test** — read `tests/unit/settings-admin-panes.test.tsx` first for its render harness, then add an assertion that `PeoplePane`'s output contains "Allow new registrations" and does not contain "Auth provider configuration".

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:unit -- tests/unit/settings-admin-panes.test.tsx`
Expected: FAIL — registration controls not present in `PeoplePane` yet.

- [ ] **Step 3: Implement** — in `settings-admin-panes.tsx`: add a `Group title="Registration"` (the two `Row`s + `Switch`es from `IdentityPane`, using the same `regQuery`/`putMutation` wiring) as the first `Group` inside `PeoplePane`, before "Pending approval". Delete `IdentityPane` and its now-unused imports (`Terminal` icon, `getRegistrationSettings`/`putRegistrationSettings` move into `PeoplePane`'s existing imports if not already there).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:unit -- tests/unit/settings-admin-panes.test.tsx`
Expected: PASS. Then: `grep -rn "IdentityPane" apps/web/src tests` — zero results outside this diff.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-admin-panes.tsx tests/unit/settings-admin-panes.test.tsx
git commit -m "feat(settings): merge Identity registration into People & access"
```

## Task 6: Grouped shell registries + durable URL section state

**Files:**
- Modify: `apps/web/src/settings/settings-page.tsx`
- Test: `tests/unit/settings-page-priorities.test.tsx`

- [ ] **Step 1: Write the failing tests** — extend the existing describe block:

```tsx
it("renders the four personal group labels and drops merged/removed ids", () => {
  const html = renderToString(
    <MemoryRouter initialEntries={["/settings"]}>
      <SettingsPage me={{ user: { /* non-admin, same shape as existing test */ id: "user-1", email: "user@example.test", emailVerified: true, name: "User", status: "active", isInstanceAdmin: false, isBootstrapOwner: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }, profilePrefs: { addressed: null }, hasPasswordCredential: false }} />
    </MemoryRouter>
  );
  expect(html).toContain("Your account");
  expect(html).toContain("Jarvis");
  expect(html).toContain("Connections");
  expect(html).toContain("Extensions");
  expect(html).toContain("Account &amp; preferences");
  expect(html).not.toContain(">General<");
});

it("renders the three admin group labels and drops the Identity destination", () => {
  const html = renderToString(
    <MemoryRouter initialEntries={["/settings?section=people"]}>
      <SettingsPage me={adminMe} />
    </MemoryRouter>
  );
  expect(html).toContain("Access");
  expect(html).toContain("AI &amp; extensions");
  expect(html).toContain("Operations");
  expect(html).not.toContain("Identity &amp; registration");
});

it("falls back to a permitted personal section when a non-admin URL requests an admin id", () => {
  const html = renderToString(
    <MemoryRouter initialEntries={["/settings?section=people"]}>
      <SettingsPage me={{ user: { id: "user-1", email: "user@example.test", emailVerified: true, name: "User", status: "active", isInstanceAdmin: false, isBootstrapOwner: false, createdAt: "2026-06-01T00:00:00.000Z", updatedAt: "2026-06-01T00:00:00.000Z" }, profilePrefs: { addressed: null }, hasPasswordCredential: false }} />
    </MemoryRouter>
  );
  expect(html).toContain("Account &amp; preferences");
  expect(html).not.toContain("People &amp; access");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- tests/unit/settings-page-priorities.test.tsx`
Expected: FAIL on all three new cases against today's flat single-heading registry.

- [ ] **Step 3: Implement** in `settings-page.tsx`:
  - Remove `"general"` from `PersonalSectionId` and `"identity"` from `AdminSectionId`.
  - Replace `PERSONAL_SECTIONS`/`ADMIN_SECTIONS` arrays with grouped arrays using
    `SettingsSectionGroup` from `settings-navigation.ts`, matching spec's Final IA tables exactly
    (group labels and destination order as given in spec lines 84-99). Derive
    `PERSONAL_SECTIONS = flattenSettingsGroups(PERSONAL_GROUPS)` and same for admin, used
    unchanged by `coerceSettingsSectionId`, `sections.find`, etc.
  - Drop `GeneralPane`/`IdentityPane` lazy imports; rename `ProfilePane`'s section label to
    "Account & preferences" (label lives in the registry entry, not the pane itself).
  - Replace the consume-and-delete `useEffect` for `?section=` with: on mount and on every
    `searchParams` change, derive `active` directly from `coerceSettingsSectionId` over
    `searchParams.get("section")` (admin ids only honored when `isAdmin`); `setActiveSection`
    calls `setSearchParams({ section: id }, ...)` — no `replace`, so each pick is a history entry.
    Keep local-storage read/write as the fallback path only (when there is no `section` param on
    initial load — write mode/category to storage same as today for the no-query case).
  - Render nav as: for each group in the active mode's groups, a `<div className="set2__navgroup">{group.label}</div>` followed by that group's section buttons (same button JSX as today, unchanged classNames).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- tests/unit/settings-page-priorities.test.tsx`
Expected: PASS all 5 cases (2 existing + 3 new). Also run
`pnpm test:unit -- tests/unit/web-settings-storage.test.ts tests/unit/web-settings-admin-policy.test.ts`
to confirm no storage/policy regression.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/settings/settings-page.tsx tests/unit/settings-page-priorities.test.tsx
git commit -m "feat(settings): grouped shell registries with durable URL section state"
```

## Task 7: Module list/detail URL contract + configurable visibility wiring

**Files:**
- Modify: `apps/web/src/settings/settings-personal-data-panes.tsx`
- Test: `tests/unit/module-settings-deep-link.test.ts` (existing — extend) + a new focused case in `tests/unit/web-settings-module-view-model.test.ts` is already covered by Task 2; this task is about `ModulesPane` wiring itself, covered by the Playwright spec (Task 9) since it needs full router + query mocking. Add one lean unit case if `ModulesPane` has an existing render test file — check first with `grep -rln "ModulesPane" tests/unit`.

- [ ] **Step 1** (grounding, not a test): confirm whether `ModulesPane` has a dedicated unit test today via
`grep -rln "ModulesPane" tests/unit`. If none, this task's correctness is verified by Task 9's
Playwright spec — skip to Step 2.

- [ ] **Step 2: Implement** in `settings-personal-data-panes.tsx`:
  - Add `const CONTRIBUTED_REQUIRED_CHECK` style local `hasImplementedSettings` closure (defined
    after `CONFIG_IDS`/`CAT_BY_ID`/`CONTRIBUTED_SETTINGS_MODULE_IDS`, before `ModulesPane`):
    ```ts
    function hasImplementedModuleSettings(module: SettingsModule): boolean {
      if (CONFIG_IDS.has(module.id)) return true;
      if (CAT_BY_ID[module.id]) return true;
      return (
        CONTRIBUTED_SETTINGS_MODULE_IDS.has(module.id) &&
        Boolean(findModuleSettingsEntrySurface(module.id, MODULE_SETTINGS_SURFACES))
      );
    }
    ```
  - Replace `const modules = visibleUserToggleModules(...)` with
    `visibleConfigurableModules(myQuery.data?.modules ?? [], hasImplementedModuleSettings)`.
  - Replace the `import { settingsModuleControlModel, visibleUserToggleModules }` line with
    `visibleConfigurableModules`.
  - Add a "Required" badge for `control.kind === "required"` in `renderRow`'s badge ternary
    (`<Badge tone="neutral">Required</Badge>`), so required-but-configurable rows read distinctly
    from optional ones.
  - Rework `view` state to carry through the URL instead of only reading it once: keep the
    existing "hydrate from `?module=` on mount" `useEffect` as-is (already pushes/deletes
    correctly per spec's replace semantics), but additionally push `?module=<id>` (not replace)
    when `setView` opens a legacy (`ModuleSub`) or contributed (`{moduleId}`) detail — add a
    `openModule(id: string)` helper that calls both `setView` and
    `setSearchParams({ ...current, module: id })`, and use it in place of the three inline
    `setView(...)` calls in `renderRow`'s action handlers. Keep "Back to modules" and "select
    Modules from nav" clearing `module` via `replace`.

- [ ] **Step 3: Verify** — this task's correctness is exercised by Task 9 Playwright coverage
(list/detail URL contract scenario). Run existing regression first:

Run: `pnpm test:unit -- tests/unit/module-settings-deep-link.test.ts`
Expected: PASS (deep-link resolution logic untouched).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/settings/settings-personal-data-panes.tsx
git commit -m "feat(settings): URL-addressable module list/detail with configurable visibility"
```

## Task 8: Bounded rail + shared detail-width CSS

**Files:**
- Modify: `apps/web/src/styles/settings.css`

- [ ] **Step 1** (no unit test — layout is verified by Task 9 Playwright at 1280x640 and 390x844):
  read the full current file once more before editing to avoid clobbering unrelated rules already
  read in this session (lines 1-339 already captured above).

- [ ] **Step 2: Implement**
  - In the `.set2__nav` desktop rule (line ~93), add:
    ```css
    .set2__nav {
      position: sticky;
      top: 16px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: calc(100vh - 32px);
      overflow-y: auto;
    }
    ```
  - Ensure `.set2__navitem:focus-visible` (find/confirm its existing rule) is not clipped by the
    new `overflow-y: auto` — scrollable containers don't clip `:focus-visible` outlines by default
    as long as no `overflow: hidden` sibling wraps it; confirm visually in Task 9.
  - Relax `.pane__desc` (line 218) from `max-width: 62ch` and `.fld__hint` (line 307) from
    `max-width: 60ch` to `max-width: 72ch` — wide enough to use more of `.set2__pane`'s available
    width on desktop without becoming full-bleed at very wide viewports (`.set2` itself caps at
    `max-width: 1080px`, so 72ch stays well inside that).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/styles/settings.css
git commit -m "fix(settings): bound rail scroll and widen shared detail-pane text measure"
```

## Task 9: Playwright acceptance spec

**Files:**
- Create: `tests/e2e/settings-shell.spec.ts`
- Reuse: `tests/e2e/mock-api.ts`, `tests/e2e/mock-modules.ts` (read both in full before writing —
  `mockApi`'s `authenticated`/admin-fixture shape and `mockExternalModules`'s module fixture shape
  are the two things this spec depends on; `tests/e2e/settings-modules.spec.ts` is a working
  reference for the `mockApi`/admin-flow pattern).

- [ ] **Step 1: Write the five scenarios from spec §Automated acceptance → Playwright E2E**
  (desktop 1440x900 nav+merge assertions; short-desktop 1280x640 keyboard rail reachability;
  narrow 390x844 reachability/no-overflow; permission regression; modules list/detail URL
  contract with Briefings/Chat/Notifications + one contributed module fixture). Use
  `page.setViewportSize` per scenario or Playwright `test.use({ viewport })` per `test.describe`
  block. Assert via `getByRole`/`getByLabel`, never CSS selectors, per spec.

- [ ] **Step 2: Run against the built app**

Run: `pnpm playwright test tests/e2e/settings-shell.spec.ts`
Expected: PASS in Chromium at all three viewports once Tasks 1-8 are complete. If it fails, fix
the implementation task, not the test — the spec's scenarios are the source of truth.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/settings-shell.spec.ts
git commit -m "test(e2e): settings shell IA, URL navigation, and module list/detail acceptance"
```

## Task 10: Verification gate

- [ ] Run in order, fix red before proceeding, do not skip any:

```bash
pnpm prettier --check apps/web/src/settings/*.tsx apps/web/src/settings/*.ts apps/web/src/styles/settings.css packages/settings-ui/src/router.tsx tests/unit/web-settings-navigation.test.ts tests/unit/web-settings-module-view-model.test.ts tests/unit/settings-page-priorities.test.tsx tests/unit/settings-admin-panes.test.tsx tests/e2e/settings-shell.spec.ts
pnpm lint
pnpm check:file-size
pnpm check:design-tokens
pnpm typecheck
pnpm test:unit -- tests/unit/web-settings-navigation.test.ts tests/unit/web-settings-module-view-model.test.ts tests/unit/settings-page-priorities.test.tsx tests/unit/settings-admin-panes.test.tsx tests/unit/module-settings-router.test.tsx tests/unit/module-settings-deep-link.test.ts tests/unit/module-settings-ui-contract.test.ts tests/unit/web-settings-storage.test.ts tests/unit/web-settings-admin-policy.test.ts tests/unit/settings-people-pane.test.tsx tests/unit/settings-quiet-hours-pane.test.tsx
pnpm playwright test tests/e2e/settings-shell.spec.ts
pnpm verify:foundation
```

- [ ] **Commit** any formatting fixes, then proceed to `coordinated-wrap-up` (open PR, report to
  UX Coordinator). Never merge.

---

## Self-Review Notes

- Spec coverage: Slice 1 → Task 6; Slice 2 → Tasks 4-5; Slice 3 → Tasks 2-3, 7; Slice 4 → Tasks 8-9.
  Locked decisions 1-12 each map to at least one task above.
- Open verification needed at Task 4/5 Step 1: confirm the exact test-harness/provider wrapping
  used by sibling pane tests before writing new test files — flagged inline rather than guessed.
- Task 7's `ModulesPane` unit coverage is intentionally thin (delegated to Playwright) because the
  file already sits at 906 lines and duplicating router/query mocking in a new unit test risks
  crossing the file-size gate on the test side too; Playwright is the spec-mandated acceptance
  surface for this slice regardless.
