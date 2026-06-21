# Auto-register default chat model on provider login (#367) — Implementation Plan

> **For agentic workers:** This plan is executed task-by-task by the build agent (coordinated-build). Steps use checkbox (`- [ ]`) syntax for tracking. TDD per task; commit green.

**Goal:** After a provider's login settles `ready`, idempotently ensure an AI provider config (`authMethod: "cli"`, no credential) + a default `chat`-capable model row exist, so `selectChatModelForUser` resolves a working model with zero manual entry — and the chat launch actually passes that model via `--model`.

**Architecture:** A new provider-agnostic registration service in `@jarv1s/ai` (`AiAutoRegisterService`) is driven by a per-provider catalog-defaults map (`DEFAULT_CHAT_MODELS`). The single login chokepoint — `persistLoginTerminal`'s `ready` branch in the module-registry composition root (`onboarding-login.ts`) — calls it (best-effort) within the same admin-scoped `DataContextDb`. Separately, the resolved model id (the `sonnet` alias) is threaded from `resolveActiveProvider` → `EngineLaunchOpts`/`RpcLaunchParams` → `buildClaudeCommand` as `--model <id>` so the registered model takes effect.

**Tech Stack:** TypeScript, Kysely, Fastify, Vitest. Postgres RLS (admin-scoped writes). pnpm workspace (`@jarv1s/ai`, `@jarv1s/chat`, `@jarv1s/cli-runner`, `@jarv1s/module-registry`, `@jarv1s/settings`).

## Global Constraints

- **Provider-agnostic AI invariant:** no feature hardcodes a provider/model in a code path. The default lives in per-provider data (`DEFAULT_CHAT_MODELS`); the service is generic over `AiProviderKind`. (CLAUDE.md Hard Invariant.)
- **DataContextDb only:** every repository method takes the branded `DataContextDb`; never a root Kysely instance. Admin-scoped writes (the route already asserts owner-admin before `persistLoginTerminal`).
- **No secrets in logs/payloads/prompts.** CLI providers store NO credential (`encryptedCredential = cipher.encryptJson({ cli: true })`, mirroring the existing Admin create path). The login token never reaches this service.
- **No new migration.** Use existing tables (`app.ai_provider_configs`, `app.ai_configured_models`) and `AiRepository`. If a migration appears necessary → STOP and escalate (numbers are coordinator-assigned).
- **Module isolation:** `@jarv1s/settings` must NOT import `@jarv1s/ai`/`@jarv1s/cli-runner`. The auto-register call is wired in the composition root (`@jarv1s/module-registry`) and injected into `buildOnboardingLogin` as a port.
- **Default model id = the `sonnet` ALIAS** (not a pinned full id): anthropic → `{ providerModelId: "sonnet", displayName: "Claude Sonnet" }`.
- **Co-Authored-By trailer** on every commit = the real build model.

## Idempotency / gate semantics (locked)

`AiModelStatus = "active" | "disabled"`; models are NEVER hard-deleted (no DELETE route — "remove" in Admin = PATCH to `disabled`). Therefore:

- **Provider config:** reuse an existing **non-revoked** provider config of this kind if present; else create one (`authMethod: "cli"`, `status: "active"`, no credential).
- **Model gate:** create the default model **only if NO `chat`-capable model row exists (ANY status) under a non-revoked provider config of this kind.** This single gate satisfies all three rules:
  - re-login with an active model → row exists → skip (no duplicate);
  - user-removed model (now `disabled`) under an active provider → row exists → skip (never resurrect — decision 2);
  - never clobber a customized model (we only ever INSERT when none exists; never UPDATE).
