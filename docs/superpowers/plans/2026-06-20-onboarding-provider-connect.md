# Onboarding Provider-Connect Implementation Plan

> **For agentic workers:** This plan is executed by the build agent itself, task-by-task (the superpowers execution sub-skills are disabled in this repo). Steps use checkbox (`- [ ]`) syntax for tracking. Each task commits green.

**Goal:** Turn the detect-only "02 Assistant" onboarding step into a one-button **Connect** flow (install → login → working chat) driven entirely from the UI, so a founder reaches a working chat after only `install.sh`.

**Architecture:** A thin frontend API client drives the existing backend routes (`provider-install`, `provider-login/{begin,submit-token,poll}`). A **pure state-machine module** (`provider-connect-machine.ts`) derives each card's UI model + login-flow transitions from the persisted `installState` lifecycle + a transient (never-persisted) login session — so the logic is unit-tested without a DOM. A presentational `ProviderCard` renders purely from a `CardModel` (testable via `react-dom/server`). The contract gains an additive `installable` flag (data-driven offering, from the catalog) and the step's `done` becomes "≥1 provider `ready`".

**Tech Stack:** React 19, @tanstack/react-query 5, Fastify ajv schemas, Vitest (`react-dom/server` render, no jsdom), TypeScript.

## Global Constraints

- **No new migration** (handoff). Do not author one.
- **`@jarv1s/shared` is Vite-bundled into the browser** — never add `node:*` imports there.
- **Secrets never escape.** The pasted OAuth code + minted token are auth material — never logged, persisted, echoed, or put in any doc/payload/prompt. The submit-token client method sends the code straight to the route; component state holds it only transiently.
- **Backward-compat contract.** All `onboarding-api.ts` changes are ADDITIVE (`installable` is optional; new request/response types are new). Keep the existing host-detection fields (`cliPresent`, `installState`).
- **Provider-agnostic.** No provider hardcoded in UI control flow beyond display labels; offering is driven by the `installable` flag (catalog `supported` set).
- **File-size gate:** no source file > 1000 lines. Run the full gate (`lint && format:check && check:file-size && typecheck`) before every commit.
- **Single-active-user gate (#347):** install/login are one-at-a-time; a 503 surfaces an inline "busy" state, never a crash.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `git add` only the task's files.

## Design decisions (one is a fork from the spec's literal contract — flagged to coordinator)

- **`loginState` is NOT added.** The spec's contract section suggested per-provider `{ kind, installState, loginState }`. The persisted `ProviderInstallState` enum (`not_installed → installing → installed → needs_login → ready → error`) **already encodes login completion** (`ready` = logged in; `needs_login` = installed-not-logged-in). A separate `loginState` would double-encode the same state with drift risk. **Recommendation: keep the single `installState` lifecycle + add an additive `installable: boolean`** (which the spec's "data-driven from the catalog `supported` set" actually requires, and which the literal `{installState, loginState}` shape omitted). The codex "headless login unavailable" case is discovered at runtime (begin returns no `authorizationUrl`), not from an upfront flag — matching the spec body.
- **`cliAuth.done` becomes "≥1 provider `ready`"** (spec decision 4), upgrading the old "≥1 present" floor. Existing assembler tests assert the old floor and are updated in Task 2.
- The transient login session (loginId, authorizationUrl, awaiting/submitting/polling) lives in component state only — never persisted. Resume mid-connect lands on the persisted `installState` (`needs_login` ⇒ re-initiate login), which is a valid resume.

---

### Task 1: Shared contract — `installable` flag + install/login request & response types/schemas

**Files:**

- Modify: `packages/shared/src/onboarding-api.ts`
- Test: `tests/unit/onboarding-provider-connect-contract.test.ts` (create)

**Interfaces:**

- Produces (consumed by Tasks 2-6):
  - `OnboardingCliProviderDto` gains `readonly installable?: boolean`.
  - `interface OnboardingProviderInstallRequest { readonly providerKind: OnboardingProviderKind }`
  - `interface OnboardingProviderInstallResponse { readonly providerKind: OnboardingProviderKind; readonly installState: ProviderInstallState; readonly version?: string; readonly message?: string; readonly alreadyInstalled?: boolean }`
  - `type ProviderLoginFlowStatus = "awaiting_authorization" | "awaiting_token" | "ready" | "error"`
  - `interface OnboardingProviderLoginBeginRequest { readonly providerKind: OnboardingProviderKind }`
  - `interface OnboardingProviderLoginPollRequest { readonly providerKind: OnboardingProviderKind; readonly loginId: string }`
  - `interface OnboardingProviderLoginSubmitTokenRequest { readonly providerKind: OnboardingProviderKind; readonly loginId: string; readonly token: string }`
  - `interface OnboardingProviderLoginResponse { readonly providerKind: OnboardingProviderKind; readonly loginId: string; readonly status: ProviderLoginFlowStatus; readonly authorizationUrl?: string; readonly userCode?: string; readonly installState: ProviderInstallState; readonly message?: string }`
  - exported request schemas: `onboardingProviderInstallRequestSchema`, `onboardingProviderLoginBeginRequestSchema`, `onboardingProviderLoginPollRequestSchema`, `onboardingProviderLoginSubmitTokenRequestSchema`.

- [ ] **Step 1: Write the failing test** — `tests/unit/onboarding-provider-connect-contract.test.ts`

