# IMAP Connector — Slice B (Credential Connect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect a Yahoo/Proton/iCloud/Fastmail mailbox to Jarvis by entering an app password, with a live "Test connection" probe and an AES-256-GCM-encrypted credential at rest — **no message reading yet** (that is Slice C).

**Architecture:** Add a generic `imap` connector provider type. Each provider is a seeded `app.connector_definitions` row (`imap-yahoo`, `imap-proton`, `imap-icloud`, `imap-fastmail`); host/port/TLS/SMTP live in an in-code preset registry keyed by `provider_id`. A new `ImapConnectionService` probes IMAP+SMTP (Test connection) and, on connect, encrypts the credential and upserts a `connector_accounts` row — mirroring the existing `GoogleConnectionService` flow exactly. Tested against a real **GreenMail** IMAP/SMTP container in CI.

**Tech Stack:** TypeScript, Fastify, Kysely (via branded `DataContextDb`), pg-boss (unused in Slice B), `imapflow` (IMAP client), `nodemailer` (SMTP probe), Vitest, Docker Compose + GreenMail.

**Source spec:** `docs/superpowers/specs/2026-06-30-generic-imap-email-connector-design.md` (Codex-reviewed). This plan implements **Slice B only** (§13 row B). Slices C/D/E/F get their own plans — roadmap at the end.

## Global Constraints

_Every task's requirements implicitly include these. Verbatim from the spec + CLAUDE.md invariants._

- **Rebase before numbering migrations.** Local `main` is behind `origin/main` (origin ~4 ahead). On the local checkout the next global migration number is `0130`, but **origin may have moved past it.** Before creating any migration, rebase the work branch onto `origin/main` and recompute the next number from the **highest existing `NNNN_` prefix across all module `sql/` dirs**. Migration numbers are a single global sequence regardless of module.
- **Never edit an applied migration.** The runner (`packages/db/src/migrations/sql-runner.ts`) checksum-guards every file; a changed hash fails boot. Add new files; supersede via new policy DROP/CREATE files. Module SQL lives in the owning module's `sql/` dir, never `infra/`.
- **`foundation.test.ts` asserts the FULL migration list with `toEqual`.** Every new `.sql` file MUST add a `{ version, name }` row to `tests/integration/foundation.test.ts` in the same task, and the file MUST be listed in that module's `manifest.ts` `database.migrations` array. Run full `test:integration` — a focused test won't catch a missing row.
- **Secrets never escape.** The app password is AES-256-GCM encrypted at rest (reuse `ConnectorSecretCipher`) and never appears in HTTP responses, logs, pg-boss payloads, exports, or AI prompts. Raw IMAP/SMTP library errors (which can embed credentials/transcripts) are mapped to a bounded label and dropped — never surfaced or logged verbatim.
- **DataContextDb only.** Every repository method takes a branded `DataContextDb` (call `assertDataContextDb`), never a root Kysely instance. Owner scoping is enforced by RLS (`owner_user_id = app.current_actor_user_id()`), not by application `WHERE` clauses.
- **AccessContext shape is `{ actorUserId, requestId }`** — do not add fields.
- **`imap` is the provider TYPE; `provider_id` is the preset.** One `provider_type` enum value (`'imap'`); one `connector_definitions` row per preset. Adding a provider later = a registry entry + a one-line idempotent seed, never a schema change.
- **No stored `ok|auth_failed|unreachable` health enum in Slice B.** Test-connection _returns_ that bounded label to the caller; persistent per-account health rides the existing `connector_account_status` (`active|error|revoked`) and the #254 sync-health columns (set in Slice C). Do not add a new health enum/column here (YAGNI).

---

## File Structure

**New files:**

- `packages/connectors/sql/<NNNN>_connector_imap_enum.sql` — `ALTER TYPE ... ADD VALUE 'imap'` (own file/txn).
- `packages/connectors/sql/<NNNN+1>_connector_imap_definitions.sql` — seed the four `imap-*` definitions under a transient migration-owner RLS policy (mirror `0044`).
- `packages/connectors/src/imap-presets.ts` — in-code preset registry (`provider_id → { displayName, imapHost, imapPort, imapTls, smtpHost, smtpPort, smtpTls, authMethod, prerequisite? }`).
- `packages/connectors/src/imap-secret.ts` — `ImapConnectionSecret` shape (`kind: "imap-password"`) + `decryptImapConnectionSecret` validator.
- `packages/connectors/src/imap-probe-client.ts` — `ImapProbeClient` interface + `LiveImapProbeClient` (imapflow + nodemailer), with bounded-label error mapping.
- `packages/connectors/src/imap-connection.ts` — `ImapConnectionService` (`testConnection`, `connect`).

**Modified files:**

- `packages/shared/src/connectors-api.ts` — add `"imap"` to the union (line 3) + both schema enums (lines 112, 162); add `ImapConnectRequest`/`ImapTestRequest`/`ImapTestResult` types + route schemas.
- `packages/connectors/src/repository.ts` — `IMAP_PROVIDER_IDS` const + `upsertImapAccount(scopedDb, { providerId, scopes, encryptedSecret })`.
- `packages/connectors/src/routes.ts` — `imapService?` dep + `POST /api/connectors/imap/test` and `/connect` (rate-limited).
- `packages/connectors/src/manifest.ts` — add the two new migration filenames to `database.migrations`; add the two routes.
- `tests/integration/foundation.test.ts` — two new `{ version, name }` rows.
- `infra/docker-compose.yml` — a `greenmail` service for CI IMAP/SMTP.
- `packages/connectors/package.json` — add `imapflow`, `nodemailer` deps.

**New tests:**

