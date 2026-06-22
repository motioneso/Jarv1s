# fix-317-onboarding-provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs in the onboarding provider-check path: Google fires a live billable inference call on status probes, status route spawns subprocesses unboundedly on every fetch, and Google collapses all non-OK outcomes to `needs_login`.

**Architecture:** (1) Replace `checkGoogleProviderWithAgyPrint` with a local `agy auth status` probe mirroring the claude/codex pattern. (2) Fix the unconditional `needs_login` fallback to return `error` for non-auth failures. (3) Add a per-actor 10-second TTL cache inside the `registerOnboardingRoutes` closure so repeated status fetches don't re-spawn subprocesses.

**Tech Stack:** TypeScript, Vitest, Fastify, pnpm monorepo

## Global Constraints

- No admin private-data bypass; RLS applies to all actors.
- `packages/settings/src/routes.ts` is at 947 lines — do NOT touch it (file-size gate at 1000).
- `packages/settings/src/onboarding-routes.ts` is at 942 lines — additions must keep it under 1000.
- Cache must be per-actor (`actorUserId`), never shared across users.
- No auth tokens, credentials, or raw probe output in logs or cache.
- Co-Authored-By trailer on every commit: `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 1: Fix Google error classification (bug 3)

**Files:**

- Modify: `packages/module-registry/src/chat-multiplexer.ts:247`
- Test: `tests/unit/chat-multiplexer-provider-check.test.ts`

**Interfaces:**

- Produces: `checkGoogleProviderWithAgyPrint` returns `{ status: "error" }` for non-auth failures (instead of `needs_login`)

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/chat-multiplexer-provider-check.test.ts`, after the last `it(...)` block (line 128, inside `describe`):

```typescript
it("treats a non-auth Google crash as error, not needs_login", async () => {
  const commandIo = {
    run: async () => ({
      code: 1,
      stdout: "Fatal: agy binary crashed (segfault)\n",
      stderr: ""
    })
  } satisfies Pick<TmuxIo, "run">;
  const probe = makeProviderConnectionCheckProbe({
    engineFactory: () => {
      throw new Error("google checks must not open an interactive engine");
    },
    cliPresent: async () => true,
    skipInstallCheck: true,
    commandIo
  });

  await expect(probe("google")).resolves.toEqual({ status: "error" });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
vitest run tests/unit/chat-multiplexer-provider-check.test.ts
```

Expected: FAIL — test reports `{ status: "needs_login" }` but expected `{ status: "error" }`.

- [ ] **Step 3: Fix the bug**

In `packages/module-registry/src/chat-multiplexer.ts`, find `checkGoogleProviderWithAgyPrint` (around line 232). The last line of the function body reads:

```typescript
return { status: "needs_login" };
```

Change it to:

```typescript
return { status: "error" };
```

The full corrected function body (lines 232–248) should now look like:

```typescript
async function checkGoogleProviderWithAgyPrint(
  neutralDir: string,
  io: Pick<TmuxIo, "run">
): Promise<OnboardingProviderCheckResponse> {
  const result = await withTimeout(
    io.run("agy", ["--print", PROVIDER_CHECK_PROMPT], { cwd: neutralDir }),
    PROVIDER_CHECK_TIMEOUT_MS
  );
  const output = `${result.stdout}\n${result.stderr ?? ""}`;
  if (result.code === 0 && isProviderCheckOk(result.stdout)) {
    return { status: "ready" };
  }
  if (isAuthenticationOutput(output)) {
    return { status: "needs_login" };
  }
  return { status: "error" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
vitest run tests/unit/chat-multiplexer-provider-check.test.ts
```

Expected: ALL PASS (including the new test and the existing "treats an agy authentication prompt as needing login").

- [ ] **Step 5: Commit**

```bash
git add packages/module-registry/src/chat-multiplexer.ts \
        tests/unit/chat-multiplexer-provider-check.test.ts
git commit -m "$(cat <<'EOF'
fix(onboarding): google non-auth crash returns error, not needs_login

The final fallback in checkGoogleProviderWithAgyPrint was unconditionally
returning needs_login for all non-OK outcomes. A crash or timeout now returns
error so founders aren't directed to re-authenticate for a host install fault.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Replace Google live inference with local auth probe (bug 1)

**Files:**

- Modify: `packages/module-registry/src/chat-multiplexer.ts` — add `checkGoogleProviderWithAgyAuthStatus`, update google branch in `makeProviderConnectionCheckProbe`
- Test: `tests/unit/chat-multiplexer-provider-check.test.ts` — replace google inference tests with local-probe tests

**Interfaces:**

- Consumes: `withTimeout`, `isAuthenticationOutput`, `PROVIDER_CHECK_TIMEOUT_MS` from the same file
- Produces: `checkGoogleProviderWithAgyAuthStatus(io)` — runs `agy auth status`, no inference call; `makeProviderConnectionCheckProbe` google branch now calls it

- [ ] **Step 1: Write failing tests**

Replace the two existing google tests in `tests/unit/chat-multiplexer-provider-check.test.ts` (the ones at lines 85–128 that expect `agy --print`) with these three:

```typescript
it("checks Google with agy auth status (local, non-inference)", async () => {
  const runs: Array<{ cmd: string; args: readonly string[] }> = [];
  const commandIo = {
    run: async (cmd: string, args: readonly string[]) => {
      runs.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" };
    }
  } satisfies Pick<TmuxIo, "run">;
  const probe = makeProviderConnectionCheckProbe({
    engineFactory: () => {
      throw new Error("google checks must not open an interactive engine");
    },
    cliPresent: async () => true,
    skipInstallCheck: true,
    commandIo
  });

  const result = await probe("google");

  expect(result).toEqual({ status: "ready" });
  expect(runs).toEqual([{ cmd: "agy", args: ["auth", "status"] }]);
});