```ts
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  onboardingProviderInstallRequestSchema,
  onboardingProviderLoginSubmitTokenRequestSchema,
  getOnboardingStatusRouteSchema
} from "@jarv1s/shared";

// These schemas ARE the runtime Fastify validation contract — exercise them through a real
// Fastify ajv path (mirrors tests/unit/shared-contract-schemas.test.ts).
async function parseBody(bodySchema: unknown, payload: Record<string, unknown>) {
  const app = Fastify();
  app.post("/probe", { schema: { body: bodySchema as never } }, async (req) => req.body);
  const res = await app.inject({
    method: "POST",
    url: "/probe",
    payload,
    headers: { "content-type": "application/json" }
  });
  await app.close();
  return {
    status: res.statusCode,
    body: res.statusCode === 200 ? JSON.parse(res.body) : undefined
  };
}

describe("onboarding provider-connect contract (#365)", () => {
  it("install request strips unknown keys and keeps providerKind", async () => {
    const { status, body } = await parseBody(onboardingProviderInstallRequestSchema, {
      providerKind: "anthropic",
      __unexpected__: "x"
    });
    expect(status).toBe(200);
    expect(body).toEqual({ providerKind: "anthropic" });
  });

  it("submit-token request requires a token and keeps it (auth material flows through)", async () => {
    const missing = await parseBody(onboardingProviderLoginSubmitTokenRequestSchema, {
      providerKind: "anthropic",
      loginId: "L1"
    });
    expect(missing.status).toBe(400);
    const ok = await parseBody(onboardingProviderLoginSubmitTokenRequestSchema, {
      providerKind: "anthropic",
      loginId: "L1",
      token: "code-123"
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ providerKind: "anthropic", loginId: "L1", token: "code-123" });
  });

  it("status response schema declares an additive `installable` boolean on providers", () => {
    const providerProps = (getOnboardingStatusRouteSchema.response[200] as { oneOf: any[] })
      .oneOf[0].properties.steps.properties.cliAuth.properties.providers.items.properties;
    expect(providerProps.installable).toEqual({ type: "boolean" });
    // Additive ⇒ NOT in required.
    expect(providerProps.installable).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run tests/unit/onboarding-provider-connect-contract.test.ts`
Expected: FAIL — `onboardingProviderInstallRequestSchema` / `installable` not exported.

- [ ] **Step 3: Implement the contract additions** in `packages/shared/src/onboarding-api.ts`

Add `readonly installable?: boolean;` to `OnboardingCliProviderDto` (after `installState`), with this doc note:

```ts
  /**
   * #365 (additive): the provider is in the catalog `supported` install set, so the wizard offers a
   * Connect button. Absent/false ⇒ the card renders a non-blocking "not available" state (e.g. agy/
   * google = `blocked`). Optional ⇒ no schema break; present only when the install seam is wired.
   */
  readonly installable?: boolean;
```

Add `installable: { type: "boolean" }` to the provider `items.properties` block inside `onboardingFounderStatusSchema` (keep it OUT of the item `required` array — additive).

Add the new request/response interfaces + `ProviderLoginFlowStatus` (listed in Interfaces above) near the existing `OnboardingProviderCheck*` types. Add the four exported request schemas mirroring the settings-route shapes (provider enum `["anthropic","openai-compatible","google"]`; `loginId` `minLength:1,maxLength:200`; `token` `minLength:1,maxLength:4096`). Response types are TS-only (the web client does not validate responses; settings owns the route response schemas).

- [ ] **Step 4: Run the test + typecheck**

Run: `pnpm exec vitest run tests/unit/onboarding-provider-connect-contract.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/onboarding-api.ts tests/unit/onboarding-provider-connect-contract.test.ts
git commit -m "feat(#365): add installable flag + provider connect contract types to shared"
```

---

### Task 2: `assembleOnboardingStatus` — surface `installable`, derive `done` from `ready`

**Files:**

- Modify: `packages/settings/src/repository.ts` (the `AssembleOnboardingStatusInput` interface + `assembleOnboardingStatus`)
- Test: `tests/integration/onboarding.test.ts` (update existing assembler cases + add new — these `it()` blocks are pure, no DB)

**Interfaces:**

- Consumes: `installableByKind?: Readonly<Partial<Record<OnboardingProviderKind, boolean>>>` on the input (Task 3 supplies it).
- Produces: each provider DTO carries `installable` when known; `steps.cliAuth.done === providers.some(p => p.installState === "ready")`.

- [ ] **Step 1: Update + add failing assembler tests** in `tests/integration/onboarding.test.ts`

Change the existing `it("assembleOnboardingStatus derives flags ...")` expectation from the old present-floor to the new ready semantics. Replace the `cliAuth.done` assertion (currently `expect(...cliAuth.done).toBe(true); // at least one present`) and the providers `toEqual` to include `installable` where supplied, then add:

