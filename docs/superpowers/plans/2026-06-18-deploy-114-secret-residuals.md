# Deploy 114 Secret Residuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden secret-bearing AI and Google connector paths so decrypted credentials are parsed through shared guards and sealed credential rows cannot masquerade as safe rows.

**Architecture:** Add one small AI credential parser, brand the sealed AI provider row inside the repository, and reuse the existing Google connection secret validation from sync jobs. Keep current degrade/refuse behavior; only validation ownership changes.

**Tech Stack:** TypeScript, Kysely, Vitest, existing `@jarv1s/*` packages.

---

## File Structure

- Create `packages/ai/src/credentials.ts`: exported `AiApiKeyCredential` and `parseAiApiKeyCredential`.
- Modify `packages/ai/src/index.ts`: re-export the credential parser.
- Modify `packages/ai/src/repository.ts`: add `AiProviderWithSealedCredential` branded type and return it from `selectProviderWithCredential`.
- Modify `packages/briefings/src/compose.ts`: use `parseAiApiKeyCredential`.
- Modify `packages/chat/src/jobs.ts`: use `parseAiApiKeyCredential`.
- Modify `packages/module-registry/src/index.ts`: use `parseAiApiKeyCredential`.
- Modify `packages/connectors/src/sync-jobs.ts`: use `parseAiApiKeyCredential` and exported Google connection parser.
- Modify `packages/connectors/src/google-connection.ts`: export existing Google connection secret decrypt/guard.
- Test `tests/unit/ai-credentials.test.ts`: parser accept/reject coverage.
- Test `tests/unit/briefings-compose.test.ts`: malformed AI credential degrades to credential fallback without payload logging.
- Test `tests/integration/google-sync-orchestration.test.ts` or unit-level worker seam if simpler after inspection: malformed Google connector secret causes missing/unusable account behavior and sanitized logging.

## Task 1: AI Credential Parser And Sealed Row Type

**Files:**

- Create: `packages/ai/src/credentials.ts`
- Modify: `packages/ai/src/index.ts`
- Modify: `packages/ai/src/repository.ts`
- Test: `tests/unit/ai-credentials.test.ts`

- [ ] **Step 1: Write parser tests**

```ts
import { describe, expect, it } from "vitest";

import { parseAiApiKeyCredential } from "@jarv1s/ai";

describe("parseAiApiKeyCredential", () => {
  it("accepts a non-empty apiKey string", () => {
    expect(parseAiApiKeyCredential({ apiKey: "sk-test" })).toEqual({ apiKey: "sk-test" });
  });

  it.each([{ apiKey: "" }, { apiKey: 123 }, {}, { apiKey: null }])(
    "rejects malformed AI credentials %#",
    (value) => {
      expect(parseAiApiKeyCredential(value)).toBeNull();
    }
  );
});
```

Run: `pnpm vitest run tests/unit/ai-credentials.test.ts`
Expected: FAIL because `parseAiApiKeyCredential` does not exist.

- [ ] **Step 2: Add minimal parser and export**

```ts
export interface AiApiKeyCredential {
  readonly apiKey: string;
}

export function parseAiApiKeyCredential(value: Record<string, unknown>): AiApiKeyCredential | null {
  return typeof value.apiKey === "string" && value.apiKey.length > 0
    ? { apiKey: value.apiKey }
    : null;
}
```

Add `export * from "./credentials.js";` to `packages/ai/src/index.ts`.

- [ ] **Step 3: Brand sealed credential row**

In `packages/ai/src/repository.ts`, add near safe row types:

```ts
declare const aiSealedCredentialBrand: unique symbol;

export interface AiProviderWithSealedCredential extends AiProviderConfigSafeRow {
  readonly [aiSealedCredentialBrand]: true;
  readonly encrypted_credential: EncryptedAiSecret;
}
```

Change `selectProviderWithCredential` to return `Promise<AiProviderWithSealedCredential | undefined>` and keep the cast contained inside the repository query return.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm vitest run tests/unit/ai-credentials.test.ts
pnpm typecheck
```

Expected: PASS.

Commit:

```bash
git add packages/ai/src/credentials.ts packages/ai/src/index.ts packages/ai/src/repository.ts tests/unit/ai-credentials.test.ts
git commit -m "fix(ai): centralize api key credential parsing" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 2: AI Consumers Use Shared Parser

**Files:**

- Modify: `packages/briefings/src/compose.ts`
- Modify: `packages/chat/src/jobs.ts`
- Modify: `packages/module-registry/src/index.ts`
- Modify: `packages/connectors/src/sync-jobs.ts`
- Test: `tests/unit/briefings-compose.test.ts`

- [ ] **Step 1: Add malformed credential test**

In `tests/unit/briefings-compose.test.ts`, add a fake-deps option returning `{ apiKey: "" }` or `{ token: "secret" }` from `decryptJson`, then assert compose returns the existing credential fallback status/reason. Do not assert or print the raw payload.

