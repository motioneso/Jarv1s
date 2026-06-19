# Spec - OTNR P2 secrets/vault residual hardening

**Issue:** #114
**Status:** approved for build planning
**Date:** 2026-06-18

## Goal

Finish the live residual security hardening from OTNR P2 without reopening findings that have
already been fixed. The remaining work is defensive typing and validation around secret-bearing
paths so future serializers/callers cannot accidentally treat sealed credentials as safe data.

## Current State

Already fixed and out of scope for this slice:

- Vault read/write/delete/list operations call a realpath-based symlink escape guard in
  `packages/vault/src/vault-ops.ts`.
- AI and connector secret ciphers are centralized in `packages/db/src/secret-cipher.ts`.
- `JsonSecretCipher.encryptJson` explicitly fails if the keyring current key is missing.
- Legacy no-keyId decryption distinguishes GCM auth failure from other corrupt-envelope failures.
- `resolveKeyring` requires explicit high-entropy key material in hardened environments.
- Google token exchange errors no longer log or return the upstream response body.
- Google connector credential decrypt paths validate required fields before use.

Live residuals:

- `AiRepository.selectProviderWithCredential` returns
  `AiProviderConfigSafeRow & { encrypted_credential: EncryptedAiSecret }` via a cast. The "safe row
  plus secret column" shape is easy to pass to code expecting safe rows.
- Several AI credential consumers manually decrypt and inspect `apiKey`, duplicating validation.
- `packages/connectors/src/sync-jobs.ts` still casts a decrypted Google connection secret in the
  sync path instead of using the same runtime guard used by `GoogleConnectionService`.

## Build Scope

### 1. Branded sealed AI credential row

In `packages/ai/src/repository.ts`, introduce a distinct return type:

```ts
declare const aiSealedCredentialBrand: unique symbol;

export interface AiProviderWithSealedCredential extends AiProviderConfigSafeRow {
  readonly [aiSealedCredentialBrand]: true;
  readonly encrypted_credential: EncryptedAiSecret;
}
```

`selectProviderWithCredential` must return `Promise<AiProviderWithSealedCredential | undefined>`.
The branded type must not be assignable from a plain `AiProviderConfigSafeRow & { encrypted_credential:
EncryptedAiSecret }` object outside the repository.

### 2. Central AI credential payload guard

Add a small exported helper in the AI package, for example:

```ts
export interface AiApiKeyCredential {
  readonly apiKey: string;
}

export function parseAiApiKeyCredential(value: Record<string, unknown>): AiApiKeyCredential | null;
```

The helper returns `null` unless `apiKey` is a non-empty string. Update current AI credential
consumers to use it instead of ad hoc `typeof decrypted.apiKey` checks/casts:

- `packages/briefings/src/compose.ts`
- `packages/chat/src/jobs.ts`
- `packages/module-registry/src/index.ts`
- `packages/connectors/src/sync-jobs.ts`

Callers that currently degrade silently should keep their existing behavior, but the validation
must be centralized.

### 3. Reuse Google connection secret guard in sync jobs

Export the Google connection-secret parser/guard from `packages/connectors/src/google-connection.ts`
or move it to a small internal helper module. Update `packages/connectors/src/sync-jobs.ts` to use
that guard instead of:

```ts
connectorCipher.decryptJson(secret.encryptedSecret) as GoogleConnectionSecret;
```

If the stored connector secret is malformed, sync should behave like a missing/unusable connection
and log only sanitized metadata. It must not throw raw decrypted-shape details or include secret
fields in logs.

## Acceptance Criteria

- `selectProviderWithCredential` returns a distinct branded sealed-credential type, not a safe-row
  intersection cast.
- No production code manually casts decrypted AI credentials to `{ apiKey?: string }`.
- No production code casts decrypted connector payloads to `GoogleConnectionSecret`.
- Existing behavior is preserved: briefings/chat/persona preview/email sync degrade or refuse work
  exactly as they do today when credentials are missing/invalid.
- Tests cover:
  - The AI credential parser accepts `{ apiKey: "..." }` and rejects missing, empty, and non-string
    values.
  - At least one consumer path rejects/degrades on malformed AI credential payload without leaking
    the payload.
  - The Google sync path rejects/degrades on malformed connector secret payload without logging raw
    secret fields.

## Non-Goals

- Replacing the current SHA-256 derivation with a new envelope format or KDF. The hardened-env
  entropy requirement is already in place; a future envelope-format migration should be a separate
  issue.
- Changing vault path behavior beyond the existing realpath guard.
- Changing user-facing setup flows for AI or Google connectors.
