# Secret-Key Rotation Runbook

Covers rotating `JARVIS_CONNECTOR_SECRET_KEY` and/or `JARVIS_AI_SECRET_KEY` without
downtime or data loss. The cipher uses AES-256-GCM with a versioned key envelope —
old envelopes stay decryptable while new writes use the new key.

See also: [Release Hardening](./release-hardening.md)

---

## Overview

Each secret envelope carries a `keyId` field (e.g. `"v1"`). The cipher holds a keyring:
a **current key** (used for all new encryptions) plus zero or more **retired keys** (used
only for decryption of old envelopes). Envelopes written before key versioning was
introduced carry no `keyId` and are mapped to the reserved `"legacy"` key (which defaults
to the current key).

Rotation is lazy by default: existing rows are re-encrypted on their next normal write
(token refresh, credential update). The optional `rewrap-secrets.ts` script forces
immediate re-encryption of all rows so an old key can be retired promptly.

---

## Environment Variables

| Variable                         | Purpose                                                       |
| -------------------------------- | ------------------------------------------------------------- |
| `JARVIS_CONNECTOR_SECRET_KEY`    | Current connector key secret (plaintext — hashed to 256 bits) |
| `JARVIS_CONNECTOR_SECRET_KEY_ID` | Id of the current connector key (default: `"v1"`)             |
| `JARVIS_CONNECTOR_SECRET_KEYS`   | JSON object of retired connector keys: `{"v1":"old-secret"}`  |
| `JARVIS_AI_SECRET_KEY`           | Current AI key secret                                         |
| `JARVIS_AI_SECRET_KEY_ID`        | Id of the current AI key (default: `"v1"`)                    |
| `JARVIS_AI_SECRET_KEYS`          | JSON object of retired AI keys                                |

---

## Rotation Procedure

### Step 1 — Generate a new key secret

```bash
openssl rand -base64 32
# e.g. → "xK9mP3qL8nR2vT5wY7zB1cD4eF6gH0jI"
```

### Step 2 — Add the old key to the retired-keys map

Add the _current_ key to `JARVIS_*_SECRET_KEYS` before switching. This ensures old
envelopes remain decryptable during the transition.

```bash
# Before rotation, current is v1 / "old-secret"
JARVIS_CONNECTOR_SECRET_KEYS='{"v1":"old-secret"}'
JARVIS_AI_SECRET_KEYS='{"v1":"old-ai-secret"}'
```

### Step 3 — Set the new key as current

```bash
JARVIS_CONNECTOR_SECRET_KEY="new-secret-from-step-1"
JARVIS_CONNECTOR_SECRET_KEY_ID="v2"

JARVIS_AI_SECRET_KEY="new-ai-secret-from-step-1"
JARVIS_AI_SECRET_KEY_ID="v2"
```

### Step 4 — Deploy

Restart the API server with the updated env. New writes (token refresh, credential
update) are immediately encrypted with `v2`. Old `v1` envelopes decrypt normally via
the retired-keys map.

### Step 5 — (Optional) Force-rewrap all rows

To retire the old key promptly, run the rewrap script as an operator with all keys in
scope:

```bash
JARVIS_CONNECTOR_SECRET_KEY="new-secret" \
JARVIS_CONNECTOR_SECRET_KEY_ID="v2" \
JARVIS_CONNECTOR_SECRET_KEYS='{"v1":"old-secret"}' \
JARVIS_AI_SECRET_KEY="new-ai-secret" \
JARVIS_AI_SECRET_KEY_ID="v2" \
JARVIS_AI_SECRET_KEYS='{"v1":"old-ai-secret"}' \
pnpm tsx scripts/rewrap-secrets.ts
```

The script logs each row id and the new `keyId` — never plaintext secrets.

### Step 6 — Verify

Check application logs for AES decryption errors after deployment. If none appear,
the rotation is complete.

### Step 7 — Retire the old key

Once confident all rows have been re-encrypted (either lazily or via step 5), remove
the old key from `JARVIS_*_SECRET_KEYS` and redeploy.

```bash
# No longer needed:
# JARVIS_CONNECTOR_SECRET_KEYS (remove or set to {})
# JARVIS_AI_SECRET_KEYS (remove or set to {})
```

---

## What Happens If a Key Is Lost

If a key is removed from the keyring before all envelopes are re-encrypted, `decryptJson`
throws a **named error** (`Unknown connector secret key id: v1`) rather than an opaque
GCM authentication-tag failure. This makes the problem immediately diagnosable.

Affected users will see an error on their next connector sync or AI provider call.
Recovery requires restoring the lost key to `JARVIS_*_SECRET_KEYS` and running the
rewrap script.

---

## Key Derivation

Keys are derived with `SHA-256(raw_secret)` → 32-byte AES key. The raw secret is the
env var value (or `"jarv1s-development-*"` in non-production). Keep raw secrets
confidential; never log them.
