# Plan: P1 AI Isolation — #57 Retire AiAssistantToolExecutor, then #55 Secret Key Rotation

**Branch:** `p1-ai-isolation` **Issues:** #57 (first), #55 (second) **No migrations.**

---

## Issue #57 — Retire AiAssistantToolExecutor

### Task 57-A: calendar `tools.ts` + manifest execute wire-up

**Files:**

- `packages/calendar/src/tools.ts` (new)
- `packages/calendar/src/manifest.ts` (add `execute:`)

**Work:**
Create `packages/calendar/src/tools.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { CalendarRepository } from "./repository.js";
import { serializeCalendarEvent } from "./routes.js";

const repository = new CalendarRepository();

export const calendarListVisibleEventsExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const events = await repository.listVisible(scopedDb);
  return { data: { events: events.map(serializeCalendarEvent) } };
};
```

Wire into `calendarModuleManifest.assistantTools[0]`:

```ts
import { calendarListVisibleEventsExecute } from "./tools.js";
// ...
assistantTools: [{ name: "calendar.listVisibleEvents", ..., execute: calendarListVisibleEventsExecute }]
```

**Commit:** `feat(calendar): add listVisibleEvents execute handler (issue #57)`  
**Green bar:** `pnpm -F @jarv1s/calendar typecheck`

---

### Task 57-B: email `tools.ts` + manifest execute wire-up

**Files:**

- `packages/email/src/tools.ts` (new)
- `packages/email/src/manifest.ts` (add `execute:`)

**Work:**
Create `packages/email/src/tools.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { EmailRepository } from "./repository.js";
import { serializeEmailMessage } from "./routes.js";

const repository = new EmailRepository();

export const emailListVisibleMessagesExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const messages = await repository.listVisible(scopedDb);
  return { data: { messages: messages.map(serializeEmailMessage) } };
};
```

Wire into `emailModuleManifest.assistantTools[0].execute`.

**Commit:** `feat(email): add listVisibleMessages execute handler (issue #57)`  
**Green bar:** `pnpm -F @jarv1s/email typecheck`

---

### Task 57-C: notifications `tools.ts` + manifest execute wire-up

**Files:**

- `packages/notifications/src/tools.ts` (new)
- `packages/notifications/src/manifest.ts` (add `execute:`)

**Work:**
Create `packages/notifications/src/tools.ts`:

```ts
import { assertDataContextDb } from "@jarv1s/db";
import type { ToolExecute, ToolResult } from "@jarv1s/module-sdk";
import { NotificationsRepository } from "./repository.js";
import { serializeNotification } from "./routes.js";

const repository = new NotificationsRepository();

export const notificationsListVisibleExecute: ToolExecute = async (
  scopedDb,
  _input,
  _ctx
): Promise<ToolResult> => {
  assertDataContextDb(scopedDb);
  const result = await repository.listVisible(scopedDb);
  return {
    data: {
      notifications: result.notifications.map(serializeNotification),
      unreadCount: result.unreadCount
    }
  };
};
```

Wire into `notificationsModuleManifest.assistantTools[0].execute`.

**Commit:** `feat(notifications): add listVisible execute handler (issue #57)`  
**Green bar:** `pnpm -F @jarv1s/notifications typecheck`

---

### Task 57-D: Thin `assistant-tools.ts` + remove executor from both call sites + drop 4 deps

**Files:**

- `packages/ai/src/assistant-tools.ts` (delete class/error/imports)
- `packages/ai/package.json` (drop 4 workspace deps)
- `packages/ai/src/routes.ts` (remove executor fallback + catch branch)
- `packages/briefings/src/repository.ts` (remove executor fallback + simplified catch)
- `packages/ai/src/index.ts` (verify no dangling re-export of deleted symbols)

**Work:**

`assistant-tools.ts`: Remove all 4 feature-module import lines; delete `AiAssistantToolExecutorDependencies`, `AiAssistantToolExecutor`, `UnsupportedAssistantToolError`. Keep `listAssistantToolsFromManifests`, `findAssistantToolFromManifests`, `summarizeAssistantToolInput`.

`package.json` (ai): Remove `"@jarv1s/calendar"`, `"@jarv1s/email"`, `"@jarv1s/notifications"`, `"@jarv1s/tasks"` from `dependencies`.

`routes.ts` (ai):