Run: `pnpm vitest run tests/unit/briefings-compose.test.ts`
Expected: FAIL until compose uses the parser.

- [ ] **Step 2: Replace manual AI credential checks**

Import `parseAiApiKeyCredential` from `@jarv1s/ai` in each consumer. Replace local `decrypted.apiKey` checks with:

```ts
const credential = parseAiApiKeyCredential(deps.cipher.decryptJson(provider.encrypted_credential));
if (!credential) return existingFallback;
const apiKey = credential.apiKey;
```

For `module-registry`, preserve the existing `HttpError(503, "Chat model credential is not configured")`. For `sync-jobs`, preserve `{ text: "" }`.

- [ ] **Step 3: Verify no production casts remain**

Run:

```bash
rg -n "as \\{\\s*apiKey\\??: string|decrypted\\.apiKey|apiKey\\?: string" packages -g'*.ts'
pnpm vitest run tests/unit/briefings-compose.test.ts
pnpm typecheck
```

Expected: `rg` finds no production manual AI credential casts/checks; tests PASS.

Commit:

```bash
git add packages/briefings/src/compose.ts packages/chat/src/jobs.ts packages/module-registry/src/index.ts packages/connectors/src/sync-jobs.ts tests/unit/briefings-compose.test.ts
git commit -m "fix(ai): use shared credential guard in consumers" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 3: Google Sync Uses Existing Secret Guard

**Files:**

- Modify: `packages/connectors/src/google-connection.ts`
- Modify: `packages/connectors/src/sync-jobs.ts`
- Test: `tests/integration/google-sync-orchestration.test.ts` or smallest existing sync-job test seam

- [ ] **Step 1: Write malformed connector secret test**

Add coverage that production sync account loading receives an encrypted payload missing required Google connection fields and returns/degrades as no usable account. Capture logger calls and assert serialized log data does not include `accessToken`, `refreshToken`, `clientSecret`, or the malformed payload value.

Run the focused test file.
Expected: FAIL because sync jobs cast decrypted connector payloads.

- [ ] **Step 2: Export existing guard**

In `packages/connectors/src/google-connection.ts`, export `decryptGoogleConnectionSecret`:

```ts
export function decryptGoogleConnectionSecret(
  cipher: ConnectorSecretCipher,
  encryptedSecret: EncryptedConnectorSecret
): GoogleConnectionSecret {
```

No new parser; this already validates the full shape.

- [ ] **Step 3: Use guard in sync jobs**

In `packages/connectors/src/sync-jobs.ts`, import `decryptGoogleConnectionSecret` from `./google-connection.js`, drop the `GoogleConnectionSecret` type import, and replace the cast with:

```ts
try {
  const bundle = decryptGoogleConnectionSecret(connectorCipher, secret.encryptedSecret);
  return { id: secret.id, scopes: bundle.grantedScopes ?? [] };
} catch {
  deps.logger?.warn({ actorScoped: true, stage: "auth" }, "google-sync stored connection invalid");
  return undefined;
}
```

Keep log metadata only.

- [ ] **Step 4: Verify and commit**

Run:

```bash
pnpm vitest run tests/integration/google-sync-orchestration.test.ts
pnpm typecheck
rg -n "as GoogleConnectionSecret|GoogleConnectionSecret" packages/connectors/src/sync-jobs.ts
```

Expected: tests/typecheck PASS; `rg` finds no sync-job cast/import.

Commit:

```bash
git add packages/connectors/src/google-connection.ts packages/connectors/src/sync-jobs.ts tests/integration/google-sync-orchestration.test.ts
git commit -m "fix(connectors): validate google sync secrets" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Task 4: Security Residual Sweep

**Files:**

- Only files already touched above unless verification exposes a compile/test issue.

- [ ] **Step 1: Run acceptance greps**

```bash
rg -n "as \\{\\s*apiKey\\??: string|decrypted\\.apiKey|apiKey\\?: string" packages -g'*.ts'
rg -n "as GoogleConnectionSecret|connectorCipher\\.decryptJson\\(.*encryptedSecret" packages/connectors/src -g'*.ts'
```

Expected: no production matches for forbidden patterns.

- [ ] **Step 2: Run focused tests**

```bash
pnpm vitest run tests/unit/ai-credentials.test.ts tests/unit/briefings-compose.test.ts tests/integration/google-sync-orchestration.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit final fixes if any**

If verification required edits:

```bash
git add <explicit changed paths>
git commit -m "fix(security): finish credential residual hardening" -m "Co-Authored-By: Codex <codex@openai.com>"
```

## Self-Review

- Spec coverage: Task 1 brands `selectProviderWithCredential`; Tasks 1-2 centralize AI credential validation; Task 3 reuses Google secret guard; Task 4 verifies forbidden residual patterns.
- Placeholder scan: no `TBD`, broad “add validation”, or unbound file paths.
- Type consistency: exported parser returns `AiApiKeyCredential | null`; sealed provider row type remains repository-owned; Google guard remains the existing decrypt function.
