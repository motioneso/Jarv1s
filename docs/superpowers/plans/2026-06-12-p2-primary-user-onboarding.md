# Implementation Plan — Phase 2 Primary-user Onboarding (hybrid Jarvis-guided + skippable)

**Spec:** `docs/superpowers/specs/2026-06-12-p2-primary-user-onboarding-design.md` (read it; this plan
implements every § of it). **Epic:** #47 (Phase 2), exit criterion #6.

---

## Goal

After the founder signs up (bootstrap owner created by `bootstrapFirstJarvisUser`,
`packages/auth/src/index.ts`), give them a **deterministic, fully-skippable, resumable** step wizard
that provisions the ADR 0008 §2 prerequisites (multiplexer install + selection, CLI auth, optional
connector setup) and records completion in `app.instance_settings` via a single `onboarding.state`
enum key. The wizard works **before any AI model is configured**; an optional Jarvis chat overlay
lights up only once a **usable** multiplexer + a present CLI exist. No new table, no migration, no new
module, no secrets in any response. All admin writes are audited. The multiplexer choice reuses the
already-landed CLI-adapter `chat.multiplexer` contract and `PUT /api/admin/chat-multiplexer` route —
onboarding introduces **no second writer** of that key and **no duplicate `ChatMultiplexer` type**.

## Architecture

- **Spine (deterministic):** a new `apps/web/src/onboarding/` route tree, pure REST + React Query,
  identical in shape to the existing admin panels. State read from a new `GET /api/onboarding/status`.
  No AI dependency.
- **Optional overlay:** an `OnboardingChatOverlay` that reuses the existing chat drawer/stream; inert
  until `steps.multiplexer.done` (a **usable** multiplexer — root-pane aware for herdr) AND at least
  one provider's `cliPresent` is true (`isOverlayEnabled`). Never gates step completion.
- **Server surface:** three new routes in `packages/settings` (the module that already owns
  `instance_settings`, `requireAdmin`, `admin_audit_events`): `GET /api/onboarding/status` (admin),
  `POST /api/onboarding/complete` (requireAdmin + audited), `POST /api/onboarding/skip` (same). All
  follow the slice-D per-method `DataContextDb` pattern (`assertDataContextDb(scopedDb)` first; admin
  check + repository call share one `withDataContext` transaction). Host presence probes (tmux/herdr/
  CLI) are **bounded live probes** run **outside** the DB transaction (see "Probe placement" below):
  each is capped by a short timeout that degrades to `false`, so a slow/hung `command -v` neither holds
  a DB connection nor makes the founder wait — while still reflecting a binary installed after boot
  (live "Re-check" works without a server restart).
- **State (founder-scoped, zero-migration):** `onboarding` status is a **single enum** key —
  `onboarding.state` (`"pending" | "completed" | "skipped"`, default `"pending"`) — so the terminal
  state is unambiguous (a prior `completed` + `skipped` double-true was possible with two booleans).
  The multiplexer choice is **NOT a new key**: the CLI-adapter slice already owns `chat.multiplexer`
  (`packages/settings/src/repository.ts` `get/setChatMultiplexerSetting`, contract
  `ChatMultiplexerChoice = "auto" | "tmux" | "herdr"`, routes `GET/PUT /api/admin/chat-multiplexer`).
  Onboarding **reuses** that contract/route end to end — no second writer, no `ChatMultiplexer`
  duplicate type, no generic `PATCH /api/admin/settings/:key` write to that key.
  Per-step `done` is **derived server-side**, never separately persisted:
  - **multiplexer.done** ⇔ the chosen multiplexer is **usable** (not merely a binary on PATH). It
    reuses the adapter slice's resolution semantics (`packages/ai/src/adapters/multiplexer-resolve.ts`
    `decideMultiplexer`): `"tmux"` usable ⇔ tmux installed; `"herdr"` usable ⇔ herdr installed **AND**
    a root pane exists (`JARVIS_HERDR_ROOT_PANE`/`HERDR_PANE_ID`); `"auto"` usable ⇔ either is usable.
    `done` is true when `decideMultiplexer(...)` returns `{ ok: true }`. Bare `command -v herdr` is
    insufficient (herdr needs a root pane) — the wizard never enables "Use herdr" on bare presence.
  - **cliAuth.done** ⇔ at least one provider CLI is **present** (`cliAvailable`, presence-only). This
    is a deliberate, documented floor: presence ≠ authenticated; the field is named/worded "present"
    (`anyCliPresent`), and the step copy says "detected", never "authenticated". The wizard never
    blocks on it; the founder confirms login on the host.
  - **connectors.done** ⇔ a connector account exists.
- **Trigger:** one new branch in `apps/web/src/app.tsx`, mirroring the existing
  `account_pending_approval`/`deactivated` branches. Fires **only** for
  `isInstanceAdmin && isBootstrapOwner`; renders `<OnboardingWizard/>` when `state === "pending"`.
  Does **not** touch the unauthenticated `/api/bootstrap/status` probe (OTNR-P4 #122). **Never blocks
  a fresh instance from booting:** the status query has `retry: false`; on error/timeout the branch
  falls through to the app shell (onboarding is optional), and app.tsx passes the already-fetched
  status into the wizard as `initialData` so the wizard renders no second loading screen.

#### Probe placement (Codex R1 probes-in-txn / R2 unbounded / R3 boot-block + re-check)

`getOnboardingStatus` is split so host probes never run inside the DB transaction AND never block
boot: the two `instance_settings` reads + the admin check + connector-existence run inside
`withDataContext`; the tmux/herdr usability decision and CLI presence probes run in the **route,
outside** the transaction, as **injected bounded live functions**. Each host probe is wrapped in a
short timeout (→ `false`), so it (a) never holds a DB connection (outside the txn), (b) never makes the
founder wait unbounded (the timeout caps request latency), (c) never blocks server **startup** (no
probing at boot — the functions are constructed synchronously and probe lazily, so
`registerBuiltInApiRoutes` stays sync), and (d) reflects a binary installed after boot on the next
status fetch (live "Re-check"). The repository's status assembler is a **pure** function of (settings
row, the resolved usability booleans, the resolved CLI-presence booleans, connector-exists bool) — the
route resolves the booleans (bounded) and hands them to the pure assembler.

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
  `getOnboardingStatus` returns only booleans + the `"auto"|"tmux"|"herdr"|null` enum; no
  secret-shaped field (the integration test asserts no `token|secret|password|credential` substring).
- **Module isolation** — onboarding lives in `packages/settings`; it consumes the multiplexer-usability
  decision + CLI presence from `@jarv1s/ai` and the connector-existence check from `@jarv1s/connectors`'
  public API, all **injected as route dependencies** (no cross-module table reads, no settings→
  ai/connectors *package* dep). The injection happens in `packages/module-registry`, which already
  imports both modules.
- **Single ownership of `chat.multiplexer`** — onboarding NEVER writes that key directly. The
  multiplexer step calls the adapter slice's `PUT /api/admin/chat-multiplexer` (which routes through
  `setChatMultiplexerSetting` + its audit action). No generic `PATCH /api/admin/settings/:key` write,
  no duplicate audit action, no duplicate `ChatMultiplexer` type.
- **Audit everything admin** — complete/skip flow through `setOnboardingState` (audit actions
  `onboarding.complete` / `onboarding.skip`); the multiplexer write is audited by the existing
  `setChatMultiplexerSetting` path. All land in `admin_audit_events`.
- **No migration** — reuses the existing `instance_settings` table (one new key, `onboarding.state`)
  and the existing audited upsert helper.
- **Bootstrap-owner trigger only** — the app.tsx branch fires only for `isBootstrapOwner`.

### Verification scope note (read before executing)

`pnpm verify:foundation` = `lint && format:check && check:file-size && typecheck && test:unit &&
db:migrate && test:integration`. It **does not** run `test:e2e` (Playwright). Therefore:

- The `herdrAvailable` unit test (Task 1) lands in `tests/unit/` so it runs under `test:unit`.
- The status/complete/skip server behaviour (Tasks 4–5) lands in `tests/integration/` so it runs
  under `test:integration`.
- **The skip/resume + overlay-gating + app-branch decision logic is extracted into a pure, host-free
  helper** (`apps/web/src/onboarding/resume.ts` → `firstIncompleteStepIndex`, `isOverlayEnabled`,
  `isBootstrapOwner`, `shouldShowOnboarding`) and unit-tested in `tests/unit/onboarding-resume.test.ts`
  so the core skippability / resumability / overlay-gating / **app-branch (owner-only, pending-only,
  error-fall-through)** behaviour runs **inside `verify:foundation`** (Codex R1/R2: branch tests must
  not be Playwright-only). The wizard and `app.tsx` both import these predicates; the e2e spec then
  only confirms the rendered wiring.
- The wizard + app.tsx-branch full-render behaviour (Tasks 12–13) lands in `tests/e2e/` (Playwright).
  These are authored and must pass via `pnpm test:e2e`, but the **foundation gate covers them only
  through lint + typecheck**. The final task runs `pnpm verify:foundation` (mandatory) and
  additionally runs `pnpm test:e2e` for the onboarding specs (best-effort; the build host must have
  the Playwright browser — if unavailable, lint+typecheck of the specs is the floor and that is
  acceptable per the spec's CI scope, because the load-bearing resume/gating logic is already covered
  by the in-gate unit test above).

---

## File Structure

### New files

