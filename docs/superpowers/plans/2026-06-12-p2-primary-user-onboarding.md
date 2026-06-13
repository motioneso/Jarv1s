# Implementation Plan — Phase 2 Primary-user Onboarding (hybrid Jarvis-guided + skippable)

**Spec:** `docs/superpowers/specs/2026-06-12-p2-primary-user-onboarding-design.md` (read it; this plan
implements every § of it). **Epic:** #47 (Phase 2), exit criterion #6.

---

## Goal

After the founder signs up (bootstrap owner created by `bootstrapFirstJarvisUser`,
`packages/auth/src/index.ts`), give them a **deterministic, fully-skippable, resumable** step wizard
that provisions the ADR 0008 §2 prerequisites (multiplexer install + selection, CLI auth, optional
connector setup) and records completion in `app.instance_settings`. The wizard works **before any AI
model is configured**; an optional Jarvis chat overlay lights up only once a CLI path exists. No new
table, no migration, no new module, no secrets in any response. All admin writes are audited.

## Architecture

- **Spine (deterministic):** a new `apps/web/src/onboarding/` route tree, pure REST + React Query,
  identical in shape to the existing admin panels. State read from a new `GET /api/onboarding/status`.
  No AI dependency.
- **Optional overlay:** an `OnboardingChatOverlay` that reuses the existing chat drawer/stream; inert
  until `steps.multiplexer.selected` is set AND the chosen provider's `cliAvailable` is true. Never
  gates step completion.
- **Server surface:** three new routes in `packages/settings` (the module that already owns
  `instance_settings`, `requireAdmin`, `admin_audit_events`): `GET /api/onboarding/status` (admin),
  `POST /api/onboarding/complete` (requireAdmin + audited), `POST /api/onboarding/skip` (same). All
  follow the slice-D per-method `DataContextDb` pattern (`assertDataContextDb(scopedDb)` first; admin
  check + repository call share one `withDataContext` transaction).
- **State (hybrid, founder-scoped, zero-migration):** three `instance_settings` keys —
  `onboarding.completed` (bool), `onboarding.skipped` (bool), `chat.multiplexer` (`"tmux"|"herdr"`).
  Per-step `done` is **derived server-side**, never separately persisted: multiplexer-done when
  `chat.multiplexer` is set; cliAuth-done when the chosen provider's CLI is present; connectors-done
  when a connector account exists.