- Remove `AiAssistantToolExecutor` + `UnsupportedAssistantToolError` imports.
- Remove `assistantToolExecutor?: AiAssistantToolExecutor` from `AiRouteDependencies`.
- Remove `const assistantToolExecutor = ...` default.
- Before `withDataContext`, guard: if `!manifestTool?.execute` → reply 403 "blocked"/"unsupported_tool".
- Simplify `withDataContext` callback to call `manifestTool.execute(...)` only.
- Remove `UnsupportedAssistantToolError` catch branch (simplify to just `handleRouteError`).

`repository.ts` (briefings):

- Remove `AiAssistantToolExecutor` + `UnsupportedAssistantToolError` imports.
- Remove `assistantToolExecutor?: AiAssistantToolExecutor` from `GenerateBriefingRunInput`.
- Remove `const executor = ...` default.
- In the tool-loop: if `!manifestTool?.execute`, push `{ status: "blocked", blockedReason: "unsupported_tool", itemCount: 0, excerpts: [] }` and continue.
- Simplify `withDataContext` callback to manifest execute only.
- Simplify catch: remove `UnsupportedAssistantToolError` branch → always "failed"/"tool_failed".

`index.ts` (ai): Confirm `export *` from `./assistant-tools.js` still works cleanly; deleted symbols are gone.

**Commit:** `feat(ai): retire AiAssistantToolExecutor, remove 4 module deps (issue #57)`  
**Green bar:** `JARVIS_PGDATABASE=jarvis_ai pnpm verify:foundation` + `pnpm audit:release-hardening`

---

## Issue #55 — Secret Key Rotation / Versioning

### Task 55-A: Shared keyring helper in `packages/shared/src/keyring.ts`

**Files:**

- `packages/shared/src/keyring.ts` (new)
- `packages/shared/src/index.ts` (export)

**Note:** Both `@jarv1s/ai` and `@jarv1s/connectors` already depend on `@jarv1s/shared`. Putting the shared keyring helper here avoids a new package without muddying the crypto files.

**Work:**

```ts
// packages/shared/src/keyring.ts
import { createHash } from "node:crypto";

export interface Keyring {
  currentKeyId: string;
  keys: Map<string, Buffer>;
}

export function resolveKeyring(
  keyEnvVar: string, // e.g. "JARVIS_AI_SECRET_KEY"
  keyIdEnvVar: string, // e.g. "JARVIS_AI_SECRET_KEY_ID"
  keysEnvVar: string, // e.g. "JARVIS_AI_SECRET_KEYS"
  devDefault: string, // e.g. "jarv1s-development-ai-secret"
  env: NodeJS.ProcessEnv = process.env
): Keyring {
  // Resolve current key
  const currentSecret = env[keyEnvVar];
  if (!currentSecret && env.NODE_ENV === "production") {
    throw new Error(`${keyEnvVar} is required in production`);
  }
  const rawCurrentSecret = currentSecret ?? devDefault;
  const currentKeyBuffer = createHash("sha256").update(rawCurrentSecret).digest();
  const currentKeyId = env[keyIdEnvVar] ?? "v1";

  // Build keyring: start with current key
  const keys = new Map<string, Buffer>();
  keys.set(currentKeyId, currentKeyBuffer);

  // Add legacy key (absent-keyId envelopes) — same as current if only one key
  // Use reserved id "legacy" for envelopes with no keyId field
  if (!keys.has("legacy")) {
    keys.set("legacy", currentKeyBuffer);
  }

  // Parse additional keys from JARVIS_*_SECRET_KEYS JSON {"id":"secret",...}
  const keysJson = env[keysEnvVar];
  if (keysJson) {
    const parsed = JSON.parse(keysJson) as Record<string, string>;
    for (const [id, secret] of Object.entries(parsed)) {
      keys.set(id, createHash("sha256").update(secret).digest());
    }
    // If current key is not explicitly in the keyring JSON, it's already set above
  }

  return { currentKeyId, keys };
}
```

**Commit:** `feat(shared): add resolveKeyring helper for cipher key versioning (issue #55)`  
**Green bar:** `pnpm -F @jarv1s/shared typecheck`

---

### Task 55-B: Update `packages/connectors/src/crypto.ts`

**Files:**

- `packages/connectors/src/crypto.ts`

**Work:**

Extend `EncryptedConnectorSecret` with optional `keyId?: string`.

Refactor `ConnectorSecretCipher` to accept a `Keyring` instead of a raw `Buffer`:

