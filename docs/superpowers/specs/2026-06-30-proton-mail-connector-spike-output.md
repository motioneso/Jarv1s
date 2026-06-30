# Proton Mail Connector — Spike Output (Provider Design Note)

**Status:** Accepted — build (Ben 2026-06-30: Proton via Bridge IMAP, scheduled read, **§7a** read-cache persist)
**Date:** 2026-06-30
**Owner:** Ben
**GitHub:** #270 (Part of connector roadmap)
**Framing spike:** `docs/superpowers/specs/2026-06-18-additional-email-provider-connectors-spike.md`
**Provider chosen by Ben:** Proton Mail (2026-06-30)
**V1 shape (Ben, 2026-06-30):** **read-only, via a scheduled cron job.** A recurring pg-boss job
reads recent Proton mail via Bridge IMAP. This is *not* the full delta-sync connector framework
("we don't need to sync") and *not* purely on-demand — it's a simple periodic read. One open
decision below (§7): whether each run persists into the email read-cache or feeds Jarvis ephemerally.

> This note answers the framing spike's questions for the **specific** provider Ben chose
> (Proton Mail). It replaces the vague "more providers" text with a concrete, buildable-or-deferred
> decision. **No code is written until Ben accepts the recommended path below.**

## 1. The decisive finding

Proton Mail has **no official public developer API and no OAuth** (verified mid-2026):

- The internal REST API (`https://mail.proton.me/api`) is undocumented, **username/password** Bearer
  auth (not OAuth2), and reverse-engineered from Proton's own web client. Proton does not sanction
  third-party use of it.
- The **only supported** programmatic access is **Proton Mail Bridge**: a local desktop app
  (macOS/Windows/Linux, **paid Proton plan only**) that performs E2E decryption on the user's machine
  and exposes the mailbox over **localhost IMAP + SMTP**. It works only while that machine is running
  and Bridge is unlocked.
- Unofficial bridges/clients (Hydroxide, Peroxide, `protonmail-api-client`, `justinkalland/protonmail-api`)
  reverse-engineer the internal API. They break whenever Proton changes endpoints and depend on
  storing the user's Proton **password** (not a scoped token). **These violate our connector
  guardrails** and are rejected outright.

**Consequence:** the Google connector's mental model — per-user OAuth, scoped tokens, a server-side
sync job calling a stable provider REST API with delta tokens — **does not exist for Proton.** Any
Proton connector is an **IMAP-over-Bridge** connector, not an OAuth connector.

## 2. Why Proton still fits Jarvis (the saving grace)

Bridge is impractical for cloud SaaS (a server can't run every user's local decryptor). **Jarvis is
self-hosted** — Docker on the user's own machine(s). That inverts the usual problem:

- The user already runs Jarvis on hardware they control. Running Proton Bridge on (or LAN-reachable
  from) that same host is a normal ask for this audience.
- Decryption stays on the user's machine; Jarvis connects to `127.0.0.1:1143` (IMAP) /
  `127.0.0.1:1025` (SMTP) exactly as Thunderbird would. Proton's E2E/zero-access model is preserved.
- This is **more** sovereignty-preserving than Google OAuth, which matches Jarvis's "private by
  default / lots of personal data" posture.

So Proton is a legitimate next connector **iff** we accept an IMAP-via-Bridge architecture and a
"user must run Bridge" prerequisite. It is **not** a drop-in clone of the Google flow.

## 3. Recommended path

**Adopt the Bridge/IMAP path, scoped to a scheduled read.** A recurring pg-boss job opens an IMAP
session to Bridge, fetches recent messages, hands them off, closes — no delta tokens, no
bidirectional state, no full mirror. Treat Proton as the connector that forces the first **generic
IMAP `EmailReadProvider` seam** — a read-only interface the framing spike said to extract only when a
second provider proves it. Proton is that proof: the same read seam later unlocks
Fastmail/Yahoo/iCloud. (A full delta-sync provider can be layered on this seam later if ever wanted —
but it is explicitly **not** V1.)

Rejected alternatives:

| Option | Verdict | Reason |
| --- | --- | --- |
| Reverse-engineered Proton REST (Hydroxide et al.) | **Rejected** | Stores Proton password, undocumented/unstable, ToS + guardrail violation. |
| Wait for official Proton OAuth API | **Rejected (for now)** | No announced timeline; community has requested it for years. Revisit if Proton ships it. |
| **Bridge → localhost IMAP/SMTP** | **Recommended** | Only supported path; fits self-hosted model; reuses standard IMAP libs; preserves E2E. |