- `packages/connectors/src/imap-presets.test.ts`, `imap-secret.test.ts`, `imap-probe-client.test.ts` (unit).
- `tests/integration/connectors-imap.test.ts` (service + RLS, GreenMail-backed).
- `tests/integration/connectors-imap-routes.test.ts` (Fastify inject).

---

## Task B1: Add the `imap` provider type (enum + shared contract)

**Files:**

- Create: `packages/connectors/sql/<NNNN>_connector_imap_enum.sql`
- Modify: `packages/shared/src/connectors-api.ts:3,112,162`
- Modify: `packages/connectors/src/manifest.ts` (`database.migrations`)
- Modify: `tests/integration/foundation.test.ts` (add one row)

**Interfaces:**

- Produces: `ConnectorProviderType` now includes `"imap"`; both JSON-schema enums accept `"imap"`.

- [ ] **Step 1: Rebase + compute the migration number**

```bash
cd ~/Jarv1s
git fetch origin
git rebase origin/main           # resolve onto current origin
# Next number = highest NNNN_ prefix across all module sql dirs, +1:
ls packages/*/sql/*.sql | sed -E 's@.*/([0-9]{4})_.*@\1@' | sort -n | tail -1
```

Use that number + 1 for this file (`<NNNN>`), + 2 for B2. Expected on a fresh rebase: ≥ `0130`.

- [ ] **Step 2: Write the enum migration**

`packages/connectors/sql/<NNNN>_connector_imap_enum.sql`:

```sql
-- Postgres forbids USING a newly ALTER-added enum value in the same transaction,
-- so the value-add lives alone here; the definition seed that USES it is the next file.
ALTER TYPE app.connector_provider_type ADD VALUE IF NOT EXISTS 'imap';
```

- [ ] **Step 3: Register the migration in the manifest**

In `packages/connectors/src/manifest.ts`, add `"<NNNN>_connector_imap_enum.sql"` to the `database.migrations` array (keep numeric order).

- [ ] **Step 4: Add the shared contract value**

In `packages/shared/src/connectors-api.ts`:

- Line 3: `export type ConnectorProviderType = "calendar" | "email" | "google" | "imap";`
- Line ~112 (`connectorProviderSchema`): `enum: ["calendar", "email", "google", "imap"]`
- Line ~162 (`connectorAccountSchema`): `enum: ["calendar", "email", "google", "imap"]`

- [ ] **Step 5: Add the foundation.test.ts row (failing first)**

In `tests/integration/foundation.test.ts`, add to the `toEqual([...])` array, in numeric position:

```ts
{ version: "<NNNN>", name: "<NNNN>_connector_imap_enum.sql" },
```

- [ ] **Step 6: Run the migration-list test**