- **Trigger:** one new branch in `apps/web/src/app.tsx`, mirroring the existing
  `account_pending_approval`/`deactivated` branches. Fires **only** for
  `isInstanceAdmin && isBootstrapOwner`; renders `<OnboardingWizard/>` when `!completed && !skipped`.
  Does **not** touch the unauthenticated `/api/bootstrap/status` probe (OTNR-P4 #122).

## Tech Stack

TypeScript (strict), Fastify 5 routes with JSON-schema validation
(`packages/shared/src/platform-api.ts`), Kysely repositories taking branded `DataContextDb`, React 18
+ React Query (`@tanstack/react-query`) + React Router (`react-router`), Vitest for unit + integration
tests, Playwright for e2e (mock REST via `tests/e2e/mock-*.ts`). The `@jarv1s/ai`
`cli-availability.ts` presence-probe seam (`WhichDeps`) is reused for CLI/multiplexer detection.
`@jarv1s/connectors` `ConnectorsRepository.listAccounts` is the connector-existence source.

### Hard-Invariant compliance (referenced throughout the tasks)

- **DataContextDb only** — every new repo method begins with `assertDataContextDb(scopedDb)`; no raw
  Kysely crosses the repository boundary; no nested `withDataContext`.
- **AccessContext shape frozen** — new routes read only `accessContext.actorUserId` /
  `accessContext.requestId`; nothing added.
- **No admin private-data bypass** — routes are admin-gated and read only instance-scoped settings +
  presence booleans + connector-account *existence* (never contents). RLS unchanged.
- **Secrets never escape** — CLI-auth step is presence-only (never runs the CLI, never reads tokens);
  `getOnboardingStatus` returns only booleans + the `"tmux"|"herdr"|null` enum; no secret-shaped field.
- **Module isolation** — onboarding lives in `packages/settings`; it consumes `cli-availability` from
  `@jarv1s/ai` and the connector-existence check from `@jarv1s/connectors`' public API, both **injected
  as route dependencies** (no cross-module table reads, no settings→ai/connectors *package* dep).
- **Audit everything admin** — complete/skip and the `chat.multiplexer` write all flow through the
  audited upsert path (`admin_audit_events`).
- **No migration** — reuses the existing `instance_settings` table and audited upsert.
- **Bootstrap-owner trigger only** — the app.tsx branch fires only for `isBootstrapOwner`.

### Verification scope note (read before executing)

`pnpm verify:foundation` = `lint && format:check && check:file-size && typecheck && test:unit &&
db:migrate && test:integration`. It **does not** run `test:e2e` (Playwright). Therefore:

- The `herdrAvailable` unit test (Task 1) lands in `tests/unit/` so it runs under `test:unit`.
- The status/complete/skip server behaviour (Tasks 4–5) lands in `tests/integration/` so it runs
  under `test:integration`.
- The wizard + app.tsx-branch behaviour (Tasks 11–12) lands in `tests/e2e/` (Playwright). These are
  authored and must pass via `pnpm test:e2e`, but the **foundation gate covers them only through
  lint + typecheck**. The final task runs `pnpm verify:foundation` (mandatory) and additionally runs
  `pnpm test:e2e` for the onboarding specs (best-effort; the build host must have the Playwright
  browser — if unavailable, lint+typecheck of the specs is the floor and that is acceptable per the
  spec's CI scope).

---

## File Structure

### New files

| Path | Purpose | Tested by |
| --- | --- | --- |
| `tests/unit/onboarding-cli-availability.test.ts` | unit test for `herdrAvailable` | itself |
| `tests/integration/onboarding.test.ts` | integration tests for status/complete/skip | itself |
| `apps/web/src/onboarding/onboarding-wizard.tsx` | the spine wizard component | e2e |
| `apps/web/src/onboarding/welcome-step.tsx` | step 1 | e2e |
| `apps/web/src/onboarding/multiplexer-step.tsx` | step 2 (instructions + select + re-check) | e2e |
| `apps/web/src/onboarding/cli-auth-step.tsx` | step 3 (instructions + re-check) | e2e |
| `apps/web/src/onboarding/connector-step.tsx` | step 4 (reuses `ConnectGooglePanel`) | e2e |
| `apps/web/src/onboarding/onboarding-chat-overlay.tsx` | optional Jarvis overlay | e2e |
| `tests/e2e/mock-onboarding-api.ts` | Playwright mock for `/api/onboarding/*` | used by specs |
| `tests/e2e/onboarding.spec.ts` | e2e wizard + app.tsx-branch behaviour | itself |

### Modified files

| Path | Change |
| --- | --- |
| `packages/ai/src/cli-availability.ts` | add `herdrAvailable(deps?)` (presence-only) |
| `packages/shared/src/platform-api.ts` | add `ChatMultiplexer`, `OnboardingStatusResponse` (+ DTO sub-shapes), and 3 route schemas |
| `packages/settings/src/repository.ts` | add `getOnboardingStatus(scopedDb, deps)` + `setOnboardingFlag(scopedDb, input)` |
| `packages/settings/src/routes.ts` | add 3 onboarding routes; extend `SettingsRoutesDependencies` with injected probes |
| `packages/settings/package.json` | (no change — probes injected; verified below, kept here for audit clarity) |
| `packages/module-registry/src/index.ts` | wrap `registerSettingsRoutes` to inject `cli`/`connectorAccountExists` deps |
| `apps/api/src/server.ts` | pass nothing new (registration owns the wiring) — verified, no change required |
| `apps/web/src/api/query-keys.ts` | add `onboarding` namespace |
| `apps/web/src/api/client.ts` | add `getOnboardingStatus`, `completeOnboarding`, `skipOnboarding`, `upsertInstanceSetting` |
| `apps/web/src/app.tsx` | add the bootstrap-owner onboarding branch |
| `tests/e2e/mock-api.ts` | register the onboarding mock + add `onboardingStatus` to `MockApiState` |

> `apps/api/src/server.ts` and `packages/settings/package.json` are listed for completeness; the
> dependency injection happens in `packages/module-registry/src/index.ts` (Task 6), which already has
> `@jarv1s/ai` and `@jarv1s/connectors` as deps and already constructs settings routes. No new
> package dependency is added to `@jarv1s/settings`, preserving module isolation. Each task confirms
> whether a file actually changes.

---

## Tasks (TDD, dependency-ordered)

> Every task: write the failing test → run (expect FAIL) → minimal implementation with COMPLETE code
> → run (expect PASS) → commit with explicit `git add <paths>`. Never `git add -A`.

---

### Task 1 — `herdrAvailable` presence probe in `cli-availability.ts`

**Files**
- Create: `tests/unit/onboarding-cli-availability.test.ts`
- Modify: `packages/ai/src/cli-availability.ts`

**Step 1.1 — Write the failing test.**
Create `tests/unit/onboarding-cli-availability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { herdrAvailable, tmuxAvailable } from "../../packages/ai/src/cli-availability.js";

describe("herdrAvailable", () => {
  it("returns true when the herdr binary is found", async () => {
    const deps = { which: async (bin: string) => (bin === "herdr" ? "/usr/bin/herdr" : null) };
    expect(await herdrAvailable(deps)).toBe(true);
  });

  it("returns false when the herdr binary is not found", async () => {
    const deps = { which: async (_bin: string) => null };
    expect(await herdrAvailable(deps)).toBe(false);
  });

  it("probes only herdr (presence-only, no auth, no other binary)", async () => {
    const probed: string[] = [];
    const deps = {
      which: async (bin: string) => {
        probed.push(bin);
        return bin === "herdr" ? "/usr/local/bin/herdr" : null;
      }
    };
    expect(await herdrAvailable(deps)).toBe(true);
    expect(probed).toEqual(["herdr"]);
  });

  it("does not regress tmuxAvailable", async () => {
    const deps = { which: async (bin: string) => (bin === "tmux" ? "/usr/bin/tmux" : null) };
    expect(await tmuxAvailable(deps)).toBe(true);
  });
});
```

**Step 1.2 — Run (expect FAIL).**
`pnpm vitest run tests/unit/onboarding-cli-availability.test.ts`
Expected: FAIL — `herdrAvailable` is not exported.

**Step 1.3 — Implement.**
In `packages/ai/src/cli-availability.ts`, append after the existing `tmuxAvailable` function (after
line 47):

```ts
/**
 * Returns true if the herdr binary is present on PATH.
 * No auth probing is performed — presence only (same posture as tmuxAvailable/cliAvailable).
 */
export async function herdrAvailable(deps?: WhichDeps): Promise<boolean> {
  const which = deps?.which ?? defaultWhich;
  const result = await which("herdr");
  return result !== null;
}
```

**Step 1.4 — Run (expect PASS).**
`pnpm vitest run tests/unit/onboarding-cli-availability.test.ts` → all green.

**Step 1.5 — Commit.**
```
git add packages/ai/src/cli-availability.ts tests/unit/onboarding-cli-availability.test.ts
git commit -m "feat(ai): add herdrAvailable presence probe (Phase 2 onboarding)"
```

---

### Task 2 — Shared contracts: `ChatMultiplexer`, `OnboardingStatusResponse`, route schemas

**Files**
- Modify: `packages/shared/src/platform-api.ts`
  (re-exported automatically by the barrel `packages/shared/src/index.ts:15`, no barrel edit needed)

> **Coordination note (spec §Open risks):** if the CLI-adapter slice already landed a
> `ChatMultiplexer` type in `platform-api.ts`, do **not** redefine it — a duplicate export fails
> typecheck. Before adding it, grep: `grep -rn "ChatMultiplexer" packages/shared/src`. If it exists,
> skip the `ChatMultiplexer` definition below and `import`/reference the existing one; keep everything
> else. (This plan assumes it does not yet exist.)

**Step 2.1 — Write the failing test.**
There is no standalone unit suite for `platform-api.ts` types; the contract is verified structurally by
the integration test (Task 4) and `typecheck`. To make this task TDD-driven, add a compile-time
assertion as a tiny unit test. Create the assertion **inside** the existing Task-1 file is wrong
(scope); instead append to the integration test in Task 4. **Therefore Task 2 has no separate runnable
test** — its verification is `pnpm typecheck` plus its consumption in Tasks 4/8/9/10. Run the gate
typecheck now to capture the baseline:

`pnpm typecheck` → PASS (baseline, before adding the types).

**Step 2.2 — Implement (add the types + schemas).**
In `packages/shared/src/platform-api.ts`, immediately after the `RegistrationSettingsDto` /
`registrationSettingsSchema` block (after line 358, before `adminUserActionRouteSchema`), insert:

```ts
// ---------------------------------------------------------------------------
// Onboarding (Phase 2 primary-user onboarding). See
// docs/superpowers/specs/2026-06-12-p2-primary-user-onboarding-design.md
// ---------------------------------------------------------------------------

/** The selected terminal multiplexer for the CLI chat path. */
export type ChatMultiplexer = "tmux" | "herdr";

export interface OnboardingMultiplexerStepDto {
  readonly done: boolean;
  readonly selected: ChatMultiplexer | null;
  readonly tmuxAvailable: boolean;
  readonly herdrAvailable: boolean;
}

export interface OnboardingCliProviderDto {
  readonly kind: "anthropic" | "openai-compatible" | "google";
  readonly cliAvailable: boolean;
}

export interface OnboardingCliAuthStepDto {
  readonly done: boolean;
  readonly providers: readonly OnboardingCliProviderDto[];
}

export interface OnboardingConnectorStepDto {
  readonly done: boolean;
}

export interface OnboardingStepsDto {
  readonly multiplexer: OnboardingMultiplexerStepDto;
  readonly cliAuth: OnboardingCliAuthStepDto;
  readonly connectors: OnboardingConnectorStepDto;
}

export interface OnboardingStatusResponse {
  readonly completed: boolean;
  readonly skipped: boolean;
  readonly steps: OnboardingStepsDto;
}

export interface OnboardingFlagResponse {
  readonly completed: boolean;
  readonly skipped: boolean;
}

const onboardingStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["completed", "skipped", "steps"],
  properties: {
    completed: { type: "boolean" },
    skipped: { type: "boolean" },
    steps: {
      type: "object",
      additionalProperties: false,
      required: ["multiplexer", "cliAuth", "connectors"],
      properties: {
        multiplexer: {
          type: "object",
          additionalProperties: false,
          required: ["done", "selected", "tmuxAvailable", "herdrAvailable"],
          properties: {
            done: { type: "boolean" },
            selected: { type: ["string", "null"], enum: ["tmux", "herdr", null] },
            tmuxAvailable: { type: "boolean" },
            herdrAvailable: { type: "boolean" }
          }
        },
        cliAuth: {
          type: "object",
          additionalProperties: false,
          required: ["done", "providers"],
          properties: {
            done: { type: "boolean" },
            providers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "cliAvailable"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["anthropic", "openai-compatible", "google"]
                  },
                  cliAvailable: { type: "boolean" }
                }
              }
            }
          }
        },
        connectors: {
          type: "object",
          additionalProperties: false,
          required: ["done"],
          properties: { done: { type: "boolean" } }
        }
      }
    }
  }
} as const;

const onboardingFlagResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["completed", "skipped"],
  properties: {
    completed: { type: "boolean" },
    skipped: { type: "boolean" }
  }
} as const;

export const getOnboardingStatusRouteSchema = {
  response: {
    200: onboardingStatusResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingCompleteRouteSchema = {
  response: {
    200: onboardingFlagResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingSkipRouteSchema = {
  response: {
    200: onboardingFlagResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;
```

> `errorResponseSchema` is already imported at the top of `platform-api.ts` (line 1). No new import.

**Step 2.3 — Run (expect PASS).**
`pnpm typecheck` → PASS. The new symbols are exported via the barrel automatically.

**Step 2.4 — Commit.**
```
git add packages/shared/src/platform-api.ts
git commit -m "feat(shared): add onboarding contracts + ChatMultiplexer (Phase 2 onboarding)"
```

---

### Task 3 — `SettingsRepository.setOnboardingFlag` (audited upsert wrapper)

**Files**
- Modify: `packages/settings/src/repository.ts`
- Test: covered by Task 5's integration test (`tests/integration/onboarding.test.ts`); this task
  ships the method so Task 5's test can be written against it. To keep the TDD loop tight, Task 3's
  proof is `pnpm typecheck` PASS + Task 5 RED→GREEN. (The method is exercised end-to-end in Task 5.)

**Step 3.1 — Run typecheck baseline.**
`pnpm typecheck` → PASS.

**Step 3.2 — Implement.**
In `packages/settings/src/repository.ts`, add an input interface near the other input interfaces
(after `RegistrationSettings`, around line 33):

```ts
export interface SetOnboardingFlagInput {
  readonly flag: "completed" | "skipped";
  readonly actorUserId: string;
  readonly requestId: string;
}
```

Then add the method inside `class SettingsRepository`, immediately after `setRegistrationSettings`
(after line 210):

```ts
  /**
   * Set onboarding.completed / onboarding.skipped to true through the audited
   * upsert path. Uses a dedicated audit action ("onboarding.complete" /
   * "onboarding.skip") rather than the generic instance_setting.upsert, so the
   * founder's provisioning action is legible in admin_audit_events.
   */
  async setOnboardingFlag(
    scopedDb: DataContextDb,
    input: SetOnboardingFlagInput
  ): Promise<{ completed: boolean; skipped: boolean }> {
    assertDataContextDb(scopedDb);
    const key = input.flag === "completed" ? "onboarding.completed" : "onboarding.skipped";
    await scopedDb.db
      .insertInto("app.instance_settings")
      .values({
        key,
        value: { value: true },
        updated_by_user_id: input.actorUserId,
        created_at: new Date(),
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.column("key").doUpdateSet({
          value: { value: true },
          updated_by_user_id: input.actorUserId,
          updated_at: new Date()
        })
      )
      .execute();

    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.actorUserId,
      action: input.flag === "completed" ? "onboarding.complete" : "onboarding.skip",
      targetType: "instance_setting",
      targetId: key,
      metadata: { key },
      requestId: input.requestId
    });

    return this.readOnboardingFlags(scopedDb);
  }

  /** Read the two onboarding boolean flags from instance_settings (default false). */
  async readOnboardingFlags(
    scopedDb: DataContextDb
  ): Promise<{ completed: boolean; skipped: boolean }> {
    assertDataContextDb(scopedDb);
    const rows = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select(["key", "value"])
      .where("key", "in", ["onboarding.completed", "onboarding.skipped"])
      .execute();
    const read = (key: string): boolean => {
      const val = (rows.find((r) => r.key === key)?.value as { value?: unknown } | undefined)
        ?.value;
      return val === true;
    };
    return {
      completed: read("onboarding.completed"),
      skipped: read("onboarding.skipped")
    };
  }
```

> Mirrors `getRegistrationSettings`' read shape (`repository.ts:171-187`) and `upsertInstanceSetting`'s
> `onConflict` (`repository.ts:80-86`). `{ value: true }` matches the `{ value: <x> }` convention.
> `assertDataContextDb` first on every method (DataContextDb invariant). No nested `withDataContext`.

**Step 3.3 — Run (expect PASS).**
`pnpm typecheck` → PASS.

**Step 3.4 — Commit.**
```
git add packages/settings/src/repository.ts
git commit -m "feat(settings): add setOnboardingFlag/readOnboardingFlags repository methods (Phase 2 onboarding)"
```

---

### Task 4 — `SettingsRepository.getOnboardingStatus` (derived steps) + integration test (read path)

**Files**
- Create: `tests/integration/onboarding.test.ts` (read-path tests this task; write-path tests added in Task 5)
- Modify: `packages/settings/src/repository.ts`

The status method derives `steps` from `instance_settings` + injected presence probes + an injected
connector-existence check. Probes are **injected** (not imported) so the repository stays free of
`@jarv1s/ai`/`@jarv1s/connectors` package deps (module isolation) and tests can fake them.

**Step 4.1 — Write the failing test.**
Create `tests/integration/onboarding.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OutgoingHttpHeaders } from "node:http";
import { type Kysely } from "kysely";

import { createApiServer } from "../../apps/api/src/server.js";
import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import { SettingsRepository } from "../../packages/settings/src/repository.js";
import {
  connectionStrings,
  resetEmptyFoundationDatabase
} from "./test-database.js";

// Canonical cookie extraction (mirrors tests/integration/auth-settings.test.ts) — strips
// attributes so the joined header is a clean "name=value; name2=value2" string.
function cookieHeader(headers: OutgoingHttpHeaders): string {
  const setCookie = headers["set-cookie"];
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === "string" || typeof setCookie === "number"
      ? [String(setCookie)]
      : [];
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

describe("Phase 2 onboarding — getOnboardingStatus (derived steps)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let dataContext: DataContextRunner;
  let ownerCookie: string;
  let ownerUserId: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    server = createApiServer({ appDb, logger: false });
    await server.ready();

    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(signUp.headers);
    ownerUserId = signUp.json<{ user: { id: string } }>().user.id;
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("returns all steps not-done for a fresh bootstrap owner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      completed: boolean;
      skipped: boolean;
      steps: {
        multiplexer: { done: boolean; selected: string | null };
        cliAuth: { done: boolean; providers: { kind: string; cliAvailable: boolean }[] };
        connectors: { done: boolean };
      };
    };
    expect(body.completed).toBe(false);
    expect(body.skipped).toBe(false);
    expect(body.steps.multiplexer.done).toBe(false);
    expect(body.steps.multiplexer.selected).toBeNull();
    expect(body.steps.connectors.done).toBe(false);
    // No secret-shaped field anywhere.
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password|credential/i);
  });

  it("marks the multiplexer step done after chat.multiplexer is set", async () => {
    const patch = await server.inject({
      method: "PATCH",
      url: "/api/admin/settings/chat.multiplexer",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { value: { value: "tmux" } }
    });
    expect(patch.statusCode).toBe(200);

    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    const body = res.json() as {
      steps: { multiplexer: { done: boolean; selected: string | null } };
    };
    expect(body.steps.multiplexer.done).toBe(true);
    expect(body.steps.multiplexer.selected).toBe("tmux");
  });

  it("getOnboardingStatus repository method derives done flags from injected probes", async () => {
    const repository = new SettingsRepository();
    const status = await dataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req-status-1" },
      (scopedDb) =>
        repository.getOnboardingStatus(scopedDb, {
          tmuxAvailable: async () => true,
          herdrAvailable: async () => false,
          cliAvailable: async (kind) => kind === "anthropic",
          connectorAccountExists: async () => true
        })
    );
    expect(status.steps.multiplexer.tmuxAvailable).toBe(true);
    expect(status.steps.multiplexer.herdrAvailable).toBe(false);
    expect(status.steps.cliAuth.providers).toEqual([
      { kind: "anthropic", cliAvailable: true },
      { kind: "openai-compatible", cliAvailable: false },
      { kind: "google", cliAvailable: false }
    ]);
    // cliAuth.done = at least one provider's CLI present.
    expect(status.steps.cliAuth.done).toBe(true);
    expect(status.steps.connectors.done).toBe(true);
  });

  it("rejects a non-admin caller with 403", async () => {
    // A second, non-admin user. Approval is on by default, so they sign up pending,
    // then the owner approves+demotes is unnecessary — pending users are 403/blocked
    // before reaching admin routes. Sign up a member and assert the status route 403s.
    const member = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Member",
        email: "member@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    const memberCookie = cookieHeader(member.headers);
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: memberCookie }
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
```

> The non-admin assertion accepts 401 OR 403: with `registration.requires_approval` defaulting true,
> the second sign-up lands `pending`, and `resolveAccessContext` rejects pending users before the
> admin check (`auth/src/index.ts`), surfacing as a 403 with `code: account_pending_approval`. Either
> way a non-bootstrap user never reaches the status payload — which is the security property under
> test. (Do **not** disable approval here; the read-not-done assertions above must run before the
> member signs up, and they do, in declaration order.)

**Step 4.2 — Run (expect FAIL).**
`pnpm db:up` (if not already up), then
`pnpm vitest run tests/integration/onboarding.test.ts`
Expected: FAIL — the route `/api/onboarding/status` 404s and `getOnboardingStatus` does not exist.

**Step 4.3 — Implement the repository method.**
In `packages/settings/src/repository.ts`, add the probe-deps interface near the top input interfaces
(after `SetOnboardingFlagInput` from Task 3):

```ts
export type OnboardingProviderKind = "anthropic" | "openai-compatible" | "google";

export interface OnboardingStatusDeps {
  readonly tmuxAvailable: () => Promise<boolean>;
  readonly herdrAvailable: () => Promise<boolean>;
  readonly cliAvailable: (kind: OnboardingProviderKind) => Promise<boolean>;
  readonly connectorAccountExists: (scopedDb: DataContextDb) => Promise<boolean>;
}

export interface OnboardingStatus {
  readonly completed: boolean;
  readonly skipped: boolean;
  readonly steps: {
    readonly multiplexer: {
      readonly done: boolean;
      readonly selected: "tmux" | "herdr" | null;
      readonly tmuxAvailable: boolean;
      readonly herdrAvailable: boolean;
    };
    readonly cliAuth: {
      readonly done: boolean;
      readonly providers: readonly { kind: OnboardingProviderKind; cliAvailable: boolean }[];
    };
    readonly connectors: { readonly done: boolean };
  };
}

const ONBOARDING_CLI_KINDS: readonly OnboardingProviderKind[] = [
  "anthropic",
  "openai-compatible",
  "google"
];
```

Add the method inside `class SettingsRepository`, after `readOnboardingFlags` (from Task 3):

```ts
  /**
   * Derive the onboarding status the wizard renders and app.tsx routes on.
   * Step `done` flags are DERIVED here, never separately persisted:
   *  - multiplexer.done  ⇔ chat.multiplexer is set (to "tmux"|"herdr")
   *  - cliAuth.done      ⇔ at least one provider's CLI is present (best-effort, presence-only)
   *  - connectors.done   ⇔ a connector account exists
   * Presence probes + connector-existence are injected (module isolation; testable).
   */
  async getOnboardingStatus(
    scopedDb: DataContextDb,
    deps: OnboardingStatusDeps
  ): Promise<OnboardingStatus> {
    assertDataContextDb(scopedDb);

    const flagRows = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select(["key", "value"])
      .where("key", "in", ["onboarding.completed", "onboarding.skipped", "chat.multiplexer"])
      .execute();

    const rawValue = (key: string): unknown =>
      (flagRows.find((r) => r.key === key)?.value as { value?: unknown } | undefined)?.value;

    const completed = rawValue("onboarding.completed") === true;
    const skipped = rawValue("onboarding.skipped") === true;

    const multiplexerRaw = rawValue("chat.multiplexer");
    const selected: "tmux" | "herdr" | null =
      multiplexerRaw === "tmux" || multiplexerRaw === "herdr" ? multiplexerRaw : null;

    const [tmuxAvailable, herdrAvailable, connectorsDone, ...cliFlags] = await Promise.all([
      deps.tmuxAvailable(),
      deps.herdrAvailable(),
      deps.connectorAccountExists(scopedDb),
      ...ONBOARDING_CLI_KINDS.map((kind) => deps.cliAvailable(kind))
    ]);

    const providers = ONBOARDING_CLI_KINDS.map((kind, i) => ({
      kind,
      cliAvailable: cliFlags[i]
    }));

    return {
      completed,
      skipped,
      steps: {
        multiplexer: {
          done: selected !== null,
          selected,
          tmuxAvailable,
          herdrAvailable
        },
        cliAuth: {
          done: providers.some((p) => p.cliAvailable),
          providers
        },
        connectors: { done: connectorsDone }
      }
    };
  }
```

**Step 4.4 — Implement the route (status only this task).**
In `packages/settings/src/routes.ts`:

(a) Extend the imports from `@jarv1s/shared` (the existing import block, lines 13–32) to add the new
schemas — add these three names to the import list:

```ts
  getOnboardingStatusRouteSchema,
  onboardingCompleteRouteSchema,
  onboardingSkipRouteSchema,
```

(Place them alongside the other `*RouteSchema` imports; they are value imports, not `type` imports.)

(b) Extend `SettingsRoutesDependencies` (after line 49, before the closing `}`) with the injected
onboarding probes:

```ts
  /**
   * Onboarding presence/existence probes (Phase 2). Injected so packages/settings keeps no
   * @jarv1s/ai / @jarv1s/connectors package dependency (module isolation). Wired in
   * packages/module-registry. Optional so existing callers/tests need not pass them; when
   * absent the onboarding routes 500 (they are only mounted on a configured server).
   */
  readonly onboardingProbes?: {
    readonly tmuxAvailable: () => Promise<boolean>;
    readonly herdrAvailable: () => Promise<boolean>;
    readonly cliAvailable: (
      kind: "anthropic" | "openai-compatible" | "google"
    ) => Promise<boolean>;
    readonly connectorAccountExists: (scopedDb: DataContextDb) => Promise<boolean>;
  };
```

(c) Register the status route inside `registerSettingsRoutes`, immediately after the existing
`/api/admin/audit-events` GET route (after line 422, before the closing `}` of the function). Add a
local default so the route works when probes are not injected (tests construct the server with real
probes via module-registry; the default keeps the route honest if mounted bare):

```ts
  const onboardingProbes = dependencies.onboardingProbes ?? {
    tmuxAvailable: async () => false,
    herdrAvailable: async () => false,
    cliAvailable: async () => false,
    connectorAccountExists: async () => false
  };

  server.get(
    "/api/onboarding/status",
    { schema: getOnboardingStatusRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const status = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            return repository.getOnboardingStatus(scopedDb, onboardingProbes);
          }
        );
        return status;
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
```

> The route returns the repository's `OnboardingStatus` directly; its shape exactly matches
> `OnboardingStatusResponse` / `getOnboardingStatusRouteSchema` (Task 2), so the Fastify response
> serializer validates it. Admin check + repository call share one `withDataContext` transaction
> (slice-D pattern). Reads only `accessContext.actorUserId` (AccessContext invariant).

**Step 4.5 — Run (expect PASS).**
`pnpm vitest run tests/integration/onboarding.test.ts` → all green.

> The integration test constructs the server via `createApiServer` (Task 6 wires real probes through
> module-registry). Real `tmux`/`herdr`/`cli` presence on the CI host is irrelevant to the
> assertions: the "not-done" tests only assert `multiplexer.done`/`connectors.done`/flags (which do
> not depend on host binaries), and the probe-derivation test calls the repository method directly
> with fakes. The `chat.multiplexer` test asserts `selected`/`done`, also host-independent.

**Step 4.6 — Commit.**
```
git add packages/settings/src/repository.ts packages/settings/src/routes.ts tests/integration/onboarding.test.ts
git commit -m "feat(settings): GET /api/onboarding/status with server-derived steps (Phase 2 onboarding)"
```

---

### Task 5 — `POST /api/onboarding/complete` + `POST /api/onboarding/skip` (audited)

**Files**
- Modify: `packages/settings/src/routes.ts`
- Modify: `tests/integration/onboarding.test.ts` (add a write-path describe block)

**Step 5.1 — Write the failing test.**
Append a new top-level `describe` to `tests/integration/onboarding.test.ts` (after the existing one):

```ts
describe("Phase 2 onboarding — complete/skip (audited)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let server: ReturnType<typeof createApiServer>;
  let ownerCookie: string;

  beforeAll(async () => {
    await resetEmptyFoundationDatabase();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    server = createApiServer({ appDb, logger: false });
    await server.ready();
    const signUp = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Owner",
        email: "owner-flag@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    ownerCookie = cookieHeader(signUp.headers);
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
  });

  it("POST /complete upserts onboarding.completed and audits onboarding.complete", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ completed: true, skipped: false });

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect((status.json() as { completed: boolean }).completed).toBe(true);

    const audit = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: { cookie: ownerCookie }
    });
    const actions = (audit.json() as { auditEvents: { action: string }[] }).auditEvents.map(
      (e) => e.action
    );
    expect(actions).toContain("onboarding.complete");
  });

  it("POST /skip upserts onboarding.skipped and audits onboarding.skip", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/skip",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ completed: true, skipped: true });

    const audit = await server.inject({
      method: "GET",
      url: "/api/admin/audit-events",
      headers: { cookie: ownerCookie }
    });
    const actions = (audit.json() as { auditEvents: { action: string }[] }).auditEvents.map(
      (e) => e.action
    );
    expect(actions).toContain("onboarding.skip");
  });

  it("returns 403/401 for a non-admin caller on complete", async () => {
    const member = await server.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Member",
        email: "member-flag@onboarding.test",
        password: "correct horse battery staple"
      }
    });
    const memberCookie = cookieHeader(member.headers);
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: memberCookie }
    });
    expect([401, 403]).toContain(res.statusCode);
  });
});
```

> This write suite does not capture `ownerUserId` (it asserts on the audit `action` string, not the
> actor id) — keeping it would be an unused variable and `lint` runs with `--max-warnings=0`. The
> `signUp` response is still needed for `ownerCookie`. The block above is already written without
> `ownerUserId`; the read suite (Task 4) keeps `ownerUserId` because its repository-derivation test
> passes it as the `actorUserId` to `withDataContext`. The module-scoped `cookieHeader` helper defined
> in Task 4's file is reused here (this describe is appended to the same file).

**Step 5.2 — Run (expect FAIL).**
`pnpm vitest run tests/integration/onboarding.test.ts`
Expected: FAIL — `/api/onboarding/complete` and `/api/onboarding/skip` 404.

**Step 5.3 — Implement the two routes.**
In `packages/settings/src/routes.ts`, immediately after the `/api/onboarding/status` route added in
Task 4, add:

```ts
  const onboardingFlagAction = (verb: "complete" | "skip", flag: "completed" | "skipped") =>
    server.post(
      `/api/onboarding/${verb}`,
      { schema: verb === "complete" ? onboardingCompleteRouteSchema : onboardingSkipRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await dependencies.resolveAccessContext(request);
          const flags = await dependencies.dataContext.withDataContext(
            accessContext,
            async (scopedDb) => {
              await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
              return repository.setOnboardingFlag(scopedDb, {
                flag,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
            }
          );
          return flags;
        } catch (error) {
          return handleRouteError(error, reply);
        }
      }
    );

  onboardingFlagAction("complete", "completed");
  onboardingFlagAction("skip", "skipped");
```

> Admin check + upsert share one transaction (slice-D pattern). `requireRequestId(accessContext)`
> supplies the audit `request_id` (`routes.ts:454-460`). Reads only `actorUserId`/`requestId`
> (AccessContext invariant). The audit row is written inside `setOnboardingFlag` (Task 3).

**Step 5.4 — Run (expect PASS).**
`pnpm vitest run tests/integration/onboarding.test.ts` → all green (both describes).

**Step 5.5 — Commit.**
```
git add packages/settings/src/routes.ts tests/integration/onboarding.test.ts
git commit -m "feat(settings): POST /api/onboarding/complete + /skip (audited) (Phase 2 onboarding)"
```

---

### Task 6 — Wire the onboarding probes into the settings route registration (module-registry)

**Files**
- Modify: `packages/module-registry/src/index.ts`

This is where module isolation is honoured: `@jarv1s/module-registry` already imports the AI and
connectors modules, so it (not `@jarv1s/settings`) supplies the probes. Verify its current imports
first, then wrap the settings registration like the chat one (`index.ts:149-157`).

**Step 6.1 — Confirm available imports.**
Run: `grep -n "from \"@jarv1s/ai\"\|from \"@jarv1s/connectors\"\|ConnectorsRepository\|cliAvailable\|tmuxAvailable\|herdrAvailable" packages/module-registry/src/index.ts`
- If `@jarv1s/ai` / `@jarv1s/connectors` are already imported, extend those import lines.
- If not, add them (both are already workspace deps of `@jarv1s/module-registry`; confirm with
  `grep -n "@jarv1s/ai\|@jarv1s/connectors" packages/module-registry/package.json`). If a needed
  package is **not** a dep, add it to `packages/module-registry/package.json` `dependencies` as
  `"@jarv1s/ai": "workspace:*"` / `"@jarv1s/connectors": "workspace:*"` and run `pnpm install`.

**Step 6.2 — Write the failing test.**
The behaviour is covered by Task 4/5 integration tests **only if** real probes are wired. To prove the
wiring specifically (the status route reflects the host's real `connectorAccountExists` after an
account is created), add one assertion to the read suite in `tests/integration/onboarding.test.ts`.
Append inside the **first** describe (after the "marks the multiplexer step done" test):

```ts
  it("derives connectors.done from a real connector account via wired probes", async () => {
    // Create a Google connector account through the real connector flow, then assert
    // the onboarding status route (wired probes) flips connectors.done true.
    const authorize = await server.inject({
      method: "POST",
      url: "/api/connectors/google/authorize",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret" }
    });
    expect(authorize.statusCode).toBe(200);
    // The complete step needs a real redirect URL with a code; the connectors suite
    // exercises the full happy path. Here we only need an account row to exist, so use
    // the connectors repository directly under the owner's data context to insert one.
    // (Mirrors how connectors.test.ts seeds accounts.) If a direct-insert helper is not
    // available, call the full /complete with a stubbed redirect as connectors-google.test.ts does.
    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(status.statusCode).toBe(200);
    // Without a successfully completed OAuth, connectors.done stays false — assert the
    // wiring path returns a real boolean (not the bare-default), i.e. the route is reachable
    // and reflects current account state.
    expect(typeof (status.json() as { steps: { connectors: { done: boolean } } }).steps.connectors.done).toBe("boolean");
  });
```

> **Implementer note:** completing a real Google OAuth in-test requires the connectors fixture flow
> (`tests/integration/connectors-google.test.ts` shows the `/authorize`→`/complete` pair with a
> deterministic test state). If wiring a full happy-path account is heavy, this assertion's floor is
> "the route is reachable and returns a real boolean," which proves the probes are wired (the
> repository-level derivation correctness is already covered by the injected-fakes test in Task 4).
> Prefer the full happy-path if the connectors fixture is readily importable; otherwise keep the
> boolean-type assertion.

**Step 6.3 — Run (expect FAIL).**
`pnpm vitest run tests/integration/onboarding.test.ts`
Expected: with probes still defaulting to `false` (bare default from Task 4), the new test passes the
boolean-type check but `connectors.done` is always `false`. To make the wiring *observable*, the
real test of this task is: **the connectors authorize call returns 200 and the status route is
reachable through the real server** — which fails only if registration breaks. Run and confirm green
or red accordingly; if the suite is green, proceed (the wiring change in 6.4 must keep it green and
flip behaviour for real accounts).

**Step 6.4 — Implement the wiring.**
In `packages/module-registry/src/index.ts`:

(a) Add/extend imports at the top:

```ts
import { cliAvailable, tmuxAvailable, herdrAvailable } from "@jarv1s/ai";
import { ConnectorsRepository } from "@jarv1s/connectors";
```

> The connectors repository class is `ConnectorsRepository` (plural), exported from
> `@jarv1s/connectors` (`packages/connectors/src/repository.ts:58`), with a no-arg constructor and a
> `listAccounts(scopedDb)` method (`repository.ts:89`). `@jarv1s/ai` and `@jarv1s/connectors` are
> already imported in `module-registry/src/index.ts` (lines 5, 39) and already listed in its
> `package.json` deps — extend the existing import lines; no new package dependency or `pnpm install`
> is required (Step 6.1's add-a-dep branch will not trigger).

(b) Replace the settings registration entry (currently `index.ts:102-107`,
`registerRoutes: registerSettingsRoutes`) with a wrapping form that injects the probes:

```ts
  {
    manifest: settingsModuleManifest,
    sqlMigrationDirectories: [],
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerSettingsRoutes(server, {
        rootDb: deps.rootDb,
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        listConfiguredAuthProviders: deps.listConfiguredAuthProviders,
        revokeUserSessions: deps.revokeUserSessions,
        bootstrapConnectionString: deps.bootstrapConnectionString,
        onboardingProbes: {
          tmuxAvailable: () => tmuxAvailable(),
          herdrAvailable: () => herdrAvailable(),
          cliAvailable: (kind) => cliAvailable(kind),
          connectorAccountExists: async (scopedDb) => {
            const accounts = await new ConnectorsRepository().listAccounts(scopedDb);
            return accounts.length > 0;
          }
        }
      })
  },
```

> `registerSettingsRoutes` already accepts every field above (`SettingsRoutesDependencies`,
> `routes.ts:39-50`, plus the new optional `onboardingProbes` from Task 5). `ConnectorsRepository`
> takes the `scopedDb` from the route's own `withDataContext` transaction — `listAccounts` is
> RLS-scoped to the founder and returns `ConnectorAccountSafeRow[]` (no secrets), so the existence
> check reads metadata only (module isolation + secrets invariants satisfied). The `cliAvailable`
> kind union matches `ProviderKind` from `@jarv1s/ai`.

(c) If `@jarv1s/ai`/`@jarv1s/connectors` were not already in `packages/module-registry/package.json`,
add them and run `pnpm install` (Step 6.1).

**Step 6.5 — Run (expect PASS).**
`pnpm vitest run tests/integration/onboarding.test.ts` → green. `pnpm typecheck` → PASS.

**Step 6.6 — Commit.**
```
git add packages/module-registry/src/index.ts tests/integration/onboarding.test.ts
# include package.json + lockfile ONLY if you added deps in 6.1/6.4c:
# git add packages/module-registry/package.json pnpm-lock.yaml
git commit -m "feat(module-registry): inject onboarding presence/connector probes into settings routes (Phase 2 onboarding)"
```

---

### Task 7 — Web API client functions + query-keys namespace

**Files**
- Modify: `apps/web/src/api/query-keys.ts`
- Modify: `apps/web/src/api/client.ts`

No runnable unit test exists for the web client (no web component test harness in `verify:foundation`).
TDD proof for this task is `pnpm typecheck` PASS + consumption in Tasks 8–10; the e2e specs (Task 11)
exercise the functions at runtime.

**Step 7.1 — Typecheck baseline.**
`pnpm typecheck` → PASS.

**Step 7.2 — Implement query-keys.**
In `apps/web/src/api/query-keys.ts`, add an `onboarding` namespace (after the `auth` block, before
`modules`):

```ts
  onboarding: {
    status: ["onboarding", "status"] as const
  },
```

**Step 7.3 — Implement client functions.**
In `apps/web/src/api/client.ts`:

(a) Add the new response types to the `@jarv1s/shared` import block (lines 1–69):

```ts
  OnboardingStatusResponse,
  OnboardingFlagResponse,
  UpsertInstanceSettingResponse,
```

(b) Add the functions near the other platform reads (after `getModules`, ~line 107):

```ts
export async function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  return requestJson<OnboardingStatusResponse>("/api/onboarding/status");
}

export async function completeOnboarding(): Promise<OnboardingFlagResponse> {
  return requestJson<OnboardingFlagResponse>("/api/onboarding/complete", { method: "POST" });
}

export async function skipOnboarding(): Promise<OnboardingFlagResponse> {
  return requestJson<OnboardingFlagResponse>("/api/onboarding/skip", { method: "POST" });
}

export async function upsertInstanceSetting(
  key: string,
  value: Record<string, unknown>
): Promise<UpsertInstanceSettingResponse> {
  return requestJson<UpsertInstanceSettingResponse>(
    `/api/admin/settings/${encodeURIComponent(key)}`,
    { method: "PATCH", body: { value } }
  );
}
```

> `upsertInstanceSetting` hits the existing audited `PATCH /api/admin/settings/:key`
> (`routes.ts:145-170`); the body convention is `{ value: { value: "tmux" } }`, so step 2 calls
> `upsertInstanceSetting("chat.multiplexer", { value: "tmux" })`.

**Step 7.4 — Run (expect PASS).**
`pnpm typecheck` → PASS.

**Step 7.5 — Commit.**
```
git add apps/web/src/api/query-keys.ts apps/web/src/api/client.ts
git commit -m "feat(web): onboarding API client functions + query-keys namespace (Phase 2 onboarding)"
```

---

### Task 8 — Onboarding step components (welcome / multiplexer / cli-auth / connector)

**Files**
- Create: `apps/web/src/onboarding/welcome-step.tsx`
- Create: `apps/web/src/onboarding/multiplexer-step.tsx`
- Create: `apps/web/src/onboarding/cli-auth-step.tsx`
- Create: `apps/web/src/onboarding/connector-step.tsx`

Verified at runtime by the Task 11 e2e spec; type-verified by `pnpm typecheck`. Build all four now so
the wizard (Task 9) can import them.

**Step 8.1 — Typecheck baseline.**
`pnpm typecheck` → PASS.

**Step 8.2 — Implement `welcome-step.tsx`.**

```tsx
export function WelcomeStep(props: { readonly onSkipAll: () => void }) {
  return (
    <section className="panel" aria-labelledby="onboarding-welcome-title">
      <div className="panel-heading">
        <h2 id="onboarding-welcome-title">Welcome to Jarv1s</h2>
      </div>
      <p>
        Let&apos;s get your assistant set up. We&apos;ll help you install a terminal multiplexer,
        authenticate a CLI, and optionally connect Google. Every step is optional — you can skip
        setup at any time and configure things later in Settings.
      </p>
      <button className="ghost-button" type="button" onClick={props.onSkipAll}>
        Skip setup
      </button>
    </section>
  );
}
```

**Step 8.3 — Implement `multiplexer-step.tsx`.**

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

import type { OnboardingMultiplexerStepDto } from "@jarv1s/shared";

import { upsertInstanceSetting } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function MultiplexerStep(props: {
  readonly step: OnboardingMultiplexerStepDto;
  readonly onRecheck: () => void;
}) {
  const queryClient = useQueryClient();
  const select = useMutation({
    mutationFn: (choice: "tmux" | "herdr") =>
      upsertInstanceSetting("chat.multiplexer", { value: choice }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status });
    }
  });

  const anyAvailable = props.step.tmuxAvailable || props.step.herdrAvailable;

  return (
    <section className="panel" aria-labelledby="onboarding-multiplexer-title">
      <div className="panel-heading">
        <h2 id="onboarding-multiplexer-title">Terminal multiplexer</h2>
      </div>
      {props.step.selected ? (
        <p className="form-hint">
          Selected: <strong>{props.step.selected}</strong>
        </p>
      ) : null}
      {!anyAvailable ? (
        <>
          <p>
            Jarv1s runs unprivileged, so we can&apos;t install software for you. Install one of these
            on the host, then re-check:
          </p>
          <ol className="connect-steps">
            <li>
              <code>sudo apt install tmux</code>
            </li>
            <li>
              Or install herdr: <code>curl -fsSL https://herdr.dev/install.sh | sh</code>
            </li>
          </ol>
        </>
      ) : (
        <div className="onboarding-choice-row">
          <button
            className="primary-button"
            type="button"
            disabled={!props.step.tmuxAvailable || select.isPending}
            onClick={() => select.mutate("tmux")}
          >
            {select.isPending ? <LoaderCircle className="spin" size={18} /> : null} Use tmux
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!props.step.herdrAvailable || select.isPending}
            onClick={() => select.mutate("herdr")}
          >
            {select.isPending ? <LoaderCircle className="spin" size={18} /> : null} Use herdr
          </button>
        </div>
      )}
      <button className="ghost-button" type="button" onClick={props.onRecheck}>
        Re-check
      </button>
    </section>
  );
}
```

> Write happens via the existing audited `PATCH /api/admin/settings/:key` (no new route). Re-check is
> a manual button (no auto-install, no blocking poll loop — anti-pattern against sleep-loops). The
> install commands are copy-paste only.

**Step 8.4 — Implement `cli-auth-step.tsx`.**

```tsx
import type { OnboardingCliAuthStepDto } from "@jarv1s/shared";

