# User Custom Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Coordinated-build exception: do not dispatch subagents or use executing-plans in this repo; execute task-by-task after Coordinator approval. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create, save, select, and persist custom app color themes while keeping semantic red/amber/steel tokens locked.

**Architecture:** Use existing `app.preferences` KV storage through settings routes; no table or migration. Built-in light/dark remain CSS-owned themes selected by `data-theme`; custom themes store only aesthetic token overrides and apply them as CSS variables at runtime. Appearance ships as a normal personal settings pane because the Module Settings Connector is not present on this branch.

**Tech Stack:** Fastify settings routes, shared TypeScript DTO/schema contracts, React + TanStack Query settings pane, CSS custom properties, Vitest integration/unit tests.

---

## Verified Current State

- `apps/web/src/shell/theme-storage.ts` only accepts `"light" | "dark"` and rejects custom IDs.
- `apps/web/src/shell/app-shell.tsx` stores local shell theme state, sets `<html data-theme>`, and exposes only a dark-mode toggle in `RailUserMenu`.
- No `/api/me/themes*` routes, theme DTOs, Appearance pane, Coolors parser, or accent-ramp utility exist.
- `packages/settings/src/routes.ts` already registers preference-backed subroutes using `DataContextRunner` + `ProfilePreferencesPort`.
- `settingsModuleManifest.routes[]` has `/api/me/*` personal settings routes but no theme routes.
- Settings UI has no Module Settings Connector on this branch, so this plan adds `appearance` to the existing personal settings nav.
- `tokens.css` contains light/dark values and semantic red/amber/steel. Do not add raw color literals to component CSS. Custom user colors live in `app.preferences`; runtime JS applies them as CSS vars.

## Files

- Create: `packages/shared/src/themes-api.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/settings/src/themes-routes.ts`
- Modify: `packages/settings/src/routes.ts`
- Modify: `packages/settings/src/manifest.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/shell/theme-storage.ts`
- Create: `apps/web/src/theme/theme-runtime.ts`
- Modify: `apps/web/src/shell/app-shell.tsx`
- Create: `apps/web/src/settings/settings-appearance-pane.tsx`
- Modify: `apps/web/src/settings/settings-page.tsx`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/settings-panes-3.css`
- Modify: `tests/unit/web-shell-theme.test.ts`
- Create: `tests/unit/theme-runtime.test.ts`
- Create: `tests/integration/settings-themes.test.ts`

### Task 1: Shared Theme Contract

**Files:**

- Create: `packages/shared/src/themes-api.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write shared DTO and schema contract**

Create `packages/shared/src/themes-api.ts`:

```ts
import { errorResponseSchema } from "./schema-fragments.js";

export const AESTHETIC_THEME_TOKEN_KEYS = [
  "paper",
  "surface",
  "surface2",
  "surface3",
  "ink",
  "ink2",
  "ink3",
  "ink4",
  "line",
  "lineSubtle",
  "lineStrong",
  "accent"
] as const;

export type AestheticThemeTokenKey = (typeof AESTHETIC_THEME_TOKEN_KEYS)[number];
export type AestheticThemeTokens = Record<AestheticThemeTokenKey, string>;
export type BuiltInThemeId = "light" | "dark";

export interface BuiltInThemeDto {
  readonly id: BuiltInThemeId;
  readonly name: string;
  readonly builtIn: true;
}

export interface CustomThemeDto {
  readonly id: string;
  readonly name: string;
  readonly builtIn: false;
  readonly tokens: AestheticThemeTokens;
}

export interface ListThemesResponse {
  readonly builtIn: readonly BuiltInThemeDto[];
  readonly custom: readonly CustomThemeDto[];
  readonly activeId: string;
}

export interface PutActiveThemeRequest {
  readonly id: string;
}

export interface PutCustomThemeRequest {
  readonly name?: string;
  readonly tokens?: Partial<AestheticThemeTokens>;
}

export interface PutCustomThemeResponse {
  readonly theme: CustomThemeDto;
}

export interface DeleteCustomThemeResponse {
  readonly deletedThemeId: string;
}

const colorValueSchema = {
  type: "string",
  pattern:
    "^(#[0-9a-fA-F]{6}|rgb\\((25[0-5]|2[0-4]\\d|1?\\d?\\d),\\s*(25[0-5]|2[0-4]\\d|1?\\d?\\d),\\s*(25[0-5]|2[0-4]\\d|1?\\d?\\d)\\))$"
} as const;

export const aestheticThemeTokensSchema = {
  type: "object",
  additionalProperties: false,
  required: [...AESTHETIC_THEME_TOKEN_KEYS],
  properties: Object.fromEntries(AESTHETIC_THEME_TOKEN_KEYS.map((key) => [key, colorValueSchema]))
} as const;

const builtInThemeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "builtIn"],
  properties: {
    id: { type: "string", enum: ["light", "dark"] },
    name: { type: "string" },
    builtIn: { type: "boolean", const: true }
  }
} as const;

const customThemeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "builtIn", "tokens"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    builtIn: { type: "boolean", const: false },
    tokens: aestheticThemeTokensSchema
  }
} as const;

export const listThemesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["builtIn", "custom", "activeId"],
      properties: {
        builtIn: { type: "array", items: builtInThemeSchema },
        custom: { type: "array", items: customThemeSchema },
        activeId: { type: "string" }
      }
    },
    401: errorResponseSchema
  }
} as const;
```