```ts
it("cliAuth.done is true ONLY when ≥1 provider installState is ready (#365)", () => {
  const repository = new SettingsRepository();
  const notReady = repository.assembleOnboardingStatus({
    state: "pending",
    selected: null,
    availability: { tmuxUsable: true, herdrUsable: false },
    cliPresentByKind: { anthropic: true, "openai-compatible": false, google: false },
    connectorAccountExists: false,
    installStateByKind: { anthropic: "needs_login" },
    installableByKind: { anthropic: true, "openai-compatible": true, google: false }
  });
  expect(notReady.steps.cliAuth.done).toBe(false); // present + needs_login ≠ done
  const anthropicDto = notReady.steps.cliAuth.providers.find((p) => p.kind === "anthropic");
  expect(anthropicDto).toMatchObject({ installState: "needs_login", installable: true });
  expect(notReady.steps.cliAuth.providers.find((p) => p.kind === "google")?.installable).toBe(
    false
  );

  const ready = repository.assembleOnboardingStatus({
    state: "pending",
    selected: null,
    availability: { tmuxUsable: true, herdrUsable: false },
    cliPresentByKind: { anthropic: true, "openai-compatible": false, google: false },
    connectorAccountExists: false,
    installStateByKind: { anthropic: "ready" },
    installableByKind: { anthropic: true, "openai-compatible": true, google: false }
  });
  expect(ready.steps.cliAuth.done).toBe(true);
});

it("omits installable when installableByKind is absent (phase-1 presence surface)", () => {
  const repository = new SettingsRepository();
  const status = repository.assembleOnboardingStatus({
    state: "pending",
    selected: null,
    availability: { tmuxUsable: false, herdrUsable: false },
    cliPresentByKind: { anthropic: true, "openai-compatible": false, google: false },
    connectorAccountExists: false
  });
  expect(status.steps.cliAuth.providers.every((p) => !("installable" in p))).toBe(true);
  expect(status.steps.cliAuth.done).toBe(false); // no ready provider
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run tests/integration/onboarding.test.ts -t "assembleOnboardingStatus"` (DB must be up: `pnpm db:up`)
Expected: FAIL — `installable` undefined / `done` still uses present floor.

- [ ] **Step 3: Implement** in `packages/settings/src/repository.ts`

On `AssembleOnboardingStatusInput`, add:

```ts
  /**
   * #365 (additive): per-provider catalog installability (the `supported` set), supplied by the
   * status route from the install seam's `installability` port. Absent ⇒ `installable` omitted on
   * the DTO (phase-1 presence surface). A provider absent from the map ⇒ omitted for that provider.
   */
  readonly installableByKind?: Readonly<Partial<Record<OnboardingProviderKind, boolean>>>;
```

In `assembleOnboardingStatus`, destructure `installableByKind`, and in the `providers` map add the optional field + change `done`:

```ts
const providers = ONBOARDING_CLI_KINDS.map((kind) => {
  const installState = installStateByKind?.[kind];
  const installable = installableByKind?.[kind];
  return {
    kind,
    cliPresent: cliPresentByKind[kind],
    ...(installState !== undefined ? { installState } : {}),
    ...(installable !== undefined ? { installable } : {})
  };
});
```

```ts
        cliAuth: {
          // #365: done ⇔ at least one provider has reached `ready` (installed AND logged in).
          // Upgrades the old presence floor — onboarding now means "connected", not "detected".
          done: providers.some((p) => p.installState === "ready"),
          providers
        },
```

Update the assembler's doc comment line about `cliAuth.done` accordingly.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm exec vitest run tests/integration/onboarding.test.ts && pnpm typecheck`
Expected: PASS (the full onboarding suite, including the status route integration tests, stays green).

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/repository.ts tests/integration/onboarding.test.ts
git commit -m "feat(#365): assemble installable + ready-based cliAuth.done in onboarding status"
```

---

### Task 3: Status route — compute the `installableByKind` map from the install seam

**Files:**

- Modify: `packages/settings/src/onboarding-routes.ts` (the `GET /api/onboarding/status` handler only — no change to install/login route definitions)
- Test: `tests/unit/onboarding-status-route.test.ts` (create — mirrors the install-route harness)

**Interfaces:**

- Consumes: `OnboardingInstallDependencies.installability` (already injected).
- Produces: passes `installableByKind` into `repository.assembleOnboardingStatus` when the install seam is present.

- [ ] **Step 1: Write the failing route test** — `tests/unit/onboarding-status-route.test.ts`

```ts
import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { AccessContext, DataContextDb, User } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import type { OnboardingProviderKind } from "@jarv1s/shared";
import {
  registerOnboardingRoutes,
  type OnboardingRoutesDependencies
} from "../../packages/settings/src/onboarding-routes.js";

const ADMIN_TOKEN = "admin-token";
const ADMIN_USER_ID = "user-admin";
const adminUser = () =>
  ({ id: ADMIN_USER_ID, is_bootstrap_owner: true, is_instance_admin: true }) as unknown as User;

function buildServer(captured: { input?: any }): FastifyInstance {
  const dependencies: OnboardingRoutesDependencies = {
    dataContext: {
      withDataContext: async (_c: AccessContext, fn: (db: DataContextDb) => Promise<unknown>) =>
        fn({ __scoped: true } as unknown as DataContextDb)
    } as unknown as OnboardingRoutesDependencies["dataContext"],
    resolveAccessContext: async (request: FastifyRequest): Promise<AccessContext> => {
      const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (token === ADMIN_TOKEN) return { actorUserId: ADMIN_USER_ID, requestId: "req-1" };
      throw new HttpError(401, "no session");
    },
    // Only the methods the status handler calls — assembleOnboardingStatus captures its input and
    // returns a minimal valid founder status (the REAL assembler is covered in Task 2).
    repository: {
      getMemberOnboardingState: async () => ({ completedAt: null }),
      readOnboardingState: async () => "pending",
      readChatMultiplexerChoiceOrNull: async () => null,
      assembleOnboardingStatus: (input: unknown) => {
        captured.input = input;
        return {
          role: "founder",
          state: "pending",
          steps: {
            multiplexer: { done: false, selected: null, tmuxUsable: false, herdrUsable: false },
            cliAuth: { done: false, providers: [] },
            connectors: { done: false }
          }
        };
      }
    } as unknown as OnboardingRoutesDependencies["repository"],
    requireKnownUser: async () => adminUser(),
    assertBootstrapOwnerAdminUser: async () => adminUser(),
    requireRequestId: (ctx) => ctx.requestId,
    handleRouteError: (error, reply) => handleRouteError(error, reply),
    onboardingProbes: {
      multiplexerUsable: async () => false,
      cliPresent: async () => false,
      testProviderConnection: async () => ({ status: "needs_login" }),
      connectorAccountExists: async () => false
    },
    onboardingInstall: {
      installability: (provider: OnboardingProviderKind) =>
        provider === "google"
          ? { installable: false, blockedReason: "agy spike unresolved" }
          : { installable: true },
      installClient: async () => ({ state: "installed" }),
      stateStore: {
        persistInstalling: async () => undefined,
        persistTerminal: async () => "installed"
      },
      reconcileInstallStates: async () => ({ anthropic: "ready" })
    }
  };
  const server = Fastify({ logger: false });
  registerOnboardingRoutes(server, dependencies);
  return server;
}