## 4. Auth & connection model

- **No OAuth flow.** Instead, the connect step collects **Bridge IMAP/SMTP credentials**: host, ports,
  the Bridge-generated app password (Bridge issues a unique password per client, not the Proton
  account password), and TLS/STARTTLS mode.
- Stored in `app.connector_accounts` as an encrypted (AES-256-GCM) credential blob, owner-scoped, same
  at-rest protection as Google tokens. **The Bridge password never reaches frontend, logs, pg-boss
  payloads, exports, or AI prompts** (existing invariant).
- Connection identity metadata safe for UI: Proton address, Bridge host:port, last-connect status. No
  secret material.
- **V1 scope:** **scheduled read only.** A recurring job reads recent Proton mail via Bridge IMAP.
  **No full delta-sync framework, no send, no calendar** (Proton Calendar has no Bridge/IMAP surface).
  SMTP-send and full sync are later, separate decisions on the same read seam.

## 5. Data-shape mapping (IMAP → `app.email_messages`)

IMAP differs from Gmail's API in ways the seam must absorb:

- **Folders, not labels.** Map IMAP mailbox/folder → our label/folder field; Proton exposes
  Inbox/Sent/Archive/etc. as IMAP folders.
- **Message identity:** IMAP `UID` + `UIDVALIDITY` per folder (not Gmail's global message/thread IDs).
  Persist `(folder, uidvalidity, uid)` as the provider key; guard against `UIDVALIDITY` resets.
- **Read window:** no Gmail-style historyId needed for V1. Each cron run fetches a bounded window
  (recent UID range / date-since) per folder. No delta tokens or resumable cursors required at this
  scope; a `last-seen UID` per folder is enough to avoid re-reading old mail.
- **Threading:** derive from `References`/`In-Reply-To` headers; Proton has no server thread ID over IMAP.
- **Attachments:** metadata only (filename, size, MIME) — no body/attachment persistence beyond the
  existing email-sync policy.

## 6. Security / RLS boundaries (no new ground broken)

- Connector account rows stay owner-scoped under existing RLS; no admin private-data bypass; admin
  oversight sees safe metadata only.
- Sync jobs stay **metadata-only** in pg-boss payloads (actor/resource IDs, idempotency key) — never
  message bodies or the Bridge password.
- No raw email body persistence beyond the current email read-cache policy.
- Do **not** widen non-admin provider/account metadata to support Proton.
- New consideration: Bridge endpoint is a localhost/LAN socket. Document that the operator must keep
  Bridge host trust within the same security boundary as Jarvis; the connector must fail closed if the
  Bridge socket is unreachable (surfaced as connector health state, #254).

## 7. Read job (scheduled cron) — and the one open decision

- A recurring **pg-boss** job (configurable interval) runs an `EmailReadProvider.readRecent(account,
  window)` against Bridge IMAP — bounded UID/date window, fetch headers + body-metadata, hand off,
  close. Metadata-only payloads; the Bridge password never enters the job payload.
- Health/status labels per connector (#254): `bridge_unreachable`, `auth_failed`, `ok`.

**DECISION (Ben 2026-06-30): 7a — persist to the email read-cache.**

| Option | What it means | Trade-off |
| --- | --- | --- |
| **7a. Persist to email read-cache** (`app.email_messages`) | Cron upserts recent Proton mail into the **existing** read-cache. Chat, search, briefings, notes all work immediately via existing plumbing + #501 per-account read gating. | Lightest *new* code, most useful. But it *is* a minimal mirror — slightly against "no sync." Subject to existing read-cache retention/purge policy. |
| **7b. Ephemeral feed, no persistence** | Cron reads, feeds the briefing/AI pipeline for that run, stores nothing. | Truest to "we don't need to sync / no mirror." But Jarvis can't answer "show my Proton inbox" between runs, and search/notes can't see it. Needs a new ephemeral hand-off path (more new code, less reuse). |

**Recommendation: 7a.** It's the minimal-new-code path, reuses the cache + read-gating already built,
and a time-windowed read-cache is arguably not "sync" in the heavy sense Ben rejected. Retention is
governed by the existing email read-cache policy. Confirm before build.

## 8. UI / onboarding copy

- Onboarding already lists Proton as "Soon." Flip Proton to an active connector **of a different
  shape**: instead of an OAuth "Connect" button, a short **Bridge setup** flow (link to Proton's
  Bridge docs, fields for host/port/app-password, a "Test connection" probe).
- Set expectations in copy: requires a **paid Proton plan + Bridge running** on a host reachable from
  Jarvis. This is a real prerequisite, not a one-click OAuth.
- Empty/loading/error states use existing authored `jds-*` patterns; connector health surfaces the
  status labels above.

## 9. Architecture seam to extract (minimum, per framing spike)

- `EmailReadProvider` interface: `listFolders`, `listMessageKeys(folder, sinceUid)`, `getMessage(key)`
  → provider-neutral parsed mail records. Read-only; Google + Proton both implement it. (A future
  `EmailSyncProvider` could extend it — not now.)
- `ConnectorAuthFlow` generalizes start/complete/revoke **only where it overlaps** — for Proton
  "auth" = credential validation + Test-connection, not an OAuth redirect. Keep the abstraction honest;
  don't force a fake OAuth shape.
- Provider-specific clients stay separate (Google API client vs. an IMAP client lib).
- **Do not** build a broad connector framework or plugin marketplace (existing guardrail / #216).

## 10. Verification plan

- Unit: IMAP key mapping, UIDVALIDITY-reset handling, header-threading derivation, sanitizer that
  proves the Bridge password never serializes into job payloads/exports/AI prompts.
- Integration: against a local Bridge with a real paid Proton test account — backfill then incremental,
  assert read-cache rows + RLS owner scoping.
- **One live-account manual acceptance path:** stand up Bridge on the test host, connect via the
  onboarding flow, confirm inbox metadata appears in Jarvis with provenance, confirm
  `bridge_unreachable` health when Bridge is stopped.

## 11. Implementation plan — reviewable slices

Each slice is its own `task` issue + needs this note accepted first (build gate per CLAUDE.md).

1. **Slice A — read seam:** extract read-only `EmailReadProvider`, refactor Google reads behind it (no
   behavior change; existing tests green). *De-risks everything; ships nothing user-visible.*
2. **Slice B — Proton credential connect:** `connector_accounts` Proton credential type, encrypt-at-rest,
   Test-connection probe, connector health states. No reads yet.
3. **Slice C — Proton scheduled read:** `protonImap` `EmailReadProvider` + recurring pg-boss read job,
   **upserting into the `app.email_messages` read-cache (§7a)**, RLS + payload-sanitizer tests,
   live-account acceptance.
4. **Slice D — Onboarding UI:** flip Proton from "Soon" to active Bridge-setup flow with prerequisite copy.
5. *(Deferred)* **Slice E — SMTP send** via Bridge, only if Ben wants outbound. Separate decision.

## 12. Open product decision for Ben (activation gate)

This note is buildable, but it commits Jarvis to:

1. **A non-OAuth connector shape** (IMAP credentials + Bridge prerequisite) — the first of its kind here.
2. **A user prerequisite:** paid Proton plan + Bridge running on a Jarvis-reachable host.
3. **One design pick:** §7a (cron upserts to the email read-cache — recommended) vs §7b (ephemeral,
   no persistence).

**Accept Bridge/IMAP + pick 7a or 7b → I file Slice A–D task issues and #270 moves to build.**
**Or defer with trigger → keep #270 parked until Proton ships an official OAuth API.**

## Guardrails reaffirmed

- No reverse-engineered Proton REST. Bridge/IMAP only.
- Secrets (Bridge app password) never escape: not in frontend, logs, pg-boss payloads, exports, AI prompts.
- Sync jobs metadata-only. RLS owner scoping is the data boundary. Existing Google behavior untouched.
- No calendar, no attachment indexing, no webhooks, no connector marketplace in scope.

## Sources

- Proton Mail Bridge (official): https://proton.me/mail/bridge
- IMAP/SMTP/POP3 setup (official): https://proton.me/support/imap-smtp-and-pop3-setup
- SMTP submission tokens (send-only, official): https://proton.me/support/smtp-submission
- No official API confirmation / internal API base: community + reverse-engineered clients
  (Hydroxide https://github.com/emersion/hydroxide, Peroxide https://github.com/ljanyst/peroxide,
  unofficial docs https://github.com/secure-mail-documentation-project/protonmail-api).