- [ ] **Step 2: Export theme contract**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./themes-api.js";
```

- [ ] **Step 3: Run typecheck for contract**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/themes-api.ts packages/shared/src/index.ts
git commit -m "feat: add theme API contract"
```

### Task 2: Preference-Backed Theme Routes

**Files:**

- Create: `packages/settings/src/themes-routes.ts`
- Modify: `packages/settings/src/routes.ts`
- Modify: `packages/settings/src/manifest.ts`
- Test: `tests/integration/settings-themes.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/settings-themes.test.ts` with these cases:

```ts
it("returns built-ins and default active light theme", async () => {
  const res = await server.inject({ method: "GET", url: "/api/me/themes", headers: { cookie } });
  expect(res.statusCode).toBe(200);
  expect(res.json<ListThemesResponse>()).toMatchObject({
    builtIn: [
      { id: "light", name: "Light", builtIn: true },
      { id: "dark", name: "Dark", builtIn: true }
    ],
    custom: [],
    activeId: "light"
  });
});

it("creates a custom theme and keeps semantic tokens out of storage", async () => {
  const put = await server.inject({
    method: "PUT",
    url: "/api/me/themes/my-blue",
    headers: { cookie, "content-type": "application/json" },
    payload: { name: "My Blue", tokens: validThemeTokens }
  });
  expect(put.statusCode).toBe(200);
  expect(Object.keys(put.json<PutCustomThemeResponse>().theme.tokens)).not.toContain("red");
});

it("persists active custom theme per user", async () => {
  await putTheme(cookie, "my-blue");
  const active = await server.inject({
    method: "PUT",
    url: "/api/me/themes/active",
    headers: { cookie, "content-type": "application/json" },
    payload: { id: "my-blue" }
  });
  expect(active.statusCode).toBe(200);
  const memberRead = await server.inject({
    method: "GET",
    url: "/api/me/themes",
    headers: { cookie: memberCookie }
  });
  expect(memberRead.json<ListThemesResponse>().activeId).toBe("light");
});

it("rejects invalid colors and semantic token writes", async () => {
  const res = await server.inject({
    method: "PUT",
    url: "/api/me/themes/bad",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      name: "Bad",
      tokens: { ...validThemeTokens, red: "#000000", accent: "url(javascript:alert(1))" }
    }
  });
  expect(res.statusCode).toBe(400);
});

it("does not delete built-ins or the active theme", async () => {
  expect(
    (await server.inject({ method: "DELETE", url: "/api/me/themes/light", headers: { cookie } }))
      .statusCode
  ).toBe(400);
  await putTheme(cookie, "my-blue");
  await setActive(cookie, "my-blue");
  expect(
    (await server.inject({ method: "DELETE", url: "/api/me/themes/my-blue", headers: { cookie } }))
      .statusCode
  ).toBe(400);
});
```

Run:

```bash
pnpm vitest run tests/integration/settings-themes.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 2: Implement route module**

Create `packages/settings/src/themes-routes.ts` with:

```ts
const CUSTOM_THEMES_KEY = "themes.custom";
const ACTIVE_THEME_KEY = "themes.active";
const BUILT_IN_THEMES = [
  { id: "light", name: "Light", builtIn: true },
  { id: "dark", name: "Dark", builtIn: true }
] as const;
```

Implement `registerThemeRoutes(server, deps)`:

- `GET /api/me/themes`: read both preference keys, normalize invalid values to `[]` and `"light"`.
- `PUT /api/me/themes/active`: accept a built-in id or existing custom theme id, upsert `themes.active`.
- `PUT /api/me/themes/:id`: trim id/name, reject built-in ids, validate `tokens` against only `AESTHETIC_THEME_TOKEN_KEYS`, create/update custom array.
- `DELETE /api/me/themes/:id`: reject built-ins and current active id, remove from custom array.

Use existing route pattern:

```ts
const accessContext = await dependencies.resolveAccessContext(request);
return dependencies.dataContext.withDataContext(accessContext, async (scopedDb) => {
  const custom = normalizeCustomThemes(
    await dependencies.preferencesRepository.get(scopedDb, CUSTOM_THEMES_KEY)
  );
  await dependencies.preferencesRepository.upsert(scopedDb, CUSTOM_THEMES_KEY, nextCustom);
  return { theme };
});
```

- [ ] **Step 3: Register routes and manifest**

In `packages/settings/src/routes.ts`, import and call:

```ts
registerThemeRoutes(server, { ...dependencies, preferencesRepository });
```

In `packages/settings/src/manifest.ts`, add route entries:

```ts
{ method: "GET", path: "/api/me/themes", permissionId: "settings.view" },
{ method: "PUT", path: "/api/me/themes/active", permissionId: "settings.write" },
{ method: "PUT", path: "/api/me/themes/:id", permissionId: "settings.write" },
{ method: "DELETE", path: "/api/me/themes/:id", permissionId: "settings.write" }
```

- [ ] **Step 4: Run route tests**

```bash
pnpm vitest run tests/integration/settings-themes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/themes-routes.ts packages/settings/src/routes.ts packages/settings/src/manifest.ts tests/integration/settings-themes.test.ts
git commit -m "feat: persist user custom themes"
```

### Task 3: Theme Runtime And Storage

**Files:**

- Modify: `apps/web/src/shell/theme-storage.ts`
- Create: `apps/web/src/theme/theme-runtime.ts`
- Test: `tests/unit/web-shell-theme.test.ts`
- Test: `tests/unit/theme-runtime.test.ts`

- [ ] **Step 1: Update storage tests first**

Modify `tests/unit/web-shell-theme.test.ts`:

```ts
storage.setItem(SHELL_THEME_STORAGE_KEY, "solarized");
expect(loadShellTheme(storage)).toBe("solarized");

saveShellTheme("my-blue", storage);
expect(storage.getItem(SHELL_THEME_STORAGE_KEY)).toBe("my-blue");
```

Run:

```bash
pnpm vitest run tests/unit/web-shell-theme.test.ts
```

Expected: FAIL because custom IDs still collapse to light.

- [ ] **Step 2: Generalize local theme id storage**

Change `apps/web/src/shell/theme-storage.ts`:

```ts
export type ShellTheme = string;

export function loadShellTheme(storage: ThemeStorage = localStorage): ShellTheme {
  try {
    const value = storage.getItem(SHELL_THEME_STORAGE_KEY)?.trim();
    return value ? value : "light";
  } catch {
    return "light";
  }
}
```

- [ ] **Step 3: Write runtime tests**

Create `tests/unit/theme-runtime.test.ts`:

```ts
it("parses Coolors arrays and whitespace-separated hex values", () => {
  expect(parsePalette('["#f4f1de","#e07a5f"] #3d405b')).toEqual(["#f4f1de", "#e07a5f", "#3d405b"]);
});

it("rejects non-color values", () => {
  expect(isThemeColor("url(javascript:alert(1))")).toBe(false);
  expect(isThemeColor("#f4f1de")).toBe(true);
  expect(isThemeColor("rgb(244, 241, 222)")).toBe(true);
});