- The service **never throws into the login flow**: a registration failure is caught + logged; login still reports `ready` (auth succeeded; worst case is today's "add a model" state, never a failed-looking login).

## File Structure

- **Create** `packages/ai/src/auto-register.ts` — `DEFAULT_CHAT_MODELS` map + `AiAutoRegisterService` (the generic registration service + its injected port type).
- **Modify** `packages/ai/src/repository.ts` — add `findReusableProviderByKind` + `hasChatModelForProviderKind`.
- **Modify** `packages/ai/src/index.ts` — export `auto-register.ts`.
- **Modify** `packages/module-registry/src/onboarding-login.ts` — call the injected auto-register port in the `ready` branch (best-effort).
- **Modify** `packages/module-registry/src/index.ts` — construct the service and pass it into `buildOnboardingLogin`.
- **Modify** `packages/chat/src/live/types.ts` — `EngineLaunchOpts.model?: string`.
- **Modify** `packages/chat/src/live/rpc-contract.ts` — `RpcLaunchParams.model?: string`.
- **Modify** `packages/chat/src/live/chat-session-manager.ts` — pass `model` into `engine.launch`.
- **Modify** `packages/chat/src/live/chat-engine-rpc-client.ts` — forward `opts.model` into `RpcLaunchParams`.
- **Modify** `packages/cli-runner/src/engine-host.ts` — pass `model: params.model` into `engine.launch`.
- **Modify** `packages/chat/src/live/cli-chat-engine.ts` — `buildClaudeCommand` adds `--model <id>` when present.
- **Tests:** `tests/integration/ai-auto-register.test.ts` (new), `tests/unit/cli-chat-engine.test.ts` (extend).

---

## Task 1: `--model` plumbing through the launch path

Threads the already-resolved model id (the `sonnet` alias from `resolveActiveProvider`) end-to-end so the launched CLI uses the registered model. Pure additive optional field; no behavior change when absent.

**Files:**

- Modify: `packages/chat/src/live/types.ts` (EngineLaunchOpts)
- Modify: `packages/chat/src/live/rpc-contract.ts` (RpcLaunchParams)
- Modify: `packages/chat/src/live/chat-session-manager.ts:254` (launch call)
- Modify: `packages/chat/src/live/chat-engine-rpc-client.ts:649` (launch → params)
- Modify: `packages/cli-runner/src/engine-host.ts:175` (engine.launch)
- Modify: `packages/chat/src/live/cli-chat-engine.ts` (buildClaudeCommand)
- Test: `tests/unit/cli-chat-engine.test.ts`

**Interfaces:**

- Produces: `EngineLaunchOpts.model?: string`, `RpcLaunchParams.model?: string`. `buildClaudeCommand` emits `--model <model>` (shell-quoted) when `opts.model` is a non-empty string; omits the flag otherwise (rides the account default, as today).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/cli-chat-engine.test.ts`. Model present emits `--model`; absent omits it. Mirror the existing launch-line extraction (`sendKeysCall![1][3]`).

```ts
it("passes --model <id> on the claude launch line when a model is set", async () => {
  const { engine, io } = makeEngine("anthropic"); // use the file's existing engine/mux harness
  await engine.launch({
    neutralDir: "/tmp/neutral",
    personaPath: "/tmp/persona.txt",
    model: "sonnet"
  });
  const sendKeysCall = io.run.mock.calls.find(
    (c) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
  );
  const launchLine = (sendKeysCall![1] as string[])[3];
  expect(launchLine).toContain("--model 'sonnet'");
});

it("omits --model when no model is set", async () => {
  const { engine, io } = makeEngine("anthropic");
  await engine.launch({ neutralDir: "/tmp/neutral", personaPath: "/tmp/persona.txt" });
  const sendKeysCall = io.run.mock.calls.find(
    (c) => c[0] === "tmux" && (c[1] as string[])[0] === "send-keys"
  );
  const launchLine = (sendKeysCall![1] as string[])[3];
  expect(launchLine).not.toContain("--model");
});
```

> NOTE for implementer: reuse the exact engine/mux/io construction already used by the sibling tests at the top of this file (e.g. the `--tools ""` test). Do not invent a `makeEngine` helper if one isn't there — copy the existing setup inline.

- [ ] **Step 2: Run test, verify it fails** — `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts -t "model"`. Expected: FAIL (`--model` not present).

- [ ] **Step 3: Implement.**
  - `types.ts` — add to `EngineLaunchOpts`:
    ```ts
    /**
     * The resolved provider model id from the active chat model row (e.g. the "sonnet"
     * alias). When set, the claude launch passes `--model <id>` so the registered model
     * takes effect; absent ⇒ the launch rides the CLI account default (legacy behavior).
     */
    readonly model?: string;
    ```
  - `rpc-contract.ts` — add to `RpcLaunchParams` (after `replayBatch`):
    ```ts
    /** The resolved provider model id (e.g. "sonnet"); cli-runner passes it to the CLI as --model. */
    readonly model?: string;
    ```
  - `chat-session-manager.ts:254` — add `model,` to the `engine.launch({...})` object (the `model` const is already destructured at line 206).
  - `chat-engine-rpc-client.ts` `launch()` — add to the `params` spread: `...(opts.model !== undefined ? { model: opts.model } : {})`.
  - `engine-host.ts` `engine.launch({...})` — add `model: params.model`.
  - `cli-chat-engine.ts` `buildClaudeCommand` — after the `--session-id`/`--strict-mcp-config` push block, before `return parts.join(" ")`:
    ```ts
    if (opts.model) {
      parts.push(`--model ${shellQuote(opts.model)}`);
    }
    ```

- [ ] **Step 4: Run tests, verify pass** — `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts`. Expected: PASS.

- [ ] **Step 5: typecheck affected packages** — `pnpm typecheck`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/chat/src/live/types.ts packages/chat/src/live/rpc-contract.ts \
  packages/chat/src/live/chat-session-manager.ts packages/chat/src/live/chat-engine-rpc-client.ts \
  packages/cli-runner/src/engine-host.ts packages/chat/src/live/cli-chat-engine.ts \
  tests/unit/cli-chat-engine.test.ts
git commit -m "feat(#367): pass --model from the active chat model row through the launch path"
```

---

## Task 2: catalog defaults + `AiAutoRegisterService` (with repo helpers)

The provider-agnostic registration service + its data-driven defaults, plus the two `AiRepository` helpers it needs. Tested via integration (real Postgres + RLS) since it touches the DB.

**Files:**

- Create: `packages/ai/src/auto-register.ts`
- Modify: `packages/ai/src/repository.ts` (two new methods)
- Modify: `packages/ai/src/index.ts` (export)
- Test: `tests/integration/ai-auto-register.test.ts`

**Interfaces:**

- Consumes: `AiRepository`, `AiSecretCipher` (`@jarv1s/ai`), `DataContextDb` (`@jarv1s/db`), `AiProviderKind`.
- Produces:

  ```ts
  export interface DefaultChatModel {
    readonly providerModelId: string;
    readonly displayName: string; // the model row display name
    readonly providerDisplayName: string; // the provider config display name
    readonly tier: AiModelTier;
    readonly capabilities: readonly AiModelCapability[];
  }
  export const DEFAULT_CHAT_MODELS: Partial<Record<AiProviderKind, DefaultChatModel>>;

  export interface AiAutoRegisterPort {
    ensureDefaultChatModel(scopedDb: DataContextDb, providerKind: AiProviderKind): Promise<void>;
  }
  export class AiAutoRegisterService implements AiAutoRegisterPort {
    constructor(deps: { repository: AiRepository; cipher: AiSecretCipher });
    ensureDefaultChatModel(scopedDb: DataContextDb, providerKind: AiProviderKind): Promise<void>;
  }
  ```

  - `AiRepository.findReusableProviderByKind(scopedDb, kind): Promise<AiProviderConfigSafeRow | undefined>` — newest non-revoked config of that kind.
  - `AiRepository.hasChatModelForProviderKind(scopedDb, kind): Promise<boolean>` — true if any `chat`-capable model row (any status) exists under a non-revoked config of that kind.

- [ ] **Step 1: Write the failing integration test** — create `tests/integration/ai-auto-register.test.ts`. Model the harness on `tests/integration/ai.test.ts` (sets `JARVIS_AI_SECRET_KEY`, makes the actor an instance admin via `UPDATE app.users SET is_instance_admin = true`, uses `dataContext.withDataContext(adminCtx, ...)`). Cover:

```ts
// 1. First login: creates a cli provider config + the sonnet chat model; selectChatModelForUser returns it.
it("registers a default chat model on first ready", async () => {
  await dataContext.withDataContext(adminCtx(), (db) =>
    service.ensureDefaultChatModel(db, "anthropic")
  );
  const [providers, model] = await dataContext.withDataContext(adminCtx(), async (db) => [
    await repository.listProviders(db),
    await repository.selectChatModelForUser(db)
  ]);
  const cli = providers.find((p) => p.provider_kind === "anthropic");
  expect(cli?.auth_method).toBe("cli");
  expect(cli?.has_credential).toBe(true); // {cli:true} sealed — not a real credential, but a sealed blob
  expect(model?.provider_model_id).toBe("sonnet");
  expect(model?.capabilities).toContain("chat");
});

// 2. Idempotent: a second call creates nothing new.
it("is idempotent across re-login", async () => {
  await dataContext.withDataContext(adminCtx(), (db) =>
    service.ensureDefaultChatModel(db, "anthropic")
  );
  await dataContext.withDataContext(adminCtx(), (db) =>
    service.ensureDefaultChatModel(db, "anthropic")
  );
  const { providers, models } = await dataContext.withDataContext(adminCtx(), async (db) => ({
    providers: (await repository.listProviders(db)).filter((p) => p.provider_kind === "anthropic"),
    models: await repository.listModels(db)
  }));
  expect(providers).toHaveLength(1);
  expect(models.filter((m) => m.provider_model_id === "sonnet")).toHaveLength(1);
});

// 3. Never resurrects a user-removed (disabled) model.
it("does not recreate a model the user disabled", async () => {
  await dataContext.withDataContext(adminCtx(), (db) =>
    service.ensureDefaultChatModel(db, "anthropic")
  );
  const model = await dataContext.withDataContext(adminCtx(), (db) =>
    repository.selectChatModelForUser(db)
  );
  await dataContext.withDataContext(adminCtx(), (db) =>
    repository.updateModel(db, model!.id, { status: "disabled" })
  );
  await dataContext.withDataContext(adminCtx(), (db) =>
    service.ensureDefaultChatModel(db, "anthropic")
  ); // re-login
  const models = await dataContext.withDataContext(adminCtx(), (db) => repository.listModels(db));
  expect(models.filter((m) => m.provider_model_id === "sonnet")).toHaveLength(1);
  expect(models[0]?.status).toBe("disabled"); // still disabled, not resurrected
});

// 4. Reuses an existing active provider config instead of duplicating it.
it("reuses an existing non-revoked provider config", async () => {
  await dataContext.withDataContext(adminCtx(), (db) =>
    repository.createProvider(db, {
      providerKind: "anthropic",
      displayName: "Claude",
      authMethod: "cli",
      encryptedCredential: cipher.encryptJson({ cli: true })
    })
  );
  await dataContext.withDataContext(adminCtx(), (db) =>
    service.ensureDefaultChatModel(db, "anthropic")
  );
  const providers = await dataContext.withDataContext(adminCtx(), (db) =>
    repository.listProviders(db)
  );
  expect(providers.filter((p) => p.provider_kind === "anthropic")).toHaveLength(1);
});

// 5. Unknown provider (no catalog default) is a no-op, not a throw.
it("no-ops for a provider without a catalog default", async () => {
  await dataContext.withDataContext(adminCtx(), (db) =>
    service.ensureDefaultChatModel(db, "custom")
  );
  const providers = await dataContext.withDataContext(adminCtx(), (db) =>
    repository.listProviders(db)
  );
  expect(providers.filter((p) => p.provider_kind === "custom")).toHaveLength(0);
});
```

> NOTE: confirm `has_credential` semantics against the harness — `encrypted_credential IS NOT NULL` is true for a sealed `{cli:true}` blob. Adjust the assertion to match the existing ai.test.ts expectation for cli providers if it differs.

- [ ] **Step 2: Run test, verify it fails** — `pnpm db:up` (if needed) then `pnpm exec vitest run tests/integration/ai-auto-register.test.ts`. Expected: FAIL (module/methods not defined).

- [ ] **Step 3: Add the repository helpers** to `packages/ai/src/repository.ts` (alongside the other provider/model methods):

```ts
async findReusableProviderByKind(
  scopedDb: DataContextDb,
  providerKind: AiProviderKind
): Promise<AiProviderConfigSafeRow | undefined> {
  assertDataContextDb(scopedDb);
  return this.safeProviderQuery(scopedDb)
    .where("provider_kind", "=", providerKind)
    .where("status", "!=", "revoked")
    .executeTakeFirst();
}

async hasChatModelForProviderKind(
  scopedDb: DataContextDb,
  providerKind: AiProviderKind
): Promise<boolean> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.ai_configured_models as models")
    .innerJoin("app.ai_provider_configs as providers", "providers.id", "models.provider_config_id")
    .select(sql<boolean>`true`.as("has_it"))
    .where("providers.provider_kind", "=", providerKind)
    .where("providers.status", "!=", "revoked")
    .where(sql<boolean>`'chat' = any(${sql.ref("models.capabilities")})`)
    .executeTakeFirst();
  return row?.has_it ?? false;
}
```

> `safeProviderQuery` already orders by `created_at desc` so `executeTakeFirst` returns the newest matching config.

- [ ] **Step 4: Create `packages/ai/src/auto-register.ts`:**

```ts
import type { AiModelCapability } from "@jarv1s/shared";
import type { AiModelTier, AiProviderKind, DataContextDb } from "@jarv1s/db";

import type { AiSecretCipher } from "./crypto.js";
import { AiRepository } from "./repository.js";

/** A provider's data-driven default chat model (provider-agnostic — no code path hardcodes a model). */
export interface DefaultChatModel {
  readonly providerModelId: string;
  readonly displayName: string;
  readonly providerDisplayName: string;
  readonly tier: AiModelTier;
  readonly capabilities: readonly AiModelCapability[];
}

/**
 * Per-provider default chat model registered on login `ready`. The id is the provider's
 * ALIAS, not a pinned full id (decision 2): "sonnet" stays current across Sonnet releases.
 * Adding a provider = a new entry here, no new code path.
 */
export const DEFAULT_CHAT_MODELS: Partial<Record<AiProviderKind, DefaultChatModel>> = {
  anthropic: {
    providerModelId: "sonnet",
    displayName: "Claude Sonnet",
    providerDisplayName: "Claude",
    tier: "interactive",
    capabilities: ["chat"]
  }
};

/** The seam the login flow calls on `ready`. Generic over providerKind. */
export interface AiAutoRegisterPort {
  ensureDefaultChatModel(scopedDb: DataContextDb, providerKind: AiProviderKind): Promise<void>;
}

/**
 * Idempotently ensures a CLI provider config + a default chat model exist for a provider
 * after its login settles `ready` (#367). Reuses an existing non-revoked config; creates the
 * default model ONLY when no chat-capable model row (any status) exists under a non-revoked
 * config of that kind — so a re-login never duplicates a row and never resurrects a model the
 * founder disabled in Admin (decision 2). Never clobbers a customized model (INSERT-only).
 */
export class AiAutoRegisterService implements AiAutoRegisterPort {
  private readonly repository: AiRepository;
  private readonly cipher: AiSecretCipher;

  constructor(deps: { readonly repository: AiRepository; readonly cipher: AiSecretCipher }) {
    this.repository = deps.repository;
    this.cipher = deps.cipher;
  }

  async ensureDefaultChatModel(
    scopedDb: DataContextDb,
    providerKind: AiProviderKind
  ): Promise<void> {
    const def = DEFAULT_CHAT_MODELS[providerKind];
    if (!def) return; // no catalog default for this provider — nothing to register.

    // Gate: a chat model already exists for this kind (active OR user-disabled) → leave it.
    if (await this.repository.hasChatModelForProviderKind(scopedDb, providerKind)) return;

    // Reuse a non-revoked config of this kind, else create a cli (no-credential) one.
    const existing = await this.repository.findReusableProviderByKind(scopedDb, providerKind);
    const providerConfig =
      existing ??
      (await this.repository.createProvider(scopedDb, {
        providerKind,
        displayName: def.providerDisplayName,
        status: "active",
        authMethod: "cli",
        // CLI providers carry NO real credential — seal the same {cli:true} marker the
        // Admin create path uses (no secret is stored/logged).
        encryptedCredential: this.cipher.encryptJson({ cli: true })
      }));

    await this.repository.createModel(scopedDb, {
      providerConfigId: providerConfig.id,
      providerModelId: def.providerModelId,
      displayName: def.displayName,
      capabilities: def.capabilities,
      status: "active",
      tier: def.tier
    });
  }
}
```

- [ ] **Step 5: Export from `packages/ai/src/index.ts`** — add `export * from "./auto-register.js";`.

- [ ] **Step 6: Run tests, verify pass** — `pnpm exec vitest run tests/integration/ai-auto-register.test.ts`. Expected: PASS (all 5).

- [ ] **Step 7: typecheck** — `pnpm typecheck`. Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/ai/src/auto-register.ts packages/ai/src/repository.ts packages/ai/src/index.ts \
  tests/integration/ai-auto-register.test.ts
git commit -m "feat(#367): AiAutoRegisterService + per-provider default chat model catalog"
```

---

## Task 3: wire auto-register into the login `ready` chokepoint

Inject the service into `buildOnboardingLogin` and call it (best-effort) when `persistLoginTerminal` settles `ready`. Both the onboarding wizard and the settings connect/login path funnel through these same routes, so this one chokepoint covers both triggers (spec decision: "registration is not onboarding-specific").

**Files:**

- Modify: `packages/module-registry/src/onboarding-login.ts`
- Modify: `packages/module-registry/src/index.ts`
- Test: `tests/integration/ai-auto-register.test.ts` (add a wiring test driving `buildOnboardingLogin`'s stateStore)

**Interfaces:**

- Consumes: `AiAutoRegisterPort` (Task 2), the existing `SettingsRepository` install-state methods.
- `buildOnboardingLogin` deps gain `autoRegister?: AiAutoRegisterPort` and `logger?: { warn(obj, msg): void }` (mirror the install seam's logger shape already used at index.ts:663). Absent `autoRegister` ⇒ ready persists exactly as today (no-op) — keeps existing tests green.

- [ ] **Step 1: Write the failing test** — add to `tests/integration/ai-auto-register.test.ts`: build the login seam with a real `AiAutoRegisterService` and drive its `stateStore.persistLoginTerminal(db, { provider, status: "ready", requestId })`; assert a sonnet model becomes resolvable; and that a thrown auto-register error does NOT propagate (best-effort).

```ts
it("auto-registers when persistLoginTerminal settles ready, and never throws into login", async () => {
  const seam = buildOnboardingLogin({
    enabled: true,
    getConnection: () => undefined, // not exercised; we call stateStore directly
    repository: new SettingsRepository(),
    autoRegister: service,
    logger: { warn: () => {} }
  })!;
  await dataContext.withDataContext(adminCtx(), (db) =>
    seam.stateStore.persistLoginTerminal(db, {
      provider: "anthropic",
      status: "ready",
      requestId: "r1"
    })
  );
  const model = await dataContext.withDataContext(adminCtx(), (db) =>
    repository.selectChatModelForUser(db)
  );
  expect(model?.provider_model_id).toBe("sonnet");

  // best-effort: a throwing port must not fail the ready persist
  const throwingSeam = buildOnboardingLogin({
    enabled: true,
    getConnection: () => undefined,
    repository: new SettingsRepository(),
    autoRegister: {
      ensureDefaultChatModel: async () => {
        throw new Error("boom");
      }
    },
    logger: { warn: () => {} }
  })!;
  const state = await dataContext.withDataContext(adminCtx(), (db) =>
    throwingSeam.stateStore.persistLoginTerminal(db, {
      provider: "openai-compatible",
      status: "ready",
      requestId: "r2"
    })
  );
  expect(state).toBe("ready");
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm exec vitest run tests/integration/ai-auto-register.test.ts -t "persistLoginTerminal"`. Expected: FAIL (`autoRegister` dep not accepted).

- [ ] **Step 3: Implement in `onboarding-login.ts`.**
  - Import the port + provider-kind types:
    ```ts
    import type { AiAutoRegisterPort } from "@jarv1s/ai";
    import type { AiProviderKind } from "@jarv1s/db";
    ```
  - Extend `buildOnboardingLogin`'s deps object with:
    ```ts
    readonly autoRegister?: AiAutoRegisterPort;
    readonly logger?: { readonly warn: (obj: unknown, msg: string) => void };
    ```
  - In `stateStore.persistLoginTerminal`, the `status === "ready"` branch:
    ```ts
    if (status === "ready") {
      const state = await repository.upsertProviderInstallState(scopedDb, {
        provider,
        state: "ready"
      });
      // #367: best-effort default-model registration — chat works with zero manual entry. A
      // failure here must NEVER fail the login (auth already succeeded); log + continue.
      if (deps.autoRegister) {
        try {
          await deps.autoRegister.ensureDefaultChatModel(scopedDb, provider as AiProviderKind);
        } catch (err) {
          deps.logger?.warn(
            { err, provider },
            "auto-register default chat model failed after login ready"
          );
        }
      }
      return state;
    }
    ```
    > `OnboardingProviderKind` ("anthropic" | "openai-compatible" | "google") is a subset of `AiProviderKind`; the `as AiProviderKind` widening is safe.

- [ ] **Step 4: Wire in `packages/module-registry/src/index.ts`.** `aiRepository` (line 280) and `cipher` (281) already exist in this scope. Construct the service once and pass it into `buildOnboardingLogin` (line 670):

  ```ts
  import { AiAutoRegisterService } from "@jarv1s/ai"; // add to the existing @jarv1s/ai import
  // ...
  const onboardingLogin: OnboardingLoginDependencies | undefined = buildOnboardingLogin({
    enabled: socketConfigured,
    getConnection: getRpcConnection,
    repository: new SettingsRepository(),
    autoRegister: new AiAutoRegisterService({ repository: aiRepository, cipher }),
    logger: { warn: (obj, msg) => server.log.warn(obj, msg) }
  });
  ```

  > Confirm `aiRepository`/`cipher` are in scope at line 670; if they were declared inside a narrower block, hoist the `new AiAutoRegisterService(...)` to where they're visible or construct fresh `new AiRepository()` / `createAiSecretCipher()` (as index.ts already does at 454/455).

- [ ] **Step 5: Run tests, verify pass** — `pnpm exec vitest run tests/integration/ai-auto-register.test.ts`. Expected: PASS.

- [ ] **Step 6: Guard against regressions** — run the login + onboarding suites that exercise this seam:
      `pnpm exec vitest run tests/integration/chat-multiplexer-admin.test.ts` and any onboarding-login integration test (grep `persistLoginTerminal`/`provider-login` under `tests/`). Expected: PASS.

- [ ] **Step 7: typecheck** — `pnpm typecheck`. Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/module-registry/src/onboarding-login.ts packages/module-registry/src/index.ts \
  tests/integration/ai-auto-register.test.ts
git commit -m "feat(#367): trigger auto-register on login ready (onboarding + settings share the chokepoint)"
```

---

## Task 4: full gate + foundation migration-list check

No migration was added, but `tests/integration/foundation.test.ts` asserts the full migration list and the broad suite must stay green.

**Files:** none (verification only).

- [ ] **Step 1: pre-push trio** — `pnpm format:check && pnpm lint && pnpm typecheck`. Fix anything red (scope `pnpm format` to changed paths only — do NOT run repo-wide format + broad `git add`).
- [ ] **Step 2: file-size gate** — `pnpm check:file-size`. Expected: PASS (no source file >1000 lines; `repository.ts` is ~810 after additions — verify it stays under).
- [ ] **Step 3: targeted integration** — `pnpm exec vitest run tests/integration/ai-auto-register.test.ts tests/integration/ai.test.ts tests/integration/ai-chat-model-override.test.ts`. Expected: PASS.
- [ ] **Step 4: unit** — `pnpm test:unit` (or `pnpm exec vitest run tests/unit/cli-chat-engine.test.ts`). Expected: PASS.
- [ ] **Step 5: foundation** — `pnpm exec vitest run tests/integration/foundation.test.ts`. Expected: PASS (no migration change ⇒ list unchanged).
- [ ] **Step 6: fresh rebase + report** — `git fetch origin main && git rebase origin/main`, re-run the trio, then hand off to `coordinated-wrap-up`.

---

## Self-Review

- **Spec coverage:** Decision 1 (auto-register on ready) → Task 3. Decision 2 + 2a (sonnet alias default; `--model` passed) → Task 2 (`DEFAULT_CHAT_MODELS`) + Task 1 (`--model`). Decision 3 (no live discovery) → nothing built (correct). Design "catalog default" → Task 2. "Registration mechanism idempotent / never clobber / never resurrect" → Task 2 gate semantics + Task 2 tests 2/3/4. "Trigger points: onboarding AND settings same service" → Task 3 (shared route chokepoint). "Selection unchanged" → no resolver change (confirmed). Security/invariants (no credential, reuse admin gate, provider-agnostic) → Task 2 + the route's existing `assertBootstrapOwnerAdminUser`.
- **Placeholder scan:** none — every code step shows concrete code.
- **Type consistency:** `ensureDefaultChatModel`, `AiAutoRegisterPort`, `DEFAULT_CHAT_MODELS`, `findReusableProviderByKind`, `hasChatModelForProviderKind`, `EngineLaunchOpts.model`, `RpcLaunchParams.model` used consistently across tasks.

## Open notes for the Coordinator

- **Admin gate reuse:** the spec says "reuse `assertInstanceAdmin`". The chosen chokepoint (`persistLoginTerminal`) runs INSIDE the route's `assertBootstrapOwnerAdminUser` + admin-scoped `DataContextDb` (onboarding-routes.ts:669/700/734), so the writes are already owner-admin-gated and RLS-scoped — the service does not re-assert. Flagging in case you want an explicit re-assert inside the service instead.
- **Best-effort vs strict:** auto-register failure is caught + logged, never failing the login. Rationale in the plan. Flag if you want it strict (fail the ready transition on registration error).