- `encryptJson` stamps `keyId: this.keyring.currentKeyId`.
- `decryptJson` reads `envelope.keyId ?? "legacy"`, looks up the key, throws `Error(\`Unknown connector secret key id: ${id}\`)` if not found.

`createConnectorSecretCipher(env)` calls `resolveKeyring("JARVIS_CONNECTOR_SECRET_KEY", "JARVIS_CONNECTOR_SECRET_KEY_ID", "JARVIS_CONNECTOR_SECRET_KEYS", "jarv1s-development-connector-secret", env)`.

**Existing callers** (`tests/integration/connectors-google.test.ts`, `connectors.test.ts`) use `createConnectorSecretCipher()` — no constructor signature change needed since they use the factory.

**Commit:** `feat(connectors): add keyId to secret envelope, support keyring rotation (issue #55)`  
**Green bar:** `pnpm -F @jarv1s/connectors typecheck`

---

### Task 55-C: Update `packages/ai/src/crypto.ts`

**Files:**

- `packages/ai/src/crypto.ts`

**Work:** Same pattern as 55-B, using `JARVIS_AI_SECRET_KEY*` vars. `decryptJson` throws `Error(\`Unknown AI secret key id: ${id}\`)`.

**Commit:** `feat(ai): add keyId to AI secret envelope, support keyring rotation (issue #55)`  
**Green bar:** `pnpm -F @jarv1s/ai typecheck`

---

### Task 55-D: Tests for keyring rotation

**Files:**

- `tests/integration/connectors.test.ts` (add keyring tests)
- `tests/integration/ai.test.ts` (add keyring tests)

**Tests required by spec:**

1. **Encrypt-new / decrypt-old:** encrypt under `v1`, rotate current to `v2` (both in keyring), confirm `v1` ciphertext still decrypts + new encrypt is stamped `v2`.
2. **Legacy envelope compatibility:** encrypt with pre-keyId cipher (no `keyId` field), confirm decrypts under new cipher with old key as "legacy".
3. **Unknown keyId clear error:** envelope with unknown `keyId` → throws named error (not opaque GCM failure).

Run per-module: `JARVIS_PGDATABASE=jarvis_ai pnpm test:integration --reporter=verbose` (filtered to connectors + ai suites).

**Commit:** `test(crypto): keyring rotation + legacy envelope + unknown-key tests (issue #55)`

---

### Task 55-E: rewrap script + runbook

**Files:**

- `scripts/rewrap-secrets.ts` (new, operator script — NOT in migration chain)
- `docs/operations/secret-key-rotation.md` (new)

**Work:**

`rewrap-secrets.ts`: iterate `connector_accounts`, `connector_oauth_pending`, `ai_provider_configs` rows per user via `withDataContext`; re-encrypt with the current cipher; log row ids only (never plaintext). CLI exit 0 on success.

`secret-key-rotation.md`: step-by-step runbook:

1. Generate new key (`openssl rand -base64 32`).
2. Add to `JARVIS_*_SECRET_KEYS` JSON (keep old key id + secret in the map).
3. Set `JARVIS_*_SECRET_KEY_ID` to new id.
4. Deploy — lazy re-encryption begins on normal writes.
5. (Optional) run `node scripts/rewrap-secrets.ts` to force-rewrap all rows.
6. Verify: check logs for decryption errors.
7. Retire old key: remove its entry from `JARVIS_*_SECRET_KEYS`.

Cross-link from `docs/operations/release-hardening.md`.

**Commit:** `feat(ops): rewrap-secrets script + secret-key-rotation runbook (issue #55)`

---

### Task 55-F: Full gate

`JARVIS_PGDATABASE=jarvis_ai pnpm verify:foundation` + `pnpm audit:release-hardening`

Migration count must still be **44** (no new migrations).

---

## Exit criteria mapping

### #57

- [x] 57-A: `calendar.listVisibleEvents` has execute handler
- [x] 57-B: `email.listVisibleMessages` has execute handler
- [x] 57-C: `notifications.listVisible` has execute handler
- [x] 57-D: Executor class + error + 4 deps deleted; both call sites dispatch manifest-only
- [x] 57-D: `pnpm verify:foundation` + `pnpm audit:release-hardening` green

### #55

- [x] 55-A–C: Envelope carries `keyId`; `encryptJson` stamps current key id
- [x] 55-D: encrypt-new/decrypt-old test + legacy-envelope test + unknown-keyId test
- [x] 55-E: Runbook exists
- [x] 55-F: `pnpm verify:foundation` green; migration count = 44
