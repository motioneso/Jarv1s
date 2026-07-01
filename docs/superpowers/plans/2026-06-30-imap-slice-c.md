# IMAP Slice C — Read + Scheduled Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: drive this plan yourself, task by task, using
> `superpowers:test-driven-development`. The superpowers execution skills
> (`executing-plans`, `subagent-driven-development`) are disabled in this repo by design.

**Goal:** Fetch real messages over IMAP into `app.email_messages`, put IMAP accounts on a
per-account recurring pg-boss schedule, put Google on an equivalent recurring schedule, and
close the two correctness gaps (RLS insert policy, scope persistence) that block IMAP data
from ever becoming visible.

**Architecture:** Slices A (`EmailReadProvider` seam, PR #644) and B (IMAP connect/probe,
PR #646) are already merged to `main`. Slice C adds the concrete IMAP implementation of the
existing seam (`ImapEmailReadProvider`), a new `connectors.imap-sync` pg-boss queue whose
handler mirrors the email section of `runGoogleSync` (same `withSavepoint`/
`markSyncStarted`/`markSyncFinished`/`EmailRepository.upsertCachedMessage` pattern), and a
lazy per-key recurring-schedule reconciler (same shape as `packages/notes/src/schedule.ts`)
called from the IMAP connect/disconnect routes and — newly — from the Google connect/
disconnect routes too.

**Tech Stack:** `imapflow` (already a dep), `mailparser` (new dep, added this plan), pg-boss
`boss.schedule`/`unschedule`, Kysely, `@jarv1s/jobs` (`assertMetadataOnlyPayload`,
`registerDataContextWorker`).

## Global Constraints

- **Never edit an applied migration.** New migration file only. Global migration numbering
  (confirmed via `find . -path "*/sql/*.sql" | grep -oE '[0-9]{4}_'` across ALL modules) —
  current max is `0131` (`packages/connectors/sql/0131_connector_imap_definitions.sql`). This
  plan's migration is `0132`. **Re-check this max immediately before creating the migration
  file** (Task 3) in case another agent landed a migration since this plan was written —
  bump the number if so.
- **Metadata-only job payloads.** Every `boss.schedule()` / `sendJob()` payload is IDs + job
  kind only. Call `assertMetadataOnlyPayload()` before every `boss.schedule()` call (defense
  in depth — `schedule()` does not route through `sendJob`'s guard).
- **DataContextDb only.** All repository methods take a branded `DataContextDb`, opened via
  `scopedDb.db`, and start with `assertDataContextDb(scopedDb)`.
- **Secrets never escape.** The IMAP password lives only inside the decrypted
  `ImapConnectionSecret`, used in-process to open an `ImapFlow` connection. It must never be
  logged, put in a job payload, or put in `external_metadata`.
- **Provider-agnostic AI.** Not touched by this slice (no AI-facing code changes beyond
  reusing the existing `extractEmailSignals` seam as-is).
- **RLS FORCE ROW LEVEL SECURITY** stays on `app.email_messages`; the insert-policy change
  (Task 3) widens the `EXISTS` clause, it does not relax owner-scoping.
- Full local gate before every push: `pnpm format:check && pnpm lint && pnpm typecheck`, plus
  `pnpm verify:foundation` before wrap-up.

---

## Existing precedent this plan reuses verbatim (do not re-derive, just follow)

- Recurring schedule reconcile shape: `packages/notes/src/schedule.ts` — one `boss.schedule`/
  `unschedule` pair, keyed by an ID, `assertMetadataOnlyPayload` before schedule.
- Per-item SAVEPOINT isolation: `withSavepoint()` in `packages/connectors/src/sync-jobs.ts:200-227`
  — copy this exact function (or import it — it's not exported today; Task 7 exports it).
- Queue registration + worker fan-out: `registerConnectorsJobWorkers()` in
  `packages/connectors/src/sync-jobs.ts:549-625` and `GOOGLE_SYNC_QUEUE_DEFINITIONS` at
  `sync-jobs.ts:34-47`.
- Module wiring: `packages/module-registry/src/index.ts` — the connectors module entry passes
  `queueDefinitions: GOOGLE_SYNC_QUEUE_DEFINITIONS` and a `registerWorkers` function; both need
  to also cover the new IMAP queue.

---

### Task 1: Fix `upsertImapAccount` to persist real scopes

**Files:**
- Modify: `packages/connectors/src/repository.ts:340-365` (`upsertImapAccount`)
- Test: `tests/integration/connectors-imap.test.ts`

**Interfaces:**
- Consumes: `ConnectorsRepository.createAccount`/`updateAccount` (existing, unchanged
  signatures at `repository.ts:113-173`).
- Produces: `upsertImapAccount` now writes `scopes` = the connected preset's
  `connector_definitions.default_scopes` (seeded as `['email.read']` by migration `0131`),
  not `[]`. Later tasks (Task 2, Task 3's RLS check, Task 9's schedule gating) all depend on
  this being non-empty.

Today `upsertImapAccount` hardcodes `scopes: []` on both the create and update path, so every
connected IMAP account always evaluates `email: false` under `resolveEffectiveGrants` (Task 2)
regardless of the seeded `default_scopes`.

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/connectors-imap.test.ts` (follow the existing test's setup for
`withDataContext`/`ConnectorsRepository`/`createConnectorSecretCipher` in that file):

```typescript
it("persists the imap-proton preset's default_scopes on connect, not an empty array", async () => {
  const repo = new ConnectorsRepository();
  const cipher = createConnectorSecretCipher();
  const account = await dataContext.withDataContext(accessContext, (scopedDb) =>
    repo.upsertImapAccount(scopedDb, {
      providerId: "imap-proton",
      encryptedSecret: cipher.encryptJson({
        kind: "imap-password",
        providerId: "imap-proton",
        username: "user@proton.local",
        password: "secret",
        imapHost: "127.0.0.1",
        imapPort: 1143,
        imapTls: false,
        smtpHost: "127.0.0.1",
        smtpPort: 1025,
        smtpSecurity: "none"
      })
    })
  );
  expect(account.scopes).toEqual(["email.read"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/integration/connectors-imap.test.ts -t "persists the imap-proton preset"`
Expected: FAIL — `account.scopes` is `[]`, not `["email.read"]`.

- [ ] **Step 3: Implement — read `default_scopes` from `connector_definitions` inside `upsertImapAccount`**

In `packages/connectors/src/repository.ts`, replace the body of `upsertImapAccount`:

```typescript
async upsertImapAccount(
  scopedDb: DataContextDb,
  input: { providerId: string; encryptedSecret: EncryptedConnectorSecret }
): Promise<ConnectorAccountSafeRow> {
  assertDataContextDb(scopedDb);
  const definition = await scopedDb.db
    .selectFrom("app.connector_definitions")
    .select("default_scopes")
    .where("provider_id", "=", input.providerId)
    .executeTakeFirst();
  const scopes = definition?.default_scopes ?? [];

  const existing = await scopedDb.db
    .selectFrom("app.connector_accounts")
    .select("id")
    .where("provider_id", "=", input.providerId)
    .executeTakeFirst();
  if (existing) {
    const updated = await this.updateAccount(scopedDb, existing.id, {
      scopes,
      status: "active",
      encryptedSecret: input.encryptedSecret
    });
    if (!updated) throw new Error("Failed to update imap account");
    return updated;
  }
  return this.createAccount(scopedDb, {
    providerId: input.providerId,
    scopes,
    status: "active",
    encryptedSecret: input.encryptedSecret
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/integration/connectors-imap.test.ts -t "persists the imap-proton preset"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/repository.ts tests/integration/connectors-imap.test.ts
git commit -m "fix(connectors): persist real default_scopes on imap account upsert"
```

---

### Task 2: Recognize IMAP's `email.read` scope in feature-grant gating

**Files:**
- Modify: `packages/connectors/src/feature-grants.ts:46-54` (`accountHasEmailScope`)
- Test: `tests/unit/connectors-freshness.test.ts` is the existing precedent location for
  connectors unit tests without a DB — create a sibling file
  `tests/unit/connectors-feature-grants.test.ts`.

**Interfaces:**
- Consumes: none new.
- Produces: `accountHasEmailScope(scopes)` now returns `true` for `scopes.includes("email.read")`,
  so `resolveEffectiveGrants` (already calls this function, unchanged signature) reports
  `email: true` for a freshly-connected IMAP account with default-on grants — this is what
  makes IMAP-cached messages visible to chat/search/briefings per #501's existing gating.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/connectors-feature-grants.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { resolveEffectiveGrants } from "../../packages/connectors/src/feature-grants.js";

describe("resolveEffectiveGrants — imap email.read scope", () => {
  it("grants email for an account whose only scope is email.read", () => {
    const grants = resolveEffectiveGrants(["email.read"], null);
    expect(grants.email).toBe(true);
  });

  it("does not grant email for an account with no recognized scope", () => {
    const grants = resolveEffectiveGrants([], null);
    expect(grants.email).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-feature-grants.test.ts`
Expected: FAIL — first case returns `email: false`.

- [ ] **Step 3: Implement**

In `packages/connectors/src/feature-grants.ts`, add the constant and extend the function:

```typescript
const IMAP_EMAIL_READ_SCOPE = "email.read";

function accountHasEmailScope(scopes: readonly string[]): boolean {
  return (
    scopes.includes(GMAIL_SCOPE) ||
    scopes.includes(GMAIL_READONLY_SCOPE) ||
    scopes.includes(GMAIL_FULL_SCOPE) ||
    scopes.includes("gmail") ||
    scopes.includes("gmail.readonly") ||
    scopes.includes(IMAP_EMAIL_READ_SCOPE)
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-feature-grants.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/feature-grants.ts tests/unit/connectors-feature-grants.test.ts
git commit -m "feat(connectors): recognize imap email.read scope in feature-grant gating"
```

---

### Task 3: RLS migration — allow `provider_type = 'imap'` inserts into `app.email_messages`

**Files:**
- Create: `packages/email/sql/0132_email_imap_insert.sql` (re-check the global max first, per
  Global Constraints — bump the number if `0131` is no longer the max).
- Test: `tests/integration/connectors-imap.test.ts`

**Interfaces:**
- Consumes: `app.connector_accounts`, `app.connector_definitions` (unchanged schema).
- Produces: an `EmailRepository.upsertCachedMessage` call scoped to an IMAP
  `connector_account_id` now succeeds instead of raising a RLS policy violation.

Mirrors the existing `'google'` branch added by `0068` — gates on the account actually holding
the `email.read` scope, not just on `provider_type = 'imap'` alone (defense in depth: a
misconfigured account with an empty `scopes` array still cannot insert).

- [ ] **Step 1: Write the failing integration test**

Add to `tests/integration/connectors-imap.test.ts`:

```typescript
it("allows an email_messages insert for a provider_type='imap' account with email.read scope", async () => {
  const repo = new ConnectorsRepository();
  const cipher = createConnectorSecretCipher();
  const account = await dataContext.withDataContext(accessContext, (scopedDb) =>
    repo.upsertImapAccount(scopedDb, {
      providerId: "imap-proton",
      encryptedSecret: cipher.encryptJson({
        kind: "imap-password",
        providerId: "imap-proton",
        username: "user@proton.local",
        password: "secret",
        imapHost: "127.0.0.1",
        imapPort: 1143,
        imapTls: false,
        smtpHost: "127.0.0.1",
        smtpPort: 1025,
        smtpSecurity: "none"
      })
    })
  );
  const emailRepo = new EmailRepository();
  const message = await dataContext.withDataContext(accessContext, (scopedDb) =>
    emailRepo.upsertCachedMessage(scopedDb, {
      connectorAccountId: account.id,
      sender: "friend@example.com",
      subject: "hello",
      receivedAt: new Date().toISOString(),
      externalId: "imap:INBOX:1000:1"
    })
  );
  expect(message.id).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/integration/connectors-imap.test.ts -t "allows an email_messages insert for a provider_type='imap'"`
Expected: FAIL — Postgres raises a row-level security policy violation (42501) because
`0068`'s `email_messages_insert` `EXISTS` clause only matches `'email'` or `'google'`.

- [ ] **Step 3: Write the migration**

Create `packages/email/sql/0132_email_imap_insert.sql`:

```sql
-- Widen the email_messages INSERT policy (0068) to also accept provider_type='imap',
-- gated on the account holding the email.read scope (mirrors the 'google' + gmail.modify
-- branch already in 0068). Owner-equality and the calendar/select/update policies are
-- untouched — this migration only replaces the insert policy's EXISTS clause.

DROP POLICY IF EXISTS email_messages_insert ON app.email_messages;

CREATE POLICY email_messages_insert
ON app.email_messages
FOR INSERT
TO jarvis_app_runtime, jarvis_worker_runtime
WITH CHECK (
  app.current_actor_user_id() IS NOT NULL
  AND owner_user_id = app.current_actor_user_id()
  AND EXISTS (
    SELECT 1
    FROM app.connector_accounts accounts
    JOIN app.connector_definitions definitions
      ON definitions.provider_id = accounts.provider_id
    WHERE accounts.id = connector_account_id
      AND accounts.owner_user_id = app.current_actor_user_id()
      AND (
        definitions.provider_type = 'email'
        OR (
          definitions.provider_type = 'google'
          AND 'https://www.googleapis.com/auth/gmail.modify' = ANY (accounts.scopes)
        )
        OR (
          definitions.provider_type = 'imap'
          AND 'email.read' = ANY (accounts.scopes)
        )
      )
  )
);
```

- [ ] **Step 4: Run migrations, then run test to verify it passes**

Run: `pnpm db:migrate && pnpm --filter @jarv1s/connectors exec vitest run ../../tests/integration/connectors-imap.test.ts -t "allows an email_messages insert for a provider_type='imap'"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email/sql/0132_email_imap_insert.sql tests/integration/connectors-imap.test.ts
git commit -m "feat(email): allow imap-provider inserts into email_messages via RLS"
```

---

### Task 4: IMAP message-identity encoding (`folder:uidvalidity:uid` → `external_id`)

**Files:**
- Create: `packages/connectors/src/imap-message-key.ts`
- Test: `tests/unit/connectors-imap-message-key.test.ts`

**Interfaces:**
- Produces: `encodeImapExternalId(identity): string`, `decodeImapExternalId(externalId): ImapMessageIdentity | null`,
  `ImapMessageIdentity { folder: string; uidValidity: string; uid: number }`. Task 6
  (`ImapEmailReadProvider`) is the only consumer.

This is the mechanism that satisfies the spec's UIDVALIDITY-reset requirement (§5) passively:
because `uidValidity` is baked into `external_id`, a server-side UIDVALIDITY reset produces a
*different* `external_id` for the same UID going forward — old rows are simply never matched
again by the `ON CONFLICT (connector_account_id, external_id)` upsert, so no explicit
reset-detection logic is needed. `uidValidity` is kept as a `string` (not a `Number`) to avoid
any 32-bit/BigInt precision assumptions about IMAP's UIDVALIDITY value.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/connectors-imap-message-key.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import {
  decodeImapExternalId,
  encodeImapExternalId
} from "../../packages/connectors/src/imap-message-key.js";

describe("imap message key encoding", () => {
  it("round-trips folder/uidValidity/uid", () => {
    const encoded = encodeImapExternalId({ folder: "INBOX", uidValidity: "1719700000", uid: 42 });
    expect(decodeImapExternalId(encoded)).toEqual({
      folder: "INBOX",
      uidValidity: "1719700000",
      uid: 42
    });
  });

  it("escapes a folder name containing a colon so decode is unambiguous", () => {
    const encoded = encodeImapExternalId({
      folder: "Archive:2026",
      uidValidity: "1",
      uid: 1
    });
    expect(decodeImapExternalId(encoded)?.folder).toBe("Archive:2026");
  });

  it("produces a different external_id for the same uid under a different uidValidity", () => {
    const before = encodeImapExternalId({ folder: "INBOX", uidValidity: "1", uid: 42 });
    const after = encodeImapExternalId({ folder: "INBOX", uidValidity: "2", uid: 42 });
    expect(before).not.toBe(after);
  });

  it("returns null for a non-imap external_id", () => {
    expect(decodeImapExternalId("gmail-message-id-123")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-imap-message-key.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/connectors/src/imap-message-key.ts`:

```typescript
const IMAP_EXTERNAL_ID_PREFIX = "imap:";

export interface ImapMessageIdentity {
  readonly folder: string;
  readonly uidValidity: string;
  readonly uid: number;
}

/**
 * Encode an IMAP message's (folder, UIDVALIDITY, UID) identity into the flat `external_id`
 * text column. The folder is percent-encoded so a folder name containing ":" cannot be
 * confused with the field separator.
 */
export function encodeImapExternalId(identity: ImapMessageIdentity): string {
  return `${IMAP_EXTERNAL_ID_PREFIX}${encodeURIComponent(identity.folder)}:${identity.uidValidity}:${identity.uid}`;
}

export function decodeImapExternalId(externalId: string): ImapMessageIdentity | null {
  if (!externalId.startsWith(IMAP_EXTERNAL_ID_PREFIX)) return null;
  const rest = externalId.slice(IMAP_EXTERNAL_ID_PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) return null;
  const [encodedFolder, uidValidity, uidStr] = parts;
  const uid = Number(uidStr);
  if (!Number.isInteger(uid) || uidValidity.length === 0) return null;
  return { folder: decodeURIComponent(encodedFolder), uidValidity, uid };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-imap-message-key.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/imap-message-key.ts tests/unit/connectors-imap-message-key.test.ts
git commit -m "feat(connectors): encode imap message identity into external_id"
```

---

### Task 5: Widen `EmailReadProvider` to a generic credential type

**Files:**
- Modify: `packages/connectors/src/email-read-provider.ts`

**Interfaces:**
- Produces: `EmailReadProvider<TCredential = string>` — `GoogleEmailReadProvider` keeps
  implementing `EmailReadProvider` (defaults to `EmailReadProvider<string>`, source-compatible,
  zero call-site changes). Task 6's `ImapEmailReadProvider` implements
  `EmailReadProvider<ImapConnectionSecret>`.

Today the interface hardcodes `accessToken: string` for the credential parameter. IMAP has no
access token — it needs the full decrypted `ImapConnectionSecret` object. A default generic
parameter keeps every existing Google call site (`sync-jobs.ts`, which references
`GoogleEmailReadProvider` concretely, never the bare interface) compiling unchanged.

- [ ] **Step 1: Modify the interface**

In `packages/connectors/src/email-read-provider.ts`, replace the interface:

```typescript
export interface EmailReadProvider<TCredential = string> {
  listFolders(credential: TCredential): Promise<string[]>;
  listMessageKeys(
    credential: TCredential,
    folder: string,
    sinceKey?: string
  ): Promise<MailMessageKey[]>;
  getMessage(credential: TCredential, key: MailMessageKey): Promise<ParsedEmail>;
}
```

Leave `GoogleEmailReadProvider`'s `implements EmailReadProvider` as-is (no `<string>` needed —
it's the default).

- [ ] **Step 2: Typecheck to confirm no call-site breakage**

Run: `pnpm --filter @jarv1s/connectors typecheck`
Expected: PASS with zero errors (this step has no new test; it's a pure signature widening
verified by the type checker, not new behavior — confirmed safe because `GoogleEmailReadProvider`
and every caller reference the concrete class, never `EmailReadProvider` unparameterized).

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/src/email-read-provider.ts
git commit -m "refactor(connectors): make EmailReadProvider credential type generic"
```

---

### Task 6: `ImapEmailReadProvider` — real IMAP message fetch

**Files:**
- Modify: `packages/connectors/package.json` (add `mailparser` + `@types/mailparser`)
- Create: `packages/connectors/src/imap-email-read-provider.ts`
- Test: `tests/unit/connectors-imap-email-read-provider.test.ts`

**Interfaces:**
- Consumes: `ImapConnectionSecret` (`imap-secret.ts`), `encodeImapExternalId`/
  `decodeImapExternalId` (Task 4), `ParsedEmail` (`email-extract.ts`), `EmailReadProvider<TCredential>`
  (Task 5), `MailMessageKey` (`email-read-provider.ts`, unchanged shape — IMAP puts the fully
  encoded external_id into `MailMessageKey.id`, so no MailMessageKey shape change is needed).
- Produces: `ImapEmailReadProvider implements EmailReadProvider<ImapConnectionSecret>`,
  exported `IMAP_READ_WINDOW_DAYS = 30` (mirrors Google's `newer_than:30d`).

The IMAP client is injected via an optional constructor param so unit tests use a fake instead
of a real socket (real-server behavior is exercised later, at wrap-up, against the loopback
Proton Bridge stub already used by `imap-probe-client.ts`'s integration tests — no new
integration harness needed for this plan).

- [ ] **Step 1: Add the `mailparser` dependency**

In `packages/connectors/package.json`, add to `dependencies`: `"mailparser": "^3.7.5"`, and to
`devDependencies`: `"@types/mailparser": "^3.4.7"`. Then run:

Run: `pnpm install`
Expected: lockfile updates, `mailparser` resolves under `packages/connectors/node_modules`.

- [ ] **Step 2: Write the failing unit test**

Create `tests/unit/connectors-imap-email-read-provider.test.ts`:

```typescript
import { describe, expect, it } from "vitest";

import { ImapEmailReadProvider } from "../../packages/connectors/src/imap-email-read-provider.js";
import type { ImapConnectionSecret } from "../../packages/connectors/src/imap-secret.js";

const SECRET: ImapConnectionSecret = {
  kind: "imap-password",
  providerId: "imap-proton",
  username: "user@proton.local",
  password: "secret",
  imapHost: "127.0.0.1",
  imapPort: 1143,
  imapTls: false,
  smtpHost: "127.0.0.1",
  smtpPort: 1025,
  smtpSecurity: "none"
};

const RAW_MESSAGE = [
  "From: Alice <alice@example.com>",
  "To: user@proton.local",
  "Subject: Test subject",
  "Date: Mon, 01 Jun 2026 12:00:00 +0000",
  "",
  "Hello world"
].join("\r\n");

function makeFakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    connect: async () => undefined,
    logout: async () => undefined,
    close: async () => undefined,
    list: async () => [{ path: "INBOX" }, { path: "Archive" }],
    mailboxOpen: async () => ({ uidValidity: 1719700000n, exists: 1 }),
    search: async () => [1, 2],
    fetchOne: async () => ({ uid: 1, source: Buffer.from(RAW_MESSAGE) }),
    ...overrides
  };
}

describe("ImapEmailReadProvider", () => {
  it("lists real mailbox paths via list()", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    const folders = await provider.listFolders(SECRET);
    expect(folders).toEqual(["INBOX", "Archive"]);
  });

  it("encodes folder+uidValidity+uid into each key's id", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    const keys = await provider.listMessageKeys(SECRET, "INBOX");
    expect(keys).toEqual([
      { folder: "INBOX", id: "imap:INBOX:1719700000:1" },
      { folder: "INBOX", id: "imap:INBOX:1719700000:2" }
    ]);
  });

  it("fetches and parses a message body/headers by decoding the key", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    const parsed = await provider.getMessage(SECRET, {
      folder: "INBOX",
      id: "imap:INBOX:1719700000:1"
    });
    expect(parsed.externalId).toBe("imap:INBOX:1719700000:1");
    expect(parsed.subject).toBe("Test subject");
    expect(parsed.from).toContain("alice@example.com");
    expect(parsed.body).toContain("Hello world");
  });

  it("throws on a malformed key rather than silently fetching the wrong message", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    await expect(
      provider.getMessage(SECRET, { folder: "INBOX", id: "not-an-imap-key" })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-imap-email-read-provider.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/connectors/src/imap-email-read-provider.ts`:

```typescript
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type { ParsedEmail } from "./email-extract.js";
import type { EmailReadProvider, MailMessageKey } from "./email-read-provider.js";
import { decodeImapExternalId, encodeImapExternalId } from "./imap-message-key.js";
import type { ImapConnectionSecret } from "./imap-secret.js";

/** Mirrors Google's `newer_than:30d` sync query — bounds the fetch window (spec §7a). */
export const IMAP_READ_WINDOW_DAYS = 30;
export const IMAP_DEFAULT_FOLDER = "INBOX";

/** Minimal subset of ImapFlow this provider needs — narrowed for testability (fakes in tests). */
export interface ImapFlowLike {
  connect(): Promise<unknown>;
  logout(): Promise<void>;
  close(): void | Promise<void>;
  list(): Promise<Array<{ path: string }>>;
  mailboxOpen(
    path: string,
    opts?: { readOnly?: boolean }
  ): Promise<{ uidValidity: bigint | number | string }>;
  search(query: Record<string, unknown>, opts: { uid: boolean }): Promise<number[] | false>;
  fetchOne(
    range: string,
    query: Record<string, unknown>,
    opts: { uid: boolean }
  ): Promise<{ uid: number; source?: Buffer } | false>;
}

export type ImapClientFactory = (secret: ImapConnectionSecret) => ImapFlowLike;

function defaultClientFactory(secret: ImapConnectionSecret): ImapFlowLike {
  return new ImapFlow({
    host: secret.imapHost,
    port: secret.imapPort,
    secure: secret.imapTls,
    auth: { user: secret.username, pass: secret.password },
    logger: false
  }) as unknown as ImapFlowLike;
}

async function withImapClient<T>(
  factory: ImapClientFactory,
  secret: ImapConnectionSecret,
  fn: (client: ImapFlowLike) => Promise<T>
): Promise<T> {
  const client = factory(secret);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      await client.close();
    }
  }
}

/**
 * IMAP implementation of the provider-neutral EmailReadProvider seam (Slice A). Every method
 * takes the full decrypted ImapConnectionSecret as its credential — IMAP has no access token
 * to refresh, unlike Google (spec §9).
 */
export class ImapEmailReadProvider implements EmailReadProvider<ImapConnectionSecret> {
  constructor(private readonly clientFactory: ImapClientFactory = defaultClientFactory) {}

  async listFolders(secret: ImapConnectionSecret): Promise<string[]> {
    return withImapClient(this.clientFactory, secret, async (client) => {
      const entries = await client.list();
      return entries.map((entry) => entry.path);
    });
  }

  async listMessageKeys(secret: ImapConnectionSecret, folder: string): Promise<MailMessageKey[]> {
    return withImapClient(this.clientFactory, secret, async (client) => {
      const box = await client.mailboxOpen(folder, { readOnly: true });
      const since = new Date(Date.now() - IMAP_READ_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since }, { uid: true });
      if (!uids) return [];
      const uidValidity = String(box.uidValidity);
      return uids.map((uid) => ({
        folder,
        id: encodeImapExternalId({ folder, uidValidity, uid })
      }));
    });
  }

  async getMessage(secret: ImapConnectionSecret, key: MailMessageKey): Promise<ParsedEmail> {
    const identity = decodeImapExternalId(key.id);
    if (!identity) {
      throw new Error("Malformed IMAP message key");
    }
    return withImapClient(this.clientFactory, secret, async (client) => {
      await client.mailboxOpen(identity.folder, { readOnly: true });
      const message = await client.fetchOne(String(identity.uid), { uid: true, source: true }, {
        uid: true
      });
      if (!message || !message.source) {
        throw new Error("IMAP message not found or has no source");
      }
      const mail = await simpleParser(message.source);
      const recipients = [
        ...(mail.to
          ? (Array.isArray(mail.to) ? mail.to : [mail.to]).flatMap((a) =>
              a.value.map((v) => v.address ?? "")
            )
          : []),
        ...(mail.cc
          ? (Array.isArray(mail.cc) ? mail.cc : [mail.cc]).flatMap((a) =>
              a.value.map((v) => v.address ?? "")
            )
          : [])
      ].filter((addr) => addr.length > 0);

      return {
        externalId: key.id,
        historyId: null,
        subject: mail.subject ?? "(no subject)",
        from: mail.from?.text ?? "(unknown)",
        recipients,
        receivedAt: (mail.date ?? new Date()).toISOString(),
        labelIds: [],
        snippet: null,
        body: mail.text ?? mail.html ?? "",
        bodyTruncated: false
      };
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-imap-email-read-provider.test.ts`
Expected: PASS. If `mailparser`'s parsed `AddressObject` shape differs from the code above,
adjust the field access to match the installed version's actual type — this is exactly what
Step 4 catches.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/package.json packages/connectors/src/imap-email-read-provider.ts tests/unit/connectors-imap-email-read-provider.test.ts pnpm-lock.yaml
git commit -m "feat(connectors): implement ImapEmailReadProvider for real IMAP message fetch"
```

---

### Task 7: `runImapSync` job — fetch + cache into `app.email_messages`

**Files:**
- Create: `packages/connectors/src/imap-sync-jobs.ts`
- Modify: `packages/connectors/src/sync-jobs.ts` (export `withSavepoint`)
- Test: `tests/integration/connectors-imap.test.ts`

**Interfaces:**
- Consumes: `withSavepoint` (now exported from `sync-jobs.ts`), `ImapEmailReadProvider` (Task 6),
  `decryptImapConnectionSecret` (`imap-secret.ts`), `EmailRepository.upsertCachedMessage`
  (unchanged), `ConnectorsRepository.markSyncStarted`/`markSyncFinished` (unchanged — both
  already take a plain `accountId: string`, no Google-specific typing).
- Produces: `IMAP_SYNC_QUEUE = "connectors.imap-sync"`, `IMAP_SYNC_QUEUE_DEFINITIONS`,
  `ImapSyncPayload { connectorAccountId: string }`, `runImapSync(scopedDb, connectorAccountId, deps)`,
  `registerImapSyncWorker(boss, deps)`. Task 8 wires these into module-registry.

Only the email section of `runGoogleSync` is relevant to IMAP (no calendar concept). IMAP has
no token to refresh, so there is no `withTokenRetry` equivalent — auth failure is a single
try/catch around the whole run, recorded via `markSyncFinished({status: "failed", error: "auth-error"})`
exactly like Google's auth-failure path.

- [ ] **Step 1: Export `withSavepoint` from `sync-jobs.ts`**

In `packages/connectors/src/sync-jobs.ts`, change `async function withSavepoint<T>(` to
`export async function withSavepoint<T>(`. No behavior change.

- [ ] **Step 2: Write the failing integration test**

Add to `tests/integration/connectors-imap.test.ts` (uses a fake `ImapEmailReadProvider` client
factory the same way Task 6's unit test does, but drives the real `runImapSync` against a real
scoped transaction so the RLS/upsert path is exercised end-to-end):

```typescript
it("runImapSync caches a fetched message into app.email_messages", async () => {
  const repo = new ConnectorsRepository();
  const cipher = createConnectorSecretCipher();
  const account = await dataContext.withDataContext(accessContext, (scopedDb) =>
    repo.upsertImapAccount(scopedDb, {
      providerId: "imap-proton",
      encryptedSecret: cipher.encryptJson({
        kind: "imap-password",
        providerId: "imap-proton",
        username: "user@proton.local",
        password: "secret",
        imapHost: "127.0.0.1",
        imapPort: 1143,
        imapTls: false,
        smtpHost: "127.0.0.1",
        smtpPort: 1025,
        smtpSecurity: "none"
      })
    })
  );

  const fakeProvider = {
    listFolders: async () => ["INBOX"],
    listMessageKeys: async () => [{ folder: "INBOX", id: "imap:INBOX:1:1" }],
    getMessage: async () => ({
      externalId: "imap:INBOX:1:1",
      historyId: null,
      subject: "hi",
      from: "friend@example.com",
      recipients: [],
      receivedAt: new Date().toISOString(),
      labelIds: [],
      snippet: null,
      body: "body",
      bodyTruncated: false
    })
  };

  const result = await dataContext.withDataContext(accessContext, (scopedDb) =>
    runImapSync(scopedDb, account.id, {
      repository: repo,
      cipher,
      emailReadProvider: fakeProvider,
      emailExtractDeps: {
        selectModel: async () => undefined,
        runChat: async () => ({ text: "" })
      }
    })
  );

  expect(result.emailUpserted).toBe(1);
  expect(result.errors).toEqual([]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/integration/connectors-imap.test.ts -t "runImapSync caches"`
Expected: FAIL — module `imap-sync-jobs.ts` does not exist.

- [ ] **Step 4: Implement**

Create `packages/connectors/src/imap-sync-jobs.ts`:

```typescript
import type { Job, PgBoss, WorkOptions } from "pg-boss";

import type { ActorScopedJobPayload, QueueDefinition } from "@jarv1s/jobs";
import { registerDataContextWorker } from "@jarv1s/jobs";
import type { ConnectorSyncStatus, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { EmailRepository } from "@jarv1s/email";

import { createConnectorSecretCipher, type ConnectorSecretCipher } from "./crypto.js";
import type { EmailExtractDeps } from "./email-extract.js";
import { extractEmailSignals } from "./email-extract.js";
import type { EmailReadProvider } from "./email-read-provider.js";
import { ImapEmailReadProvider, IMAP_DEFAULT_FOLDER } from "./imap-email-read-provider.js";
import { decryptImapConnectionSecret, type ImapConnectionSecret } from "./imap-secret.js";
import { ConnectorsRepository } from "./repository.js";
import { withSavepoint, resolveEmailMessageCap, type SyncLogger } from "./sync-jobs.js";

export const IMAP_SYNC_QUEUE = "connectors.imap-sync";

export const IMAP_SYNC_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: IMAP_SYNC_QUEUE,
    options: {
      // exclusive + keyed by connectorAccountId at enqueue time — one in-flight sync per
      // IMAP account, mirroring GOOGLE_SYNC_QUEUE's per-actor exclusivity.
      policy: "exclusive",
      retryLimit: 1,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  }
];

export interface ImapSyncPayload extends ActorScopedJobPayload {
  readonly kind: "imap-sync";
  readonly connectorAccountId: string;
  readonly idempotencyKey?: string;
}

export interface ImapSyncResult {
  readonly emailUpserted: number;
  readonly emailFailures: number;
  readonly errors: string[];
  readonly truncated: boolean;
}

const NOOP_LOGGER: SyncLogger = { warn: () => undefined, info: () => undefined };
const EMAIL_MESSAGE_CAP = resolveEmailMessageCap(process.env.JARVIS_EMAIL_SYNC_CAP);

export interface RunImapSyncDeps {
  readonly repository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly emailExtractDeps: EmailExtractDeps;
  readonly emailReadProvider?: EmailReadProvider<ImapConnectionSecret>;
  readonly emailRepository?: EmailRepository;
  readonly now?: () => Date;
  readonly logger?: SyncLogger;
}

export async function runImapSync(
  scopedDb: DataContextDb,
  connectorAccountId: string,
  deps: RunImapSyncDeps
): Promise<ImapSyncResult> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? NOOP_LOGGER;
  const emailRepo = deps.emailRepository ?? new EmailRepository();
  const provider = deps.emailReadProvider ?? new ImapEmailReadProvider();
  const errors: string[] = [];
  let emailUpserted = 0;
  let emailFailures = 0;
  let truncated = false;

  await deps.repository.markSyncStarted(scopedDb, connectorAccountId, now());

  let secret: ImapConnectionSecret;
  try {
    const account = await deps.repository.getActiveGoogleAccountSecret(scopedDb);
    // Not used for IMAP — see Task 8's follow-up on a dedicated getActiveImapAccountSecret.
    void account;
    throw new Error("unreachable");
  } catch {
    secret = undefined as never;
  }

  try {
    const secretRow = await deps.repository.getActiveImapAccountSecret(scopedDb, connectorAccountId);
    if (!secretRow) {
      await deps.repository.markSyncFinished(scopedDb, connectorAccountId, {
        finishedAt: now(),
        status: "failed",
        error: "no-active-connection",
        counts: { emailUpserted: 0, emailFailures: 0, truncated: false }
      });
      return { emailUpserted: 0, emailFailures: 0, errors: ["no-active-connection"], truncated: false };
    }
    secret = decryptImapConnectionSecret(deps.cipher, secretRow.encryptedSecret);
  } catch {
    logger.warn({ actorScoped: true, stage: "auth" }, "imap-sync auth failed");
    await deps.repository.markSyncFinished(scopedDb, connectorAccountId, {
      finishedAt: now(),
      status: "failed",
      error: "auth-error",
      counts: { emailUpserted: 0, emailFailures: 0, truncated: false }
    });
    return { emailUpserted: 0, emailFailures: 0, errors: ["auth-error"], truncated: false };
  }

  try {
    const keys = await provider.listMessageKeys(secret, IMAP_DEFAULT_FOLDER);
    const capped = keys.slice(0, EMAIL_MESSAGE_CAP);
    if (keys.length > capped.length) truncated = true;

    for (const key of capped) {
      try {
        const parsed = await provider.getMessage(secret, key);
        const extracted = await extractEmailSignals(parsed, deps.emailExtractDeps);
        await withSavepoint(scopedDb, (savepointDb) =>
          emailRepo.upsertCachedMessage(savepointDb, {
            connectorAccountId,
            externalId: parsed.externalId,
            sender: parsed.from,
            recipients: parsed.recipients,
            subject: parsed.subject,
            snippet: parsed.snippet,
            receivedAt: parsed.receivedAt,
            externalMetadata: {},
            summary: extracted.summary,
            signals: extracted.signals as Record<string, unknown>
          })
        );
        emailUpserted += 1;
      } catch (error) {
        emailFailures += 1;
        if (!errors.includes("email-message-error")) errors.push("email-message-error");
        logger.warn(
          { stage: "email-message", name: (error as Error).name },
          "imap-sync email message failed"
        );
      }
    }
  } catch (error) {
    logger.warn({ stage: "email", name: (error as Error).name }, "imap-sync email failed");
    errors.push("email-error");
  }

  const status: ConnectorSyncStatus = errors.length > 0 || truncated ? "partial" : "success";
  await deps.repository.markSyncFinished(scopedDb, connectorAccountId, {
    finishedAt: now(),
    status,
    error: errors[0] ?? null,
    counts: { emailUpserted, emailFailures, truncated }
  });

  return { emailUpserted, emailFailures, errors, truncated };
}

export interface RegisterImapSyncWorkerDeps {
  readonly dataContext: DataContextRunner;
  readonly workOptions?: WorkOptions;
  readonly onResult?: (job: Job<ImapSyncPayload>, result: ImapSyncResult) => void;
  readonly logger?: SyncLogger;
}

export async function registerImapSyncWorker(
  boss: PgBoss,
  deps: RegisterImapSyncWorkerDeps
): Promise<string[]> {
  const repository = new ConnectorsRepository();
  const cipher = createConnectorSecretCipher();

  const workId = await registerDataContextWorker<ImapSyncPayload, ImapSyncResult>(
    boss,
    IMAP_SYNC_QUEUE,
    deps.dataContext,
    async (job, scopedDb) => {
      const emailExtractDeps: EmailExtractDeps = job.data as unknown as EmailExtractDeps;
      const result = await runImapSync(scopedDb, job.data.connectorAccountId, {
        repository,
        cipher,
        emailExtractDeps,
        logger: deps.logger
      });
      deps.onResult?.(job, result);
      return result;
    },
    deps.workOptions
  );

  return [workId];
}
```

**Note for the builder:** the `getActiveGoogleAccountSecret` dead-code probe block above (the
first `try { ... throw new Error("unreachable") } catch { secret = undefined as never }`) is a
**placeholder artifact that must be deleted** — it exists only because this plan is written
before `ConnectorsRepository.getActiveImapAccountSecret` exists. **Delete that whole first
try/catch block** and add the real repository method in this same step:

In `packages/connectors/src/repository.ts`, add (near `getActiveGoogleAccountSecret`):

```typescript
async getActiveImapAccountSecret(
  scopedDb: DataContextDb,
  accountId: string
): Promise<{ id: string; encryptedSecret: EncryptedConnectorSecret } | undefined> {
  assertDataContextDb(scopedDb);
  const row = await scopedDb.db
    .selectFrom("app.connector_accounts")
    .select(["id", "encrypted_secret"])
    .where("id", "=", accountId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!row) return undefined;
  return { id: row.id, encryptedSecret: row.encrypted_secret as EncryptedConnectorSecret };
}
```

Also fix `registerImapSyncWorker`'s `emailExtractDeps: job.data as unknown as EmailExtractDeps`
placeholder — that cast is wrong; `EmailExtractDeps` must be built the same way
`registerConnectorsJobWorkers` builds it (AI router + credential decrypt), not derived from the
job payload. Copy the `emailExtractDeps` construction block verbatim from
`registerConnectorsJobWorkers` in `sync-jobs.ts:569-601` (it only needs `scopedDb`, not any
Google-specific state) into `registerImapSyncWorker` in place of that line.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/integration/connectors-imap.test.ts -t "runImapSync caches"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/imap-sync-jobs.ts packages/connectors/src/repository.ts packages/connectors/src/sync-jobs.ts tests/integration/connectors-imap.test.ts
git commit -m "feat(connectors): add runImapSync job handler and imap-sync queue"
```

---

### Task 8: Register the IMAP queue + worker in module-registry

**Files:**
- Modify: `packages/module-registry/src/index.ts` (connectors module entry, ~lines 473-485,
  952)

**Interfaces:**
- Consumes: `IMAP_SYNC_QUEUE_DEFINITIONS`, `registerImapSyncWorker` (Task 7).
- Produces: the worker's startup queue-existence guard (`apps/worker/src/worker.ts`) now sees
  `connectors.imap-sync` as a known queue; `getAllQueueDefinitions()` includes it.

- [ ] **Step 1: Update the connectors module entry**

In `packages/module-registry/src/index.ts`, find the connectors module's `BUILT_IN_MODULES`
entry (the one with `queueDefinitions: GOOGLE_SYNC_QUEUE_DEFINITIONS`). Import
`IMAP_SYNC_QUEUE_DEFINITIONS` and `registerImapSyncWorker` from
`@jarv1s/connectors`'s `imap-sync-jobs.js`, then change:

```typescript
queueDefinitions: [...GOOGLE_SYNC_QUEUE_DEFINITIONS, ...IMAP_SYNC_QUEUE_DEFINITIONS],
registerWorkers: async (boss, dependencies) => {
  const googleWorkIds = await registerConnectorsJobWorkers(boss, dependencies);
  const imapWorkIds = await registerImapSyncWorker(boss, dependencies);
  return [...googleWorkIds, ...imapWorkIds];
},
```

(Match whatever the existing `registerWorkers` closure's exact parameter/return shape is at
that call site — read the ~15 lines around it before editing, since this plan's summary of it
is approximate; keep the diff minimal.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @jarv1s/module-registry typecheck`
Expected: PASS

- [ ] **Step 3: Run the worker boot integration test (queue-existence guard)**

Run: `pnpm --filter @jarv1s/module-registry test` (or the repo's equivalent — check
`package.json` `scripts.test` in that package) and separately
`pnpm --filter worker typecheck` for `apps/worker`.
Expected: PASS — no "unknown queue" failure.

- [ ] **Step 4: Commit**

```bash
git add packages/module-registry/src/index.ts
git commit -m "feat(connectors): wire imap-sync queue and worker into module registry"
```

---

### Task 9: Per-account recurring schedule for IMAP (reconcile on connect/disconnect)

**Files:**
- Create: `packages/connectors/src/imap-schedule.ts`
- Modify: `packages/connectors/src/routes.ts` (imap connect route, ~line 186; add a
  disconnect/revoke route hook if one exists — check for an existing
  `/api/connectors/:accountId/revoke` or similar handler in `routes.ts` and hook the
  unschedule call there; if no such generic revoke route touches IMAP accounts specifically,
  hook `revokeAccount`'s call site instead)
- Test: `tests/unit/connectors-imap-schedule.test.ts`

**Interfaces:**
- Consumes: `assertMetadataOnlyPayload` (`@jarv1s/jobs`), `IMAP_SYNC_QUEUE` (Task 7).
- Produces: `reconcileImapAccountSchedule(boss, connectorAccountId, connected)`.

Keyed on `connectorAccountId` (not actor id) because one actor can connect multiple IMAP
presets simultaneously — unlike Google's single-account-per-actor model.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/connectors-imap-schedule.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import { reconcileImapAccountSchedule } from "../../packages/connectors/src/imap-schedule.js";

describe("reconcileImapAccountSchedule", () => {
  it("schedules a 15-min cron keyed by connectorAccountId when connected", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule, unschedule: vi.fn() };
    await reconcileImapAccountSchedule(boss as never, "account-1", true);
    expect(schedule).toHaveBeenCalledWith(
      "connectors.imap-sync",
      expect.any(String),
      { connectorAccountId: "account-1" },
      { tz: "UTC", key: "account-1" }
    );
  });

  it("unschedules when disconnected", async () => {
    const unschedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule: vi.fn(), unschedule };
    await reconcileImapAccountSchedule(boss as never, "account-1", false);
    expect(unschedule).toHaveBeenCalledWith("connectors.imap-sync", "account-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-imap-schedule.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/connectors/src/imap-schedule.ts`:

```typescript
import type { PgBoss } from "pg-boss";

import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import { IMAP_SYNC_QUEUE } from "./imap-sync-jobs.js";

export const IMAP_SYNC_CRON = "*/15 * * * *";
const IMAP_SYNC_TZ = "UTC";

/**
 * Reconcile the per-account IMAP sync schedule. Keyed by connectorAccountId (not actor id) —
 * one actor may connect several IMAP presets at once, each syncing on its own schedule row.
 * assertMetadataOnlyPayload is defense-in-depth (boss.schedule bypasses sendJob's guard).
 */
export async function reconcileImapAccountSchedule(
  boss: PgBoss,
  connectorAccountId: string,
  connected: boolean
): Promise<void> {
  if (connected) {
    const data = { connectorAccountId };
    assertMetadataOnlyPayload(data);
    await boss.schedule(IMAP_SYNC_QUEUE, IMAP_SYNC_CRON, data, {
      tz: IMAP_SYNC_TZ,
      key: connectorAccountId
    });
    return;
  }
  await boss.unschedule(IMAP_SYNC_QUEUE, connectorAccountId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-imap-schedule.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the connect route**

In `packages/connectors/src/routes.ts`, in the `/api/connectors/imap/connect` handler (around
line 197), after the account is created, call the reconciler best-effort (same try/catch-log
pattern as the existing Google sync-on-connect enqueue at lines 128-147):

```typescript
const account = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
  imapService.connect(scopedDb, input)
);
try {
  await reconcileImapAccountSchedule(dependencies.boss, account.id, true);
} catch (error) {
  request.log.warn(
    { event: "connectors.imap_schedule_reconcile_failed", name: (error as Error).name },
    "imap schedule reconcile failed; account is connected but will not auto-sync until reconnect"
  );
}
return reply.code(201).send({ account: serializeAccount(account) });
```

Add the import: `import { reconcileImapAccountSchedule } from "./imap-schedule.js";`

For the disconnect/revoke path: locate the route that calls `ConnectorsRepository.revokeAccount`
in `routes.ts` (grep `revokeAccount` in that file), and add
`await reconcileImapAccountSchedule(dependencies.boss, accountId, false)` after a successful
revoke, guarded the same best-effort way, but **only when the revoked account's
`provider_type === 'imap'`** (check the account row's `provider_type` before calling — do not
unschedule a Google account through this path).

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/imap-schedule.ts packages/connectors/src/routes.ts tests/unit/connectors-imap-schedule.test.ts
git commit -m "feat(connectors): reconcile per-account imap sync schedule on connect/disconnect"
```

---

### Task 10: Wire Google onto the same recurring-schedule shape

**Files:**
- Create: `packages/connectors/src/google-schedule.ts`
- Modify: `packages/connectors/src/routes.ts` (google complete route ~line 114, revoke route)
- Test: `tests/unit/connectors-google-schedule.test.ts`

**Interfaces:**
- Consumes: `assertMetadataOnlyPayload`, `GOOGLE_SYNC_QUEUE` (existing).
- Produces: `reconcileGoogleAccountSchedule(boss, actorUserId, connected)`. This is
  **additive** — the existing on-demand `sendJob(GOOGLE_SYNC_QUEUE, ...)` calls in
  `/api/connectors/google/complete` and `/api/connectors/google/sync` are unchanged; this task
  only adds the recurring cron alongside them, per the issue title ("wire Google onto same
  scheduler").

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/connectors-google-schedule.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

import { reconcileGoogleAccountSchedule } from "../../packages/connectors/src/google-schedule.js";

describe("reconcileGoogleAccountSchedule", () => {
  it("schedules a 15-min cron keyed by actorUserId when connected", async () => {
    const schedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule, unschedule: vi.fn() };
    await reconcileGoogleAccountSchedule(boss as never, "actor-1", true);
    expect(schedule).toHaveBeenCalledWith(
      "connectors.google-sync",
      expect.any(String),
      { actorUserId: "actor-1" },
      { tz: "UTC", key: "actor-1" }
    );
  });

  it("unschedules when disconnected", async () => {
    const unschedule = vi.fn().mockResolvedValue(undefined);
    const boss = { schedule: vi.fn(), unschedule };
    await reconcileGoogleAccountSchedule(boss as never, "actor-1", false);
    expect(unschedule).toHaveBeenCalledWith("connectors.google-sync", "actor-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-google-schedule.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/connectors/src/google-schedule.ts`:

```typescript
import type { PgBoss } from "pg-boss";

import { assertMetadataOnlyPayload } from "@jarv1s/jobs";

import { GOOGLE_SYNC_QUEUE } from "./sync-jobs.js";

export const GOOGLE_SYNC_CRON = "*/15 * * * *";
const GOOGLE_SYNC_TZ = "UTC";

/**
 * Additive recurring schedule for the Google sync queue, alongside the existing on-demand
 * sendJob triggers (connect + manual "Sync now"). Keyed by actorUserId — one Google account
 * per actor today (GoogleConnectionService is single-account), matching GOOGLE_SYNC_QUEUE's
 * existing per-actor singletonKey exclusivity.
 */
export async function reconcileGoogleAccountSchedule(
  boss: PgBoss,
  actorUserId: string,
  connected: boolean
): Promise<void> {
  if (connected) {
    const data = { actorUserId };
    assertMetadataOnlyPayload(data);
    await boss.schedule(GOOGLE_SYNC_QUEUE, GOOGLE_SYNC_CRON, data, {
      tz: GOOGLE_SYNC_TZ,
      key: actorUserId
    });
    return;
  }
  await boss.unschedule(GOOGLE_SYNC_QUEUE, actorUserId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-google-schedule.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into the google/complete route and the revoke route**

In `packages/connectors/src/routes.ts`, in `/api/connectors/google/complete` (around line
125-148), after the existing best-effort `sendJob` block, add a second best-effort call:

```typescript
try {
  await reconcileGoogleAccountSchedule(dependencies.boss, accessContext.actorUserId, true);
} catch (error) {
  request.log.warn(
    { event: "connectors.google_schedule_reconcile_failed", name: (error as Error).name },
    "google schedule reconcile failed; account is connected but will not auto-sync on schedule until reconnect"
  );
}
```

Add the import: `import { reconcileGoogleAccountSchedule } from "./google-schedule.js";`

In the same revoke route located for Task 9 (grep `revokeAccount` in `routes.ts`), add the
Google-side unschedule guarded on the revoked account's `provider_type === 'google'`:
`await reconcileGoogleAccountSchedule(dependencies.boss, accessContext.actorUserId, false)`.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/google-schedule.ts packages/connectors/src/routes.ts tests/unit/connectors-google-schedule.test.ts
git commit -m "feat(connectors): add recurring schedule for google sync alongside on-demand triggers"
```

---

### Task 11: Secret-sanitizer test — IMAP password never reaches a job payload

**Files:**
- Test: `tests/unit/connectors-imap-schedule.test.ts` (extend Task 9's file)

**Interfaces:**
- Consumes: `reconcileImapAccountSchedule` (Task 9), `assertMetadataOnlyPayload` (existing).

Direct proof (not just code-review) that the IMAP password can never serialize into a pg-boss
payload — required by the handoff's security-tier non-negotiables and spec §10.

- [ ] **Step 1: Write the test**

Add to `tests/unit/connectors-imap-schedule.test.ts`:

```typescript
it("never includes password/secret fields in the scheduled payload", async () => {
  const schedule = vi.fn().mockResolvedValue(undefined);
  const boss = { schedule, unschedule: vi.fn() };
  await reconcileImapAccountSchedule(boss as never, "account-1", true);
  const [, , payload] = schedule.mock.calls[0];
  expect(Object.keys(payload)).toEqual(["connectorAccountId"]);
  expect(JSON.stringify(payload)).not.toMatch(/password|secret/i);
});
```

- [ ] **Step 2: Run test to verify it passes (no implementation change expected)**

Run: `pnpm --filter @jarv1s/connectors exec vitest run ../../tests/unit/connectors-imap-schedule.test.ts`
Expected: PASS immediately — this test documents/locks in behavior Task 9 already provides
(`assertMetadataOnlyPayload` plus the payload literal only ever containing
`connectorAccountId`). If it fails, Task 9's implementation regressed and must be fixed before
continuing.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/connectors-imap-schedule.test.ts
git commit -m "test(connectors): lock in imap schedule payload is metadata-only"
```

---

## Self-Review

**Spec coverage** (`docs/superpowers/specs/2026-06-30-proton-mail-connector-spike-output.md`):
- §5 (data-shape / UIDVALIDITY identity) → Task 4 (encoding baked into `external_id`, reset
  handled passively).
- §6 (security/RLS) → Task 3 (RLS migration), Task 11 (payload sanitizer test), secret never
  leaves `imap-secret.ts`/`imap-email-read-provider.ts` in-process use.
- §7a (persist-to-cache into `app.email_messages`) → Task 7.
- §9 (architecture seam, generic credential) → Task 5, Task 6.
- §10 (verification plan) → integration tests in Tasks 1, 3, 7; unit tests in Tasks 2, 4, 6, 9,
  10, 11.
- Issue #642's "wire Google onto same scheduler" → Task 10.
- Slice B gaps discovered during premise verification (scopes bug, missing feature-grant
  recognition) → Tasks 1, 2 — both are hard blockers for Slice C's data ever becoming visible,
  so they're in-scope rather than deferred.

**Out of scope for this plan (explicitly, not silently dropped):**
- IMAP incremental skip-unchanged (Gmail's `historyId` optimization) — not built; every
  scheduled IMAP run re-fetches and idempotently re-upserts the capped window. Acceptable per
  the "don't build a full connector-sync framework" guardrail; a future slice can add a
  per-account high-water-mark marker if sync cost becomes a problem.
- A generic per-provider sync-framework abstraction unifying Google/IMAP — deliberately not
  built (guardrail); the two queues/handlers are parallel, not merged.
- SMTP/send — read-only scope, unchanged from the accepted spec.

**Placeholder scan:** none remaining — Task 7's Step 4 note explicitly calls out and resolves
the two placeholder-shaped fragments (dead-code probe block, wrong `emailExtractDeps` cast)
that exist only because Task 7 depends on a repository method added within the same step.

**Type consistency:** `ImapConnectionSecret` (Task 6/7), `MailMessageKey` (unchanged shape,
Task 4/6), `ImapSyncResult`/`ImapSyncPayload` (Task 7/8), `EmailReadProvider<TCredential>`
(Task 5/6) — all names match across every task that references them.

---

## Escalation note (for the coordinator, not part of the plan body)

Two items expand narrowly beyond a literal reading of the spec's Slice C bullet, surfaced
during premise verification:
1. Slice B shipped `upsertImapAccount` with a real scopes bug (always `[]`) and
   `feature-grants.ts` never recognized `email.read` — without fixing both (Tasks 1–2), IMAP
   messages would cache successfully but stay permanently invisible to chat/search/briefings.
   Treated as in-scope hard blockers, not separate follow-up issues.
2. "Wire Google onto same scheduler" (issue title) goes beyond the spec's Proton-only framing —
   Task 10 adds Google's recurring cron *additively*, keeping its existing on-demand triggers
   intact.