| Path | Purpose | Tested by |
| --- | --- | --- |
| `tests/unit/onboarding-cli-availability.test.ts` | unit test for `herdrAvailable` | itself |
| `tests/unit/onboarding-resume.test.ts` | unit test for resume + overlay-gating + app-branch predicates (in gate) | itself |
| `tests/integration/onboarding.test.ts` | integration tests for status/complete/skip + real connector | itself |
| `apps/web/src/onboarding/resume.ts` | pure resume/overlay-gating/app-branch helpers (host-free, gate-tested) | unit |
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
| `packages/shared/src/platform-api.ts` | add `OnboardingState` enum, `OnboardingStatusResponse` (+ DTO sub-shapes), 3 route schemas; **reuse existing `ChatMultiplexerChoice`** (do NOT add a `ChatMultiplexer` type) |
| `packages/settings/src/repository.ts` | add `assembleOnboardingStatus(...)` (pure) + `readOnboardingState`/`setOnboardingState`; reuse `getChatMultiplexerSetting` |
| `packages/settings/src/routes.ts` | add 3 onboarding routes; extend `SettingsRoutesDependencies` with injected `onboardingProbes` (bounded live usability/CLI-presence functions + connector-exists) |
| `packages/module-registry/src/index.ts` | wrap `registerSettingsRoutes` — **spread/forward existing deps**, then add `onboardingProbes` (bounded live tmux/herdr-usability + CLI-presence functions + connector-exists check) |
| `packages/module-registry/src/chat-multiplexer.ts` | add `boundedProbe` + `makeMultiplexerUsableProbe`/`makeCliPresentProbe` live bounded probes |
| `apps/api/src/server.ts` | pass nothing new (registration owns the wiring) — verified, no change required |
| `apps/web/src/api/query-keys.ts` | add `onboarding` namespace |
| `apps/web/src/api/client.ts` | add `getOnboardingStatus`, `completeOnboarding`, `skipOnboarding`; reuse the existing `putChatMultiplexerSettings` client fn (add it if absent) — **no generic instance-setting writer for `chat.multiplexer`** |
| `apps/web/src/app.tsx` | add the bootstrap-owner onboarding branch; pass status as `initialData` to the wizard |
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

### Task 2 — Shared contracts: `OnboardingState`, `OnboardingStatusResponse`, route schemas

**Files**
- Modify: `packages/shared/src/platform-api.ts`
  (re-exported automatically by the barrel `packages/shared/src/index.ts:15`, no barrel edit needed)

