# Generic IMAP Email Connector (Yahoo first; absorbs Proton) — Design Spec

**Status:** proposed — **Codex adversarial review complete; both BLOCKERs + all HIGH/MED findings
folded in** (2026-06-30). Awaiting Ben build go-decision.

**Codex review resolution (2026-06-30):** verified against source. BLOCKER-1 (`external_metadata`
column doesn't exist) → §4 now uses `provider_id`-as-preset + in-code registry, §7/§14 add an
`email_sync_state` table. BLOCKER-2 (`email_messages_insert` denies `imap`) → §6a + §14 require a new
email RLS migration. HIGH/MED: bounded Test-connection labels (§5), send-vs-refresh concurrency priority
(§6), `(folder,uidvalidity)` cursor (§7), threading normalization (§7), Google scheduler guardrails +
default-off calendar reconciliation (§6b), GreenMail re-scoped to "protocol harness" + per-preset smokes
(§12), migration count corrected to 4 (§14). Confirmed-correct by Codex: #214 recipient floor preserved
(§8); Yahoo app-password-over-IMAP still valid in 2026.
**Date:** 2026-06-30
**Owner:** Ben + Stanley (hive)
**GitHub:** Part of #270 (connector roadmap). Supersedes the Proton-bespoke build; folds in #641.
**Grounded on:** `origin/main` @ `6a84b4eb` (local `main` `b2e12ce4`)

**Supersedes / depends on (read, not remembered):**

- `docs/superpowers/specs/2026-06-30-proton-mail-connector-spike-output.md` — **superseded by this
  spec.** Its accepted decisions (§5 IMAP data-shape, §7a persist-to-read-cache, §9 `EmailReadProvider`
  seam, slices A/B) are carried forward here as the _generic_ foundation rather than Proton-specific.
- `docs/superpowers/specs/2026-06-18-additional-email-provider-connectors-spike.md` — the framing spike
  (#270): "extract only the seam the second provider proves." This spec is that extraction.
- `docs/superpowers/specs/2026-06-30-email-agency-slice.md` — the #214 email reply-agency trust model.
  **This spec depends on it** for send (`email.draftReply` / `email.sendReply`, server-derived recipient,
  destructive floor, preview-on-stream). Send here = the same two tools, one more provider backend.
- `packages/connectors/src/{oauth,google-connection,google-api-client,sync-jobs,live-tools,repository,
crypto,feature-grants}.ts` — the Google-specific connector this generalizes.
- `packages/email/src/repository.ts` + `app.email_messages` (migration `0012`) — the read-cache.

## 0. TL;DR

Build **one generic IMAP email connector** — a single transport (IMAP read + SMTP/`APPEND` write) with
providers as **configuration presets**, not bespoke code. Yahoo is provider #1; Proton (over Bridge),
iCloud, and Fastmail ship as additional presets on the same code path in v1. Outlook/Microsoft is
spec'd behind an `authMethod: 'xoauth2'` seam but deferred (it needs OAuth, not an app password). The
connector caches into the existing `app.email_messages` read-cache via a **scheduled pg-boss refresh
job** (which Google also adopts), gated by the existing per-account feature-grant model. Send reuses
the #214 agency trust model behind a provider-abstracted `EmailWriteProvider`. Tested end-to-end with
**GreenMail** (a self-hosted Docker IMAP+SMTP server) — no real provider accounts needed for CI.

## 1. Decision & scope

**v1 (this spec):**

- A generic **`imap`** connector provider type. Specific providers are **presets** (host/port/TLS,
  display name, SMTP endpoint, `authMethod`) in an in-code registry.
- **Wired presets:** Yahoo Mail, Proton (Bridge), iCloud, Fastmail — all **app-password over IMAP**.
- **Capabilities:** full **read + send**. Read = scheduled IMAP fetch → read-cache. Send = SMTP
  submission + draft-via-`APPEND`, behind the #214 agency confirmation model.
- **Scheduled refresh** (recurring pg-boss job) for IMAP **and** Google (Ben 2026-06-30: Google gains
  scheduled sync too — consciously overriding the Proton spike's "leave Google untouched" guardrail).

**Deferred (seam-ready, follow-up issues):**

- **Outlook / Hotmail / Microsoft 365** — requires OAuth2 `XOAUTH2`; consumer Microsoft removed both
  basic-auth IMAP and app passwords. Lands as a preset with `authMethod: 'xoauth2'` + an OAuth flow on
  the same seam. No schema change.
- Reply-all, new-compose to arbitrary recipients, attachments/HTML compose, calendar (IMAP has none).

**Gmail stays on its existing API connector** — not re-implemented over IMAP.

## 2. Why generic IMAP, and why now

Yahoo (verified mid-2026): basic password auth was killed (May 2024). Third-party access is either
**OAuth2 / XOAUTH2** (Yahoo's Mail developer program is effectively closed to new partners) or an
**app-specific password over standard IMAP** (`imap.mail.yahoo.com:993`). The app-password path is the
realistic one for a self-hosted tool. Crucially, that same `IMAP + app-password-or-XOAUTH2` model is how
iCloud, Fastmail, Proton (via Bridge), and (with XOAUTH2) Outlook all work. **One IMAP connector unlocks
the whole list.** The Proton spike independently arrived at the same `EmailReadProvider`/IMAP-credentials
seam; this spec generalizes it instead of building Proton bespoke (its branch `feat/641-proton-bridge-creds`
has zero commits — nothing wasted).

## 3. Architecture seams

```
                  ┌─────────────────────────────────────────────┐
                  │  Provider preset registry (in code, data)   │
                  │  yahoo | proton | icloud | fastmail [| outlook]
                  │  → host, port, tls, smtpHost, smtpPort,     │
                  │    displayName, authMethod: password|xoauth2│
                  └─────────────────────────────────────────────┘
                                   │
   ConnectorAuthFlow (generalized) │   EmailReadProvider          EmailWriteProvider
   start/validate/revoke + Test    │   listFolders                saveDraft (APPEND \Drafts)
   connection probe                │   listMessageKeys(folder,    send (SMTP submission +
        │                          │     sinceUid)                 APPEND \Sent)
        ▼                          │   getMessage(key)                  │
  app.connector_accounts           │        ▲                          ▼
  (AES-256-GCM creds blob,         │   ┌────┴─────┐            packages/email/
   owner-scoped RLS)               │   │ imapClient│            email-write-service.ts
                                   │   │ googleApi │            (provider-abstracted)
   scheduled pg-boss refresh ──────┴──►│ (existing)│
   (IMAP + Google) → upsert            └──────────┘
   app.email_messages (§7a, feature-grant gated)
```

- **`EmailReadProvider`** (from Proton spike §9): `listFolders`, `listMessageKeys(folder, sinceUid)`,
  `getMessage(key)` → provider-neutral parsed mail records. Google reads refactor behind it (Slice A,
  no behavior change). IMAP implements it via an IMAP client lib.
- **`EmailWriteProvider`** (new, generalizes `email-write-service.ts`): `saveDraft()`, `send()`. Gmail
  impl = `drafts.create` / `messages.send`; IMAP impl = `APPEND` to `\Drafts` / SMTP submission +
  `APPEND` to `\Sent`. The #214 trust model (tools, confirmation, recipient derivation) is unchanged
  and provider-agnostic.
- **`ConnectorAuthFlow`** generalized **only where it overlaps**. For password IMAP, "auth" = credential
  validation + Test-connection, not an OAuth redirect — don't force a fake OAuth shape (Proton spike §9).
- Provider-specific clients stay separate (Google API client vs IMAP client). **No connector plugin
  marketplace / framework** (guardrail #216).

## 4. Provider identity: generic `imap` provider type + preset = `provider_id`

**Corrected after Codex review:** `app.connector_accounts` has **no `external_metadata` column**
(columns: `id, provider_id, owner_user_id, scopes, status, encrypted_secret, revoked_at, ...`). So the
preset is **not** a metadata field — it is the **`provider_id`**, exactly how `google-calendar` /
`google-gmail` already coexist as distinct `provider_id`s sharing the `google` provider type.

- Migration adds a single `'imap'` value to `app.connector_provider_type` (two-file `ALTER TYPE ADD
VALUE` + use dance, mirroring `0043`→`0044`). `'google'` stays its own value.
- Each preset is a seeded **`app.connector_definitions` row**: `provider_id` (e.g. `imap-yahoo`,
  `imap-proton`, `imap-icloud`, `imap-fastmail`), `provider_type = 'imap'`, `display_name`,
  `default_scopes` (the email capability scope — see §5/§6). The account's `provider_id` IS the preset
  selection; no metadata column needed.
- **Connection parameters** (`imapHost/Port/Tls`, `smtpHost/Port/Tls`, `authMethod`, prerequisite copy)
  live in an **in-code preset registry keyed by `provider_id`** — pure config, version-controlled, not
  in the DB. Adding iCloud/Fastmail/Outlook = a registry entry **plus a one-line `connector_definitions`
  seed** (a tiny seed migration or idempotent `INSERT ... ON CONFLICT DO NOTHING`), **not** a schema
  change. Host/port are never secret, so registry-in-code is fine.
- Admin/health/onboarding UIs read `display_name` (DB) + the registry for the human label.

## 5. Auth & secret handling

- **Connect form** (no OAuth redirect for password presets): preset picker (prefills host/port/TLS +
  SMTP) → username/email + **app-specific password** → **"Test connection"** probe (opens IMAP, logs in,
  `LIST`, closes; opens SMTP, `EHLO`/auth, closes). Proton preset prefills Bridge localhost
  (`127.0.0.1:1143` / `:1025`).
- **Test-connection results are bounded enum labels only** — `ok | auth_failed | tls_failed |
unreachable` (Codex HIGH-3). Raw IMAP/SMTP library errors (which can embed command transcripts,
  usernames, or `AUTH` blobs) are **mapped to a label and never surfaced**; the underlying error is
  dropped, not logged verbatim. A test asserts raw transcripts / usernames / passwords / `AUTH` strings
  never reach HTTP responses **or logs** (the sanitizer test in §12 covers responses + logs, not just
  payloads/exports/prompts).
- **Secret at rest:** the app-password (and any SMTP-specific secret) live in **one AES-256-GCM
  encrypted blob** in `app.connector_accounts` (reuse `crypto.ts`), owner-scoped under existing RLS.
- **Secrets never escape:** the password is never in frontend responses, logs, pg-boss payloads, user
  exports, or AI prompts. Safe UI metadata = address, preset id, host:port, last-connect status — no
  secret material. A unit test asserts creds never serialize into payloads/exports/prompts.
- **XOAUTH2 forward seam:** presets with `authMethod: 'xoauth2'` carry an OAuth client + token refresh
  (reuse the `GoogleOAuthClient` shape); the IMAP/SMTP login swaps `LOGIN`/`AUTH PLAIN` for
  `AUTH XOAUTH2 <base64 bearer>`. Not built in v1.

## 6. Read path: scheduled refresh → read-cache

- A **generic recurring pg-boss job** (per connected account, configurable interval, default ~15 min)
  calls `EmailReadProvider.readRecent(account, window)`: open IMAP, fetch a bounded UID/date window per
  folder, upsert into `app.email_messages` (§7a persist), close. **Google rides the same scheduler**
  (its existing `sync-jobs.ts` becomes a scheduled trigger; see §6a).
- **Connect-time backfill** + a manual **"Sync now"** button remain (mirror Google's existing triggers).
- **No per-query live IMAP tool in v1** — the warm cache + scheduled refresh replace it (avoids per-query
  IMAP session cost and Yahoo's 5-connection cap).
- **Feature-grant gating:** cached IMAP reads are gated **per-account** via the existing #501/#627 model,
  identical to Google. Private by default.
- **Connection discipline & concurrency priority** (Codex HIGH-4): bound IMAP connections per account
  **below Yahoo's 5-cap**, but do **not** force everything through one serialized lane that lets a long
  backfill starve an approved send. Rules: **interactive send/draft `APPEND` has priority** and a hard
  timeout; **scheduled refresh yields/skips** when an interactive op is in flight or already running;
  **SMTP submission is a separate channel** from the IMAP pool (so send never blocks on a refresh). A
  small bounded pool (e.g. ≤2 IMAP + 1 SMTP) keeps us under the cap while avoiding head-of-line blocking.

### 6a. RLS: scheduled IMAP upsert must be allowed (Codex BLOCKER-2)

The current `email_messages_insert` policy (`packages/email/sql/0068_*`) only permits
`provider_type IN ('email','google')` (the `google` branch additionally requires the `gmail.modify`
scope). **An IMAP refresh upsert would be RLS-denied today.** This spec therefore requires a **new
email-module RLS migration** that relaxes `email_messages_insert` (and `_update` to match) to also allow:

```
definitions.provider_type = 'imap'
  AND <email-sync capability scope> = ANY (accounts.scopes)
```

mirroring the `google` branch's scope guard, with **owner-equality preserved verbatim**
(`owner_user_id = app.current_actor_user_id()`). Background runs supply actor context via the existing
**worker-runtime RLS grants** (`packages/connectors/sql/0069_*`); confirm `jarvis_worker_runtime` is in
the policy's role list (it is, in 0068). An integration test must prove an IMAP cron upsert **succeeds
for the owner and is denied for a non-owner**. No `BYPASSRLS`.

### 6b. Google scheduled-sync side-effects + guardrails (Codex MED-7)

Adding a cron to Google means: (1) calendar **reconciliation** (stale-event cleanup in `sync-jobs.ts`)
now runs automatically on the timer — **this is behavior change with delete-blast-radius**, so it ships
**default-off / opt-in** with a test proving scheduled reconciliation **cannot delete rows outside the
intended window**; (2) email **AI summarization** triggered by new cached mail must carry an extraction
**cap/throttle** so a timer can't fan out unbounded LLM calls; (3) background runs use the worker-runtime
RLS grants (`0069`); (4) respect Google **API quota** with a guard + conservative default interval,
user-disable-able. IMAP and Google schedulers share the job machinery but have **independent interval +
enable controls**.

## 7. Data-shape mapping (IMAP → `app.email_messages`) — from Proton spike §5

- **Folders, not labels:** map IMAP mailbox/folder → the cache label/folder field.
- **Message identity:** `(folder, uidvalidity, uid)` as the provider key (not Gmail's global ids).
- **Sync cursor** (Codex HIGH-5): cursor state is keyed **`(connector_account_id, folder, uidvalidity)
→ last_seen_uid`** — UIDVALIDITY is **part of the key**, not ignored. On a `UIDVALIDITY` change the
  old generation's high-water mark is **never reused** (a lower restarted UID range would otherwise skip
  all new mail); the new `(folder, uidvalidity)` cursor starts fresh and the old generation's rows are
  marked stale (documented dedupe), so we neither skip nor silently duplicate. This cursor needs a home:
  **`app.connector_accounts` has no metadata column**, so add a small **`app.email_sync_state` table**
  (owner-scoped RLS, in the email module's `sql/`) — see §14. No delta tokens / resumable cursors beyond
  this.
- **Read window:** bounded recent UID range / `date-since` per folder, advancing the cursor above.
- **Threading** (Codex MED-6): derive from headers (IMAP has no server thread id) with explicit
  normalization — store a canonical `message_id`, a **bounded, deduped `references[]`** (cap count +
  max header length, drop malformed), and derive `In-Reply-To` for reply construction from that. #214's
  server-derived `threadId` for IMAP sends is computed from this normalized metadata, not raw headers.
- **Attachments:** metadata only (filename, size, MIME). No body/attachment persistence beyond the
  existing email read-cache policy.

## 8. Send path (depends on #214 email-agency-slice)

Reuse the agency trust model **verbatim** — only the backend differs:

- `email.draftReply` (`risk:"write"`, family `email_drafts`, promotable to `trusted_auto`) →
  `EmailWriteProvider.saveDraft()`. Gmail = `drafts.create`; **IMAP = `APPEND` raw RFC822 MIME to the
  `\Drafts` folder** (user finishes/sends in the provider's webmail).
- `email.sendReply` (`risk:"destructive"`, **always confirm**, hard floor) →
  `EmailWriteProvider.send()`. Gmail = `messages.send`; **IMAP = SMTP submission (`smtp.mail.yahoo.com:465`
  / preset) then `APPEND` to `\Sent`.**
- **Recipient/subject/threadId are server-derived** from the owner-visible cached thread (#214 §5) — the
  model supplies only a cache message id + body. Reply-to-cached-threads only. The exfiltration floor is
  preserved across all providers.
- **Body rides the chat stream, never the DB** (#214 §4). Synchronous execution after approval — no email
  body in any pg-boss payload.
- Same SMTP/IMAP credential blob; XOAUTH2 send uses `AUTH XOAUTH2` when the preset requires it.
- **Ordering:** #214 (trust model + card preview + Gmail write path) should land first or alongside Slice
  D. Slice D adds the IMAP/SMTP `EmailWriteProvider` impl behind the existing tools.

## 9. Security & invariants

- **No admin private-data bypass / RLS is the boundary.** Connector rows + cache stay owner-scoped; admin
  oversight sees safe metadata only; no `BYPASSRLS`.
- **Secrets never escape** (§5). **Metadata-only pg-boss payloads** — refresh jobs carry actor/account
  ids + idempotency key + window params, never message bodies or creds.
- **Private by default** — per-account feature-grant gating on cached reads.
- **`AccessContext` stays `{ actorUserId, requestId }`** — no new fields.
- **Fail closed:** unreachable IMAP/SMTP → connector health `unreachable`, no silent partial state.
- **DataContextDb only**; reads/writes under the actor's scoped handle.

## 10. Connector health (#254)

Per account: `ok | auth_failed | unreachable`. Surfaced in settings + admin (safe metadata). A failed
Test-connection or scheduled run sets the state; `unreachable` covers Bridge-down / network / TLS.

## 11. Onboarding / UI

- Onboarding currently lists Outlook / Microsoft 365 / Proton / iCloud / Yahoo / Fastmail as "Soon."
  Flip **Yahoo, Proton, iCloud, Fastmail** to active **IMAP connect** flows (preset picker + creds +
  Test connection). Proton's flow carries the **paid-plan + Bridge-running** prerequisite copy.
- Outlook stays "Soon" until the XOAUTH2 slice.
- Empty/loading/error states use existing authored `jds-*` patterns; no new design system.

## 12. Test strategy — GreenMail protocol harness + per-preset smokes

GreenMail proves **protocol mechanics**, not provider behavior (Codex MED-8). Name it accordingly and
don't let "GreenMail green" imply a provider is verified.

- **Integration (CI) — GreenMail in Docker** (real self-hosted IMAP+SMTP+POP3, the **protocol harness**):
  seed messages, point a preset at `localhost`, assert: backfill + incremental read into
  `app.email_messages`, **RLS owner scoping (IMAP cron upsert succeeds for owner, denied for non-owner —
  §6a)**, feature-grant gating, `APPEND`-draft lands in `\Drafts`, SMTP send + `\Sent` `APPEND`,
  `UIDVALIDITY`-reset cursor handling (§7). No real account required.
- **Unit:** `(folder,uidvalidity,uid)` mapping, `UIDVALIDITY` reset cursor logic, **bounded/deduped
  header-threading** normalization (§7), preset registry, bounded Test-connection error mapping, and a
  **sanitizer test** proving creds + raw IMAP/SMTP transcripts never serialize into HTTP responses,
  **logs**, job payloads, exports, or AI prompts.
- **Per-preset reality** (GreenMail can't exercise Yahoo conn-caps, Proton Bridge, iCloud/Fastmail auth
  quirks, XOAUTH2, or malformed real-world headers): **Yahoo gets a live manual acceptance** before it's
  on by default; **Proton/iCloud/Fastmail ship "experimental / off by default" until each gets one manual
  smoke**, or behind a flag. Don't flip all four on from GreenMail alone.
- **Optional later:** Mailosaur for a real-internet-delivery smoke (paid; not in CI).

## 13. Slice plan (each = its own `task` issue, Part of #270, gated on this spec)

| Slice | Issue                                      | What                                                                                                                                                                                                 | Notes                                                                                                                                                                    |
| ----- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** | **✅ SHIPPED #640 / PR #644** (`08e62f6a`) | Extract read-only `EmailReadProvider`; refactor Google reads behind it                                                                                                                               | No behavior change. Already merged — **do not re-cut.**                                                                                                                  |
| **B** | retitle **#641**                           | Generic IMAP credential connect: preset registry + connect form + bounded Test-connection + health states + encrypted creds                                                                          | **Absorbs the Proton #641 scope** (provider-parameterized credential shape). Migrations 1+2 (§14): `imap` enum-add + preset `connector_definitions` seeds. No reads yet. |
| **C** | retitle **#642**                           | IMAP `EmailReadProvider` impl + generic scheduled refresh job → `app.email_messages` (§7a); **wire Google onto the same scheduler** (§6b); feature-grant gated; Yahoo+Proton+iCloud+Fastmail presets | The bulk. Migrations 3+4 (§14): email RLS `imap` insert branch + `email_sync_state` table. GreenMail protocol-harness + owner/non-owner RLS tests.                       |
| **D** | **NEW**                                    | Send: generalize `email-write-service` behind `EmailWriteProvider`; IMAP `APPEND`-draft + SMTP send                                                                                                  | **Depends on #214.**                                                                                                                                                     |
| **E** | retitle **#643**                           | Onboarding UI: flip the four providers "Soon" → active                                                                                                                                               | Proton prerequisite copy.                                                                                                                                                |
| **F** | deferred                                   | Outlook / XOAUTH2 `authMethod` on the same seam                                                                                                                                                      | Adds OAuth flow; no schema change.                                                                                                                                       |

## 14. Migration impact (corrected — Codex; not "one migration")

At least **four** new migrations across two modules:

1. **connectors:** add `'imap'` to `app.connector_provider_type` (the value-add half of the two-file
   `ALTER TYPE ADD VALUE` dance — Postgres forbids add+use in one txn, see `0043`→`0044`).
2. **connectors:** seed the preset `connector_definitions` rows (`imap-yahoo` / `-proton` / `-icloud` /
   `-fastmail`, `provider_type='imap'`) — the _use_ half, in a separate migration from the enum-add.
   Idempotent `INSERT ... ON CONFLICT DO NOTHING`.
3. **email:** new `email_messages_insert` (+ `_update`) policy relaxing to `provider_type='imap'` with
   the email-sync capability-scope guard, owner-equality verbatim (§6a). Never edit applied `0068`/`0021`
   — supersede with a new file.
4. **email:** new `app.email_sync_state` table — `(connector_account_id, folder, uidvalidity) →
last_seen_uid`, owner-scoped RLS — for the §7 cursor (there is **no** `connector_accounts` metadata
   column to reuse).

- Module SQL lives in the owning module's `sql/` dir, never `infra/`. No edits to applied migrations
  (hash-checked).
- `foundation.test.ts` asserts the full migration list with `toEqual` — **add every new migration's row
  and run full `test:integration`** or it breaks latently.

## 15. Out of scope

Calendar over IMAP; reply-all; new-compose to arbitrary recipients; attachments/HTML compose; webhooks/
push; shared hosted OAuth app; connector plugin marketplace; per-query live IMAP tool; Outlook/XOAUTH2
(deferred, seam-ready).

## 16. Open items for the build gate

- Model-diverse spec-merge gate (2× review) per process.
- GitHub: Slice **A is already merged (#640 / PR #644)** — don't re-cut. On Ben's go, god retitles
  #641→B, #642→C, #643→E, cuts a NEW issue for D, all Part of #270; F stays deferred. Proton spike
  marked "superseded by" this; #214 lands before/with Slice D.
- Ben build go-decision.
