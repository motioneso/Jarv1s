# Handoff — CI cleanup (issue #27)

**Date:** 2026-06-08
**Author:** prior session (Claude)
**Scope:** Green the "Verify foundation and app" CI job and `compose-smoke` job.
**Issue:** #27 — CI cleanup: green the foundation e2e job + compose-smoke
**Related:** epic #22 (chat work that preceded this; the root cause is not chat, but the CI job was already red before any chat work)

---

## Context

`main`'s CI has been fully red since before the chat work. `verify:foundation` is green locally. Three separate root causes each block a different CI step:

1. **Missing Playwright browser install** → all e2e tests error with "Executable doesn't exist"
2. **Stale e2e selectors** → two assertions in `app-shell.spec.ts` reference a `Workspace` dropdown that was removed in Slice 1f
3. **onnxruntime glibc mismatch** → `compose-smoke` fails because `onnxruntime-node` requires glibc but `node:24-alpine` uses musl libc

Fix each one independently; they don't interact.

---

## Fix 1 — Add Playwright install to CI

**File:** `.github/workflows/ci.yml`

**Problem:** `pnpm test:e2e` runs without browsers installed. Playwright needs them pre-downloaded in CI.

**Fix:** Add this step immediately before `Run Playwright smoke tests`:

```yaml
      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium
```

The full updated sequence in the `verify` job should look like:

```yaml
      - name: Build web
        run: pnpm build:web

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Run Playwright smoke tests
        run: pnpm test:e2e
```

Installing only `chromium` (not all browsers) keeps CI fast; `playwright.config.ts` uses chromium.

---

## Fix 2 — Remove stale `Workspace` assertions from `app-shell.spec.ts`

**File:** `tests/e2e/app-shell.spec.ts`

**Problem:** Two assertions (`line 39` and `line 53`) check `page.getByLabel("Workspace")` for a workspace-selector dropdown. The selector was removed in Slice 1f and the element no longer exists.

**Fix:** Delete these two assertion lines:

```diff
-  await expect(page.getByLabel("Workspace")).toHaveValue("workspace-1");
```

They appear in two tests:
- `"signs in and renders shell navigation"` (line 39)
- `"creates and updates tasks through REST calls"` (line 53)

No other test logic depends on the removed selector. Simply delete the two lines.

**Also check:** The handoff preceding this one also mentions a "briefing tool-metadata test that fails." Before assuming it's gone, run the e2e suite locally with browsers installed and see exactly which test fails and why. The briefing test at lines 202–236 (tool checkboxes `tasks.listVisible`, `tasks.updateStatus`) may still be valid — only mark it for removal if it actually fails with a clear reason.

---

## Fix 3 — Fix onnxruntime-node in compose-smoke

**File:** `infra/docker-compose.yml`

**Problem:** `onnxruntime-node` (used by `packages/ai` for the local embedding provider) links against glibc (`libonnxruntime.so.1`). The compose services use `node:24-alpine`, which is musl-based and has no glibc.

Error in CI:
```
ERR_DLOPEN_FAILED: /workspace/node_modules/onnxruntime-node/bin/napi-v3/linux/x64/onnxruntime_binding.node
```

**Two options:**

**Option A (recommended): Switch base image to Debian**

Change all four services (`migrate`, `api`, `web`, `worker`) in `infra/docker-compose.yml`:

```diff
-    image: node:24-alpine
+    image: node:24-bookworm-slim
```

This is the cleanest fix. `bookworm-slim` is Debian 12 and has glibc. Size is ~200 MB vs ~130 MB for alpine, but glibc compatibility is guaranteed for any native module.

**Option B: Keep alpine, add gcompat**

Add a shell step to each service command:

```diff
-    command: sh -c "corepack enable && pnpm install ... && pnpm start:api"
+    command: sh -c "apk add --no-cache gcompat && corepack enable && pnpm install ... && pnpm start:api"
```

`gcompat` installs a thin glibc shim for alpine. This is lighter but fragile — works for simple glibc dependencies but can fail for complex native modules with deep symbol requirements. Option A is safer.

---

## What to verify after each fix

After fix 1 + 2 together:
```bash
# Run locally with browsers installed (or let CI run it)
pnpm exec playwright install --with-deps chromium
pnpm build:web && pnpm test:e2e
```

After fix 3:
```bash
# Build the compose stack and run smoke
pnpm smoke:compose -- --api-port 3099
```

Then push to a branch and confirm the GitHub Actions "Verify foundation and app" and "Compose deployment smoke" jobs both go green.

---

## Files to touch

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Add `playwright install` step before e2e |
| `tests/e2e/app-shell.spec.ts` | Remove 2 stale `Workspace` assertions |
| `infra/docker-compose.yml` | Swap `node:24-alpine` → `node:24-bookworm-slim` (or add gcompat) |

---

## Gotchas

- **Playwright version drift:** the installed browser must match the `@playwright/test` version in `pnpm-lock.yaml`. `pnpm exec playwright install` (no version arg) picks the right version automatically; don't pin a version manually.
- **onnxruntime in compose vs local:** locally you're on a glibc system, so you won't hit the compose failure. The only way to reproduce fix 3 is to run `pnpm smoke:compose` (which Docker-izes everything) or to look at CI logs.
- **pg-boss worker test flakiness** (`foundation.test.ts`, `tasks.test.ts`, `briefings.test.ts`): these time out intermittently due to a pg-boss polling race condition. They are pre-existing (confirmed flaky at the same rate before and after the chat work). Do NOT confuse them with new failures — they have nothing to do with this CI cleanup.
- **compose-smoke vs verify job:** these are two separate CI jobs; fix 3 only affects `compose-smoke`, fixes 1+2 only affect the `verify` job.

---

## Current GitHub state

- Issue #27 ("CI cleanup") is open and on the project board (Todo).
- PR #29 ("Phase B retire-legacy backend") is open against `main` — **review and merge this first** before starting CI cleanup, since CI will run against whatever is in `main`.
- Epic #22 ("Jarv1s Chat") is In Progress on the board; Phase 1 + Phase B are done; Phase 2 (agentic MCP) is next after CI is green.