> **Coordination — the CLI-adapter slice HAS LANDED (verified 2026-06-13).** `platform-api.ts:345`
> already defines `export type ChatMultiplexerChoice = "auto" | "tmux" | "herdr"` ("Single source of
> truth — ai/settings import this"), plus `ChatMultiplexerSettingsDto`,
> `getChatMultiplexerSettingsRouteSchema`, `putChatMultiplexerSettingsRouteSchema`. **Do NOT add a
> `ChatMultiplexer` type** — onboarding reuses `ChatMultiplexerChoice`. The `selected` field below is
> typed `ChatMultiplexerChoice | null` (`null` only when the `chat.multiplexer` row is absent on a
> fresh instance; once present it is `"auto"|"tmux"|"herdr"`). Confirm before editing:
> `grep -n "ChatMultiplexerChoice" packages/shared/src/platform-api.ts` (expect the existing line 345).

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
// NOTE: ChatMultiplexerChoice ("auto"|"tmux"|"herdr") is the EXISTING CLI-adapter
// contract (this file, ~line 345). Onboarding reuses it; it is NOT redefined here.
// ---------------------------------------------------------------------------

/** Single, unambiguous onboarding lifecycle state (replaces two booleans). */
export type OnboardingState = "pending" | "completed" | "skipped";

export interface OnboardingMultiplexerStepDto {
  /** done ⇔ the chosen multiplexer is USABLE (tmux installed | herdr installed+root pane | auto). */
  readonly done: boolean;
  /** The persisted chat.multiplexer choice, or null when no row exists yet. */
  readonly selected: ChatMultiplexerChoice | null;
  /** tmux is usable on this host (installed). */
  readonly tmuxUsable: boolean;
  /** herdr is usable on this host (installed AND a root pane is configured). */
  readonly herdrUsable: boolean;
}

export interface OnboardingCliProviderDto {
  readonly kind: "anthropic" | "openai-compatible" | "google";
  /** Presence-only: the binary is on PATH. NOT a claim of authentication. */
  readonly cliPresent: boolean;
}

export interface OnboardingCliAuthStepDto {
  /** Documented floor: done ⇔ at least one provider CLI is PRESENT (presence ≠ authed). */
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
  readonly state: OnboardingState;
  readonly steps: OnboardingStepsDto;
}

export interface OnboardingStateResponse {
  readonly state: OnboardingState;
}

const onboardingStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "steps"],
  properties: {
    state: { type: "string", enum: ["pending", "completed", "skipped"] },
    steps: {
      type: "object",
      additionalProperties: false,
      required: ["multiplexer", "cliAuth", "connectors"],
      properties: {
        multiplexer: {
          type: "object",
          additionalProperties: false,
          required: ["done", "selected", "tmuxUsable", "herdrUsable"],
          properties: {
            done: { type: "boolean" },
            selected: { type: ["string", "null"], enum: ["auto", "tmux", "herdr", null] },
            tmuxUsable: { type: "boolean" },
            herdrUsable: { type: "boolean" }
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
                required: ["kind", "cliPresent"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["anthropic", "openai-compatible", "google"]
                  },
                  cliPresent: { type: "boolean" }
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

const onboardingStateResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state"],
  properties: {
    state: { type: "string", enum: ["pending", "completed", "skipped"] }
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
    200: onboardingStateResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingSkipRouteSchema = {
  response: {
    200: onboardingStateResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;
```

> `errorResponseSchema` is already imported at the top of `platform-api.ts` (line 1). No new import.
> `ChatMultiplexerChoice` is already declared in the same file (line 345) — reference it directly.

**Step 2.3 — Run (expect PASS).**
`pnpm typecheck` → PASS. The new symbols are exported via the barrel automatically.

**Step 2.4 — Commit.**
```
git add packages/shared/src/platform-api.ts
git commit -m "feat(shared): add onboarding contracts (reuse ChatMultiplexerChoice) (Phase 2 onboarding)"
```

---

### Task 3 — `SettingsRepository.readOnboardingState` / `setOnboardingState` (enum, audited via the existing upsert helper)

**Files**
- Modify: `packages/settings/src/repository.ts`
- Test: covered by Task 5's integration test (`tests/integration/onboarding.test.ts`); this task
  ships the methods so Task 5's test can be written against them. To keep the TDD loop tight, Task 3's
  proof is `pnpm typecheck` PASS + Task 5 RED→GREEN. (The methods are exercised end-to-end in Task 5.)

**Step 3.1 — Run typecheck baseline + confirm reuse points.**
`pnpm typecheck` → PASS. Confirm the helper you will extend:
`grep -n "async upsertInstanceSetting\|insertAuditEvent\|UpsertInstanceSettingInput" packages/settings/src/repository.ts`
— `upsertInstanceSetting(scopedDb, { key, value, updatedByUserId, requestId })` performs the row
upsert AND writes exactly one audit row with the hard-coded action `"instance_setting.upsert"`. To get
**exactly one** audit row carrying the specific `onboarding.complete`/`onboarding.skip` action (Codex
R2: avoid a double audit; R1: no hand-rolled second insert), add an **optional `action` override** to
`UpsertInstanceSettingInput` and use it in `upsertInstanceSetting`. Verify `insertAuditEvent`'s shape
first (`grep -n "insertAuditEvent\|interface UpsertInstanceSettingInput" packages/settings/src/repository.ts`)
and adapt field names to match (do not invent fields).

**Step 3.2 — Implement (one audit row via an action override on the shared helper).**
In `packages/settings/src/repository.ts`:

(a) Add an optional `action` (and optional `metadata`) to the **existing** `UpsertInstanceSettingInput`
— leave every existing field (including `value`, whose current type is `Record<string, unknown>`)
exactly as-is; only append the two optionals (Codex R3 #5):

```ts
export interface UpsertInstanceSettingInput {
  // ...all existing fields UNCHANGED (key, value: Record<string, unknown>, updatedByUserId,
  //    requestId — do not retype value)...
  /** Override the audit action (default "instance_setting.upsert"). Keeps ONE audit row. */
  readonly action?: string;
  /** Override audit metadata (default { key }). */
  readonly metadata?: Record<string, unknown>;
}
```

> Confirm the current field shape first (`grep -n "interface UpsertInstanceSettingInput" -A8 packages/settings/src/repository.ts`)
> and append only the two optionals. Do NOT change `value`'s type.

(b) Use them in `upsertInstanceSetting`'s `insertAuditEvent` call (replace the hard-coded action/
metadata):

```ts
    await this.insertAuditEvent(scopedDb, {
      actorUserId: input.updatedByUserId,
      action: input.action ?? "instance_setting.upsert",
      targetType: "instance_setting",
      targetId: input.key,
      requestId: input.requestId,
      metadata: input.metadata ?? { key: input.key }
    });
```

> This is backward-compatible: every existing caller (including `setChatMultiplexerSetting`) omits
> `action`/`metadata` and keeps the `instance_setting.upsert` row unchanged. Only onboarding passes the
> override, yielding exactly one row.

(c) Add the input type near the other input interfaces (after `RegistrationSettings`). Import
`OnboardingState` from `@jarv1s/shared` (extend the existing shared import block):

```ts
export interface SetOnboardingStateInput {
  readonly state: Exclude<OnboardingState, "pending">; // only complete/skip are written
  readonly actorUserId: string;
  readonly requestId: string;
}
```

(d) Add the methods inside `class SettingsRepository`, immediately after
`getChatMultiplexerSetting`/`setChatMultiplexerSetting` (keeping onboarding next to its sibling
multiplexer setting):

```ts
  /** Read the single onboarding lifecycle state (default "pending" when absent). */
  async readOnboardingState(scopedDb: DataContextDb): Promise<OnboardingState> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", "onboarding.state")
      .executeTakeFirst();
    const raw = (row?.value as { value?: unknown } | undefined)?.value;
    return raw === "completed" || raw === "skipped" ? raw : "pending";
  }

  /**
   * Set onboarding.state to "completed" or "skipped" through the shared audited upsert
   * helper with an ACTION OVERRIDE, so there is exactly ONE audit row carrying the
   * specific verb ("onboarding.complete"/"onboarding.skip"). A single enum key means the
   * terminal state is never ambiguous (the prior two-boolean design allowed completed &&
   * skipped both true); skip overwrites completed and vice-versa.
   */
  async setOnboardingState(
    scopedDb: DataContextDb,
    input: SetOnboardingStateInput
  ): Promise<OnboardingState> {
    assertDataContextDb(scopedDb);
    await this.upsertInstanceSetting(scopedDb, {
      key: "onboarding.state",
      value: { value: input.state },
      updatedByUserId: input.actorUserId,
      requestId: input.requestId,
      action: input.state === "completed" ? "onboarding.complete" : "onboarding.skip",
      metadata: { state: input.state }
    });
    return input.state;
  }
```

> Reuses `upsertInstanceSetting` for the row write — no hand-rolled second insert path (R1) — and the
> action override means exactly one audit row (R2). `assertDataContextDb` first on every DB method
> (DataContextDb invariant). No nested `withDataContext`.

**Step 3.3 — Run (expect PASS).**
`pnpm typecheck` → PASS.

**Step 3.4 — Commit.**
```
git add packages/settings/src/repository.ts
git commit -m "feat(settings): add readOnboardingState/setOnboardingState (enum, audited) (Phase 2 onboarding)"
```

---

### Task 4 — `GET /api/onboarding/status`: pure assembler + route + module-registry wiring + integration test

**Files**
- Create: `tests/integration/onboarding.test.ts` (read-path tests this task; write-path tests in Task 5)
- Modify: `packages/settings/src/repository.ts`
- Modify: `packages/settings/src/routes.ts`
- Modify: `packages/module-registry/src/index.ts` (inject the bounded onboarding probes)
- Modify: `packages/module-registry/src/chat-multiplexer.ts` (add the bounded live usability/CLI probes)

> **Ordering note (Codex R2 #1):** the route fails closed (500) until the probes are injected, and the
> integration tests run through `createApiServer` (→ module-registry). So the probe **wiring is part of
> THIS task** (Step 4.4b), landing before the route-mounted assertions run green. Task 6 then only adds
> the *real-connector-account* assertion (which needs a seeded account) — it does not first-introduce
> the wiring.

The status is a **pure assembler** fed by: the persisted `onboarding.state` + `chat.multiplexer`
choice (DB reads), the resolved tmux/herdr usability booleans, the resolved per-provider CLI-presence
booleans, and a connector-existence bool. The route resolves the booleans by calling **injected
bounded live probe functions** (timeout → false, outside the DB transaction); those functions are
supplied by module-registry (which already imports `@jarv1s/ai`/`@jarv1s/connectors`), so
`packages/settings` keeps no package dep on them (module isolation). The pure assembler takes only
booleans, so tests fake it directly with no host or DB.

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

  it("returns state=pending + all steps not-done for a fresh bootstrap owner", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      state: string;
      steps: {
        multiplexer: { done: boolean; selected: string | null };
        cliAuth: { done: boolean; providers: { kind: string; cliPresent: boolean }[] };
        connectors: { done: boolean };
      };
    };
    expect(body.state).toBe("pending");
    // selected is null only when no chat.multiplexer row exists yet on a fresh instance.
    expect(body.steps.multiplexer.selected).toBeNull();
    // multiplexer.done is false because nothing is selected/usable yet (host-independent:
    // selected===null ⇒ not done regardless of installed binaries).
    expect(body.steps.multiplexer.done).toBe(false);
    expect(body.steps.connectors.done).toBe(false);
    // No secret-shaped field anywhere.
    expect(JSON.stringify(body)).not.toMatch(/token|secret|password|credential/i);
  });

  it("marks the multiplexer step done after chat.multiplexer is set to a usable choice", async () => {
    // Use the DEDICATED, audited adapter route (PUT /api/admin/chat-multiplexer) — the
    // single owner of chat.multiplexer. Onboarding never writes that key directly.
    const put = await server.inject({
      method: "PUT",
      url: "/api/admin/chat-multiplexer",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { multiplexer: "auto" }
    });
    expect(put.statusCode).toBe(200);

    const res = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    const body = res.json() as {
      steps: { multiplexer: { done: boolean; selected: string | null; tmuxUsable: boolean; herdrUsable: boolean } };
    };
    // selected reflects the persisted choice ("auto"). done depends on host usability,
    // which is host-dependent in the real server; assert selected + that done is a boolean
    // consistent with usability (done ⇔ at least one usable for "auto").
    expect(body.steps.multiplexer.selected).toBe("auto");
    const anyUsable = body.steps.multiplexer.tmuxUsable || body.steps.multiplexer.herdrUsable;
    expect(body.steps.multiplexer.done).toBe(anyUsable);
  });

  it("assembleOnboardingStatus derives flags from a settings row + availability snapshot + connector bool", () => {
    // Pure assembler — no DB, no host, no transaction. Exercised directly so derivation
    // logic runs deterministically regardless of the CI host's installed binaries.
    const repository = new SettingsRepository();
    const status = repository.assembleOnboardingStatus({
      state: "pending",
      selected: "herdr",
      availability: { tmuxUsable: true, herdrUsable: false },
      cliPresentByKind: { anthropic: true, "openai-compatible": false, google: false },
      connectorAccountExists: true
    });
    expect(status.state).toBe("pending");
    // herdr selected but NOT usable (no root pane) ⇒ multiplexer.done is FALSE even though
    // herdr's binary may be present — bare presence is insufficient (Codex R1 herdr finding).
    expect(status.steps.multiplexer.selected).toBe("herdr");
    expect(status.steps.multiplexer.done).toBe(false);
    expect(status.steps.multiplexer.tmuxUsable).toBe(true);
    expect(status.steps.multiplexer.herdrUsable).toBe(false);
    expect(status.steps.cliAuth.providers).toEqual([
      { kind: "anthropic", cliPresent: true },
      { kind: "openai-compatible", cliPresent: false },
      { kind: "google", cliPresent: false }
    ]);
    expect(status.steps.cliAuth.done).toBe(true); // at least one present
    expect(status.steps.connectors.done).toBe(true);
  });

  it("assembleOnboardingStatus: auto is done when either multiplexer is usable", () => {
    const repository = new SettingsRepository();
    const auto = repository.assembleOnboardingStatus({
      state: "pending",
      selected: "auto",
      availability: { tmuxUsable: true, herdrUsable: false },
      cliPresentByKind: { anthropic: false, "openai-compatible": false, google: false },
      connectorAccountExists: false
    });
    expect(auto.steps.multiplexer.done).toBe(true); // auto + tmux usable
    expect(auto.steps.cliAuth.done).toBe(false); // no CLI present
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

**Step 4.3 — Implement the pure assembler + thin DB read.**
The status method is split so host probes never run inside the DB transaction (Codex R1
probes-in-transaction race): the **route** resolves the tmux/herdr usability + CLI-presence booleans
(via bounded live probes, outside the txn) and the connector-exists bool (its check uses the route's
own `scopedDb`), then calls a **pure** `assembleOnboardingStatus` that takes only booleans.
In `packages/settings/src/repository.ts`, add these types near the top input interfaces (after
`SetOnboardingStateInput` from Task 3). Import `OnboardingStatusResponse`, `ChatMultiplexerChoice`,
and `OnboardingState` from `@jarv1s/shared` (extend the existing shared import block):

```ts
export type OnboardingProviderKind = "anthropic" | "openai-compatible" | "google";

/** Host usability of each multiplexer, resolved by the composition root (env-aware). */
export interface OnboardingAvailability {
  readonly tmuxUsable: boolean;
  readonly herdrUsable: boolean;
}

/** Pure inputs to the status assembler (no DB, no host I/O, no transaction). */
export interface AssembleOnboardingStatusInput {
  readonly state: OnboardingState;
  readonly selected: ChatMultiplexerChoice | null;
  readonly availability: OnboardingAvailability;
  readonly cliPresentByKind: Readonly<Record<OnboardingProviderKind, boolean>>;
  readonly connectorAccountExists: boolean;
}

const ONBOARDING_CLI_KINDS: readonly OnboardingProviderKind[] = [
  "anthropic",
  "openai-compatible",
  "google"
];
```

Add the **pure** assembler inside `class SettingsRepository` (a method for testability; it touches no
`this` state and no DB — `assertDataContextDb` is therefore NOT called here because there is no
`scopedDb`):

```ts
  /**
   * PURE derivation of onboarding status — no DB, no host probes, no transaction. The route
   * supplies the persisted state + selected choice (from a DB read), the host availability
   * snapshot, the per-provider CLI presence, and the connector-exists bool. Derived `done`:
   *  - multiplexer.done ⇔ the SELECTED choice is USABLE on this host:
   *       "tmux"  ⇒ tmuxUsable ; "herdr" ⇒ herdrUsable ; "auto" ⇒ tmuxUsable || herdrUsable.
   *     A null selection (no chat.multiplexer row yet) ⇒ not done. Bare binary presence is
   *     NOT enough for herdr (it needs a root pane) — usability is decided upstream.
   *  - cliAuth.done ⇔ at least one provider CLI is PRESENT (presence ≠ authenticated; floor).
   *  - connectors.done ⇔ a connector account exists.
   * The `satisfies OnboardingStatusResponse` makes contract drift a compile error (Codex R1).
   */
  assembleOnboardingStatus(input: AssembleOnboardingStatusInput): OnboardingStatusResponse {
    const { state, selected, availability, cliPresentByKind, connectorAccountExists } = input;

    const multiplexerDone =
      selected === "tmux"
        ? availability.tmuxUsable
        : selected === "herdr"
          ? availability.herdrUsable
          : selected === "auto"
            ? availability.tmuxUsable || availability.herdrUsable
            : false;

    const providers = ONBOARDING_CLI_KINDS.map((kind) => ({
      kind,
      cliPresent: cliPresentByKind[kind]
    }));

    return {
      state,
      steps: {
        multiplexer: {
          done: multiplexerDone,
          selected,
          tmuxUsable: availability.tmuxUsable,
          herdrUsable: availability.herdrUsable
        },
        cliAuth: {
          done: providers.some((p) => p.cliPresent),
          providers
        },
        connectors: { done: connectorAccountExists }
      }
    } satisfies OnboardingStatusResponse;
  }
```

> The repository return type IS the shared `OnboardingStatusResponse` (no parallel local DTO; Codex
> R1 contract-drift). `selected` is read in the route from the existing
> `getChatMultiplexerSetting(scopedDb)` (which returns `"auto"` when no row exists) — **but** the
> status needs to distinguish "no row yet" (`null`, fresh instance) from a persisted `"auto"`. So the
> route reads the raw row presence: if no `chat.multiplexer` row exists, pass `selected: null`; else
> pass the stored choice. Add a tiny helper to the repository for that exact read:

```ts
  /** Read the persisted chat.multiplexer choice, or null when no row exists (fresh instance). */
  async readChatMultiplexerChoiceOrNull(
    scopedDb: DataContextDb
  ): Promise<ChatMultiplexerChoice | null> {
    assertDataContextDb(scopedDb);
    const row = await scopedDb.db
      .selectFrom("app.instance_settings")
      .select("value")
      .where("key", "=", "chat.multiplexer")
      .executeTakeFirst();
    if (!row) return null;
    const raw = (row.value as { value?: unknown } | undefined)?.value;
    return raw === "auto" || raw === "tmux" || raw === "herdr" ? raw : null;
  }
```

**Step 4.4 — Implement the route (status only this task).**
In `packages/settings/src/routes.ts`:

(a) Extend the imports from `@jarv1s/shared` (the existing import block) to add the new schemas — add
these three names to the import list:

```ts
  getOnboardingStatusRouteSchema,
  onboardingCompleteRouteSchema,
  onboardingSkipRouteSchema,
```

(Place them alongside the other `*RouteSchema` imports; they are value imports, not `type` imports.)

(b) Extend `SettingsRoutesDependencies` with the injected onboarding deps. These are **bounded live
probe functions** run at request time **outside the DB transaction** — NOT boot snapshots. Each host
probe is internally wrapped in a short timeout that degrades to `false`, so (i) it never blocks server
**startup** (Codex R3 #2 — boot is untouched), (ii) it never holds a DB connection or makes the
founder wait unbounded (Codex R1 in-txn / R2 unbounded-request — the race caps latency), and (iii) the
step "Re-check" buttons reflect a binary installed **after** boot without a restart (Codex R3 #3 — live
re-check works). The existing `chatMultiplexerAvailability` dep stays as-is (the admin hint legitimately
shows bare presence); onboarding gets its own root-pane-aware usability probe:

```ts
  /**
   * Onboarding probes (Phase 2). Injected so packages/settings keeps no @jarv1s/ai /
   * @jarv1s/connectors PACKAGE dependency (module isolation); wired in packages/module-registry.
   * REQUIRED on any server that mounts the onboarding routes — when absent the routes fail
   * closed (500 + logged) rather than silently reporting all-not-done (Codex R1 masking finding).
   * Each function below is BOUNDED (timeout → false) and called OUTSIDE the DB transaction.
   */
  readonly onboardingProbes?: {
    /** Multiplexer usability (herdr accounts for the root-pane requirement). Bounded live probe. */
    readonly multiplexerUsable: (kind: "tmux" | "herdr") => Promise<boolean>;
    /** Provider CLI presence (presence-only). Bounded live probe. */
    readonly cliPresent: (
      kind: "anthropic" | "openai-compatible" | "google"
    ) => Promise<boolean>;
    /** Connector-account existence — a scoped read (needs the request's RLS scope). */
    readonly connectorAccountExists: (scopedDb: DataContextDb) => Promise<boolean>;
  };
```

(c) Register the status route inside `registerSettingsRoutes`, immediately after the existing
`/api/admin/audit-events` GET route. **Fail closed** when deps are missing instead of defaulting to
`false` (Codex R1: silent masking). Only the two DB reads + the connector-existence read (RLS-scoped)
run inside `withDataContext`; the bounded host probes run **after**, outside the transaction (Codex R1):

```ts
  server.get(
    "/api/onboarding/status",
    { schema: getOnboardingStatusRouteSchema },
    async (request, reply) => {
      try {
        const probes = dependencies.onboardingProbes;
        if (!probes) {
          request.log.error("onboarding routes mounted without onboardingProbes — failing closed");
          return reply.code(500).send({ error: "onboarding probes not configured" });
        }
        const accessContext = await dependencies.resolveAccessContext(request);

        // DB reads + admin check + connector-exists share ONE transaction (slice-D).
        const dbPart = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
            const [state, selected, connectorAccountExists] = await Promise.all([
              repository.readOnboardingState(scopedDb),
              repository.readChatMultiplexerChoiceOrNull(scopedDb),
              probes.connectorAccountExists(scopedDb)
            ]);
            return { state, selected, connectorAccountExists };
          }
        );

        // Bounded host probes OUTSIDE the transaction (each is timeout-capped → false in
        // the injected impl, so this Promise.all resolves quickly even on a slow host).
        const [tmuxUsable, herdrUsable, anthropic, openaiCompatible, google] = await Promise.all([
          probes.multiplexerUsable("tmux"),
          probes.multiplexerUsable("herdr"),
          probes.cliPresent("anthropic"),
          probes.cliPresent("openai-compatible"),
          probes.cliPresent("google")
        ]);

        return repository.assembleOnboardingStatus({
          state: dbPart.state,
          selected: dbPart.selected,
          availability: { tmuxUsable, herdrUsable }, // herdrUsable is root-pane-aware (Task 6)
          cliPresentByKind: { anthropic, "openai-compatible": openaiCompatible, google },
          connectorAccountExists: dbPart.connectorAccountExists
        });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
```

> Returns the pure assembler's `OnboardingStatusResponse` — shape matches
> `getOnboardingStatusRouteSchema` (Task 2) so the Fastify serializer validates it. Admin check + DB
> reads share one `withDataContext` (slice-D pattern); the **bounded** host probes run outside it
> (Codex R1 in-txn + R2 unbounded + R3 boot-block + R3 re-check, all satisfied: live but capped). Reads
> only `accessContext.actorUserId` (AccessContext invariant). Fails closed if misconfigured. This is
> the single canonical route implementation (Codex R2 #4) — no later task rewrites it.

**Step 4.4b — Wire the bounded live probes in module-registry (so the route is green for the tests).**
The route fails closed until `onboardingProbes` is injected; inject it here so the integration tests
(via `createApiServer` → `registerBuiltInApiRoutes`) pass in THIS task. **`registerBuiltInApiRoutes` is
SYNCHRONOUS** (`index.ts:206`), so the wiring must NOT `await` anything at registration time (Codex R3
#1) and must NOT probe the host at boot (Codex R3 #2). Instead inject **bounded live functions** that
probe lazily, per request, each capped by a short timeout that degrades to `false`.

(i) In `packages/module-registry/src/chat-multiplexer.ts`, add a bounded-probe helper + the live
usability/presence functions next to `probeChatMultiplexerAvailability` (do NOT modify the existing
`UpsertInstanceSettingInput` or the existing sync availability probe):

```ts
import { decideMultiplexer } from "@jarv1s/ai"; // root-pane-aware usability decision (pure)
import { cliAvailable } from "@jarv1s/ai"; // presence-only CLI probe (async, uses `which`)

/** Cap a host probe so a slow/hung binary lookup degrades to false instead of stalling a request. */
async function boundedProbe(p: Promise<boolean>, ms = 1500): Promise<boolean> {
  return Promise.race([
    p.catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))
  ]);
}

/**
 * Live, bounded multiplexer usability for a single kind. `decideMultiplexer` is pure and
 * already encodes "herdr usable ⇔ installed AND root pane" (multiplexer-resolve.ts:37-39);
 * the only host I/O is the synchronous PATH `has(bin)` inside createBinaryProbe, which we
 * still wrap so the contract is uniformly bounded. Re-reads PATH each call, so a binary
 * installed after boot is reflected on the next status fetch (no restart needed).
 */
export function makeMultiplexerUsableProbe(
  env: NodeJS.ProcessEnv = process.env
): (kind: "tmux" | "herdr") => Promise<boolean> {
  return (kind) =>
    boundedProbe(
      Promise.resolve().then(() => {
        const probe = createBinaryProbe(env);
        return decideMultiplexer({ env, configured: kind, isInstalled: (b) => probe.has(b) }).ok;
      })
    );
}

/** Live, bounded provider-CLI presence (presence-only). Re-reads PATH each call. */
export function makeCliPresentProbe(): (
  kind: "anthropic" | "openai-compatible" | "google"
) => Promise<boolean> {
  return (kind) => boundedProbe(cliAvailable(kind));
}
```

> Confirm `decideMultiplexer`/`createBinaryProbe`/`cliAvailable` are barrel-exported from `@jarv1s/ai`
> (`grep -rn "decideMultiplexer\|createBinaryProbe\|cliAvailable" packages/ai/src/index.ts`); if not,
> import from the submodule paths `chat-multiplexer.ts` already uses, or add the re-export. If
> `createBinaryProbe` does a one-shot scan at construction, building it fresh inside the probe (as
> above) is what makes re-check live; if it is already cheap/sync, keep it inside the closure.

(ii) In `packages/module-registry/src/index.ts`, inject `onboardingProbes` by **spreading deps then
augmenting** (so `chatMultiplexerAvailability` and every other settings dep is preserved — Codex R1
#3). No `await`, no boot-time probing — the functions are constructed synchronously and probe lazily:

```ts
import { ConnectorsRepository } from "@jarv1s/connectors";
import { makeMultiplexerUsableProbe, makeCliPresentProbe } from "./chat-multiplexer.js";

// Inside registerBuiltInApiRoutes (sync), near the existing `const availability = ...`:
const multiplexerUsable = makeMultiplexerUsableProbe(env);
const cliPresent = makeCliPresentProbe();

// Replace the bare `registerRoutes: registerSettingsRoutes` settings entry with:
  {
    manifest: settingsModuleManifest,
    sqlMigrationDirectories: [],
    queueDefinitions: [],
    registerRoutes: (server, regDeps) =>
      registerSettingsRoutes(server, {
        ...regDeps, // forwards chatMultiplexerAvailability + every existing settings dep
        onboardingProbes: {
          multiplexerUsable,
          cliPresent,
          connectorAccountExists: async (scopedDb) =>
            (await new ConnectorsRepository().listAccounts(scopedDb)).length > 0
        }
      })
  },
```

> `BUILT_IN_MODULES` is currently a module-level `const` whose settings entry is the bare
> `registerSettingsRoutes`. To close over the request-built probes, move the settings descriptor's
> `registerRoutes` to a wrapper constructed inside `registerBuiltInApiRoutes` (it already builds a per-
> call `deps` and loops `module.registerRoutes?.(server, deps)` at `index.ts:227-234`), e.g. special-
> case the settings module in that loop, or replace the loop's settings entry with the wrapper above.
> Follow the existing `availability`/`chatEngineFactory` pattern, which is likewise built inside this
> sync function and closed over. **No `await` is added to `registerBuiltInApiRoutes`** (Codex R3 #1) and
> **no host probe runs at boot** (Codex R3 #2) — probing happens lazily, per request, bounded.
> `listAccounts` is RLS-scoped + returns `ConnectorAccountSafeRow[]` (no secrets) — metadata-only.

**Step 4.5 — Run (expect PASS).**
`pnpm vitest run tests/integration/onboarding.test.ts` → all green. `pnpm typecheck` → PASS.

> Real host binaries are irrelevant to the deterministic assertions: the
> `state=pending`/`selected=null`/`connectors.done=false` tests don't depend on installed binaries
> (selection is null ⇒ not done; no connector account ⇒ not done); the two `assembleOnboardingStatus`
> tests call the **pure** method directly with fixed inputs; the `selected="auto"` test asserts
> `done === (tmuxUsable || herdrUsable)` which holds by construction. The route is green because the
> bounded probes are injected in Step 4.4b.

**Step 4.6 — Commit.**
```
git add packages/settings/src/repository.ts packages/settings/src/routes.ts packages/module-registry/src/index.ts packages/module-registry/src/chat-multiplexer.ts tests/integration/onboarding.test.ts
git commit -m "feat(settings): GET /api/onboarding/status — pure assembler, bounded live probes, fail-closed, wired (Phase 2 onboarding)"
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

  it("POST /complete sets state=completed and audits onboarding.complete", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/complete",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: "completed" });

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect((status.json() as { state: string }).state).toBe("completed");

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

  it("POST /skip sets state=skipped (replacing completed — single enum, never both) and audits", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/onboarding/skip",
      headers: { cookie: ownerCookie }
    });
    expect(res.statusCode).toBe(200);
    // A single enum means skip OVERWRITES completed — the terminal state is unambiguous;
    // there is no "completed && skipped both true" (Codex R1 ambiguous-terminal-state finding).
    expect(res.json()).toEqual({ state: "skipped" });

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect((status.json() as { state: string }).state).toBe("skipped");

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
  const onboardingStateAction = (verb: "complete" | "skip", state: "completed" | "skipped") =>
    server.post(
      `/api/onboarding/${verb}`,
      { schema: verb === "complete" ? onboardingCompleteRouteSchema : onboardingSkipRouteSchema },
      async (request, reply) => {
        try {
          const accessContext = await dependencies.resolveAccessContext(request);
          const result = await dependencies.dataContext.withDataContext(
            accessContext,
            async (scopedDb) => {
              await assertAdminUser(repository, scopedDb, accessContext.actorUserId);
              const newState = await repository.setOnboardingState(scopedDb, {
                state,
                actorUserId: accessContext.actorUserId,
                requestId: requireRequestId(accessContext)
              });
              return { state: newState };
            }
          );
          return result;
        } catch (error) {
          return handleRouteError(error, reply);
        }
      }
    );

  onboardingStateAction("complete", "completed");
  onboardingStateAction("skip", "skipped");
```

> Admin check + upsert share one transaction (slice-D pattern). `requireRequestId(accessContext)`
> supplies the audit `request_id` (`routes.ts:454-460`). Reads only `actorUserId`/`requestId`
> (AccessContext invariant). The audit row is written inside `setOnboardingState` (Task 3). The
> response `{ state }` matches `onboardingCompleteRouteSchema`/`onboardingSkipRouteSchema`
> (`OnboardingStateResponse`, Task 2).

**Step 5.4 — Run (expect PASS).**
`pnpm vitest run tests/integration/onboarding.test.ts` → all green (both describes).

**Step 5.5 — Commit.**
```
git add packages/settings/src/routes.ts tests/integration/onboarding.test.ts
git commit -m "feat(settings): POST /api/onboarding/complete + /skip (audited) (Phase 2 onboarding)"
```

---

### Task 6 — Prove the connector-existence wiring with a real account (integration)

**Files**
- Modify: `tests/integration/onboarding.test.ts`

The probe wiring landed in Task 4 (Step 4.4b). This task adds the **real** wiring assertion Codex R1 #5
asked for: seed an actual connector account and prove the status route's `connectors.done` flips to
`true` (the boolean-type placeholder is gone). It also re-asserts no secret leaks through the payload.

**Step 6.1 — Confirm the connectors test cipher helper name.**
Run `grep -rn "encryptJson\|createConnectorSecretCipher\|ConnectorSecretCipher\|cipher" tests/integration/connectors.test.ts packages/connectors/src | head` and use the exact helper that
`connectors.test.ts` uses to build an `encryptedSecret` — do not invent a name. (As of writing,
`connectors.test.ts` builds `encryptedSecret` via a cipher's `.encryptJson({ accessToken })`; match it.)

**Step 6.2 — Write the failing test.**
Add the connectors imports to the test file's import block:

```ts
import { ConnectorsRepository } from "@jarv1s/connectors";
// + the cipher helper connectors.test.ts imports (confirmed in Step 6.1), e.g.:
import { createConnectorSecretCipher } from "@jarv1s/connectors";
```

Append inside the **first** describe (after the multiplexer test), reusing that suite's
`ownerUserId`/`ownerCookie`/`dataContext`:

```ts
  it("derives connectors.done=true after a real connector account exists", async () => {
    await dataContext.withDataContext(
      { actorUserId: ownerUserId, requestId: "req-seed-connector" },
      (scopedDb) =>
        new ConnectorsRepository().createAccount(scopedDb, {
          providerId: "google",
          scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
          encryptedSecret: createConnectorSecretCipher().encryptJson({
            accessToken: "seeded-token-not-asserted"
          })
        })
    );

    const status = await server.inject({
      method: "GET",
      url: "/api/onboarding/status",
      headers: { cookie: ownerCookie }
    });
    expect(status.statusCode).toBe(200);
    const body = status.json() as { steps: { connectors: { done: boolean } } };
    expect(body.steps.connectors.done).toBe(true); // proves connectorAccountExists is wired
    expect(status.body).not.toMatch(/seeded-token-not-asserted|accessToken|ciphertext/i);
  });
```

**Step 6.3 — Run (expect FAIL → PASS).**
With Task 4's wiring already in place, this test is the only new behaviour. Run
`pnpm vitest run tests/integration/onboarding.test.ts`. If it is **red**, the connector probe is not
wired correctly (revisit Step 4.4b-ii's `connectorAccountExists`); if **green**, the wiring is proven.
(There is no separate implementation step here — the wiring shipped in Task 4; this task is the
verifying assertion. If, contrary to expectation, the assertion passes before you intended any change,
that is fine: it confirms Task 4's wiring already satisfies the requirement.)

> `createAccount` sets `owner_user_id = app.current_actor_user_id()` (RLS-scoped), so the seeded row is
> the owner's and `listAccounts(scopedDb)` under the same owner returns it. The cipher helper encrypts
> at rest; the secret never surfaces in the status payload (the last assertion proves it).

**Step 6.4 — Commit.**
```
git add tests/integration/onboarding.test.ts
git commit -m "test(settings): prove onboarding connectors.done wiring with a real account (Phase 2 onboarding)"
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

(a) Add the new response types to the `@jarv1s/shared` import block:

```ts
  OnboardingStatusResponse,
  OnboardingStateResponse,
```

> Do **NOT** add a generic instance-setting writer. The multiplexer choice is written through the
> existing `setChatMultiplexerSettings(multiplexer)` (`client.ts:548`, hits the audited
> `PUT /api/admin/chat-multiplexer`) — the single owner of `chat.multiplexer`. `ChatMultiplexerChoice`
> and `ChatMultiplexerSettingsDto` are already imported (`client.ts:10-11`).

(b) Add the functions near the other platform reads (after `getModules`, ~line 108):

```ts
/** Bounded so a hung status read can never trap the founder before the app shell (Codex R2 #2). */
const ONBOARDING_STATUS_TIMEOUT_MS = 4000;

export async function getOnboardingStatus(): Promise<OnboardingStatusResponse> {
  // Race the request against a bounded timeout. On timeout this rejects → React Query
  // (retry:false) surfaces isError, and app.tsx falls through to the app shell. A fresh
  // instance therefore always boots even if /api/onboarding/status hangs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ONBOARDING_STATUS_TIMEOUT_MS);
  try {
    return await requestJson<OnboardingStatusResponse>("/api/onboarding/status", {
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function completeOnboarding(): Promise<OnboardingStateResponse> {
  return requestJson<OnboardingStateResponse>("/api/onboarding/complete", { method: "POST" });
}

export async function skipOnboarding(): Promise<OnboardingStateResponse> {
  return requestJson<OnboardingStateResponse>("/api/onboarding/skip", { method: "POST" });
}
```

> Confirm `requestJson` forwards `signal` to `fetch` (`grep -n "function requestJson\|signal\|fetch("
> apps/web/src/api/client.ts`). If its options type does not yet accept `signal`, add
> `readonly signal?: AbortSignal` to that options type and pass it through to `fetch` (a one-line
> addition; every other caller is unaffected). The timeout converts a hang into a fall-through, which
> the app.tsx branch (Task 11) treats as "no wizard, render the shell".
>
> The multiplexer step (Task 8) calls the **existing** `setChatMultiplexerSettings(choice)` — no new
> client function for that write, no generic `PATCH /api/admin/settings/:key`. Single ownership of
> `chat.multiplexer` preserved (Codex R1 #1/#2).

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

import type { ChatMultiplexerChoice, OnboardingMultiplexerStepDto } from "@jarv1s/shared";

import { setChatMultiplexerSettings } from "../api/client";
import { queryKeys } from "../api/query-keys";

export function MultiplexerStep(props: {
  readonly step: OnboardingMultiplexerStepDto;
  readonly onRecheck: () => void;
}) {
  const queryClient = useQueryClient();
  const select = useMutation({
    // Reuse the EXISTING audited writer — single owner of chat.multiplexer.
    mutationFn: (choice: ChatMultiplexerChoice) => setChatMultiplexerSettings(choice),
    onSuccess: async () => {
      // Invalidate BOTH the onboarding status and the settings chat-multiplexer query so the
      // adapter slice's settings panel (if open) stays consistent.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.chatMultiplexer })
      ]);
    }
  });

  const anyUsable = props.step.tmuxUsable || props.step.herdrUsable;

  return (
    <section className="panel" aria-labelledby="onboarding-multiplexer-title">
      <div className="panel-heading">
        <h2 id="onboarding-multiplexer-title">Terminal multiplexer</h2>
      </div>
      {props.step.selected ? (
        <p className="form-hint">
          Selected: <strong>{props.step.selected}</strong>
          {props.step.done ? " (usable)" : " (selected, but not usable on this host yet)"}
        </p>
      ) : null}
      {!anyUsable ? (
        <>
          <p>
            Jarv1s runs unprivileged, so we can&apos;t install software for you. Install one of these
            on the host, then re-check. (herdr also needs a root pane — set
            <code>JARVIS_HERDR_ROOT_PANE</code> or run Jarv1s inside herdr.)
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
            disabled={!props.step.tmuxUsable || select.isPending}
            onClick={() => select.mutate("tmux")}
          >
            {select.isPending ? <LoaderCircle className="spin" size={18} /> : null} Use tmux
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!props.step.herdrUsable || select.isPending}
            onClick={() => select.mutate("herdr")}
          >
            {select.isPending ? <LoaderCircle className="spin" size={18} /> : null} Use herdr
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={select.isPending}
            onClick={() => select.mutate("auto")}
            title="Let Jarv1s pick whichever usable multiplexer is installed"
          >
            Auto-detect
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

> Write happens via the existing audited `PUT /api/admin/chat-multiplexer`
> (`setChatMultiplexerSettings`) — no new route, no generic `PATCH`, single ownership of
> `chat.multiplexer` (Codex R1 #1/#2). The "Use herdr" button is disabled unless herdr is **usable**
> (installed AND root pane — `herdrUsable`), so the founder is never offered a choice that would only
> fail at launch (Codex R1 herdr finding). "Auto-detect" persists `"auto"` (the existing default
> semantics). Re-check is a manual button (no auto-install, no blocking poll — anti-pattern against
> sleep-loops). Install commands are copy-paste only. `queryKeys.settings.chatMultiplexer`
> (`query-keys.ts:12`) already exists.

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
              {provider.cliPresent ? (
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

### Task 10 — Resume/overlay-gating helper (gate-tested) + `OnboardingWizard` spine

**Files**
- Create: `apps/web/src/onboarding/resume.ts` (pure, host-free)
- Create: `tests/unit/onboarding-resume.test.ts` (runs under `verify:foundation`'s `test:unit`)
- Create: `apps/web/src/onboarding/onboarding-wizard.tsx`

The load-bearing skip/resume/overlay-gating logic is extracted into a **pure** helper so it runs
inside the foundation gate (Codex R1: branch tests must not be Playwright-only), not just the
best-effort e2e.

**Step 10.1 — Typecheck baseline.**
`pnpm typecheck` → PASS.

**Step 10.2 — Write the failing unit test for the helper.**
Create `tests/unit/onboarding-resume.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { OnboardingStatusResponse } from "@jarv1s/shared";

import {
  STEP_KEYS,
  firstIncompleteStepIndex,
  isOverlayEnabled
} from "../../apps/web/src/onboarding/resume.js";

function status(overrides: Partial<OnboardingStatusResponse["steps"]> = {}): OnboardingStatusResponse {
  return {
    state: "pending",
    steps: {
      multiplexer: { done: false, selected: null, tmuxUsable: false, herdrUsable: false },
      cliAuth: {
        done: false,
        providers: [
          { kind: "anthropic", cliPresent: false },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
        ]
      },
      connectors: { done: false },
      ...overrides
    }
  };
}

describe("firstIncompleteStepIndex", () => {
  it("returns the multiplexer step (index 1) when nothing is done", () => {
    expect(firstIncompleteStepIndex(status())).toBe(STEP_KEYS.indexOf("multiplexer"));
  });

  it("skips done steps and resumes at the first not-done", () => {
    const s = status({
      multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false }
    });
    expect(firstIncompleteStepIndex(s)).toBe(STEP_KEYS.indexOf("cliAuth"));
  });

  it("returns the last step index when every derived step is done", () => {
    const s = status({
      multiplexer: { done: true, selected: "auto", tmuxUsable: true, herdrUsable: false },
      cliAuth: {
        done: true,
        providers: [
          { kind: "anthropic", cliPresent: true },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
        ]
      },
      connectors: { done: true }
    });
    expect(firstIncompleteStepIndex(s)).toBe(STEP_KEYS.length - 1);
  });
});

describe("isOverlayEnabled", () => {
  it("is false when no multiplexer is usable", () => {
    expect(isOverlayEnabled(status())).toBe(false);
  });

  it("is false when a multiplexer is usable but no CLI is present", () => {
    const s = status({
      multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false }
    });
    expect(isOverlayEnabled(s)).toBe(false);
  });

  it("is true only when the multiplexer step is done (usable) AND a CLI is present", () => {
    const s = status({
      multiplexer: { done: true, selected: "tmux", tmuxUsable: true, herdrUsable: false },
      cliAuth: {
        done: true,
        providers: [
          { kind: "anthropic", cliPresent: true },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
        ]
      }
    });
    expect(isOverlayEnabled(s)).toBe(true);
  });

  it("is false for a null status (still-loading / error)", () => {
    expect(isOverlayEnabled(undefined)).toBe(false);
  });
});
```

**Step 10.3 — Run (expect FAIL), then implement `resume.ts`.**
`pnpm vitest run tests/unit/onboarding-resume.test.ts` → FAIL (module missing). Then create
`apps/web/src/onboarding/resume.ts`:

```ts
import type { OnboardingStatusResponse } from "@jarv1s/shared";

export const STEP_KEYS = ["welcome", "multiplexer", "cliAuth", "connectors"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

/** Per-step done map. welcome is always "done" for resume purposes; the rest are derived. */
export function doneByStep(status: OnboardingStatusResponse | undefined): Record<StepKey, boolean> {
  const steps = status?.steps;
  return {
    welcome: true,
    multiplexer: steps?.multiplexer.done ?? false,
    cliAuth: steps?.cliAuth.done ?? false,
    connectors: steps?.connectors.done ?? false
  };
}

/** Index of the first not-done step; the last step index when everything is done. */
export function firstIncompleteStepIndex(status: OnboardingStatusResponse | undefined): number {
  const done = doneByStep(status);
  const idx = STEP_KEYS.findIndex((k) => !done[k]);
  return idx === -1 ? STEP_KEYS.length - 1 : idx;
}

/**
 * The optional Jarvis overlay is enabled ONLY when a usable CLI chat path exists:
 * the multiplexer step is DONE (i.e. the chosen multiplexer is USABLE — tmux installed,
 * herdr installed+root-pane, or auto with one usable) AND at least one provider CLI is
 * PRESENT. Gating on `multiplexer.done` (not bare `selected`) honours herdr's root-pane
 * requirement (Codex R1) — a selected-but-unusable herdr does not light the overlay.
 */
export function isOverlayEnabled(status: OnboardingStatusResponse | undefined): boolean {
  if (!status) return false;
  return status.steps.multiplexer.done && status.steps.cliAuth.providers.some((p) => p.cliPresent);
}
```

Re-run: `pnpm vitest run tests/unit/onboarding-resume.test.ts` → all green.

**Step 10.4 — Implement the wizard (imports the helper; takes `initialStatus` from app.tsx).**

```tsx
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { OnboardingStatusResponse } from "@jarv1s/shared";

import { completeOnboarding, getOnboardingStatus, skipOnboarding } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { CliAuthStep } from "./cli-auth-step";
import { ConnectorStep } from "./connector-step";
import { MultiplexerStep } from "./multiplexer-step";
import { OnboardingChatOverlay } from "./onboarding-chat-overlay";
import { WelcomeStep } from "./welcome-step";
import { STEP_KEYS, firstIncompleteStepIndex, isOverlayEnabled } from "./resume";

export function OnboardingWizard(props: {
  readonly onDone: () => void;
  /** The status app.tsx already fetched — seeds the query so the wizard shows NO second loader. */
  readonly initialStatus: OnboardingStatusResponse;
}) {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: queryKeys.onboarding.status,
    queryFn: getOnboardingStatus,
    retry: false,
    initialData: props.initialStatus // never a fresh-load spinner inside the wizard
  });

  const [stepIndex, setStepIndex] = useState(() => firstIncompleteStepIndex(props.initialStatus));
  const [resumed, setResumed] = useState(false);

  // If the first server refresh arrives, resume once at the first not-done step.
  useEffect(() => {
    if (statusQuery.isSuccess && !resumed) {
      setStepIndex(firstIncompleteStepIndex(statusQuery.data));
      setResumed(true);
    }
  }, [statusQuery.isSuccess, statusQuery.data, resumed]);

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

  // No isLoading branch: initialData guarantees data is present from the first render
  // (app.tsx already waited). A background refetch error never blanks the wizard.
  const steps = statusQuery.data.steps;
  const overlayEnabled = isOverlayEnabled(statusQuery.data);

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
            Couldn&apos;t refresh setup status. You can still skip and configure later.
          </p>
        ) : null}

        <div className="onboarding-step">
          {currentKey === "welcome" ? <WelcomeStep onSkipAll={() => skip.mutate()} /> : null}
          {currentKey === "multiplexer" ? (
            <MultiplexerStep step={steps.multiplexer} onRecheck={invalidateStatus} />
          ) : null}
          {currentKey === "cliAuth" ? (
            <CliAuthStep step={steps.cliAuth} onRecheck={invalidateStatus} />
          ) : null}
          {currentKey === "connectors" ? (
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
> "Skip setup" (header + welcome) writes `onboarding.state = "skipped"` and exits; "Finish" writes
> `onboarding.state = "completed"`. Re-entry resumes at the first not-done step
> (`firstIncompleteStepIndex`, seeded synchronously from `initialStatus` so there is no flash). The
> overlay is enabled only when the multiplexer step is **done (usable)** AND a provider CLI is present
> (`isOverlayEnabled`). There is **no in-wizard loading screen** — `initialData` from app.tsx
> guarantees data on first render, so a stalled background refetch never blanks the wizard or traps
> the founder (Codex R1 double-loader / fresh-boot finding). The wizard uses
> `center-screen`/`panel`/`primary-button`/`ghost-button`/`form-hint`/`form-error` classes that
> already exist in `apps/web/src/styles.css`; the new `onboarding-*` class names are layout-only and
> can be left unstyled (no functional dependency) or given minimal CSS — see Step 10.5.

**Step 10.5 — (Optional) minimal CSS.**
The wizard relies only on existing classes for function. If you add the `onboarding-*` wrappers,
append minimal rules to `apps/web/src/styles.css` (purely cosmetic; not load-bearing). This is
optional and may be skipped; if added, include `apps/web/src/styles.css` in the commit `git add`.

**Step 10.6 — Run (expect PASS).**
`pnpm vitest run tests/unit/onboarding-resume.test.ts` → green. `pnpm typecheck` → PASS. `pnpm lint`
→ PASS (fix any unused-import/var warnings; lint runs with `--max-warnings=0`).

**Step 10.7 — Commit.**
```
git add apps/web/src/onboarding/resume.ts tests/unit/onboarding-resume.test.ts apps/web/src/onboarding/onboarding-wizard.tsx
# add apps/web/src/styles.css too ONLY if you added CSS in 10.5
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

(b) **Extend `resume.ts` with the pure app-branch predicate (so the branch is gate-testable, Codex R2
#5).** Add to `apps/web/src/onboarding/resume.ts`:

```ts
import type { MeResponse, OnboardingStatusResponse } from "@jarv1s/shared";

/** Bootstrap owner ⇔ instance admin AND bootstrap owner. Used to gate the onboarding fetch+branch. */
export function isBootstrapOwner(me: MeResponse | undefined): boolean {
  return me?.user.isInstanceAdmin === true && me?.user.isBootstrapOwner === true;
}

/**
 * Pure decision the app.tsx branch makes: show the wizard ONLY for a bootstrap owner whose
 * status has loaded successfully with state === "pending". Any other case (non-owner, no data
 * yet, error/timeout, or a terminal state) ⇒ false ⇒ render the app shell. This guarantees a
 * fresh instance always boots and a non-owner never sees the wizard.
 */
export function shouldShowOnboarding(
  me: MeResponse | undefined,
  status: OnboardingStatusResponse | undefined
): boolean {
  return isBootstrapOwner(me) && status?.state === "pending";
}
```

> Confirm `MeResponse` shape (`grep -n "interface MeResponse\|isBootstrapOwner\|isInstanceAdmin" packages/shared/src/platform-api.ts`)
> and that `MeResponse` is barrel-exported from `@jarv1s/shared`. **First** append these failing unit
> tests to `tests/unit/onboarding-resume.test.ts` (extend its imports with `shouldShowOnboarding`,
> `isBootstrapOwner` and `MeResponse`), run them RED, then implement the predicate above to turn them
> green:

```ts
function me(isInstanceAdmin: boolean, isBootstrapOwner: boolean): MeResponse {
  // Build the minimal MeResponse the predicate reads; match the real shape (fill required
  // fields per platform-api.ts — only user.isInstanceAdmin / user.isBootstrapOwner are read).
  return { user: { isInstanceAdmin, isBootstrapOwner } } as unknown as MeResponse;
}

describe("shouldShowOnboarding", () => {
  it("is false for a non-owner even with a pending status", () => {
    expect(shouldShowOnboarding(me(false, false), status())).toBe(false);
    expect(shouldShowOnboarding(me(true, false), status())).toBe(false); // admin but not bootstrap owner
  });
  it("is true for a bootstrap owner with state=pending", () => {
    expect(shouldShowOnboarding(me(true, true), status())).toBe(true);
  });
  it("is false for a bootstrap owner once state is terminal", () => {
    expect(shouldShowOnboarding(me(true, true), { ...status(), state: "completed" })).toBe(false);
    expect(shouldShowOnboarding(me(true, true), { ...status(), state: "skipped" })).toBe(false);
  });
  it("is false when status is undefined (loading/error) — fall through to the shell", () => {
    expect(shouldShowOnboarding(me(true, true), undefined)).toBe(false);
  });
});
```

(c) Add the onboarding status query after the `modulesQuery`. It must be **enabled only for the
bootstrap owner** so household members never call it (the `enabled` flag means no network request
fires for non-owners — proven by the in-gate `isBootstrapOwner` test + the e2e non-owner test):

```ts
  const ownerForOnboarding = isBootstrapOwner(meQuery.data);
  const onboardingQuery = useQuery({
    enabled: ownerForOnboarding,
    queryKey: queryKeys.onboarding.status,
    queryFn: getOnboardingStatus,
    retry: false // getOnboardingStatus is itself bounded by a 4s timeout (client.ts)
  });
```

(d) Add the branch **after** the `if (!meQuery.data) { ... }` block (before the
`return ( <BrowserRouter> ...`):

```ts
  if (ownerForOnboarding) {
    // A hung status read cannot trap the founder: getOnboardingStatus is bounded to 4s, so
    // isLoading resolves to data-or-error within that window. We show a bounded loader only
    // for the owner's first boot (avoids a shell flash before the wizard); on error/timeout
    // onboardingQuery.data is undefined ⇒ we fall through to the app shell below.
    if (onboardingQuery.isLoading) {
      return <LoadingScreen />;
    }
    if (shouldShowOnboarding(meQuery.data, onboardingQuery.data)) {
      return (
        <OnboardingWizard
          initialStatus={onboardingQuery.data!}
          onDone={() => void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding.status })}
        />
      );
    }
    // else: not pending (terminal state) OR errored/timed-out ⇒ fall through to the shell.
  }
```

> Mirrors the `account_pending`/`deactivated` early-return shape (`app.tsx:61-67`). Fires only for
> `isInstanceAdmin && isBootstrapOwner` (acceptance #4; bootstrap-owner-trigger-only invariant). Does
> **not** touch `/api/bootstrap/status` (OTNR-P4 #122) — that pre-auth probe and its bounded exemption
> are untouched; the onboarding status route is fully authed + admin-gated, outside the pre-auth
> exemption. The loader is **bounded** by `getOnboardingStatus`'s 4s timeout (Task 7): a hang resolves
> to `isError` within 4s and falls through — a fresh instance always boots (Codex R1/R2 fresh-boot
> finding). The decision uses the pure `shouldShowOnboarding` (gate-tested). Passing `initialStatus`
> removes the wizard's own loader (Codex R1 double-loader finding). `onDone` invalidates the status
> query so `complete`/`skip` re-drives this branch to a terminal state → fall through. (`initialStatus`
> is non-null here because `shouldShowOnboarding` is true only when `status?.state === "pending"`; the
> `!` is therefore sound — or restructure with a local `const data = onboardingQuery.data` guard if you
> prefer to avoid the non-null assertion under lint rules.)

**Step 11.3 — Run (expect PASS).**
`pnpm vitest run tests/unit/onboarding-resume.test.ts` → green (incl. the new predicate tests).
`pnpm typecheck` → PASS. `pnpm lint` → PASS.

**Step 11.4 — Commit.**
```
git add apps/web/src/onboarding/resume.ts tests/unit/onboarding-resume.test.ts apps/web/src/app.tsx
git commit -m "feat(web): app.tsx bootstrap-owner onboarding branch + gate-tested predicate (Phase 2 onboarding)"
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
    state: "pending",
    steps: {
      multiplexer: { done: false, selected: null, tmuxUsable: false, herdrUsable: false },
      cliAuth: {
        done: false,
        providers: [
          { kind: "anthropic", cliPresent: false },
          { kind: "openai-compatible", cliPresent: false },
          { kind: "google", cliPresent: false }
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
    // Default to a COMPLETED status so existing specs (which never set onboardingStatus)
    // fall straight through to the app shell — the wizard never hijacks them. The onboarding
    // spec opts in explicitly with onboardingStatus: defaultOnboardingStatus() (state pending).
    const status = state.onboardingStatus ?? defaultOnboardingStatus({ state: "completed" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(status)
    });
  };
  const setState = (route: Route, next: "completed" | "skipped") => {
    state.onboardingStatus = { ...(state.onboardingStatus ?? defaultOnboardingStatus()), state: next };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ state: next }) // OnboardingStateResponse
    });
  };
  await page.route("**/api/onboarding/status", (route) => get(route));
  await page.route("**/api/onboarding/complete", (route) => setState(route, "completed"));
  await page.route("**/api/onboarding/skip", (route) => setState(route, "skipped"));
  // The multiplexer step writes via the DEDICATED adapter route PUT /api/admin/chat-multiplexer
  // (NOT a generic settings PATCH). Mirror its ChatMultiplexerSettingsDto response shape.
  await page.route(/\/api\/admin\/chat-multiplexer$/, (route) => {
    const body = route.request().postDataJSON() as { multiplexer: "auto" | "tmux" | "herdr" };
    const choice = body.multiplexer;
    const prev = state.onboardingStatus ?? defaultOnboardingStatus();
    // Reflect selection; mark done iff the chosen choice maps to a usable backend in the mock's
    // current snapshot (so e2e can drive both the usable and the not-yet-usable paths).
    const usable =
      choice === "tmux"
        ? prev.steps.multiplexer.tmuxUsable
        : choice === "herdr"
          ? prev.steps.multiplexer.herdrUsable
          : prev.steps.multiplexer.tmuxUsable || prev.steps.multiplexer.herdrUsable;
    state.onboardingStatus = {
      ...prev,
      steps: { ...prev.steps, multiplexer: { ...prev.steps.multiplexer, done: usable, selected: choice } }
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        multiplexer: choice,
        available: {
          tmux: state.onboardingStatus.steps.multiplexer.tmuxUsable,
          herdr: state.onboardingStatus.steps.multiplexer.herdrUsable
        }
      }) // ChatMultiplexerSettingsDto
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

> **Default preserves existing specs.** The `get` handler above already defaults to
> `defaultOnboardingStatus({ state: "completed" })` when `onboardingStatus` is unset, so every
> existing authenticated bootstrap-owner spec (app-shell, tasks, chat-drawer, connect-google) sees a
> completed status and falls straight through to the app shell — no behaviour change. The onboarding
> spec opts into the wizard by explicitly passing `onboardingStatus: defaultOnboardingStatus()`
> (which is `state: "pending"`). No separate `get` adjustment is needed; it is built in.

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

  // After finish the status mock returns state:"completed"; the app.tsx branch falls through.
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

1. `GET /api/onboarding/status` returns `{state,steps}` with server-derived `done` flags; admin-gated;
   per-method `DataContextDb`; host probes outside the txn; fail-closed if misconfigured. → Tasks 4, 6.
2. `POST /complete` + `/skip` set the single `onboarding.state` enum, `requireAdmin`-gated, each writes
   an `onboarding.complete`/`onboarding.skip` audit row; skip overwrites completed (no ambiguous
   both-true). → Tasks 3, 5.
3. `cli-availability.ts` gains `herdrAvailable`, presence-only, same `WhichDeps` seam. → Task 1.
4. `app.tsx` branch fires only for `isInstanceAdmin && isBootstrapOwner` when `state === "pending"`
   (pure `shouldShowOnboarding`, unit-tested in-gate); mirrors `account_pending`; never touches
   `/api/bootstrap/status`; passes `initialStatus` (no double loader); status read is bounded to 4s
   and falls through on error/timeout so a fresh instance always boots. → Tasks 7, 11.
5. Wizard renders four ordered steps; every step skippable; whole flow skippable; re-entry resumes at
   first not-done (pure `firstIncompleteStepIndex`, unit-tested in-gate). → Tasks 8, 10.
6. Step 2 writes `chat.multiplexer` via the **existing dedicated audited** `PUT /api/admin/chat-multiplexer`
   (`setChatMultiplexerSettings`) — single owner, no generic PATCH, supports `auto`; multiplexer/CLI
   steps show instructions + manual re-check (no auto-install, no blocking poll); "Use herdr" disabled
   unless herdr is usable (root-pane aware). → Tasks 7, 8.
7. Optional chat overlay mounts in the wizard, disabled until the multiplexer is **usable** AND a CLI is
   present (`isOverlayEnabled`, unit-tested), reuses chat drawer/stream, never gates completion. →
   Tasks 9, 10.
8. New shared contracts in `platform-api.ts` (reusing `ChatMultiplexerChoice`, NO duplicate type),
   barrel-exported; `queryKeys.onboarding` namespace. → Tasks 2, 7.
9. No new migration (one new `onboarding.state` key); no secret-shaped field in any onboarding response
   (status + connector-seed tests assert no `token|secret|password|credential|accessToken|ciphertext`);
   `AccessContext` unchanged; all writes audited. → Tasks 2–6.
10. `pnpm verify:foundation` green incl. new unit (cli-availability + resume) + integration tests. →
    Task 14.

**Step 13.2 — Placeholder scan.** Grep the worktree for accidental placeholders introduced by this
slice:
```
grep -rn "TODO\|FIXME\|similar to above\|placeholder\|XXX" \
  packages/ai/src/cli-availability.ts \
  packages/shared/src/platform-api.ts \
  packages/settings/src/repository.ts packages/settings/src/routes.ts \
  packages/module-registry/src/index.ts packages/module-registry/src/chat-multiplexer.ts \
  apps/web/src/onboarding apps/web/src/app.tsx apps/web/src/api/client.ts apps/web/src/api/query-keys.ts \
  tests/unit/onboarding-cli-availability.test.ts tests/unit/onboarding-resume.test.ts \
  tests/integration/onboarding.test.ts \
  tests/e2e/mock-onboarding-api.ts tests/e2e/onboarding.spec.ts
```
Expected: no matches in the new/changed code (pre-existing TODOs elsewhere are out of scope).

**Step 13.3 — Type-consistency check.** Confirm:
- `assembleOnboardingStatus(...)` returns the shared `OnboardingStatusResponse` (enforced by
  `satisfies OnboardingStatusResponse`); the route returns it directly and the Fastify serializer
  validates it against `getOnboardingStatusRouteSchema`. No parallel local DTO exists.
- `OnboardingProviderKind` (repository) === `ProviderKind` (`@jarv1s/ai`) === the schema `kind` enum
  (`anthropic|openai-compatible|google`) === `OnboardingCliProviderDto.kind`.
- `selected` is `ChatMultiplexerChoice | null` everywhere (shared DTO, repository helper, schema enum
  `["auto","tmux","herdr",null]`).
- The multiplexer write goes through `setChatMultiplexerSettings(choice)` → `PUT /api/admin/chat-multiplexer`;
  there is NO generic instance-setting writer for `chat.multiplexer` anywhere in the slice.
- `ChatDrawer`/`useChatStream` destructure in the overlay matches the real exports (Task 9 note).

**Step 13.4 — Hard-Invariant audit.** Confirm against CLAUDE.md "Hard Invariants":
DataContextDb-only (every new repo method that touches the DB starts with `assertDataContextDb`; the
pure assembler has no `scopedDb`), AccessContext unchanged (routes read only `actorUserId`/`requestId`),
secrets never escape (status returns booleans + the multiplexer enum only; CLI step presence-only;
connector existence is a bool, never contents), module isolation (probes injected via module-registry
which spreads existing deps + adds `onboardingProbes`; no settings→ai/connectors package dep), no
migration, all admin writes audited (onboarding state + the reused multiplexer write), bootstrap-owner-
only trigger. Also confirm the onboarding status route is fully authed/admin-gated and therefore does
NOT use the pre-auth non-secret read exemption (`chat-multiplexer.ts` `PREAUTH_READABLE_SETTING_KEYS`);
that allowlist is unchanged.

**Step 13.5 — Single-ownership check.** Re-run
`grep -rn "ChatMultiplexer\b\|ChatMultiplexerChoice" packages/shared/src` — confirm `ChatMultiplexerChoice`
is defined exactly once (the adapter slice's, ~line 345) and the slice added **no** `ChatMultiplexer`
type. Re-run `grep -rn "chat.multiplexer" packages/settings/src apps/web/src` — confirm the only writers
are `setChatMultiplexerSetting` (repository) / `setChatMultiplexerSettings` (client) via
`PUT /api/admin/chat-multiplexer`; onboarding adds no second writer.

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
limit), `typecheck` (tsc + web typecheck), `test:unit` (includes the `herdrAvailable` AND the
`onboarding-resume` helper tests), `db:migrate` (idempotent; no new migration so the hash-check is
unaffected), `test:integration` (includes `tests/integration/onboarding.test.ts`).
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
- **`chat.multiplexer` is owned by the CLI-adapter slice (already landed).** Onboarding reuses
  `ChatMultiplexerChoice` + `PUT /api/admin/chat-multiplexer` and adds NO second writer and NO
  duplicate type. Task 2 and Task 13.5 guard this. If the adapter slice's contract changed since this
  plan was written, re-confirm `getChatMultiplexerSetting`/`setChatMultiplexerSetting` and the route
  shape before building (grep first).
- **Two paths validate only at the DEPLOY checkpoint** (real multiplexer engine use; real chat overlay
  replies) — do not stall the build waiting on the deployable-stack slice. Everything in Tasks 1–14 is
  buildable and gate-testable against the already-shipped panels + presence probes + the landed
  multiplexer contract.
- If any step's "expected FAIL" instead passes, stop and investigate (the test or the baseline is
  wrong) before implementing — do not skip the RED phase.