Run: `pnpm --filter @jarv1s/integration-tests test foundation -t "applies versioned SQL migrations"` (or the repo's `test:integration` invocation for that file).
Expected: PASS — the new migration applies and the list matches. If it FAILS with a version-list mismatch, the row position or filename is wrong; fix and rerun.

- [ ] **Step 7: Typecheck the shared change**

Run: `pnpm --filter @jarv1s/shared typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/connectors/sql/<NNNN>_connector_imap_enum.sql \
        packages/connectors/src/manifest.ts \
        packages/shared/src/connectors-api.ts \
        tests/integration/foundation.test.ts
git commit -m "feat(connectors): add imap provider type (enum + shared contract)"
```

---

## Task B2: Seed the preset definitions + in-code preset registry

**Files:**

- Create: `packages/connectors/sql/<NNNN+1>_connector_imap_definitions.sql`
- Create: `packages/connectors/src/imap-presets.ts`
- Create: `packages/connectors/src/imap-presets.test.ts`
- Modify: `packages/connectors/src/manifest.ts`, `tests/integration/foundation.test.ts`

**Interfaces:**

- Produces: `IMAP_PRESETS: Record<string, ImapPreset>`, `getImapPreset(providerId): ImapPreset | undefined`, `IMAP_PROVIDER_IDS: readonly string[]`, and four seeded `connector_definitions` rows.

- [ ] **Step 1: Write the registry test (failing)**

`packages/connectors/src/imap-presets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IMAP_PRESETS, IMAP_PROVIDER_IDS, getImapPreset } from "./imap-presets.js";

describe("imap presets", () => {
  it("exposes the four v1 password presets keyed by provider_id", () => {
    expect(IMAP_PROVIDER_IDS).toEqual([
      "imap-yahoo",
      "imap-proton",
      "imap-icloud",
      "imap-fastmail"
    ]);
  });
  it("yahoo preset uses TLS 993 / SMTPS 465 and password auth", () => {
    const yahoo = getImapPreset("imap-yahoo");
    expect(yahoo).toMatchObject({
      imapHost: "imap.mail.yahoo.com",
      imapPort: 993,
      imapTls: true,
      smtpHost: "smtp.mail.yahoo.com",
      smtpPort: 465,
      smtpTls: true,
      authMethod: "password"
    });
  });
  it("proton preset points at local Bridge", () => {
    expect(getImapPreset("imap-proton")).toMatchObject({
      imapHost: "127.0.0.1",
      imapPort: 1143,
      smtpHost: "127.0.0.1",
      smtpPort: 1025
    });
  });
  it("returns undefined for unknown provider", () => {
    expect(getImapPreset("imap-nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `pnpm --filter @jarv1s/connectors test imap-presets`
Expected: FAIL — cannot find `./imap-presets.js`.

- [ ] **Step 3: Implement the registry**

`packages/connectors/src/imap-presets.ts`:

```ts
export type ImapAuthMethod = "password" | "xoauth2";

export interface ImapPreset {
  readonly providerId: string;
  readonly displayName: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapTls: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpTls: boolean;
  readonly authMethod: ImapAuthMethod;
  /** Operator-facing note shown in the connect form, e.g. Proton's Bridge prerequisite. */
  readonly prerequisite?: string;
}

export const IMAP_PRESETS: Record<string, ImapPreset> = {
  "imap-yahoo": {
    providerId: "imap-yahoo",
    displayName: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapTls: true,
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpTls: true,
    authMethod: "password",
    prerequisite:
      "Generate an app password in Yahoo Account Security; your normal password will not work."
  },
  "imap-proton": {
    providerId: "imap-proton",
    displayName: "Proton Mail (Bridge)",
    imapHost: "127.0.0.1",
    imapPort: 1143,
    imapTls: false,
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
    smtpTls: false,
    authMethod: "password",
    prerequisite:
      "Requires a paid Proton plan with Proton Mail Bridge installed and running on (or reachable from) this host."
  },
  "imap-icloud": {
    providerId: "imap-icloud",
    displayName: "iCloud Mail",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapTls: true,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpTls: true,
    authMethod: "password",
    prerequisite: "Generate an app-specific password at appleid.apple.com."
  },
  "imap-fastmail": {
    providerId: "imap-fastmail",
    displayName: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    imapTls: true,
    smtpHost: "smtp.fastmail.com",
    smtpPort: 465,
    smtpTls: true,
    authMethod: "password",
    prerequisite: "Generate an app password in Fastmail Settings → Privacy & Security."
  }
};

export const IMAP_PROVIDER_IDS = Object.keys(IMAP_PRESETS) as readonly string[];

export function getImapPreset(providerId: string): ImapPreset | undefined {
  return IMAP_PRESETS[providerId];
}
```

- [ ] **Step 4: Run it (passes)**

Run: `pnpm --filter @jarv1s/connectors test imap-presets`
Expected: PASS.

- [ ] **Step 5: Write the definitions seed migration**

`packages/connectors/sql/<NNNN+1>_connector_imap_definitions.sql` (mirror `0044`'s transient-policy seed because `connector_definitions` is FORCE RLS):

```sql
-- connector_definitions is FORCE ROW LEVEL SECURITY; seed under a transient migration-owner policy.
CREATE POLICY connector_definitions_imap_seed ON app.connector_definitions
  TO jarvis_migration_owner USING (true) WITH CHECK (true);

INSERT INTO app.connector_definitions (provider_id, provider_type, display_name, status, default_scopes)
VALUES
  ('imap-yahoo',    'imap', 'Yahoo Mail',            'available', ARRAY['email.read']::text[]),
  ('imap-proton',   'imap', 'Proton Mail (Bridge)',  'available', ARRAY['email.read']::text[]),
  ('imap-icloud',   'imap', 'iCloud Mail',           'available', ARRAY['email.read']::text[]),
  ('imap-fastmail', 'imap', 'Fastmail',              'available', ARRAY['email.read']::text[])
ON CONFLICT (provider_id) DO UPDATE SET
  provider_type = EXCLUDED.provider_type,
  display_name  = EXCLUDED.display_name,
  status        = EXCLUDED.status,
  default_scopes = EXCLUDED.default_scopes;

DROP POLICY connector_definitions_imap_seed ON app.connector_definitions;
```

> Note: `email.read` is the capability scope the Slice C RLS `imap`-insert branch will require (spec §6a). It is set here at connect time so Slice C needs no backfill.

- [ ] **Step 6: Register migration + add foundation row**

- `manifest.ts`: add `"<NNNN+1>_connector_imap_definitions.sql"` to `database.migrations`.
- `tests/integration/foundation.test.ts`: add `{ version: "<NNNN+1>", name: "<NNNN+1>_connector_imap_definitions.sql" }` in order.

- [ ] **Step 7: Add a seed integration assertion**

Append to `tests/integration/connectors-imap.test.ts` (file created fully in B6; if it doesn't exist yet, create it with this one test now):

```ts
it("seeds the four imap provider definitions readable by any actor", async () => {
  await resetFoundationDatabase();
  const appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  const dataContext = new DataContextRunner(appDb);
  const rows = await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: "req:a" },
    (db) => new ConnectorsRepository().listProviders(db)
  );
  const imap = rows
    .filter((r) => r.providerType === "imap")
    .map((r) => r.providerId)
    .sort();
  expect(imap).toEqual(["imap-fastmail", "imap-icloud", "imap-proton", "imap-yahoo"]);
  await appDb.destroy();
});
```

- [ ] **Step 8: Run migration + seed tests**

Run: `pnpm test:integration` scoped to `foundation` and `connectors-imap`.
Expected: PASS — list matches, four `imap` definitions present.

- [ ] **Step 9: Commit**

```bash
git add packages/connectors/sql/<NNNN+1>_connector_imap_definitions.sql \
        packages/connectors/src/imap-presets.ts packages/connectors/src/imap-presets.test.ts \
        packages/connectors/src/manifest.ts tests/integration/foundation.test.ts \
        tests/integration/connectors-imap.test.ts
git commit -m "feat(connectors): seed imap preset definitions + in-code preset registry"
```

---

## Task B3: IMAP credential secret shape + validator

**Files:**

- Create: `packages/connectors/src/imap-secret.ts`
- Create: `packages/connectors/src/imap-secret.test.ts`

**Interfaces:**

- Consumes: `ConnectorSecretCipher` (`packages/connectors/src/crypto.ts`) — `encryptJson(value): EncryptedSecret`, `decryptJson(envelope): Record<string, unknown>`.
- Produces: `ImapConnectionSecret { kind: "imap-password"; providerId; username; password; imapHost; imapPort; imapTls; smtpHost; smtpPort; smtpTls }`; `decryptImapConnectionSecret(cipher, envelope): ImapConnectionSecret` (throws on wrong `kind`/shape).

- [ ] **Step 1: Write the roundtrip + rejection test (failing)**

`packages/connectors/src/imap-secret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ConnectorSecretCipher } from "./crypto.js";
import { Keyring } from "@jarv1s/db";
import { decryptImapConnectionSecret, type ImapConnectionSecret } from "./imap-secret.js";