describe("GET /api/onboarding/status installable wiring (#365)", () => {
  it("passes a catalog-derived installableByKind into the assembler", async () => {
    const captured: { input?: any } = {};
    const server = buildServer(captured);
    await server.ready();
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    await server.close();
    expect(res.statusCode).toBe(200);
    expect(captured.input.installableByKind).toEqual({
      anthropic: true,
      "openai-compatible": true,
      google: false
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run tests/unit/onboarding-status-route.test.ts`
Expected: FAIL — `captured.input.installableByKind` is `undefined`.

- [ ] **Step 3: Implement** in `packages/settings/src/onboarding-routes.ts`

Inside the `withDataContext` block of the status handler (where `installStateByKind` is computed), also derive the installability map (pure, sync — no DB), and thread it into the `assembleOnboardingStatus` call:

```ts
const installStateByKind = install ? await install.reconcileInstallStates(scopedDb) : undefined;
// #365: derive per-provider catalog installability (the `supported` set) from the
// install seam's pure installability port, so the wizard offers Connect data-drivenly.
const installableByKind = install
  ? {
      anthropic: install.installability("anthropic").installable,
      "openai-compatible": install.installability("openai-compatible").installable,
      google: install.installability("google").installable
    }
  : undefined;
return { state, selected, connectorAccountExists, installStateByKind, installableByKind };
```

Then in the `assembleOnboardingStatus({...})` call, add:

```ts
          ...(dbPart.installableByKind !== undefined
            ? { installableByKind: dbPart.installableByKind }
            : {})
```

- [ ] **Step 4: Run test + the onboarding integration suite + typecheck**

Run: `pnpm exec vitest run tests/unit/onboarding-status-route.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/settings/src/onboarding-routes.ts tests/unit/onboarding-status-route.test.ts
git commit -m "feat(#365): wire catalog installability into onboarding status route"
```

---

### Task 4: Web API client — install + login methods

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Test: `tests/unit/web-onboarding-connect-client.test.ts` (create)

**Interfaces:**

- Produces (consumed by Task 6):
  - `installOnboardingProvider(input: OnboardingProviderInstallRequest): Promise<OnboardingProviderInstallResponse>`
  - `beginOnboardingProviderLogin(input: OnboardingProviderLoginBeginRequest): Promise<OnboardingProviderLoginResponse>`
  - `submitOnboardingProviderLoginToken(input: OnboardingProviderLoginSubmitTokenRequest): Promise<OnboardingProviderLoginResponse>`
  - `pollOnboardingProviderLogin(input: OnboardingProviderLoginPollRequest): Promise<OnboardingProviderLoginResponse>`

- [ ] **Step 1: Write the failing test** — `tests/unit/web-onboarding-connect-client.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginOnboardingProviderLogin,
  installOnboardingProvider,
  pollOnboardingProviderLogin,
  submitOnboardingProviderLoginToken
} from "../../apps/web/src/api/client.js";

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("onboarding connect client (#365)", () => {
  it("installOnboardingProvider POSTs providerKind and returns the lifecycle", async () => {
    const fetchMock = mockFetchOnce({ providerKind: "anthropic", installState: "installed" });
    const res = await installOnboardingProvider({ providerKind: "anthropic" });
    expect(res).toEqual({ providerKind: "anthropic", installState: "installed" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/onboarding/provider-install");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ providerKind: "anthropic" });
  });

  it("beginOnboardingProviderLogin POSTs to /begin", async () => {
    const fetchMock = mockFetchOnce({
      providerKind: "anthropic",
      loginId: "L1",
      status: "awaiting_token",
      authorizationUrl: "https://claude.ai/oauth",
      installState: "needs_login"
    });
    const res = await beginOnboardingProviderLogin({ providerKind: "anthropic" });
    expect(res.authorizationUrl).toBe("https://claude.ai/oauth");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/onboarding/provider-login/begin");
  });

  it("submitToken forwards the pasted code to /submit-token", async () => {
    const fetchMock = mockFetchOnce({
      providerKind: "anthropic",
      loginId: "L1",
      status: "ready",
      installState: "ready"
    });
    const res = await submitOnboardingProviderLoginToken({
      providerKind: "anthropic",
      loginId: "L1",
      token: "code-123"
    });
    expect(res.status).toBe("ready");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/onboarding/provider-login/submit-token");
    expect(JSON.parse(init.body as string)).toEqual({
      providerKind: "anthropic",
      loginId: "L1",
      token: "code-123"
    });
  });

  it("pollOnboardingProviderLogin POSTs to /poll", async () => {
    const fetchMock = mockFetchOnce({
      providerKind: "anthropic",
      loginId: "L1",
      status: "ready",
      installState: "ready"
    });
    await pollOnboardingProviderLogin({ providerKind: "anthropic", loginId: "L1" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/onboarding/provider-login/poll");
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run tests/unit/web-onboarding-connect-client.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** in `apps/web/src/api/client.ts`

Add the new types to the existing `@jarv1s/shared` type import block:
`OnboardingProviderInstallRequest`, `OnboardingProviderInstallResponse`, `OnboardingProviderLoginBeginRequest`, `OnboardingProviderLoginPollRequest`, `OnboardingProviderLoginSubmitTokenRequest`, `OnboardingProviderLoginResponse`.

Add after `testOnboardingProviderConnection`:

```ts
export async function installOnboardingProvider(
  input: OnboardingProviderInstallRequest
): Promise<OnboardingProviderInstallResponse> {
  return requestJson<OnboardingProviderInstallResponse>("/api/onboarding/provider-install", {
    method: "POST",
    body: input
  });
}

export async function beginOnboardingProviderLogin(
  input: OnboardingProviderLoginBeginRequest
): Promise<OnboardingProviderLoginResponse> {
  return requestJson<OnboardingProviderLoginResponse>("/api/onboarding/provider-login/begin", {
    method: "POST",
    body: input
  });
}

// The pasted code is auth material: forwarded straight to the route, never logged or stored.
export async function submitOnboardingProviderLoginToken(
  input: OnboardingProviderLoginSubmitTokenRequest
): Promise<OnboardingProviderLoginResponse> {
  return requestJson<OnboardingProviderLoginResponse>(
    "/api/onboarding/provider-login/submit-token",
    { method: "POST", body: input }
  );
}

export async function pollOnboardingProviderLogin(
  input: OnboardingProviderLoginPollRequest
): Promise<OnboardingProviderLoginResponse> {
  return requestJson<OnboardingProviderLoginResponse>("/api/onboarding/provider-login/poll", {
    method: "POST",
    body: input
  });
}
```

- [ ] **Step 4: Run test + web typecheck**

Run: `pnpm exec vitest run tests/unit/web-onboarding-connect-client.test.ts && pnpm --filter @jarv1s/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts tests/unit/web-onboarding-connect-client.test.ts
git commit -m "feat(#365): add onboarding provider install/login client methods"
```

---

### Task 5: Pure connect state-machine module

**Files:**

- Create: `apps/web/src/onboarding/provider-connect-machine.ts`
- Test: `tests/unit/onboarding-provider-connect-machine.test.ts` (create)

**Interfaces:**

- Produces (consumed by Task 6):
  - `type LoginPhase = "idle" | "beginning" | "awaiting_token" | "submitting" | "polling" | "no_url"`
  - `interface LoginSession { readonly phase: LoginPhase; readonly loginId?: string; readonly authorizationUrl?: string; readonly error?: string }`
  - `const IDLE_LOGIN: LoginSession`
  - `type CardStatus = "unavailable" | "not_installed" | "installing" | "needs_login" | "logging_in" | "no_login" | "ready" | "error"`
  - `interface CardModel { readonly status: CardStatus; readonly busy: boolean; readonly errorMessage?: string; readonly authorizationUrl?: string; readonly awaitingToken: boolean; readonly inFlight: boolean }`
  - `function deriveCardModel(args: { provider: OnboardingCliProviderDto; login: LoginSession; installing: boolean; busy: boolean; errorMessage?: string }): CardModel`
  - `function shouldAutoLogin(installState: ProviderInstallState): boolean`
  - `type LoginNext = { kind: "awaiting_token"; loginId: string; authorizationUrl: string } | { kind: "no_url"; loginId: string } | { kind: "poll"; loginId: string } | { kind: "ready" } | { kind: "error"; message: string }`
  - `function interpretLoginResponse(resp: OnboardingProviderLoginResponse, phase: "begin" | "submit" | "poll"): LoginNext`

- [ ] **Step 1: Write the failing tests** — `tests/unit/onboarding-provider-connect-machine.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { OnboardingCliProviderDto } from "@jarv1s/shared";
import {
  deriveCardModel,
  interpretLoginResponse,
  shouldAutoLogin,
  IDLE_LOGIN
} from "../../apps/web/src/onboarding/provider-connect-machine.js";

const provider = (over: Partial<OnboardingCliProviderDto>): OnboardingCliProviderDto => ({
  kind: "anthropic",
  cliPresent: false,
  ...over
});

describe("deriveCardModel", () => {
  it("non-installable provider ⇒ unavailable, non-blocking", () => {
    const m = deriveCardModel({
      provider: provider({ kind: "google", installable: false }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("unavailable");
  });

  it("installable + no install row ⇒ not_installed (offer Connect)", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("not_installed");
  });

  it("installing flag ⇒ installing + inFlight", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "installing" }),
      login: IDLE_LOGIN,
      installing: true,
      busy: false
    });
    expect(m.status).toBe("installing");
    expect(m.inFlight).toBe(true);
  });

  it("installState needs_login (idle login) ⇒ needs_login", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "needs_login" }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("needs_login");
  });

  it("awaiting_token login session ⇒ logging_in, exposes url + paste field", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "needs_login" }),
      login: { phase: "awaiting_token", loginId: "L1", authorizationUrl: "https://x" },
      installing: false,
      busy: false
    });
    expect(m.status).toBe("logging_in");
    expect(m.awaitingToken).toBe(true);
    expect(m.authorizationUrl).toBe("https://x");
  });

  it("no_url login phase ⇒ no_login (codex headless degraded)", () => {
    const m = deriveCardModel({
      provider: provider({
        kind: "openai-compatible",
        installable: true,
        installState: "needs_login"
      }),
      login: { phase: "no_url", loginId: "L1" },
      installing: false,
      busy: false
    });
    expect(m.status).toBe("no_login");
  });

  it("installState ready ⇒ ready", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "ready" }),
      login: IDLE_LOGIN,
      installing: false,
      busy: false
    });
    expect(m.status).toBe("ready");
  });

  it("busy is surfaced orthogonally (503 single-active-user)", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true }),
      login: IDLE_LOGIN,
      installing: false,
      busy: true
    });
    expect(m.busy).toBe(true);
  });

  it("error message flows from the login session", () => {
    const m = deriveCardModel({
      provider: provider({ installable: true, installState: "error" }),
      login: { phase: "idle", error: "login smoke check failed" },
      installing: false,
      busy: false
    });
    expect(m.status).toBe("error");
    expect(m.errorMessage).toBe("login smoke check failed");
  });
});

describe("shouldAutoLogin", () => {
  it("auto-advances to login from installed / needs_login", () => {
    expect(shouldAutoLogin("installed")).toBe(true);
    expect(shouldAutoLogin("needs_login")).toBe(true);
  });
  it("does not auto-login from error / ready / not_installed", () => {
    expect(shouldAutoLogin("error")).toBe(false);
    expect(shouldAutoLogin("ready")).toBe(false);
    expect(shouldAutoLogin("not_installed")).toBe(false);
  });
});

describe("interpretLoginResponse", () => {
  const base = {
    providerKind: "anthropic" as const,
    loginId: "L1",
    installState: "needs_login" as const
  };

  it("begin with authorizationUrl ⇒ awaiting_token", () => {
    const next = interpretLoginResponse(
      { ...base, status: "awaiting_token", authorizationUrl: "https://x" },
      "begin"
    );
    expect(next).toEqual({ kind: "awaiting_token", loginId: "L1", authorizationUrl: "https://x" });
  });

  it("begin with NO url ⇒ no_url (codex headless)", () => {
    const next = interpretLoginResponse({ ...base, status: "awaiting_token" }, "begin");
    expect(next).toEqual({ kind: "no_url", loginId: "L1" });
  });

  it("ready status ⇒ ready (any phase)", () => {
    expect(
      interpretLoginResponse({ ...base, status: "ready", installState: "ready" }, "submit")
    ).toEqual({ kind: "ready" });
  });

  it("error status ⇒ error with message", () => {
    expect(
      interpretLoginResponse({ ...base, status: "error", message: "bad code" }, "submit")
    ).toEqual({ kind: "error", message: "bad code" });
  });

  it("submit still awaiting ⇒ poll", () => {
    expect(interpretLoginResponse({ ...base, status: "awaiting_token" }, "submit")).toEqual({
      kind: "poll",
      loginId: "L1"
    });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run tests/unit/onboarding-provider-connect-machine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `apps/web/src/onboarding/provider-connect-machine.ts`

```ts
import type {
  OnboardingCliProviderDto,
  OnboardingProviderLoginResponse,
  ProviderInstallState
} from "@jarv1s/shared";

// The transient, CLIENT-ONLY login session (never persisted; resume relies on installState).
export type LoginPhase =
  | "idle"
  | "beginning"
  | "awaiting_token"
  | "submitting"
  | "polling"
  | "no_url";

export interface LoginSession {
  readonly phase: LoginPhase;
  readonly loginId?: string;
  readonly authorizationUrl?: string;
  readonly error?: string;
}

export const IDLE_LOGIN: LoginSession = { phase: "idle" };

export type CardStatus =
  | "unavailable"
  | "not_installed"
  | "installing"
  | "needs_login"
  | "logging_in"
  | "no_login"
  | "ready"
  | "error";

export interface CardModel {
  readonly status: CardStatus;
  readonly busy: boolean;
  readonly errorMessage?: string;
  readonly authorizationUrl?: string;
  readonly awaitingToken: boolean;
  readonly inFlight: boolean;
}

const ACTIVE_LOGIN: ReadonlySet<LoginPhase> = new Set([
  "beginning",
  "awaiting_token",
  "submitting",
  "polling"
]);

/** Pure: derive the per-card UI model from the persisted lifecycle + transient login session. */
export function deriveCardModel(args: {
  readonly provider: OnboardingCliProviderDto;
  readonly login: LoginSession;
  readonly installing: boolean;
  readonly busy: boolean;
  readonly errorMessage?: string;
}): CardModel {
  const { provider, login, installing, busy } = args;
  const errorMessage = login.error ?? args.errorMessage;
  const inFlight =
    installing ||
    login.phase === "beginning" ||
    login.phase === "submitting" ||
    login.phase === "polling";
  const base = {
    busy,
    awaitingToken: login.phase === "awaiting_token",
    authorizationUrl: login.phase === "awaiting_token" ? login.authorizationUrl : undefined,
    inFlight,
    ...(errorMessage !== undefined ? { errorMessage } : {})
  };

  if (provider.installable === false) return { ...base, status: "unavailable" };
  if (installing) return { ...base, status: "installing" };
  if (login.phase === "no_url") return { ...base, status: "no_login" };
  if (ACTIVE_LOGIN.has(login.phase)) return { ...base, status: "logging_in" };

  switch (provider.installState) {
    case "ready":
      return { ...base, status: "ready" };
    case "error":
      return { ...base, status: "error" };
    case "needs_login":
    case "installed":
      return { ...base, status: "needs_login" };
    case "installing":
      return { ...base, status: "installing" };
    default:
      return { ...base, status: "not_installed" };
  }
}

/** After an install POST settles, should we chain straight into login? */
export function shouldAutoLogin(installState: ProviderInstallState): boolean {
  return installState === "installed" || installState === "needs_login";
}

export type LoginNext =
  | { readonly kind: "awaiting_token"; readonly loginId: string; readonly authorizationUrl: string }
  | { readonly kind: "no_url"; readonly loginId: string }
  | { readonly kind: "poll"; readonly loginId: string }
  | { readonly kind: "ready" }
  | { readonly kind: "error"; readonly message: string };

/** Pure: map a login response to the next client action. */
export function interpretLoginResponse(
  resp: OnboardingProviderLoginResponse,
  phase: "begin" | "submit" | "poll"
): LoginNext {
  if (resp.status === "ready") return { kind: "ready" };
  if (resp.status === "error") return { kind: "error", message: resp.message ?? "Login failed." };
  // awaiting_authorization | awaiting_token (not settled)
  if (phase === "begin") {
    if (!resp.authorizationUrl) return { kind: "no_url", loginId: resp.loginId };
    return {
      kind: "awaiting_token",
      loginId: resp.loginId,
      authorizationUrl: resp.authorizationUrl
    };
  }
  return { kind: "poll", loginId: resp.loginId };
}
```

- [ ] **Step 4: Run tests + web typecheck**

Run: `pnpm exec vitest run tests/unit/onboarding-provider-connect-machine.test.ts && pnpm --filter @jarv1s/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/onboarding/provider-connect-machine.ts tests/unit/onboarding-provider-connect-machine.test.ts
git commit -m "feat(#365): pure provider-connect state machine"
```

---

### Task 6: Provider-connect step — `ProviderCard` (presentational) + stateful `CliAuthStep`

**Files:**

- Modify (replace contents): `apps/web/src/onboarding/cli-auth-step.tsx`
- Test: `tests/unit/onboarding-provider-connect-step.test.tsx` (create)

**Interfaces:**

- Consumes: Task 4 client methods, Task 5 machine (`deriveCardModel`, `interpretLoginResponse`, `shouldAutoLogin`, `IDLE_LOGIN`, `CardModel`), `ApiError` (`.status === 503` ⇒ busy).
- Produces: `export function ProviderCard(props: { model: CardModel; label: string; onConnect: () => void; onLogin: () => void; onSubmitToken: (code: string) => void; tokenValue: string; onTokenChange: (v: string) => void })` and the default-exported (named) `CliAuthStep` with the unchanged signature `{ step: OnboardingCliAuthStepDto; onRecheck: () => Promise<unknown> | void }` (the wizard already passes these).

- [ ] **Step 1: Write the failing render tests** — `tests/unit/onboarding-provider-connect-step.test.tsx`

```ts
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { CardModel } from "../../apps/web/src/onboarding/provider-connect-machine.js";
import { ProviderCard } from "../../apps/web/src/onboarding/cli-auth-step.js";

const noop = () => undefined;
function render(model: CardModel, label = "Claude"): string {
  return renderToString(
    createElement(ProviderCard, {
      model,
      label,
      onConnect: noop,
      onLogin: noop,
      onSubmitToken: noop,
      tokenValue: "",
      onTokenChange: noop
    })
  );
}
const baseModel = (over: Partial<CardModel>): CardModel => ({
  status: "not_installed",
  busy: false,
  awaitingToken: false,
  inFlight: false,
  ...over
});

describe("ProviderCard (rendered)", () => {
  it("not_installed shows a Connect affordance", () => {
    expect(render(baseModel({ status: "not_installed" })).toLowerCase()).toContain("connect");
  });

  it("ready shows the connected / chat-ready confirmation", () => {
    const html = render(baseModel({ status: "ready" })).toLowerCase();
    expect(html).toContain("connected");
    expect(html).toContain("chat");
  });

  it("logging_in awaiting token shows the auth URL link and a paste-code field", () => {
    const html = render(
      baseModel({
        status: "logging_in",
        awaitingToken: true,
        authorizationUrl: "https://claude.ai/oauth/x"
      })
    );
    expect(html).toContain("https://claude.ai/oauth/x");
    expect(html.toLowerCase()).toContain("paste");
  });

  it("no_login (codex headless) shows the degraded, non-blocking message", () => {
    expect(render(baseModel({ status: "no_login" }), "Codex").toLowerCase()).toContain("headless");
  });

  it("unavailable shows a not-available message and no Connect button", () => {
    const html = render(baseModel({ status: "unavailable" }), "Antigravity").toLowerCase();
    expect(html).toContain("not");
    expect(html).not.toContain(">connect<");
  });

  it("busy surfaces an inline one-at-a-time notice", () => {
    expect(render(baseModel({ status: "not_installed", busy: true })).toLowerCase()).toContain(
      "busy"
    );
  });

  it("error surfaces the message", () => {
    expect(render(baseModel({ status: "error", errorMessage: "verify failed" }))).toContain(
      "verify failed"
    );
  });

  it("never renders a token/secret label leak", () => {
    const html = render(
      baseModel({ status: "logging_in", awaitingToken: true, authorizationUrl: "https://x" })
    );
    expect(html).not.toMatch(/secret|password|credential/i);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run tests/unit/onboarding-provider-connect-step.test.tsx`
Expected: FAIL — `ProviderCard` not exported.

- [ ] **Step 3: Implement** the new `apps/web/src/onboarding/cli-auth-step.tsx`

Replace the file with the provider-connect step. Keep the export name `CliAuthStep` and signature `{ step, onRecheck }` (so the wizard is untouched). Structure:

- `PROVIDER_LABELS: Record<OnboardingProviderKind, string>` → `{ anthropic: "Claude", "openai-compatible": "Codex", google: "Antigravity" }`.
- `CliAuthStep`: holds per-provider transient state `Record<kind, { login: LoginSession; installing: boolean; busy: boolean; error?: string; token: string }>`; for each `props.step.providers` compute `model = deriveCardModel(...)` and render `<ProviderCard .../>`.
- Handlers (async, sequential per the single-active-user gate):
  - `onConnect(kind)`: set `installing`, clear busy/error → `installOnboardingProvider({providerKind:kind})`; on resolve, clear installing, if `shouldAutoLogin(res.installState)` call `beginLogin(kind)`, else if `res.installState==="error"` set error `res.message`; on `ApiError` 503 set busy, else set generic error; finally `await props.onRecheck()` (refresh persisted status).
  - `beginLogin(kind)` / `onLogin(kind)`: set `login.phase="beginning"` → `beginOnboardingProviderLogin` → `interpretLoginResponse(res,"begin")`: `awaiting_token`⇒set session url+loginId; `no_url`⇒phase no_url; `ready`⇒`onRecheck()` + idle; `error`⇒error; (`poll` not expected from begin). 503⇒busy.
  - `onSubmitToken(kind, code)`: set `login.phase="submitting"` → `submitOnboardingProviderLoginToken({providerKind,loginId,token:code})` → `interpretLoginResponse(res,"submit")`: `ready`⇒`onRecheck()`+idle; `error`⇒error; `poll`⇒`pollUntilSettled(kind, loginId)`. 503⇒busy. The `code` is read from state, sent, then cleared — never logged.
  - `pollUntilSettled(kind, loginId)`: bounded loop (max 20 attempts, 1500ms apart) calling `pollOnboardingProviderLogin`; `interpretLoginResponse(res,"poll")`: `ready`⇒onRecheck+idle, `error`⇒error, `poll`⇒wait + continue; on exhaustion set error "Login timed out — try again." Use a phase `"polling"` while looping.
- `ProviderCard` (exported, presentational, pure from `model`): renders per `model.status`:
  - `unavailable`: muted "Login isn't available for {label} yet." no Connect.
  - `not_installed`: `<button>Connect</button>` (disabled when `model.busy`), hint "Installs + signs you in · ~30–90s".
  - `installing`: spinner + "Installing… ~30–90s".
  - `needs_login`: `<button onClick={onLogin}>Log in</button>`.
  - `logging_in` + `awaitingToken`: open-in-new-tab link to `model.authorizationUrl` + copy button + a paste-code `<input>` (value `tokenValue`, onChange `onTokenChange`) + `<button>Submit</button>` (calls `onSubmitToken(tokenValue)`); when not awaitingToken show spinner "Signing in…".
  - `no_login`: "Login isn't available headless yet for {label}." non-blocking.
  - `ready`: "Connected · chat ready" with a check.
  - `error`: the `errorMessage` + a Retry (`onConnect` or `onLogin` depending — use `onLogin` if installState present else `onConnect`; for simplicity Retry calls `onConnect`).
  - When `model.busy`: an inline "Another setup is in progress — try again in a moment." notice (the word "busy" must appear for the test; include a class `onb-auth__busy` and the copy "Setup busy").
- Reuse existing `onb-cli`/`onb-auth` classnames + `StepHeader`/`onb-scan` layout from the old file where sensible; keep lucide icons already imported.

> Keep the file < 1000 lines (it will be ~300). Do NOT log the token anywhere.

- [ ] **Step 4: Run the render tests + the multiplexer render test + web typecheck + lint**

Run: `pnpm exec vitest run tests/unit/onboarding-provider-connect-step.test.tsx && pnpm --filter @jarv1s/web typecheck && pnpm exec eslint apps/web/src/onboarding/cli-auth-step.tsx`
Expected: PASS.

- [ ] **Step 5: Verify the wizard still type-checks against the unchanged signature**

Run: `pnpm typecheck`
Expected: PASS — `OnboardingWizard` passes `{ step: founderSteps.cliAuth, onRecheck: invalidateStatus }`; the FinishStep recap keys off `cliAuth.done` (now ready-based) with no code change.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/onboarding/cli-auth-step.tsx tests/unit/onboarding-provider-connect-step.test.tsx
git commit -m "feat(#365): provider-connect onboarding step (install -> login -> chat ready)"
```

---

### Task 7: Full-gate green + self-review

**Files:** none (verification)

- [ ] **Step 1: Run the maintainability gate**

Run: `pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck`
Expected: all green. (`pnpm format` first if format:check flags anything.)

- [ ] **Step 2: Run the affected test suites**

Run: `pnpm exec vitest run tests/unit && pnpm exec vitest run tests/integration/onboarding.test.ts`
Expected: green (DB up for the integration file).

- [ ] **Step 3: Spec self-review** — confirm against the spec:
  - One Connect button chains install→login (Task 6 `onConnect` → auto `beginLogin`). ✓
  - No manual model-id UI (none added; #367 auto-registers on `ready`). ✓
  - Providers data-driven (offering via `installable`; labels only hardcoded). ✓
  - Steered-but-skippable; `done` ⇔ ≥1 `ready` (Task 2). ✓
  - codex no-URL degraded path (`no_login`). ✓
  - busy(503) inline, no crash. ✓
  - Secrets: token forwarded only, never logged/echoed (Tasks 4/6). ✓

- [ ] **Step 4: Hand off to `coordinated-wrap-up`** (PR + report to coordinator). Do NOT merge / move the board.