it("treats an agy auth status login signal as needing login", async () => {
  const commandIo = {
    run: async () => ({
      code: 1,
      stdout: "Please sign in to continue\n",
      stderr: ""
    })
  } satisfies Pick<TmuxIo, "run">;
  const probe = makeProviderConnectionCheckProbe({
    engineFactory: () => {
      throw new Error("google checks must not open an interactive engine");
    },
    cliPresent: async () => true,
    skipInstallCheck: true,
    commandIo
  });

  await expect(probe("google")).resolves.toEqual({ status: "needs_login" });
});

it("treats a non-auth Google agy crash as error", async () => {
  const commandIo = {
    run: async () => ({
      code: 1,
      stdout: "Fatal: agy binary crashed (segfault)\n",
      stderr: ""
    })
  } satisfies Pick<TmuxIo, "run">;
  const probe = makeProviderConnectionCheckProbe({
    engineFactory: () => {
      throw new Error("google checks must not open an interactive engine");
    },
    cliPresent: async () => true,
    skipInstallCheck: true,
    commandIo
  });

  await expect(probe("google")).resolves.toEqual({ status: "error" });
});
```

Note: the third test duplicates coverage from Task 1 to ensure the new implementation also classifies correctly. Keep the Task 1 test added in the previous commit — it will still compile and pass because it exercises the same new path.

- [ ] **Step 2: Run tests to verify they fail**

```bash
vitest run tests/unit/chat-multiplexer-provider-check.test.ts
```

Expected: the first two new tests FAIL — the google branch still calls `agy --print` not `agy auth status`.

- [ ] **Step 3: Add `checkGoogleProviderWithAgyAuthStatus`**

In `packages/module-registry/src/chat-multiplexer.ts`, add a new function immediately after `checkOpenAiCompatibleProviderWithCodexLoginStatus` ends (around line 230, before the `checkGoogleProviderWithAgyPrint` function):

```typescript
async function checkGoogleProviderWithAgyAuthStatus(
  io: Pick<TmuxIo, "run">
): Promise<OnboardingProviderCheckResponse> {
  const result = await withTimeout(io.run("agy", ["auth", "status"]), PROVIDER_CHECK_TIMEOUT_MS);
  if (result.code !== 0) {
    const output = `${result.stdout}\n${result.stderr ?? ""}`;
    return isAuthenticationOutput(output) ? { status: "needs_login" } : { status: "error" };
  }
  return { status: "ready" };
}
```

- [ ] **Step 4: Update the google branch in `makeProviderConnectionCheckProbe`**

In `packages/module-registry/src/chat-multiplexer.ts`, find the google branch inside `makeProviderConnectionCheckProbe` (around lines 172–177):

```typescript
if (kind === "google") {
  return await checkGoogleProviderWithAgyPrint(neutralDir, deps.commandIo ?? createRealTmuxIo());
}
```

Replace it with:

```typescript
if (kind === "google") {
  return await checkGoogleProviderWithAgyAuthStatus(deps.commandIo ?? createRealTmuxIo());
}
```

`checkGoogleProviderWithAgyPrint` can now be deleted (it is only called from this one branch). Remove it entirely.

- [ ] **Step 5: Run tests to verify they pass**

```bash
vitest run tests/unit/chat-multiplexer-provider-check.test.ts
```

Expected: ALL PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/module-registry/src/chat-multiplexer.ts \
        tests/unit/chat-multiplexer-provider-check.test.ts
git commit -m "$(cat <<'EOF'
fix(onboarding): replace google live-inference probe with local agy auth status

The google branch was running `agy --print "Reply with exactly OK."` — a
billable end-to-end inference call on every status probe. Replace with
`agy auth status` (local, non-inference), mirroring how claude/codex work.
Non-zero exit + no auth signal → error; auth signal → needs_login; 0 → ready.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add per-actor TTL cache to status route (bug 2)

**Files:**

- Modify: `packages/settings/src/onboarding-routes.ts` — cache declaration inside `registerOnboardingRoutes`, cache lookup wrapping the `cliPresent` fan-out
- Test: `tests/unit/onboarding-status-route.test.ts` — refactor `buildServer` + add cache test

**Interfaces:**

- Consumes: `accessContext.actorUserId` (already available in the handler); `Date.now()` for TTL comparison
- Produces: repeated `/api/onboarding/status` calls within 10 s for the same actor do not re-invoke `cliPresent`

- [ ] **Step 1: Refactor `buildServer` in the test to accept a `cliPresent` override**

In `tests/unit/onboarding-status-route.test.ts`, change the `buildServer` signature and its internal `onboardingProbes` to accept an optional override:

```typescript
function buildServer(
  captured: { input?: AssembleInput },
  opts?: { cliPresent?: (kind: OnboardingProviderKind) => Promise<boolean> }
): FastifyInstance {
  const dependencies: OnboardingRoutesDependencies = {
    // ... (all existing fields unchanged) ...
    onboardingProbes: {
      cliPresent: opts?.cliPresent ?? (async () => false),
      testProviderConnection: async () => ({ status: "needs_login" }),
      connectorAccountExists: async () => false
    }
    // ... (rest unchanged) ...
  };
  const server = Fastify({ logger: false });
  registerOnboardingRoutes(server, dependencies);
  return server;
}
```

The existing test `buildServer(captured)` call still works (no second arg = same behavior as before).

- [ ] **Step 2: Write the failing cache test**

Add a new `describe` block at the end of `tests/unit/onboarding-status-route.test.ts`:

```typescript
describe("GET /api/onboarding/status cliPresent cache (#317)", () => {
  it("caches cliPresent results for a given actor within the TTL window", async () => {
    let probeCount = 0;
    const captured: { input?: AssembleInput } = {};
    const server = buildServer(captured, {
      cliPresent: async () => {
        probeCount++;
        return false;
      }
    });
    await server.ready();

    await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });

    await server.close();
    // 3 providers × 1 probe call (second fetch hit cache, no re-spawn)
    expect(probeCount).toBe(3);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
vitest run tests/unit/onboarding-status-route.test.ts
```

Expected: FAIL — `probeCount` is 6 (two fetches × 3 providers) instead of 3.

- [ ] **Step 4: Add the cache to `registerOnboardingRoutes`**

In `packages/settings/src/onboarding-routes.ts`, find `registerOnboardingRoutes` (line 456). Add two lines immediately after the `const repository = dependencies.repository;` assignment (around line 460):

```typescript
const CLI_PROBE_TTL_MS = 10_000;
const cliProbeCache = new Map<
  string,
  { anthropic: boolean; "openai-compatible": boolean; google: boolean; ts: number }
>();
```

- [ ] **Step 5: Wrap the `cliPresent` fan-out with the cache**

In the same file, find the `Promise.all` block that runs the three `cliPresent` calls (around lines 533–537):

```typescript
const [anthropic, openaiCompatible, google] = await Promise.all([
  probes.cliPresent("anthropic"),
  probes.cliPresent("openai-compatible"),
  probes.cliPresent("google")
]);
```

Replace it with:

```typescript
const actorId = accessContext.actorUserId;
const now = Date.now();
const hit = cliProbeCache.get(actorId);
let anthropic: boolean;
let openaiCompatible: boolean;
let google: boolean;
if (hit && now - hit.ts < CLI_PROBE_TTL_MS) {
  anthropic = hit.anthropic;
  openaiCompatible = hit["openai-compatible"];
  google = hit.google;
} else {
  [anthropic, openaiCompatible, google] = await Promise.all([
    probes.cliPresent("anthropic"),
    probes.cliPresent("openai-compatible"),
    probes.cliPresent("google")
  ]);
  cliProbeCache.set(actorId, {
    anthropic,
    "openai-compatible": openaiCompatible,
    google,
    ts: now
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
vitest run tests/unit/onboarding-status-route.test.ts
```

Expected: ALL PASS (existing installable-wiring test and new cache test).

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 8: Check file size**

```bash
wc -l packages/settings/src/onboarding-routes.ts
```

Expected: ≤ 999.

- [ ] **Step 9: Commit**

```bash
git add packages/settings/src/onboarding-routes.ts \
        tests/unit/onboarding-status-route.test.ts
git commit -m "$(cat <<'EOF'
fix(onboarding): per-actor TTL cache on status route cliPresent probes

Every GET /api/onboarding/status fetch was spawning 3 host subprocesses via
cliPresent. A 10-second per-actor Map cache inside registerOnboardingRoutes
absorbs repeated fetches driven by the wizard's invalidate/refetch loop.
Cache is keyed to actorUserId — never shared across actors.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Full gate

**Files:** none (verification only)

- [ ] **Step 1: Pre-push trio + rebase**

```bash
pnpm format:check && pnpm lint && pnpm typecheck
git fetch origin main && git rebase origin/main
```

Expected: all three pass; rebase is a no-op (branch is off main).

- [ ] **Step 2: Run integration tests**

Requires Postgres: `pnpm db:up` if not already running.

```bash
pnpm test:integration
```

Expected: same count as before (no migrations added, no new integration tests).

- [ ] **Step 3: Run full foundation gate**

```bash
pnpm verify:foundation
```

Expected: green (lint + format:check + check:file-size + typecheck + db:migrate + test:integration all pass).

- [ ] **Step 4: Run e2e**

```bash
pnpm test:e2e
```

Expected: green (e2e mocks REST; provider-check path not exercised by e2e but suite should remain green).