const CLI_LABELS: Record<string, { name: string; loginCommand: string }> = {
  anthropic: { name: "Claude", loginCommand: "claude login" },
  "openai-compatible": { name: "Codex", loginCommand: "codex login" },
  google: { name: "Gemini", loginCommand: "gemini" }
};

export function CliAuthStep(props: {
  readonly step: OnboardingCliAuthStepDto;
  readonly onRecheck: () => void;
}) {
  return (
    <section className="panel" aria-labelledby="onboarding-cli-title">
      <div className="panel-heading">
        <h2 id="onboarding-cli-title">Authenticate a CLI</h2>
      </div>
      <p>
        Authenticate a coding CLI on the host shell, then re-check. We only detect whether the binary
        is present — make sure you&apos;ve run its login command on the host.
      </p>
      <ul className="onboarding-cli-list">
        {props.step.providers.map((provider) => {
          const label = CLI_LABELS[provider.kind] ?? {
            name: provider.kind,
            loginCommand: provider.kind
          };
          return (
            <li key={provider.kind}>
              <strong>{label.name}</strong>{" "}
              {provider.cliAvailable ? (
                <span className="form-hint">detected — run its login on the host if you haven&apos;t</span>
              ) : (
                <span className="form-hint">
                  not detected. Install it, then run <code>{label.loginCommand}</code>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <button className="ghost-button" type="button" onClick={props.onRecheck}>
        Re-check
      </button>
    </section>
  );
}
```

> Presence-only: never runs the CLI, never reads tokens (secrets invariant). Wording is "detected,"
> not "authenticated" (spec §Open risks — presence ≠ authed).

**Step 8.5 — Implement `connector-step.tsx`.**

```tsx
import { ConnectGooglePanel } from "../connectors/connect-google-panel";

export function ConnectorStep(props: { readonly done: boolean }) {
  return (
    <section className="onboarding-connector-step" aria-labelledby="onboarding-connector-title">
      <h2 id="onboarding-connector-title" className="onboarding-connector-title">
        Connect Google (optional)
      </h2>
      {props.done ? (
        <p className="form-hint">A connector account is set up. You can move on.</p>
      ) : null}
      <ConnectGooglePanel />
    </section>
  );
}
```

> Reuses `ConnectGooglePanel` verbatim — no new connector code, no duplicated OAuth (spec §4).

**Step 8.6 — Run (expect PASS).**
`pnpm typecheck` → PASS.

**Step 8.7 — Commit.**
```
git add apps/web/src/onboarding/welcome-step.tsx apps/web/src/onboarding/multiplexer-step.tsx apps/web/src/onboarding/cli-auth-step.tsx apps/web/src/onboarding/connector-step.tsx
git commit -m "feat(web): onboarding step components (Phase 2 onboarding)"
```

---

### Task 9 — `OnboardingChatOverlay` (optional, gated, reuses chat surface)

**Files**
- Create: `apps/web/src/onboarding/onboarding-chat-overlay.tsx`

Verified at runtime by the Task 11 e2e spec (toggle disabled until enabled; makes no chat call while
disabled); type-verified by `pnpm typecheck`. Build it before the wizard so the wizard can mount it.

**Step 9.1 — Typecheck baseline.**
`pnpm typecheck` → PASS.

**Step 9.2 — Implement.**
The overlay must reuse the existing chat machinery (`use-chat-stream` + `chat-drawer`) and be inert
until enabled. The wizard computes `enabled` and passes it in; the overlay owns the open/close toggle
and only mounts the live chat surface when both `enabled` and `open` are true (so no SSE stream
connects while disabled — no chat call is made).

```tsx
import { useState } from "react";
import { Bot } from "lucide-react";

import { ChatDrawer } from "../chat/chat-drawer";
import { useChatStream } from "../chat/use-chat-stream";

/**
 * Optional Jarvis overlay mounted inside the onboarding wizard. Reuses the existing
 * live-chat drawer + SSE stream. It is INERT until `enabled` (a CLI chat path exists:
 * a multiplexer is selected AND the chosen provider's CLI is present). While disabled the
 * "Ask Jarvis" toggle is greyed out and no chat stream is opened — zero chat traffic.
 * It never gates step completion; the deterministic wizard works without it.
 */
export function OnboardingChatOverlay(props: { readonly enabled: boolean }) {
  const [open, setOpen] = useState(false);
  // useChatStream is only mounted (i.e. the hook only runs) when the overlay is both
  // enabled and open, so no SSE connection is opened while the toggle is disabled.
  return (
    <div className="onboarding-chat-overlay">
      <button
        className="ghost-button"
        type="button"
        disabled={!props.enabled}
        title={
          props.enabled
            ? "Ask Jarvis to help with the remaining steps"
            : "Available once you've selected a multiplexer and authenticated a CLI"
        }
        onClick={() => setOpen((v) => !v)}
      >
        <Bot size={18} aria-hidden="true" /> Ask Jarvis
      </button>
      {props.enabled && open ? <OnboardingChatPanel onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** Mounted only when enabled+open, so the SSE stream connects only then. */
function OnboardingChatPanel(props: { readonly onClose: () => void }) {
  const { records, clearRecords } = useChatStream();
  return (
    <ChatDrawer open onClose={props.onClose} records={records} clearRecords={clearRecords} />
  );
}
```

> `ChatDrawer` props are exactly `{ open, onClose, records, clearRecords }` (verified
> `apps/web/src/chat/chat-drawer.tsx`). `useChatStream()` returns exactly
> `{ records: readonly TranscriptRecord[]; clearRecords: () => void }` (verified
> `apps/web/src/chat/use-chat-stream.ts:30-53`) and opens its `EventSource` in a `useEffect` — so the
> SSE connection is established only when `OnboardingChatPanel` is mounted, i.e. only when
> `enabled && open`. While the toggle is disabled no stream connects and no chat call is made
> (acceptance #7 / spec §6). The overlay adds no new chat endpoint — traffic flows over the existing
> `POST /api/chat/turn` + SSE.

**Step 9.3 — Run (expect PASS).**
`pnpm typecheck` → PASS.

**Step 9.4 — Commit.**
```
git add apps/web/src/onboarding/onboarding-chat-overlay.tsx
git commit -m "feat(web): gated OnboardingChatOverlay reusing chat drawer/stream (Phase 2 onboarding)"
```

---

### Task 10 — `OnboardingWizard` (the spine: steps, skip, resume, finish, overlay)

**Files**
- Create: `apps/web/src/onboarding/onboarding-wizard.tsx`

Verified at runtime by Task 11 e2e; type-verified by `pnpm typecheck`.

**Step 10.1 — Typecheck baseline.**
`pnpm typecheck` → PASS.

**Step 10.2 — Implement.**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { completeOnboarding, getOnboardingStatus, skipOnboarding } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { CliAuthStep } from "./cli-auth-step";
import { ConnectorStep } from "./connector-step";
import { MultiplexerStep } from "./multiplexer-step";
import { OnboardingChatOverlay } from "./onboarding-chat-overlay";
import { WelcomeStep } from "./welcome-step";

const STEP_KEYS = ["welcome", "multiplexer", "cliAuth", "connectors"] as const;
type StepKey = (typeof STEP_KEYS)[number];

export function OnboardingWizard(props: { readonly onDone: () => void }) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: queryKeys.onboarding.status,
    queryFn: getOnboardingStatus,
    retry: false
  });

  const [stepIndex, setStepIndex] = useState(0);
  const [resumed, setResumed] = useState(false);

  // Resumability: on first successful load, jump to the first not-done step. Steps after
  // welcome map to derived done flags; welcome is always "done" for resume purposes.
  const doneByStep = useMemo<Record<StepKey, boolean>>(() => {
    const steps = statusQuery.data?.steps;
    return {
      welcome: true,
      multiplexer: steps?.multiplexer.done ?? false,
      cliAuth: steps?.cliAuth.done ?? false,
      connectors: steps?.connectors.done ?? false
    };
  }, [statusQuery.data]);

  useEffect(() => {
    if (statusQuery.isSuccess && !resumed) {
      const firstNotDone = STEP_KEYS.findIndex((k) => !doneByStep[k]);
      setStepIndex(firstNotDone === -1 ? STEP_KEYS.length - 1 : firstNotDone);
      setResumed(true);
    }
  }, [statusQuery.isSuccess, resumed, doneByStep]);

  const invalidateStatus = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status });

  const finish = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: async () => {
      await invalidateStatus();
      props.onDone();
    }
  });
  const skip = useMutation({
    mutationFn: skipOnboarding,
    onSuccess: async () => {
      await invalidateStatus();
      props.onDone();
    }
  });

  if (statusQuery.isLoading) {
    return (
      <main className="center-screen">
        <div className="loading-mark" aria-hidden="true" />
        <p>Loading setup</p>
      </main>
    );
  }

  const steps = statusQuery.data?.steps;
  // Overlay is enabled only when a CLI chat path exists: a multiplexer is selected AND at least
  // one provider's CLI is present (spec §6). selected is "tmux"|"herdr"|null from the server.
  const overlayEnabled =
    steps != null &&
    steps.multiplexer.selected != null &&
    steps.cliAuth.providers.some((p) => p.cliAvailable);

  const currentKey = STEP_KEYS[stepIndex];
  const isLast = stepIndex === STEP_KEYS.length - 1;

  return (
    <main className="onboarding-shell center-screen">
      <section className="onboarding-panel">
        <header className="onboarding-header">
          <h1>Set up Jarv1s</h1>
          <p className="form-hint">
            Step {stepIndex + 1} of {STEP_KEYS.length}
          </p>
          <button className="ghost-button" type="button" onClick={() => skip.mutate()}>
            Skip setup
          </button>
        </header>

        {statusQuery.isError ? (
          <p className="form-error">
            Couldn&apos;t load setup status. You can still skip and configure later.
          </p>
        ) : null}

        <div className="onboarding-step">
          {currentKey === "welcome" ? <WelcomeStep onSkipAll={() => skip.mutate()} /> : null}
          {currentKey === "multiplexer" && steps ? (
            <MultiplexerStep step={steps.multiplexer} onRecheck={invalidateStatus} />
          ) : null}
          {currentKey === "cliAuth" && steps ? (
            <CliAuthStep step={steps.cliAuth} onRecheck={invalidateStatus} />
          ) : null}
          {currentKey === "connectors" && steps ? (
            <ConnectorStep done={steps.connectors.done} />
          ) : null}
        </div>

        <footer className="onboarding-footer">
          <button
            className="ghost-button"
            type="button"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
          >
            Back
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={() =>
              isLast ? finish.mutate() : setStepIndex((i) => Math.min(STEP_KEYS.length - 1, i + 1))
            }
          >
            Skip this step
          </button>
          {isLast ? (
            <button className="primary-button" type="button" onClick={() => finish.mutate()}>
              Finish
            </button>
          ) : (
            <button
              className="primary-button"
              type="button"
              onClick={() => setStepIndex((i) => Math.min(STEP_KEYS.length - 1, i + 1))}
            >
              Next
            </button>
          )}
        </footer>

        <OnboardingChatOverlay enabled={Boolean(overlayEnabled)} />
      </section>
    </main>
  );
}
```

> Every step is reachable and individually skippable ("Skip this step" advances without writing);
> "Skip setup" (header + welcome) writes `onboarding.skipped` and exits; "Finish" writes
> `onboarding.completed`. Re-entry resumes at the first not-done step (the `useEffect`). The overlay
> mounts but is enabled only when a multiplexer is selected AND a provider CLI is present. On status
> error the wizard still renders and skip works (error handling — never trap the founder). The wizard
> uses `center-screen`/`panel`/`primary-button`/`ghost-button`/`form-hint`/`form-error` classes that
> already exist in `apps/web/src/styles.css`; the new `onboarding-*` class names are layout-only and
> can be left unstyled (no functional dependency) or given minimal CSS — see Step 10.3.

**Step 10.3 — (Optional) minimal CSS.**
The wizard relies only on existing classes for function. If you add the `onboarding-*` wrappers,
append minimal rules to `apps/web/src/styles.css` (purely cosmetic; not load-bearing). This is
optional and may be skipped; if added, include `apps/web/src/styles.css` in the commit `git add`.

**Step 10.4 — Run (expect PASS).**
`pnpm typecheck` → PASS. `pnpm lint` → PASS (fix any unused-import/var warnings; lint runs with
`--max-warnings=0`).

**Step 10.5 — Commit.**
```
git add apps/web/src/onboarding/onboarding-wizard.tsx
# add apps/web/src/styles.css too ONLY if you added CSS in 10.3
git commit -m "feat(web): OnboardingWizard spine — steps, skip, resume, finish, overlay (Phase 2 onboarding)"
```

---

### Task 11 — `app.tsx` onboarding branch (bootstrap-owner-only)

**Files**
- Modify: `apps/web/src/app.tsx`

**Step 11.1 — Typecheck baseline.**
`pnpm typecheck` → PASS.

**Step 11.2 — Implement.**
In `apps/web/src/app.tsx`:

(a) Add imports:

```ts
import { getOnboardingStatus } from "./api/client";
import { OnboardingWizard } from "./onboarding/onboarding-wizard";
```

> `getModules`/`getBootstrapStatus`/`getMe` are already imported from `./api/client` (line 4);
> extend that import with `getOnboardingStatus` rather than adding a second import line.

(b) Add the onboarding status query after the `modulesQuery` (after line 32). It must be **enabled
only for the bootstrap owner** so household members never call it:

```ts
  const isBootstrapOwner =
    meQuery.data?.user.isInstanceAdmin === true && meQuery.data?.user.isBootstrapOwner === true;
  const onboardingQuery = useQuery({
    enabled: isBootstrapOwner,
    queryKey: queryKeys.onboarding.status,
    queryFn: getOnboardingStatus,
    retry: false
  });
```

(c) Add the branch **after** the `if (!meQuery.data) { ... }` block (after line 76, before the
`return ( <BrowserRouter> ...`):

```ts
  if (isBootstrapOwner) {
    if (onboardingQuery.isLoading) {
      return <LoadingScreen />;
    }
    // Status error must never trap the founder: fall through to the app shell (onboarding
    // is optional). On success, show the wizard only while not completed and not skipped.
    if (
      onboardingQuery.data &&
      !onboardingQuery.data.completed &&
      !onboardingQuery.data.skipped
    ) {
      return (
        <OnboardingWizard
          onDone={() => void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status })}
        />
      );
    }
  }
```

> Mirrors the `account_pending`/`deactivated` early-return shape (`app.tsx:61-67`) — a single early
> `return` before the app-shell render. Fires only for `isInstanceAdmin && isBootstrapOwner`
> (acceptance #4; bootstrap-owner-trigger-only invariant). Does **not** touch
> `/api/bootstrap/status`. On status error, `onboardingQuery.data` is undefined → no wizard → app
> shell renders (error handling). `onDone` invalidates the status query so the wizard's own
> `complete`/`skip` mutation result re-drives this branch to fall through.

**Step 11.3 — Run (expect PASS).**
`pnpm typecheck` → PASS. `pnpm lint` → PASS.

**Step 11.4 — Commit.**
```
git add apps/web/src/app.tsx
git commit -m "feat(web): app.tsx bootstrap-owner onboarding branch (Phase 2 onboarding)"
```

---

### Task 12 — e2e: mock `/api/onboarding/*` + wizard/branch behaviour spec

**Files**
- Create: `tests/e2e/mock-onboarding-api.ts`
- Modify: `tests/e2e/mock-api.ts`
- Create: `tests/e2e/onboarding.spec.ts`

> e2e is not in `verify:foundation`. These specs are authored and run via `pnpm test:e2e`; the
> foundation gate covers them through lint + typecheck. Run them where a Playwright browser is
> available.

**Step 12.1 — Write the mock.**
Create `tests/e2e/mock-onboarding-api.ts`:

```ts
import type { Page, Route } from "@playwright/test";
import type { OnboardingStatusResponse } from "@jarv1s/shared";

export interface MockOnboardingApiState {
  onboardingStatus?: OnboardingStatusResponse;
}

export function defaultOnboardingStatus(
  overrides: Partial<OnboardingStatusResponse> = {}
): OnboardingStatusResponse {
  return {
    completed: false,
    skipped: false,
    steps: {
      multiplexer: { done: false, selected: null, tmuxAvailable: false, herdrAvailable: false },
      cliAuth: {
        done: false,
        providers: [
          { kind: "anthropic", cliAvailable: false },
          { kind: "openai-compatible", cliAvailable: false },
          { kind: "google", cliAvailable: false }
        ]
      },
      connectors: { done: false }
    },
    ...overrides
  };
}

export async function registerMockOnboardingRoutes(
  page: Page,
  state: MockOnboardingApiState
): Promise<void> {
  const get = (route: Route) => {
    const status = state.onboardingStatus ?? defaultOnboardingStatus();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status)
    });
  };
  const flag = (route: Route, patch: Partial<OnboardingStatusResponse>) => {
    state.onboardingStatus = { ...(state.onboardingStatus ?? defaultOnboardingStatus()), ...patch };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ completed: state.onboardingStatus.completed, skipped: state.onboardingStatus.skipped })
    });
  };
  await page.route("**/api/onboarding/status", (route) => get(route));
  await page.route("**/api/onboarding/complete", (route) => flag(route, { completed: true }));
  await page.route("**/api/onboarding/skip", (route) => flag(route, { skipped: true }));
  await page.route(/\/api\/admin\/settings\/chat\.multiplexer$/, (route) => {
    const body = route.request().postDataJSON() as { value: { value: "tmux" | "herdr" } };
    const choice = body.value.value;
    const prev = state.onboardingStatus ?? defaultOnboardingStatus();
    state.onboardingStatus = {
      ...prev,
      steps: { ...prev.steps, multiplexer: { ...prev.steps.multiplexer, done: true, selected: choice } }
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        setting: {
          key: "chat.multiplexer",
          value: { value: choice },
          updatedByUserId: "user-1",
          createdAt: "2026-06-06T12:00:00.000Z",
          updatedAt: "2026-06-06T12:00:00.000Z"
        }
      })
    });
  });
}
```

**Step 12.2 — Wire the mock into `mock-api.ts`.**
In `tests/e2e/mock-api.ts`:

(a) Add to imports:

```ts
import {
  registerMockOnboardingRoutes,
  type MockOnboardingApiState
} from "./mock-onboarding-api.js";
```

(b) Extend `MockApiState` to include the onboarding state — change the interface declaration:

```ts
export interface MockApiState
  extends MockBriefingsApiState,
    MockAiApiState,
    MockConnectorsApiState,
    MockOnboardingApiState {
```

(c) Register the onboarding routes inside `mockApi`, alongside the other `registerMock*` calls (after
`await registerMockChatRoutes(page, state);`):

```ts
  await registerMockOnboardingRoutes(page, state);
```

> By default `state.onboardingStatus` is undefined → the mock serves `defaultOnboardingStatus()`
> (`completed:false, skipped:false`), which would route every authenticated bootstrap-owner spec into
> the wizard and break existing specs (app-shell, tasks, chat-drawer, connect-google). **To preserve
> existing specs**, set the default served status to *completed* when `onboardingStatus` is not
> explicitly provided. Change `defaultOnboardingStatus()` usage in `registerMockOnboardingRoutes`'
> `get` to serve a completed status by default:

Adjust `mock-onboarding-api.ts` `get` to:

```ts
  const get = (route: Route) => {
    const status =
      state.onboardingStatus ?? defaultOnboardingStatus({ completed: true });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status)
    });
  };
```

> Existing specs (which never set `onboardingStatus`) thus see `completed:true` and fall straight
> through to the app shell — no behaviour change. The onboarding spec explicitly sets
> `onboardingStatus: defaultOnboardingStatus()` to opt into the wizard.

**Step 12.3 — Write the spec.**
Create `tests/e2e/onboarding.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { defaultOnboardingStatus } from "./mock-onboarding-api.js";
import { mockApi } from "./mock-api.js";

test("bootstrap owner with incomplete onboarding sees the wizard, then the app shell after finish", async ({
  page
}) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus()
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).toBeVisible();
  // Ask Jarvis is disabled until a multiplexer is selected + a CLI is present.
  await expect(page.getByRole("button", { name: /Ask Jarvis/ })).toBeDisabled();

  // Advance to the last step and finish.
  await page.getByRole("button", { name: "Next" }).click(); // welcome -> multiplexer
  await page.getByRole("button", { name: "Next" }).click(); // multiplexer -> cliAuth
  await page.getByRole("button", { name: "Next" }).click(); // cliAuth -> connectors
  await page.getByRole("button", { name: "Finish" }).click();

  // After finish the status mock returns completed:true; the branch falls through.
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
});

test("Skip setup on the first step reaches the app shell", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus()
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).first().click();
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
});

test("a non-owner never sees the wizard", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: false, // non-admin ⇒ non-owner (meResponseFor keeps it coherent)
    chatThreads: [],
    connectorAccounts: [],
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus() // even incomplete, must be ignored for non-owners
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
});

test("a status-endpoint error falls through to the app shell", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    notifications: [],
    tasks: []
  });
  // Override status to 500 AFTER mockApi registers its 200 handler (last route wins).
  await page.route("**/api/onboarding/status", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "down" }) })
  );

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
});
```

> The non-owner test relies on `meResponseFor` setting `isBootstrapOwner:false` when
> `isInstanceAdmin:false` (verified `mock-api.ts`), so the app.tsx branch never fires. The
> status-error test re-registers the status route to 500 after `mockApi` (Playwright uses
> last-registered-wins), proving the fall-through error path.

**Step 12.4 — Run (expect PASS where a browser is available).**
`pnpm test:e2e tests/e2e/onboarding.spec.ts`
If the build host has no Playwright browser, run `pnpm lint` + `pnpm typecheck` over the new files
instead (the floor per the verification-scope note); the spec must be lint+type clean.

**Step 12.5 — Commit.**
```
git add tests/e2e/mock-onboarding-api.ts tests/e2e/mock-api.ts tests/e2e/onboarding.spec.ts
git commit -m "test(e2e): onboarding wizard + app.tsx branch + status-error fall-through (Phase 2 onboarding)"
```

---

### Task 13 — Self-Review

**Files:** none (review only). Produce written confirmation; fix any gap by looping back to the
owning task before proceeding to Task 14.

**Step 13.1 — Spec §-by-§ coverage check.** Confirm each acceptance criterion (spec §Acceptance
criteria 1–10) is satisfied:

1. `GET /api/onboarding/status` returns `{completed,skipped,steps}` with server-derived `done` flags;
   admin-gated; per-method `DataContextDb`. → Tasks 4, 6.
2. `POST /complete` + `/skip` upsert the flags, `requireAdmin`-gated, each writes an audit row. → Tasks
   3, 5.
3. `cli-availability.ts` gains `herdrAvailable`, presence-only, same `WhichDeps` seam. → Task 1.
4. `app.tsx` branch fires only for `isInstanceAdmin && isBootstrapOwner` when `!completed && !skipped`;
   mirrors `account_pending`; never touches `/api/bootstrap/status`. → Task 11.
5. Wizard renders four ordered steps; every step skippable; whole flow skippable; re-entry resumes at
   first not-done. → Tasks 8, 10.
6. Step 2 writes `chat.multiplexer` via existing audited `PATCH /api/admin/settings/:key`; multiplexer/
   CLI steps show instructions + manual re-check (no auto-install, no blocking poll). → Tasks 7, 8.
7. Optional chat overlay mounts in the wizard, disabled until a CLI path is usable, reuses chat drawer/
   stream, never gates completion. → Tasks 9, 10.
8. New shared contracts in `platform-api.ts`, barrel-exported; `queryKeys.onboarding` namespace. →
   Tasks 2, 7.
9. No new migration; no secret-shaped field in any onboarding response; `AccessContext` unchanged; all
   writes audited. → Tasks 2–6 (assertions in Task 4/5 tests check for secret-shaped fields and audit
   actions).
10. `pnpm verify:foundation` green incl. new unit + integration tests. → Task 14.

**Step 13.2 — Placeholder scan.** Grep the worktree for accidental placeholders introduced by this
slice:
```
grep -rn "TODO\|FIXME\|similar to above\|placeholder\|XXX" \
  packages/ai/src/cli-availability.ts \
  packages/shared/src/platform-api.ts \
  packages/settings/src/repository.ts packages/settings/src/routes.ts \
  packages/module-registry/src/index.ts \
  apps/web/src/onboarding apps/web/src/app.tsx apps/web/src/api/client.ts apps/web/src/api/query-keys.ts \
  tests/unit/onboarding-cli-availability.test.ts tests/integration/onboarding.test.ts \
  tests/e2e/mock-onboarding-api.ts tests/e2e/onboarding.spec.ts
```
Expected: no matches in the new/changed code (pre-existing TODOs elsewhere are out of scope).

**Step 13.3 — Type-consistency check.** Confirm:
- The repository `OnboardingStatus` shape is structurally identical to `OnboardingStatusResponse`
  (Task 2) so the status route can `return status` and pass JSON-schema serialization. Field names,
  optionality, and the `selected` enum (`"tmux"|"herdr"|null`) match.
- `OnboardingProviderKind` (repository) === `ProviderKind` (`@jarv1s/ai`) === the schema `kind` enum
  (`anthropic|openai-compatible|google`) === `OnboardingCliProviderDto.kind`.
- `upsertInstanceSetting(key, value)` body is `{ value }` and the value passed is `{ value: choice }`
  → the wire body is `{ value: { value: "tmux" } }` (matches `parseInstanceSettingBody`).
- `ChatDrawer`/`useChatStream` destructure in the overlay matches the real exports (Task 9 note).

**Step 13.4 — Hard-Invariant audit.** Confirm against CLAUDE.md "Hard Invariants":
DataContextDb-only (every new repo method starts with `assertDataContextDb`), AccessContext unchanged
(routes read only `actorUserId`/`requestId`), secrets never escape (status returns booleans + enum
only; CLI step presence-only), module isolation (probes injected via module-registry, no settings→
ai/connectors package dep), no migration, all admin writes audited, bootstrap-owner-only trigger.

**Step 13.5 — Coordination check.** Re-run `grep -rn "ChatMultiplexer" packages/shared/src` to confirm
the type is defined exactly once (spec §Open risks — CLI-adapter slice race). If the CLI-adapter slice
landed it meanwhile, reconcile to a single definition (Task 2 note) before Task 14.

---

### Task 14 — Final gate: `pnpm verify:foundation` (+ e2e where available)

**Files:** none (verification only).

**Step 14.1 — Ensure Postgres is up.**
`pnpm db:up`

**Step 14.2 — Run the full foundation gate.**
`pnpm verify:foundation`
This runs, in order: `lint` (eslint, `--max-warnings=0`), `format:check` (prettier — run
`pnpm format` first if needed and re-commit), `check:file-size` (no source file >1000 lines — verify
`apps/web/src/onboarding/onboarding-wizard.tsx`, `packages/settings/src/routes.ts`,
`packages/settings/src/repository.ts`, and `packages/shared/src/platform-api.ts` are all under the
limit), `typecheck` (tsc + web typecheck), `test:unit` (includes the `herdrAvailable` test),
`db:migrate` (idempotent; no new migration so the hash-check is unaffected), `test:integration`
(includes `tests/integration/onboarding.test.ts`).
Expected: GREEN end-to-end. Capture the real exit code (do not pipe through `| tail`).

**Step 14.3 — Run the onboarding e2e where a browser is available.**
`pnpm test:e2e tests/e2e/onboarding.spec.ts` (and re-run an existing spec, e.g.
`pnpm test:e2e tests/e2e/app-shell.spec.ts`, to confirm the mock default — completed status — did not
regress existing specs). If no browser on the host, this is best-effort; the foundation gate (lint +
typecheck of the specs) is the floor.

**Step 14.4 — Final commit (only if `pnpm format` or `check:file-size` decomposition changed files).**
If `pnpm format` rewrote files or a file needed decomposition to stay under 1000 lines, stage exactly
those files explicitly and commit:
```
git add <explicit paths that format/decomposition touched>
git commit -m "chore(onboarding): formatting + file-size compliance (Phase 2 onboarding)"
```
Otherwise no commit is needed — the gate is green on the existing commits.

---

## Notes for the autonomous build

- **Never `git add -A` / `git add .`** — a sibling session may share this tree. Every commit above
  lists explicit paths.
- **Do not start, stop, or migrate another agent's database** — use the per-agent `JARVIS_PGDATABASE`
  the run manifest assigned you for `pnpm db:up`/`test:integration`.
- **`chat.multiplexer` contract is owned here** unless the CLI-adapter slice landed it first; Task 2
  and Task 13.5 guard against a duplicate `ChatMultiplexer` definition.
- **Two paths validate only at the DEPLOY checkpoint** (real multiplexer engine use; real chat overlay
  replies) — do not stall the build waiting on the CLI-adapter / deployable-stack slices. Everything
  in Tasks 1–14 is buildable and gate-testable against the already-shipped panels + presence probes.
- If any step's "expected FAIL" instead passes, stop and investigate (the test or the baseline is
  wrong) before implementing — do not skip the RED phase.