const cipher = new ConnectorSecretCipher(
  Keyring.fromRawKeys([{ id: "k1", key: Buffer.alloc(32, 7) }])
);
const secret: ImapConnectionSecret = {
  kind: "imap-password",
  providerId: "imap-yahoo",
  username: "a@yahoo.com",
  password: "app-pw-123",
  imapHost: "imap.mail.yahoo.com",
  imapPort: 993,
  imapTls: true,
  smtpHost: "smtp.mail.yahoo.com",
  smtpPort: 465,
  smtpTls: true
};

describe("imap secret", () => {
  it("roundtrips through the connector cipher", () => {
    const envelope = cipher.encryptJson(secret);
    expect(decryptImapConnectionSecret(cipher, envelope)).toEqual(secret);
  });
  it("rejects a non-imap secret kind", () => {
    const envelope = cipher.encryptJson({ kind: "google-oauth", refreshToken: "x" });
    expect(() => decryptImapConnectionSecret(cipher, envelope)).toThrow(/imap-password/);
  });
  it("never serializes the password into the envelope JSON", () => {
    const envelope = cipher.encryptJson(secret);
    expect(JSON.stringify(envelope)).not.toContain("app-pw-123");
  });
});
```

> Confirm the real `Keyring` constructor name/signature against `packages/db/src/secret-cipher.ts` while implementing; adjust the test helper to match (the map shows `ConnectorSecretCipher extends JsonSecretCipher` taking a `Keyring`).

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter @jarv1s/connectors test imap-secret`
Expected: FAIL — `./imap-secret.js` missing.

- [ ] **Step 3: Implement the secret shape + validator**

`packages/connectors/src/imap-secret.ts`:

```ts
import type { ConnectorSecretCipher, EncryptedConnectorSecret } from "./crypto.js";

export interface ImapConnectionSecret extends Record<string, unknown> {
  readonly kind: "imap-password";
  readonly providerId: string;
  readonly username: string;
  readonly password: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapTls: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpTls: boolean;
}

export function decryptImapConnectionSecret(
  cipher: ConnectorSecretCipher,
  envelope: EncryptedConnectorSecret
): ImapConnectionSecret {
  const value = cipher.decryptJson(envelope) as Partial<ImapConnectionSecret>;
  if (value.kind !== "imap-password") {
    throw new Error(`Expected an imap-password connector secret, got kind=${String(value.kind)}`);
  }
  for (const field of ["providerId", "username", "password", "imapHost", "smtpHost"] as const) {
    if (typeof value[field] !== "string" || value[field] === "") {
      throw new Error(`imap-password secret missing required field: ${field}`);
    }
  }
  return value as ImapConnectionSecret;
}
```

- [ ] **Step 4: Run it (passes)**

Run: `pnpm --filter @jarv1s/connectors test imap-secret`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/imap-secret.ts packages/connectors/src/imap-secret.test.ts
git commit -m "feat(connectors): imap-password connector secret shape + validator"
```

---

## Task B4: IMAP/SMTP probe client + bounded-label mapping

**Files:**

- Create: `packages/connectors/src/imap-probe-client.ts`
- Create: `packages/connectors/src/imap-probe-client.test.ts`
- Modify: `packages/connectors/package.json` (add `imapflow`, `nodemailer`)

**Interfaces:**

- Produces: `type ImapProbeResult = "ok" | "auth_failed" | "tls_failed" | "unreachable"`; `interface ImapProbeClient { probe(input: ImapProbeInput): Promise<ImapProbeResult> }`; `LiveImapProbeClient implements ImapProbeClient`; `mapProbeError(err: unknown): Exclude<ImapProbeResult, "ok">` (exported for unit testing). `ImapProbeInput = { imapHost; imapPort; imapTls; smtpHost; smtpPort; smtpTls; username; password }`.

- [ ] **Step 1: Add dependencies**

```bash
pnpm --filter @jarv1s/connectors add imapflow nodemailer
pnpm --filter @jarv1s/connectors add -D @types/nodemailer
```

- [ ] **Step 2: Write the error-mapping test (failing)**

`packages/connectors/src/imap-probe-client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapProbeError } from "./imap-probe-client.js";