it("applies only aesthetic and generated accent vars", () => {
  const style = fakeStyle();
  applyThemeTokens(style, validThemeTokens);
  expect(style.values.get("--paper")).toBe(validThemeTokens.paper);
  expect(style.values.has("--red")).toBe(false);
  expect(style.values.has("--accent-hover")).toBe(true);
});
```

Run:

```bash
pnpm vitest run tests/unit/theme-runtime.test.ts
```

Expected: FAIL because utility does not exist.

- [ ] **Step 4: Implement runtime utility**

Create `apps/web/src/theme/theme-runtime.ts` with exported functions:

```ts
export function isThemeColor(value: string): boolean;
export function parsePalette(input: string): string[];
export function deriveAccentRamp(
  accent: string
): Record<
  | "--accent-hover"
  | "--accent-active"
  | "--accent-soft"
  | "--accent-soft-2"
  | "--accent-soft-fg"
  | "--btn-primary-bg",
  string
>;
export function applyThemeTokens(
  style: CSSStyleDeclarationLike,
  tokens: AestheticThemeTokens | null
): void;
export function readCurrentAestheticTokens(style: CSSStyleDeclaration): AestheticThemeTokens;
```

Use `color-mix(in srgb, ${accent} 88%, black)` style generated values for the ramp. `applyThemeTokens(null)` removes only custom aesthetic and accent-ramp overrides.

- [ ] **Step 5: Run unit tests**

```bash
pnpm vitest run tests/unit/web-shell-theme.test.ts tests/unit/theme-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/shell/theme-storage.ts apps/web/src/theme/theme-runtime.ts tests/unit/web-shell-theme.test.ts tests/unit/theme-runtime.test.ts
git commit -m "feat: add custom theme runtime"
```

### Task 4: Web API Client And Shell Application

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/shell/app-shell.tsx`

- [ ] **Step 1: Add web client functions**

In `apps/web/src/api/query-keys.ts`:

```ts
themes: ["settings", "themes"] as const;
```

In `apps/web/src/api/client.ts`, import theme DTOs and add:

```ts
export async function listThemes(): Promise<ListThemesResponse> {
  return requestJson<ListThemesResponse>("/api/me/themes");
}

export async function setActiveTheme(input: PutActiveThemeRequest): Promise<ListThemesResponse> {
  return requestJson<ListThemesResponse>("/api/me/themes/active", { method: "PUT", body: input });
}

export async function putCustomTheme(
  id: string,
  input: PutCustomThemeRequest
): Promise<PutCustomThemeResponse> {
  return requestJson<PutCustomThemeResponse>(`/api/me/themes/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: input
  });
}

