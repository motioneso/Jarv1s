# auth-128 Bearer-Token Hardening Implementation Plan

> **For agentic workers:** Execution sub-skills are disabled in this repo (coordinated-build mode);
> drive the plan task-by-task yourself with TDD. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two SAFE OTNR-P6 #128 sub-findings in the legacy session-bearer auth path so a
malformed `Authorization` header produces a clean 401 instead of a raw Postgres uuid-cast error or a
thrown control-flow error.

**Architecture:** Two narrow, independent changes. (1) `AuthSessionResolver.resolveAccessContext`
(`@jarv1s/db`) rejects any non-UUID token _before_ the `::uuid` cast, reusing the existing exported
`isUuid` guard from `data-context.ts`. (2) `readBearerToken` (`@jarv1s/auth`) becomes total —
returns `undefined` for any non-`Bearer <token>` header shape instead of throwing, so malformed
headers fall through to cookie auth / a single clean 401. Both throw paths already collapse to a 401
at `apps/api/src/server.ts:498-504` and in `@jarv1s/module-sdk` route-errors, so HTTP behavior is
preserved.

**Tech Stack:** TypeScript, Kysely/Postgres, Vitest integration tests, Fastify (`server.inject`).

**Superseded — NOT built:** Fix 3 (stale `workspaces` bootstrap insert). Confirmed gone: no
`workspace` reference anywhere in `packages/auth/src/`. Reported to coordinator as superseded.

---

## Task 1: UUID guard in `AuthSessionResolver` (Fix 1, MED)

**Files:**

- Modify: `packages/db/src/auth-session.ts:1-31` (import `isUuid`; guard before the `::uuid` cast)
- Modify (test): `tests/integration/auth-bearer-hardening.test.ts` (new describe block)

- [ ] **Step 1: Write the failing test** — add to `auth-bearer-hardening.test.ts` a new describe
      `"malformed / non-bearer Authorization (OTNR-P6 #128)"` with its own `appDb` + `runtime`
      (mirror the existing `observability` describe's `beforeAll`/`afterAll`). First test:

```ts
it("rejects a well-formed but non-UUID bearer token with a clean error (no raw DB cast error)", async () => {
  await expect(
    runtime.resolveAccessContext({ headers: { authorization: "Bearer not-a-uuid" } })
  ).rejects.toThrow("Session is missing or expired");
});
```

- [ ] **Step 2: Run it — expect FAIL.** Old code casts `"not-a-uuid"::uuid` → Postgres `22P02`,
      so the rejection message is the raw cast error, not `"Session is missing or expired"`.

Run: `env JARVIS_PGDATABASE=jarvis_build_auth128 vitest run tests/integration/auth-bearer-hardening.test.ts`

- [ ] **Step 3: Implement the guard** in `packages/db/src/auth-session.ts`:

```ts
import { type AccessContext, isUuid } from "./data-context.js";
```

and at the top of `resolveAccessContext`, before the `sql` call:

```ts
// A bearer token that is not a well-formed UUID can never match a session row. Guard here so a
// malformed token returns the same clean "missing/expired" rejection (→ 401) rather than a raw
// Postgres 22P02 invalid_text_representation error surfacing from the `::uuid` cast below.
if (!isUuid(sessionId)) {
  throw new Error("Session is missing or expired");
}
```

(Replace the current `import type { AccessContext } from "./data-context.js";` line — `isUuid` is a
runtime value, so it must be a value import, not `import type`.)

- [ ] **Step 4: Run the test — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/auth-session.ts tests/integration/auth-bearer-hardening.test.ts
git commit -m "fix(auth): guard non-UUID bearer tokens before the uuid cast (#128)"
```

## Task 2: Make `readBearerToken` total (Fix 2, LOW)

**Files:**

- Modify: `packages/auth/src/index.ts:481-495` (return `undefined` instead of throwing)
- Modify (test): `tests/integration/auth-bearer-hardening.test.ts` (same new describe block)
- Modify (comment only): `tests/integration/notifications.test.ts:354` (stale comment)

- [ ] **Step 1: Write the failing tests** — add to the Task-1 describe block:

```ts
it("treats a non-bearer scheme as no token (falls through to cookie auth → clean 401)", async () => {
  await expect(
    runtime.resolveAccessContext({ headers: { authorization: "Basic dXNlcjpwYXNz" } })
  ).rejects.toThrow("Session is missing or expired");
});

it("treats an empty bearer token as no token (falls through to cookie auth → clean 401)", async () => {
  await expect(
    runtime.resolveAccessContext({ headers: { authorization: "Bearer " } })
  ).rejects.toThrow("Session is missing or expired");
});
```

- [ ] **Step 2: Run them — expect FAIL.** Old code throws `"Invalid bearer token"` for both
      (wrong scheme, empty token), so `.rejects.toThrow("Session is missing or expired")` fails on the
      wrong message.

- [ ] **Step 3: Implement** — in `packages/auth/src/index.ts`, change the throw in `readBearerToken`:

```ts
function readBearerToken(headers: Headers): string | undefined {
  const authorization = readHeader(headers, "authorization");

  if (!authorization) {
    return undefined;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  // Total: anything that is not a well-formed `Bearer <token>` (wrong scheme, missing space,
  // empty token) yields `undefined` so it falls through to cookie auth or a single clean 401 —
  // never a thrown control-flow error for a mere header-format failure.
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return undefined;
  }

  return token;
}
```

- [ ] **Step 4: Fix the now-stale comment** at `tests/integration/notifications.test.ts:354`:

```ts
// Wrong scheme ("Basic") → readBearerToken returns undefined → cookie auth finds no session → 401
```

- [ ] **Step 5: Run the bearer suite + the notifications wrong-scheme test — expect PASS.**

Run: `env JARVIS_PGDATABASE=jarvis_build_auth128 vitest run tests/integration/auth-bearer-hardening.test.ts tests/integration/notifications.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/index.ts tests/integration/auth-bearer-hardening.test.ts tests/integration/notifications.test.ts
git commit -m "fix(auth): make readBearerToken total for malformed headers (#128)"
```

## Task 3: Full gate

- [ ] **Step 1:** `nice -n 15 env JARVIS_PGDATABASE=jarvis_build_auth128 pnpm verify:foundation`
- [ ] **Step 2:** Fix anything red, re-run until green. Then proceed to `coordinated-wrap-up`.

---

## Notes / out-of-scope (reported to coordinator)

- `@jarv1s/module-sdk` `AUTH_401_MESSAGES` (`route-errors.ts:48`) still lists `"Invalid bearer
token"`. After Fix 2 nothing throws it, so the set entry is dead — but module-sdk is outside the
  auth/db isolation scope for this task, so it is left untouched and flagged here.
- No migrations (code-only). No schema/RLS changes.

## Self-review

- **Spec coverage:** Fix 1 → Task 1; Fix 2 → Task 2; Fix 3 → superseded (verified, not built).
- **Type consistency:** `isUuid(value: string): boolean` (exported from `data-context.ts`) used as a
  value import in `auth-session.ts`. `readBearerToken` keeps signature `(headers: Headers) =>
string | undefined` — already its declared return type, so callers are unaffected.
- **Behavior preservation:** both removed throw paths previously mapped to 401; the wrong-scheme
  notifications test still asserts 401 and stays green.