describe("mapProbeError", () => {
  it("maps auth rejections to auth_failed", () => {
    expect(mapProbeError({ authenticationFailed: true })).toBe("auth_failed");
    expect(mapProbeError({ responseText: "[AUTHENTICATIONFAILED] Invalid credentials" })).toBe(
      "auth_failed"
    );
  });
  it("maps TLS errors to tls_failed", () => {
    expect(mapProbeError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" })).toBe("tls_failed");
  });
  it("maps connection/DNS errors to unreachable", () => {
    expect(mapProbeError({ code: "ECONNREFUSED" })).toBe("unreachable");
    expect(mapProbeError({ code: "ENOTFOUND" })).toBe("unreachable");
    expect(mapProbeError(new Error("anything else"))).toBe("unreachable");
  });
  it("never returns the raw error text", () => {
    const result = mapProbeError({ responseText: "login failed for user secret@x.com pw=hunter2" });
    expect(["auth_failed", "tls_failed", "unreachable"]).toContain(result);
  });
});
```

- [ ] **Step 3: Run it (fails)**

Run: `pnpm --filter @jarv1s/connectors test imap-probe-client`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement the probe client**

`packages/connectors/src/imap-probe-client.ts`:

```ts
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export type ImapProbeResult = "ok" | "auth_failed" | "tls_failed" | "unreachable";

export interface ImapProbeInput {
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapTls: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpTls: boolean;
  readonly username: string;
  readonly password: string;
}

export interface ImapProbeClient {
  probe(input: ImapProbeInput): Promise<ImapProbeResult>;
}

/** Map any IMAP/SMTP error to a bounded label. The raw error is intentionally discarded
 *  so credentials / server transcripts never reach a caller or a log. */
export function mapProbeError(err: unknown): Exclude<ImapProbeResult, "ok"> {
  const e = (err ?? {}) as { code?: string; authenticationFailed?: boolean; responseText?: string };
  const text = typeof e.responseText === "string" ? e.responseText.toUpperCase() : "";
  if (
    e.authenticationFailed ||
    text.includes("AUTHENTICATIONFAILED") ||
    text.includes("INVALID CREDENTIALS")
  ) {
    return "auth_failed";
  }
  if (typeof e.code === "string" && e.code.startsWith("ERR_TLS")) return "tls_failed";
  if (
    e.code === "ECONNREFUSED" ||
    e.code === "ENOTFOUND" ||
    e.code === "ETIMEDOUT" ||
    e.code === "EHOSTUNREACH"
  ) {
    return "unreachable";
  }
  return "unreachable";
}

export class LiveImapProbeClient implements ImapProbeClient {
  async probe(input: ImapProbeInput): Promise<ImapProbeResult> {
    // 1) IMAP login.
    const imap = new ImapFlow({
      host: input.imapHost,
      port: input.imapPort,
      secure: input.imapTls,
      auth: { user: input.username, pass: input.password },
      logger: false
    });
    try {
      await imap.connect();
      await imap.logout();
    } catch (err) {
      try {
        await imap.close();
      } catch {
        /* already closed */
      }
      return mapProbeError(err);
    }
    // 2) SMTP login.
    const transport = nodemailer.createTransport({
      host: input.smtpHost,
      port: input.smtpPort,
      secure: input.smtpTls,
      auth: { user: input.username, pass: input.password }
    });
    try {
      await transport.verify();
    } catch (err) {
      return mapProbeError(err);
    } finally {
      transport.close();
    }
    return "ok";
  }
}
```

- [ ] **Step 5: Run it (passes)**

Run: `pnpm --filter @jarv1s/connectors test imap-probe-client`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/imap-probe-client.ts packages/connectors/src/imap-probe-client.test.ts \
        packages/connectors/package.json pnpm-lock.yaml
git commit -m "feat(connectors): imap/smtp probe client with bounded-label error mapping"
```

---

## Task B5: GreenMail CI container

**Files:**

- Modify: `infra/docker-compose.yml`
- Modify: `tests/integration/test-database.ts` (or the env module) to read `JARVIS_TEST_IMAP_*`

**Interfaces:**

- Produces: a reachable IMAP (`:3143`) + SMTP (`:3025`) GreenMail server in CI, plus `JARVIS_TEST_IMAP_HOST/PORT/SMTP_PORT/USER/PASSWORD` env for tests. GreenMail auto-creates accounts on first login, so any `user:password` works.

- [ ] **Step 1: Add the GreenMail service**

In `infra/docker-compose.yml`, alongside `postgres`:

```yaml
greenmail:
  image: greenmail/standalone:2.1.0
  environment:
    # Non-TLS IMAP/SMTP on high ports; auto-create users on login.
    GREENMAIL_OPTS: "-Dgreenmail.setup.test.imap -Dgreenmail.setup.test.smtp -Dgreenmail.auth.disabled=false -Dgreenmail.users.login=email"
  ports:
    - "3143:3143" # IMAP
    - "3025:3025" # SMTP
  healthcheck:
    test: ["CMD", "sh", "-c", "nc -z localhost 3143 && nc -z localhost 3025"]
    interval: 5s
    timeout: 3s
    retries: 20
```

> Verify the exact port/option names against the GreenMail standalone image tag chosen; GreenMail's default test ports are IMAP `3143` / SMTP `3025`. Pin the tag.

- [ ] **Step 2: Wire the test env**

Add to the integration test env resolver (where `JARVIS_*_DATABASE_URL` are read) defaults:

```ts
export const testImap = {
  host: process.env.JARVIS_TEST_IMAP_HOST ?? "127.0.0.1",
  imapPort: Number(process.env.JARVIS_TEST_IMAP_PORT ?? 3143),
  smtpPort: Number(process.env.JARVIS_TEST_IMAP_SMTP_PORT ?? 3025),
  username: process.env.JARVIS_TEST_IMAP_USER ?? "probe@greenmail.test",
  password: process.env.JARVIS_TEST_IMAP_PASSWORD ?? "probe-pw"
};
```

- [ ] **Step 3: Verify GreenMail comes up**

Run: `docker compose -f infra/docker-compose.yml up -d greenmail && docker compose -f infra/docker-compose.yml ps`
Expected: `greenmail` healthy. Then `nc -z localhost 3143 && echo IMAP_OK`.

- [ ] **Step 4: Commit**

```bash
git add infra/docker-compose.yml tests/integration/test-database.ts
git commit -m "test(connectors): add GreenMail IMAP/SMTP container for connector CI"
```

---

## Task B6: `ImapConnectionService` (testConnection + connect) + repository upsert

**Files:**

- Create: `packages/connectors/src/imap-connection.ts`
- Modify: `packages/connectors/src/repository.ts`
- Modify/Create: `tests/integration/connectors-imap.test.ts`

**Interfaces:**

- Consumes: `ImapProbeClient` (B4), `ConnectorSecretCipher` (B3), `ConnectorsRepository`, `getImapPreset` (B2), `DataContextDb`.
- Produces:
  - `ConnectorsRepository.upsertImapAccount(scopedDb, { providerId, scopes, encryptedSecret }): Promise<ConnectorAccountSafeRow>`
  - `ImapConnectionService` with `testConnection(scopedDb, input: ImapConnectInput): Promise<ImapProbeResult>` and `connect(scopedDb, input: ImapConnectInput): Promise<ConnectorAccountSafeRow>`, where `ImapConnectInput = { providerId: string; username: string; password: string }` (host/port come from the preset, never the client).

- [ ] **Step 1: Write the service + RLS test (failing)**

Add to `tests/integration/connectors-imap.test.ts`:

```ts
const fakeProbe = (result: ImapProbeResult): ImapProbeClient => ({ probe: async () => result });

it("connect encrypts the credential and creates an owner-scoped account", async () => {
  await resetFoundationDatabase();
  const appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  const dataContext = new DataContextRunner(appDb);
  const repository = new ConnectorsRepository();
  const cipher = new ConnectorSecretCipher(
    Keyring.fromRawKeys([{ id: "k1", key: Buffer.alloc(32, 7) }])
  );
  const service = new ImapConnectionService({ repository, cipher, probeClient: fakeProbe("ok") });

  const account = await dataContext.withDataContext(
    { actorUserId: ids.userA, requestId: "req:a" },
    (db) =>
      service.connect(db, { providerId: "imap-yahoo", username: "a@yahoo.com", password: "app-pw" })
  );
  expect(account.providerId).toBe("imap-yahoo");
  expect(JSON.stringify(account)).not.toContain("app-pw"); // no secret in the safe row

  // userB cannot see userA's account (RLS).
  const seenByB = await dataContext.withDataContext(
    { actorUserId: ids.userB, requestId: "req:b" },
    (db) => repository.listAccounts(db)
  );
  expect(seenByB.find((r) => r.id === account.id)).toBeUndefined();
  await appDb.destroy();
});

it("connect refuses when the probe is not ok", async () => {
  await resetFoundationDatabase();
  const appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  const dataContext = new DataContextRunner(appDb);
  const service = new ImapConnectionService({
    repository: new ConnectorsRepository(),
    cipher: new ConnectorSecretCipher(
      Keyring.fromRawKeys([{ id: "k1", key: Buffer.alloc(32, 7) }])
    ),
    probeClient: fakeProbe("auth_failed")
  });
  await expect(
    dataContext.withDataContext({ actorUserId: ids.userA, requestId: "req:a" }, (db) =>
      service.connect(db, { providerId: "imap-yahoo", username: "a@yahoo.com", password: "bad" })
    )
  ).rejects.toThrow(/auth_failed/);
  await appDb.destroy();
});
```

Add a GreenMail-backed live probe test (real `LiveImapProbeClient` against `testImap`):

```ts
it("LiveImapProbeClient returns ok against GreenMail", async () => {
  const result = await new LiveImapProbeClient().probe({
    imapHost: testImap.host,
    imapPort: testImap.imapPort,
    imapTls: false,
    smtpHost: testImap.host,
    smtpPort: testImap.smtpPort,
    smtpTls: false,
    username: testImap.username,
    password: testImap.password
  });
  expect(result).toBe("ok");
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm test:integration` scoped to `connectors-imap`.
Expected: FAIL — `ImapConnectionService` / `upsertImapAccount` missing.

- [ ] **Step 3: Add the repository upsert**

In `packages/connectors/src/repository.ts` (mirror `upsertGoogleAccount` at line ~294):

```ts
import { IMAP_PROVIDER_IDS } from "./imap-presets.js";

// inside ConnectorsRepository:
async upsertImapAccount(
  scopedDb: DataContextDb,
  input: { providerId: string; scopes: string[]; encryptedSecret: EncryptedConnectorSecret },
): Promise<ConnectorAccountSafeRow> {
  assertDataContextDb(scopedDb);
  if (!IMAP_PROVIDER_IDS.includes(input.providerId)) {
    throw new Error(`Unknown imap provider_id: ${input.providerId}`);
  }
  const existing = await scopedDb
    .selectFrom("connector_accounts")
    .select(["id"])
    .where("provider_id", "=", input.providerId)
    .executeTakeFirst();
  if (existing) {
    return this.updateAccount(scopedDb, existing.id, {
      scopes: input.scopes, status: "active", encryptedSecret: input.encryptedSecret,
    });
  }
  return this.createAccount(scopedDb, {
    providerId: input.providerId, scopes: input.scopes, status: "active",
    encryptedSecret: input.encryptedSecret,
  });
}
```

> Match the exact `createAccount`/`updateAccount` signatures present in the file; the map confirms `createAccount(scopedDb, input)` returns `ConnectorAccountSafeRow` and sets `owner_user_id` via `app.current_actor_user_id()`.

- [ ] **Step 4: Implement the service**

`packages/connectors/src/imap-connection.ts`:

```ts
import type { DataContextDb } from "@jarv1s/db";
import { assertDataContextDb } from "@jarv1s/db";
import type { ConnectorAccountSafeRow } from "@jarv1s/shared";
import type { ConnectorsRepository } from "./repository.js";
import type { ConnectorSecretCipher } from "./crypto.js";
import type { ImapProbeClient, ImapProbeResult } from "./imap-probe-client.js";
import { getImapPreset } from "./imap-presets.js";
import type { ImapConnectionSecret } from "./imap-secret.js";

export interface ImapConnectInput {
  readonly providerId: string;
  readonly username: string;
  readonly password: string;
}

export interface ImapConnectionServiceDeps {
  readonly repository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly probeClient: ImapProbeClient;
}

export class ImapConnectionService {
  constructor(private readonly deps: ImapConnectionServiceDeps) {}

  async testConnection(scopedDb: DataContextDb, input: ImapConnectInput): Promise<ImapProbeResult> {
    assertDataContextDb(scopedDb);
    const preset = this.requirePreset(input.providerId);
    return this.deps.probeClient.probe({
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapTls: preset.imapTls,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpTls: preset.smtpTls,
      username: input.username,
      password: input.password
    });
  }

  async connect(
    scopedDb: DataContextDb,
    input: ImapConnectInput
  ): Promise<ConnectorAccountSafeRow> {
    const result = await this.testConnection(scopedDb, input);
    if (result !== "ok") {
      throw new Error(`imap connect probe failed: ${result}`);
    }
    const preset = this.requirePreset(input.providerId);
    const secret: ImapConnectionSecret = {
      kind: "imap-password",
      providerId: preset.providerId,
      username: input.username,
      password: input.password,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapTls: preset.imapTls,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpTls: preset.smtpTls
    };
    return this.deps.repository.upsertImapAccount(scopedDb, {
      providerId: preset.providerId,
      scopes: ["email.read"],
      encryptedSecret: this.deps.cipher.encryptJson(secret)
    });
  }

  private requirePreset(providerId: string) {
    const preset = getImapPreset(providerId);
    if (!preset) throw new Error(`Unknown imap provider_id: ${providerId}`);
    return preset;
  }
}
```

- [ ] **Step 5: Run the service + RLS + GreenMail tests**

Run: `pnpm test:integration` scoped to `connectors-imap` (GreenMail container up).
Expected: PASS — connect creates an owner-scoped account, no secret in the safe row, userB can't see it, bad probe rejects, live GreenMail probe returns `ok`.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/imap-connection.ts packages/connectors/src/repository.ts \
        tests/integration/connectors-imap.test.ts
git commit -m "feat(connectors): ImapConnectionService test+connect with owner-scoped encrypted creds"
```

---

## Task B7: HTTP routes — `POST /api/connectors/imap/test` + `/connect`

**Files:**

- Modify: `packages/connectors/src/routes.ts`
- Modify: `packages/connectors/src/manifest.ts` (routes array)
- Modify: `packages/shared/src/connectors-api.ts` (request/response schemas)
- Create: `tests/integration/connectors-imap-routes.test.ts`

**Interfaces:**

- Consumes: `ImapConnectionService` (B6), `resolveAccessContext`, `dataContext.withDataContext`, `serializeAccount`.
- Produces: `POST /api/connectors/imap/test` → `{ result: ImapProbeResult }`; `POST /api/connectors/imap/connect` → `201 { account }`. Body: `{ providerId, username, password }`. Both rate-limited (`oauthMax`, 1-minute window). Both require auth.

- [ ] **Step 1: Add request/response schemas to the shared contract**

In `packages/shared/src/connectors-api.ts` (mirror the `google*RouteSchema` block):

```ts
export interface ImapConnectRequest {
  providerId: string;
  username: string;
  password: string;
}
export interface ImapTestResult {
  result: "ok" | "auth_failed" | "tls_failed" | "unreachable";
}

export const imapConnectRequestSchema = {
  type: "object",
  required: ["providerId", "username", "password"],
  additionalProperties: false,
  properties: {
    providerId: {
      type: "string",
      enum: ["imap-yahoo", "imap-proton", "imap-icloud", "imap-fastmail"]
    },
    username: { type: "string", minLength: 1 },
    password: { type: "string", minLength: 1 }
  }
} as const;

export const imapTestRouteSchema = { body: imapConnectRequestSchema } as const;
export const imapConnectRouteSchema = { body: imapConnectRequestSchema } as const;
```

- [ ] **Step 2: Write the route test (failing)**

`tests/integration/connectors-imap-routes.test.ts` (mirror `connectors-google.test.ts` route harness):

```ts
it("rejects unauthenticated test-connection", async () => {
  const server = await buildImapTestServer({ probeResult: "ok" });
  const res = await server.inject({
    method: "POST",
    url: "/api/connectors/imap/test",
    payload: { providerId: "imap-yahoo", username: "a@y.com", password: "x" }
  });
  expect(res.statusCode).toBe(401);
});

it("returns the bounded probe label for an authed test", async () => {
  const server = await buildImapTestServer({ probeResult: "auth_failed" });
  const res = await server.inject({
    method: "POST",
    url: "/api/connectors/imap/test",
    headers: { authorization: "Bearer session-a" },
    payload: { providerId: "imap-yahoo", username: "a@y.com", password: "x" }
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ result: "auth_failed" });
});

it("creates an account on connect (201) and never echoes the password", async () => {
  const server = await buildImapTestServer({ probeResult: "ok" });
  const res = await server.inject({
    method: "POST",
    url: "/api/connectors/imap/connect",
    headers: { authorization: "Bearer session-a" },
    payload: { providerId: "imap-yahoo", username: "a@y.com", password: "super-secret-pw" }
  });
  expect(res.statusCode).toBe(201);
  expect(res.body).not.toContain("super-secret-pw");
});
```

> `buildImapTestServer` mirrors the google route harness: real Fastify, fake `resolveAccessContext` parsing `Bearer`, `ImapConnectionService` built with a `{ probe: async () => probeResult }` fake client, registered via `registerConnectorsRoutes`.

- [ ] **Step 3: Run it (fails)**

Run: `pnpm test:integration` scoped to `connectors-imap-routes`.
Expected: FAIL — routes not registered.

- [ ] **Step 4: Register the routes**

In `packages/connectors/src/routes.ts`, add `imapService?: ImapConnectionService` to `ConnectorsRoutesDependencies`, then (mirror `/google/complete`):

```ts
if (dependencies.imapService) {
  const imapService = dependencies.imapService;
  server.post(
    "/api/connectors/imap/test",
    {
      schema: imapTestRouteSchema,
      config: { rateLimit: { max: oauthMax, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = request.body as ImapConnectRequest;
      const result = await dependencies.dataContext.withDataContext(accessContext, (db) =>
        imapService.testConnection(db, body)
      );
      return reply.code(200).send({ result });
    }
  );

  server.post(
    "/api/connectors/imap/connect",
    {
      schema: imapConnectRouteSchema,
      config: { rateLimit: { max: oauthMax, timeWindow: "1 minute" } }
    },
    async (request, reply) => {
      const accessContext = await dependencies.resolveAccessContext(request);
      const body = request.body as ImapConnectRequest;
      const account = await dependencies.dataContext.withDataContext(accessContext, (db) =>
        imapService.connect(db, body)
      );
      return reply.code(201).send({ account: serializeAccount(account) });
    }
  );
}
```

Add the two routes to `manifest.ts` `routes` with `permissionId: "connectors.manage"`. Wire `imapService` where the connectors routes are constructed (same place `googleService` is built — construct with `repository`, `secretCipher`, and `new LiveImapProbeClient()`).

- [ ] **Step 5: Run it (passes)**

Run: `pnpm test:integration` scoped to `connectors-imap-routes`.
Expected: PASS — 401 unauth, 200 bounded label, 201 connect, no password echo.

- [ ] **Step 6: Full gate + commit**

Run: `pnpm verify:foundation` (lint + format:check + check:file-size + typecheck + test). Fix any file-size split (1000-line cap) or format issues.

```bash
git add packages/connectors/src/routes.ts packages/connectors/src/manifest.ts \
        packages/shared/src/connectors-api.ts tests/integration/connectors-imap-routes.test.ts
git commit -m "feat(connectors): imap test-connection + connect HTTP routes (rate-limited, authed)"
```

---

## Slice B Self-Review (run before handing off)

- [ ] **Spec coverage:** §4 (provider_id-as-preset) → B1/B2; §5 (encrypted creds, bounded Test-connection labels, no secret escape) → B3/B4/B7; §10 health → deferred per Global Constraints (Test-connection returns label; stored health in Slice C); §12 (GreenMail protocol harness, sanitizer tests) → B4/B5/B6. **Reads (§6/§7) are intentionally out of Slice B.**
- [ ] **Placeholder scan:** the only deliberate placeholders are `<NNNN>` migration numbers (must be computed post-rebase, per Global Constraints) — every code block is concrete.
- [ ] **Type consistency:** `ImapProbeResult` (B4) is the return type used by `ImapConnectionService` (B6) and the route response (B7); `ImapConnectionSecret.kind === "imap-password"` is written in B6 and validated in B3; `upsertImapAccount` signature matches between B6 repository and service call.
- [ ] **Verification before "done":** run full `pnpm verify:foundation` with a real exit code; do not trust a green subset.

---

## Roadmap — Slices C / D / E / F (each gets its own plan)

These are **not** in this plan; listed so michael knows the sequence and what each future plan covers.

- **Slice C (issue #642) — IMAP read + scheduled refresh.** Implement the `EmailReadProvider` for IMAP (rebase onto origin/main first — #640 added the seam, absent locally). Add the §6a email RLS migration (new `email_messages_insert`/`_update` policy allowing `provider_type='imap'` with the `email.read` scope guard, owner-equality verbatim — supersede `0068`, don't edit). Add the §7 `app.email_sync_state` table (`(connector_account_id, folder, uidvalidity) → last_seen_uid`). Generic recurring pg-boss refresh job → upsert `app.email_messages`; **wire Google onto the same scheduler** with the §6b guardrails (calendar reconciliation default-off, AI-summarization cap, quota guard, independent interval). Connection concurrency priority (§6: interactive ops > refresh; SMTP separate; ≤2 IMAP + 1 SMTP under Yahoo's 5-cap). Feature-grant gated. GreenMail integration tests for backfill/incremental/UIDVALIDITY-reset.
- **Slice D (NEW issue) — Send. DEPENDS ON #214.** Generalize `email-write-service.ts` behind `EmailWriteProvider`; IMAP impl = `APPEND` to `\Drafts` (draftReply) + SMTP submission + `APPEND` to `\Sent` (sendReply). Reuse #214 tools/confirmation/server-derived-recipient verbatim — only the backend differs.
- **Slice E (issue #643) — Onboarding UI.** Move Yahoo/Proton/iCloud/Fastmail out of `SOON_PROVIDERS` (`apps/web/src/onboarding/google-connector-step.tsx:29`) into an active connect flow (preset picker + username + app-password + Test-connection), reusing the `use-google-connect-flow.ts` pattern. Proton carries the Bridge prerequisite copy. Authored `jds-*` states only.
- **Slice F (deferred) — Outlook / XOAUTH2.** Add an `authMethod: "xoauth2"` preset + OAuth flow on the same seam (reuse `GoogleOAuthClient` shape); IMAP/SMTP login swaps `LOGIN`/`AUTH PLAIN` for `AUTH XOAUTH2`. No schema change.