export async function deleteCustomTheme(id: string): Promise<DeleteCustomThemeResponse> {
  return requestJson<DeleteCustomThemeResponse>(`/api/me/themes/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
```

- [ ] **Step 2: Replace shell toggle with active theme selection source**

In `AppShell`, use `useQuery({ queryKey: queryKeys.settings.themes, queryFn: listThemes })`. Active id precedence:

```ts
const [theme, setTheme] = useState<ShellTheme>(() => loadShellTheme());
const activeTheme = themesQuery.data?.activeId ?? theme;
```

Effect:

```ts
document.documentElement.setAttribute("data-theme", activeTheme === "dark" ? "dark" : activeTheme);
saveShellTheme(activeTheme);
const custom = themesQuery.data?.custom.find((item) => item.id === activeTheme) ?? null;
applyThemeTokens(document.documentElement.style, custom?.tokens ?? null);
```

Remove dark-mode toggle UI from `RailUserMenu`; keep Settings navigation as the way to change themes.

- [ ] **Step 3: Run shell typecheck**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/query-keys.ts apps/web/src/shell/app-shell.tsx
git commit -m "feat: apply selected user theme in shell"
```

### Task 5: Appearance Settings Pane

**Files:**

- Create: `apps/web/src/settings/settings-appearance-pane.tsx`
- Modify: `apps/web/src/settings/settings-page.tsx`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/settings-panes-3.css`

- [ ] **Step 1: Add token split comment only**

In `apps/web/src/styles/tokens.css`, add a comment near color primitives:

```css
/* User themes may override aesthetic variables only: paper/surface/ink/line/accent.
   Semantic red/amber/steel stay locked so error/caution/info meaning remains stable. */
```

- [ ] **Step 2: Add Appearance section**

In `settings-page.tsx`, import `Palette` from `lucide-react`, lazy import `AppearancePane`, extend `PersonalSectionId` with `"appearance"`, and add:

```ts
{ id: "appearance", icon: Palette, label: "Appearance", Pane: AppearancePane }
```

- [ ] **Step 3: Implement pane**

Create `settings-appearance-pane.tsx` with one component:

```tsx
export function AppearancePane() {
  const themesQuery = useQuery({ queryKey: queryKeys.settings.themes, queryFn: listThemes });
  const saveTheme = useMutation({
    mutationFn: ({ id, body }) => putCustomTheme(id, body),
    onSuccess: refreshThemes
  });
  const setActive = useMutation({ mutationFn: setActiveTheme, onSuccess: refreshThemes });
  const deleteTheme = useMutation({ mutationFn: deleteCustomTheme, onSuccess: refreshThemes });
  // local draft: name, tokens, selected slot, stagedPalette, error
}
```

Required UI:

- Theme list with built-ins + custom themes. Selecting calls `setActiveTheme`.
- Duplicate built-in/custom copies `readCurrentAestheticTokens(getComputedStyle(document.documentElement))` or custom tokens into a new draft.
- Custom theme editor with `input type="color"` and text input for every `AESTHETIC_THEME_TOKEN_KEYS` slot.
- Paste textarea uses `parsePalette`; staged swatches assign to currently selected slot by click.
- Accent derived ramp shown read-only via `deriveAccentRamp`.
- Locked semantic row for red/amber/steel with `title="Locked - red signals errors, amber signals caution. These stay consistent across all themes so warnings are never hidden."`.
- Live preview applies `style={tokensToCssVars(draft.tokens)}` to a local preview panel.
- Save shows AA contrast warning from `contrastRatio(ink, paper)`, `contrastRatio(accent, paper)`, and `contrastRatio(paper, accent)` but still calls save.
- Invalid color text sets inline error and disables only that save click.

- [ ] **Step 4: Add minimal CSS**

Append to `settings-panes-3.css` using existing tokens only:

```css
.theme-list {
  display: grid;
  gap: var(--space-2);
}
.theme-editor {
  display: grid;
  gap: var(--space-4);
}
.theme-token-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}
.theme-swatch {
  width: 28px;
  height: 28px;
  border: var(--border-w) solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.theme-preview {
  background: var(--paper);
  color: var(--ink);
  border: var(--border-w) solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-4);
}
```

- [ ] **Step 5: Run frontend checks**

```bash
pnpm typecheck
pnpm check:design-tokens
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/settings/settings-appearance-pane.tsx apps/web/src/settings/settings-page.tsx apps/web/src/styles/tokens.css apps/web/src/styles/settings-panes-3.css
git commit -m "feat: add appearance theme editor"
```

### Task 6: Verification Gate

**Files:** none unless fixes required.

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run tests/unit/web-shell-theme.test.ts tests/unit/theme-runtime.test.ts tests/integration/settings-themes.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run pre-push trio**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run frontend token check**

```bash
pnpm check:design-tokens
```

Expected: PASS.

- [ ] **Step 4: Commit any verification fixes only**

```bash
git add <exact-fix-files>
git commit -m "fix: harden custom theme checks"
```

Only run this if verification finds a real fix.

## Spec Coverage

- Create/name/save/select custom theme: Tasks 2, 4, 5.
- Color picker + HEX/RGB field per aesthetic slot: Task 5.
- Coolors-style paste to staged palette, manual slot assignment: Tasks 3, 5.
- One accent hue and generated ramp preview: Tasks 3, 5.
- Semantic red/amber/steel locked and excluded from storage: Tasks 2, 5.
- Custom theme applies to shell and persists reload: Tasks 2, 3, 4.
- Built-in light/dark remain peers: Tasks 2, 4, 5.
- AA warning without blocking save: Task 5.
- Invalid color rejected: Tasks 2, 3, 5.
- No new DB migration; owner-scoped preferences only: Task 2.

## Risk Notes

- Built-in token values stay owned by `tokens.css`; route returns built-in IDs/labels, while client reads computed CSS vars for duplicate/preview. This avoids duplicating raw color literals outside the token file.
- Appearance uses existing settings nav because #487 connector is absent on this branch.
- No semantic token write path exists server-side; client display is read-only defense-in-depth.
