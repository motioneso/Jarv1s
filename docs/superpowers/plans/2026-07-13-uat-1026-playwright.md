# UAT Playwright — Job Search Install (#1026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real (non-mocked) Playwright spec that drives the actual UI against an ephemeral,
prod-shaped instance to prove Job Search installs end-to-end — including the real container
restart + reconcile step (#999's bug) — closing #1026 (part of epic #1000).

**Architecture:** `tests/uat/run-uat.ts` provisions the ephemeral Compose stack via a new
`provisionForUat()` export from `tests/uat/provisioner.ts`, spawns Playwright against it with a
dedicated `tests/uat/playwright.uat.config.ts` (no mocks, no `webServer`, runtime `baseURL`), then
tears the stack down. The single spec (`tests/uat/specs/job-search-install.uat.spec.ts`) logs in as
the real seeded admin, navigates only by clicking (no `page.goto` shortcuts), installs Job Search,
triggers a real restart via a new `restartUatStack()` export, reloads, and asserts the module
reaches `installed-enabled`.

**Tech Stack:** Playwright, tsx, Docker Compose (`infra/docker-compose.prod.yml`), Vitest (unit
test for the `excludeChunks` forwarding fix only).

## Global Constraints

- Happy-path only. No failure-injection test (Coordinator approval #3).
- No `page.goto` except the one unavoidable initial load of `baseURL` to reach the login screen —
  every subsequent navigation (Settings, Admin/Setup, Instance modules) is a real click through
  `RailUserMenu` and in-app nav (Coordinator approval #3).
- Why-comments about fail-closed module gating cite `apps/web/src/app.tsx`'s `myModulesEnabled()`
  and issues #1026/#1000 — never #868 (relay-pass-1's citation there was confirmed wrong).
- No `git add -A` (shared tree) — explicit paths only.
- Don't touch `docs/coordination/`. Don't run repo-wide `pnpm format`. No new migration.
- `provisionForUat`'s approved return shape per Coordinator approval #1 was
  `Promise<{baseURL: string, teardown: () => Promise<void>}>`. **This plan adds a third field,
  `projectName: string`** — flagged explicitly to Coordinator below, not silently done. It's
  required because the spec must trigger a real `docker compose up -d jarv1s` restart mid-test
  (the actual #999 acceptance point), and only `provisionForUat` knows the generated
  Compose project name.

---

### Task 1: `provisioner.ts` — `provisionForUat`, `restartUatStack`, `excludeChunks` fix

**Files:**
- Modify: `tests/uat/provisioner.ts:371-465` (replaces the `main()` function and the trailing
  `import.meta.url` guard; inserts three new exports before the new `main()`)
- Test: `tests/unit/uat-provisioner.test.ts`

**Interfaces:**
- Produces:
  - `buildSeedHookInput(projectName: string, level: UatSeedLevel, opts?: {excludeChunks?: readonly string[]}): {projectName: string; level: UatSeedLevel; excludeChunks?: readonly string[]}`
  - `restartUatStack(projectName: string, baseURL: string): Promise<void>`
  - `provisionForUat(level: UatSeedLevel, opts?: {excludeChunks?: readonly string[]}): Promise<{baseURL: string; projectName: string; teardown: () => Promise<void>}>`
- Consumes: existing exports already in this file — `generateUatRunId`, `findAvailablePort`,
  `writeUatEnvFile`, `uatComposeInterpolationEnv`, `UAT_PORT_RANGE_START`/`SIZE`,
  `createUatProvisionPlan`, `bareSeedHook`, `composeSeedHook`, `buildUatComposeArgs`,
  `assertNoLeakedResources`; and non-exported `runCommand`, `waitForReady`,
  `PortBindConflictError` (same module, no export needed).

- [ ] **Step 1: Write the failing unit test for `buildSeedHookInput`**

Add to `tests/unit/uat-provisioner.test.ts` (new `describe` block, alongside the existing ones;
also add `buildSeedHookInput` to the top `import { ... } from "../uat/provisioner.js"` list):

```ts
describe("buildSeedHookInput", () => {
  it("forwards excludeChunks into the seed hook input (#1026: previously dropped by main())", () => {
    expect(buildSeedHookInput("uat-abc", "admin+data", { excludeChunks: ["job-search"] })).toEqual({
      projectName: "uat-abc",
      level: "admin+data",
      excludeChunks: ["job-search"]
    });
  });

  it("omits excludeChunks when no opts are given", () => {
    expect(buildSeedHookInput("uat-abc", "bare")).toEqual({
      projectName: "uat-abc",
      level: "bare",
      excludeChunks: undefined
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/unit/uat-provisioner.test.ts`
Expected: FAIL — `buildSeedHookInput` is not exported from `../uat/provisioner.js`.

- [ ] **Step 3: Implement — replace `tests/uat/provisioner.ts:371-465`**

Replace the current `main()` function body and the trailing guard (currently lines 371-465) with:

```ts
export function buildSeedHookInput(
  projectName: string,
  level: UatSeedLevel,
  opts?: { excludeChunks?: readonly string[] }
): { projectName: string; level: UatSeedLevel; excludeChunks?: readonly string[] } {
  return { projectName, level, excludeChunks: opts?.excludeChunks };
}

export async function restartUatStack(projectName: string, baseURL: string): Promise<void> {
  // #1026/#999: the module registry has no in-UI restart action by design
  // (settings-module-registry-section.tsx's "Downloaded — restart to apply" note) — an operator
  // re-runs `docker compose up -d`, which re-triggers scripts/module-reconcile.ts on boot. The UAT
  // spec mirrors that real operator action instead of faking the state transition, since #999 was
  // specifically a restart+reconcile bug a faked transition would not have caught.
  await runCommand("docker", buildUatComposeArgs(projectName, ["up", "-d", "jarv1s"]));
  await waitForReady(`${baseURL}/health/ready`);
}

export async function provisionForUat(
  level: UatSeedLevel,
  opts?: { excludeChunks?: readonly string[] }
): Promise<{ baseURL: string; projectName: string; teardown: () => Promise<void> }> {
  const overallStart = Date.now();
  let remainingCandidates = Array.from(
    { length: UAT_PORT_RANGE_SIZE },
    (_, i) => UAT_PORT_RANGE_START + i
  );
  let imageBuilt = false;

  while (remainingCandidates.length > 0) {
    const { projectName } = generateUatRunId();
    const webPort = await findAvailablePort(remainingCandidates);
    const envFile = writeUatEnvFile({ webPort });
    process.env.JARVIS_ENV_FILE = envFile.path;
    process.env.JARVIS_IMAGE_TAG ??= "uat-smoke";
    Object.assign(process.env, uatComposeInterpolationEnv({ webPort }));

    const teardownCompose = () =>
      runCommand("docker", buildUatComposeArgs(projectName, ["down", "-v"])).catch((error) => {
        console.error(`teardown failed for ${projectName}:`, error);
      });

    try {
      console.log(`[uat] provisioning ${projectName} on port ${webPort}`);
      if (process.env.JARVIS_UAT_BUILD !== "0" && !imageBuilt) {
        await runCommand("docker", [
          "build",
          "-t",
          `ghcr.io/motioneso/jarv1s:${process.env.JARVIS_IMAGE_TAG}`,
          "-f",
          "Dockerfile",
          "."
        ]);
        imageBuilt = true;
      }
      const plan = createUatProvisionPlan({ projectName, seedHook: bareSeedHook });
      for (const step of plan.slice(0, -1)) {
        console.log(`[uat] ${step.description}`);
        await runCommand(step.command, step.args);
      }
      await composeSeedHook(buildSeedHookInput(projectName, level, opts));
      const baseURL = `http://127.0.0.1:${webPort}`;
      await waitForReady(`${baseURL}/health/ready`);
      console.log(`[uat] reachable at ${baseURL} after ${Date.now() - overallStart}ms`);
      return {
        baseURL,
        projectName,
        // #1026: deferred, not auto-run — a caller running Playwright against this stack needs it
        // alive between provision and its own explicit teardown() call, so this can no longer live
        // in a `finally` here. SIGINT/SIGTERM handling moves to the caller (tests/uat/run-uat.ts),
        // which is the one that knows when a long-running Playwright child should be interrupted.
        teardown: async () => {
          await teardownCompose();
          await assertNoLeakedResources(projectName);
          envFile.cleanup();
        }
      };
    } catch (error) {
      await teardownCompose();
      await assertNoLeakedResources(projectName);
      envFile.cleanup();
      if (error instanceof PortBindConflictError) {
        console.warn(
          `[uat] port ${webPort} lost the bind race after probing free; retrying with next candidate (#1024)`
        );
        remainingCandidates = remainingCandidates.filter((port) => port !== webPort);
        continue;
      }
      throw error;
    }
  }
  throw new Error(
    `exhausted all ${UAT_PORT_RANGE_SIZE} reserved UAT ports (${UAT_PORT_RANGE_START}-${
      UAT_PORT_RANGE_START + UAT_PORT_RANGE_SIZE - 1
    }) without a successful bind`
  );
}

async function main(): Promise<void> {
  const overallStart = Date.now();
  const level = (process.env.JARVIS_UAT_SEED_LEVEL ?? "bare") as UatSeedLevel;
  const { teardown } = await provisionForUat(level);
  await teardown();
  console.log(`[uat] provision+teardown wall-clock: ${Date.now() - overallStart}ms`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/root exec vitest run tests/unit/uat-provisioner.test.ts`
Expected: PASS, all describe blocks including the two new `buildSeedHookInput` cases.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0. (This is a non-trivial refactor of exported signatures — typecheck is the real
gate here, not just the unit test, since `provisionForUat`/`restartUatStack` have no other callers
yet until Task 4.)

- [ ] **Step 6: Commit**

```bash
git add tests/uat/provisioner.ts tests/unit/uat-provisioner.test.ts
git commit -m "feat(uat): extract provisionForUat, fix excludeChunks forwarding (#1026)"
```

---

### Task 2: `admin.ts` — export the seeded admin credentials

**Files:**
- Modify: `tests/uat/seed/admin.ts:8-9`

**Interfaces:**
- Produces: `UAT_ADMIN_EMAIL: string`, `UAT_ADMIN_PASSWORD: string` (both exported; values
  unchanged — `"uat-admin@jarv1s.local"` / `"uat-admin-password-1025"`).
- Consumes: none new.

- [ ] **Step 1: Add `export` to both constants**

Replace `tests/uat/seed/admin.ts:8-9`:

```ts
export const UAT_ADMIN_EMAIL = "uat-admin@jarv1s.local";
export const UAT_ADMIN_PASSWORD = "uat-admin-password-1025";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: exit 0.

Note: `tests/uat/seed/admin.test.ts` asserts the same two literal string values directly — it is
unaffected by this change (values didn't move) and isn't part of this step's verification, since it
requires a live dev Postgres and isn't wired into `test:unit`/`test:integration`/`verify:foundation`
(confirmed via `docs/superpowers/handoffs/2026-07-13-uat-seed-levels-relay.md:55`, which shows this
whole test family is run manually via a direct `vitest run` invocation). No action needed here.

- [ ] **Step 3: Commit**

```bash
git add tests/uat/seed/admin.ts
git commit -m "feat(uat): export seeded admin credentials for Playwright login (#1026)"
```

---

### Task 3: `tests/uat/playwright.uat.config.ts`

**Files:**
- Create: `tests/uat/playwright.uat.config.ts`

**Interfaces:**
- Consumes: `process.env.JARVIS_UAT_BASE_URL` (set by `run-uat.ts`, Task 4).
- Produces: a Playwright config selecting `tests/uat/specs/*.uat.spec.ts`, no `webServer`, no
  mocks, `baseURL` resolved from the env var at config-load time.

- [ ] **Step 1: Write the config**

```ts
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.JARVIS_UAT_BASE_URL;
if (!baseURL) {
  throw new Error(
    "JARVIS_UAT_BASE_URL is not set — tests/uat/playwright.uat.config.ts must be invoked via " +
      "tests/uat/run-uat.ts (pnpm test:uat), which provisions the ephemeral stack and sets it."
  );
}

export default defineConfig({
  testDir: "./specs",
  testMatch: /.*\.uat\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  retries: 0,
  use: {
    baseURL,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"]
    }
  ]
});
```

- [ ] **Step 2: Verify it loads without a `baseURL`**

Run: `npx playwright test --config=tests/uat/playwright.uat.config.ts --list`
Expected: throws the `JARVIS_UAT_BASE_URL is not set` error (Task 5's spec file doesn't exist yet
either, but the env-var guard should fail first, proving the guard works before there's anything to
list).

- [ ] **Step 3: Commit**

```bash
git add tests/uat/playwright.uat.config.ts
git commit -m "feat(uat): add runtime-baseURL Playwright config for real UAT specs (#1026)"
```

---

### Task 4: `tests/uat/run-uat.ts` wrapper + `package.json` script

**Files:**
- Create: `tests/uat/run-uat.ts`
- Modify: `package.json` (scripts section, alongside the existing `"uat:provision:smoke"` entry)

**Interfaces:**
- Consumes: `provisionForUat` and its exact return shape from Task 1
  (`{baseURL, projectName, teardown}`).
- Produces: `pnpm test:uat` — provisions `admin+data` level with Job Search excluded, runs
  Playwright against `tests/uat/playwright.uat.config.ts`, tears down, exits with Playwright's exit
  code.

- [ ] **Step 1: Write `tests/uat/run-uat.ts`**

```ts
import { spawn } from "node:child_process";
import { provisionForUat } from "./provisioner.js";

async function main(): Promise<void> {
  // #1026: admin+data with job-search excluded so the spec installs it fresh — the point of the
  // #999 acceptance test is proving a real install+restart, not starting from already-installed.
  const { baseURL, projectName, teardown } = await provisionForUat("admin+data", {
    excludeChunks: ["job-search"]
  });

  let exitCode = 1;
  const onSignal = () => {
    void teardown().finally(() => process.exit(1));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    console.log(`[uat] running Playwright against ${baseURL} (project ${projectName})`);
    exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn(
        "npx",
        ["playwright", "test", "--config=tests/uat/playwright.uat.config.ts"],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            JARVIS_UAT_BASE_URL: baseURL,
            JARVIS_UAT_PROJECT_NAME: projectName
          }
        }
      );
      child.on("exit", (code) => resolvePromise(code ?? 1));
    });
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await teardown();
  }

  process.exit(exitCode);
}

await main();
```

- [ ] **Step 2: Add the `package.json` script**

Add to the `scripts` block, next to the existing `"uat:provision:smoke"` entry:

```json
"test:uat": "tsx tests/uat/run-uat.ts",
```

- [ ] **Step 3: Verify the script is wired (dry check, no Docker run yet)**

Run: `node -e "require('./package.json').scripts['test:uat']"` — confirms valid JSON and the key
exists. Full live execution is deferred to Task 5's Step 4 (the wrapper has nothing to run against
until the spec file exists).

- [ ] **Step 4: Commit**

```bash
git add tests/uat/run-uat.ts package.json
git commit -m "feat(uat): add run-uat.ts wrapper and pnpm test:uat script (#1026)"
```

---

### Task 5: `tests/uat/specs/job-search-install.uat.spec.ts`

**Files:**
- Create: `tests/uat/specs/job-search-install.uat.spec.ts`

**Interfaces:**
- Consumes: `restartUatStack` (Task 1), `UAT_ADMIN_EMAIL`/`UAT_ADMIN_PASSWORD` (Task 2),
  `process.env.JARVIS_UAT_PROJECT_NAME`/`JARVIS_UAT_BASE_URL` (set by Task 4's `run-uat.ts`).
- Produces: the one UAT acceptance spec for #1026/#999.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from "@playwright/test";
import { restartUatStack } from "../provisioner.js";
import { UAT_ADMIN_EMAIL, UAT_ADMIN_PASSWORD } from "../seed/admin.js";

// #1026/#1000/#999: happy-path proof that Job Search installs end-to-end against a real,
// prod-shaped instance (no mocked API calls — playwright.uat.config.ts has no webServer/mocks).
// Real nav only, no page.goto beyond the one unavoidable initial load: apps/web/src/app.tsx gates
// every route behind a 401 check (myModulesEnabled()), so a goto("/settings") shortcut would
// silently skip that fail-closed check instead of exercising it.
test("installing Job Search from Settings reaches installed-enabled after a real restart", async ({
  page
}) => {
  const projectName = process.env.JARVIS_UAT_PROJECT_NAME;
  const baseURL = process.env.JARVIS_UAT_BASE_URL;
  if (!projectName || !baseURL) {
    throw new Error("JARVIS_UAT_PROJECT_NAME / JARVIS_UAT_BASE_URL must be set by run-uat.ts");
  }

  await page.goto(baseURL);

  await page.getByLabel("Email").fill(UAT_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(UAT_ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Proves login landed on the authenticated shell — RailUserMenu only renders once logged in.
  await expect(page.locator(".jds-usermenu__trigger")).toBeVisible();

  const openInstanceModules = async () => {
    await page.locator(".jds-usermenu__trigger").click();
    await page.getByRole("button", { name: "Settings & permissions" }).click();
    await page.getByRole("button", { name: "Admin / Setup" }).click();
    await page.getByRole("button", { name: "Instance modules" }).click();
  };

  await openInstanceModules();
  await expect(page.getByRole("heading", { name: "Instance modules" })).toBeVisible();
  await expect(page.getByText("Available modules")).toBeVisible();

  const registry = page.locator('[aria-label="Module registry"]');
  const jobSearchRow = registry.locator("li", { hasText: "Job Search" });
  await expect(jobSearchRow.getByText("Not installed")).toBeVisible();

  await jobSearchRow.getByRole("button", { name: "Install" }).click();
  const installDialog = page.getByRole("dialog", { name: "Install Job Search?" });
  await expect(installDialog).toBeVisible();
  await installDialog.getByRole("button", { name: "Download" }).click();

  await expect(jobSearchRow.getByText("Downloaded — restart to apply")).toBeVisible({
    timeout: 30_000
  });

  // The real acceptance point (#999): install -> restart -> reconcile must land on
  // installed-enabled after an actual container restart, not just after the download step.
  await restartUatStack(projectName, baseURL);
  await page.reload();

  await openInstanceModules();
  const jobSearchRowAfterRestart = page
    .locator('[aria-label="Module registry"]')
    .locator("li", { hasText: "Job Search" });
  await expect(jobSearchRowAfterRestart.getByText("Installed")).toBeVisible({ timeout: 30_000 });

  const enableSwitch = jobSearchRowAfterRestart.getByRole("checkbox", {
    name: /enable job search/i
  });
  await jobSearchRowAfterRestart.locator("label.jds-switch", { has: enableSwitch }).click();
  await expect(enableSwitch).toBeChecked();
});
```

- [ ] **Step 2: Run it live**

Run: `pnpm test:uat`
Expected: exit 0, Playwright reports 1 passed. This is the first live run of the whole chain
(Docker build/up, seed at `admin+data` excluding job-search, login, install, real restart,
reconcile, enable). Record actual wall-clock and exit code in the commit message / PR body per
CLAUDE.md's "record the local commands and exit codes used" rule if CI is unavailable for this
step.

- [ ] **Step 3: Commit**

```bash
git add tests/uat/specs/job-search-install.uat.spec.ts
git commit -m "feat(uat): add job-search-install Playwright spec (Closes #1026)"
```

---

## Self-Review

**1. Spec coverage:** Playwright config (Task 3), provisioning + real restart primitives (Task 1),
seeded credentials export (Task 2), run wrapper + script (Task 4), and the spec itself (Task 5) —
covers every deliverable listed in the relay2 handoff's "Next concrete steps" item 1. The
`excludeChunks` forwarding bug fix is covered by Task 1 with a dedicated unit test.

**2. Placeholder scan:** No TBD/TODO, no "add error handling", no "similar to Task N" — every step
has real code. `admin.test.ts` is explicitly noted out-of-scope with a stated reason rather than a
vague "not needed."

**3. Type consistency:** `provisionForUat`'s return shape (`{baseURL, projectName, teardown}`)
matches its one call site in Task 4's `run-uat.ts`. `restartUatStack(projectName, baseURL)`
signature matches its Task 5 call site. `buildSeedHookInput`'s return type matches what
`composeSeedHook` (existing `SeedHook` type) accepts. `UAT_ADMIN_EMAIL`/`UAT_ADMIN_PASSWORD` import
path (`../seed/admin.js`) matches Task 2's export location.

**Flagged deviation from Coordinator approval #1** (not silently resolved): `provisionForUat`'s
return type gained a third field, `projectName: string`, beyond the approved
`{baseURL, teardown}`. Required because Task 5's spec must trigger a real
`docker compose up -d jarv1s` restart mid-test — the actual #999 acceptance point — and only
`provisionForUat` knows the generated Compose project name. No other approved shape changed.
