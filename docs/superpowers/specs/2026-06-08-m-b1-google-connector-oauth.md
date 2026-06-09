# M-B1: Real Google Connector — per-user OAuth + guided connection skill

**Status:** Approved design — rev 2 (unified Google Connection + chat-hands-off-secret locked)
**Date:** 2026-06-08
**Owner:** Ben
**GitHub:** Epic #8 (M-B1 · Real connectors) · related issues #12 (OAuth callback
verification), #13 (sync scope)
**Decision record:** ADR `0006-google-connector-per-user-oauth.md`

## 1. Problem

The daily briefing (M-A4) is supposed to summarize the user's real day, but
calendar/email are **stubs**: `POST /api/connectors/accounts` today accepts a
client-supplied `tokenPayload` and just encrypts it — there is no OAuth flow and no sync.
Jarv1s cannot read the user's actual calendar/mail, and cannot act on them.

This milestone makes **Gmail + Google Calendar real, read and write**, so that (a) a future
briefing grounds on real data and (b) Jarvis can later send mail / create events on the
user's behalf. **This spec covers the _connection_ foundation** — authorizing a real,
refreshable, owner-only Google credential through a guided skill. The **sync engine and
briefing grounding are an explicit downstream slice** (§9).

## 2. Goal & success criterion

A user can connect their Google account — guided from Settings _or_ by Jarvis in chat — and
Jarv1s holds a real, auto-refreshing, encrypted, owner-only OAuth credential with
read+write scopes for Gmail and Calendar. **Success = a live round-trip on the headless
box:** create the OAuth client → authorize → store tokens → make one authenticated
read call (list today's events) **and** one reversible write call (create then delete a
throwaway calendar event), all under the connected user's RLS context. This live proof _is_
issue #12.

## 3. Decisions locked (from the grill; see ADR 0006)

- **Per-user OAuth**, each user creates their **own Google Cloud "Desktop app"** client. No
  shared instance app.
- **Loopback-copy-paste** authorization: browser fails on `http://localhost:<port>` (expected),
  user pastes the full redirected URL back, server exchanges the code. No inbound callback.
- **Testing-mode + self-as-test-user** → **no Google verification** ever.
- **Read + write scopes from the first consent** so the user consents once.
- **Guided skill**, reachable from **Settings** and from **Jarvis in chat**.
- Credentials stored in the existing **encrypted `connector_accounts` secret**, owner-only.

## 4. Non-goals (this slice)

- **Microsoft / Outlook** — handled separately for now; the model generalizes later.
- **The sync engine and briefing grounding** — downstream slice (§9).
- **A shared instance OAuth app** and **Google verification / CASA** — explicitly avoided by
  the per-user testing-mode model; only relevant if Jarv1s is ever published for strangers
  (a later multi-tenant milestone).
- **Driving the LLM-CLI's vendor connectors** — proven feasible, parked as a possible future
  convenience (ADR 0006).
- **A calendar/inbox web view** — not required to connect.

## 5. Scopes requested

Requested in a single consent (read + write):

- Gmail: `https://www.googleapis.com/auth/gmail.modify` (read, label, draft, send; **not**
  the full-mailbox `https://mail.google.com/`).
- Calendar: `https://www.googleapis.com/auth/calendar` (read + write events).

Rationale: one consent now avoids a second consent trip when write lands. `gmail.modify` is
the least-privilege scope that still permits send/draft/label; we deliberately avoid the
broadest Gmail scope. Both are Google "restricted/sensitive" scopes — fine under the
per-user testing-mode model (no verification).

## 6. The connection model (build on existing substrate)

The `connectors` module already has the right shape — we extend, not replace:

- `app.connector_definitions` — seeded Google providers exist (`google-calendar`,
  `google-email`). Their `default_scopes` move from `.readonly` to the §5 read+write scopes.
- `app.connector_accounts` — per-user, owner-only RLS, `encrypted_secret jsonb`, status
  `active | error | revoked`. **The `encrypted_secret` becomes a credential bundle:**
  `{ client_id, client_secret, access_token, refresh_token, token_expiry, granted_scopes }`,
  AES-256-GCM via the existing `crypto.ts` cipher. No new secret table.

**Decided: one unified Google Connection.** A single per-user Google consent grants **both**
Gmail and Calendar scopes and yields **one** token set, represented as a **single Google
Connection that enables both services** — one consent, one credential bundle, one refresh
path, revoke-once. (Rejected: keeping the two separate `provider_id` rows sharing a grant —
they would refresh/revoke in lockstep and drift.) The existing two-provider seed
(`google-calendar`, `google-email`) consolidates into one Google provider/Connection that
carries both `provider_type`s (or backs both services). Finalize the exact column shape in
the plan via an **additive migration** (never edit an applied one).

## 7. The OAuth flow (per-user, loopback-copy-paste)

1. **Create client (once per user).** Guided: create a Google Cloud project, enable Gmail +
   Calendar APIs, configure the consent screen, create an **OAuth client of type "Desktop
   app"**, add self as a **test user**, download the client JSON (`client_id`,
   `client_secret`).
2. **Begin authorization.** Jarv1s builds the Google auth URL from the user's `client_id`,
   the §5 scopes, `redirect_uri=http://localhost:<port>`, `access_type=offline`,
   `prompt=consent` (to force a refresh token), and a CSRF `state`. The user opens it and
   approves.
3. **Relay the code.** The browser fails to load `http://localhost:<port>?code=…&state=…`
   (expected — nothing is listening). The user copies the **entire URL** and pastes it into
   Settings or to Jarvis.
4. **Exchange (server-side).** The API validates `state`, extracts `code`, and POSTs to
   Google's token endpoint (outbound only) for `access_token` + `refresh_token`. The bundle
   is encrypted and stored on the Connection; status → `active`.
5. **Refresh.** Before expiry (or on a 401), the server refreshes using the `refresh_token`;
   on refresh failure → status `error` (surfaced for re-connect). On user revoke → status
   `revoked`.

No step requires an inbound connection to the box.

## 8. The guided connection skill

A single source of truth for the walkthrough, surfaced two ways:

- **Settings page** — a step-by-step "Connect Google" flow: linked console steps, a field to
  paste the client JSON, a "Start authorization" button (opens the auth URL), and a field to
  paste the redirected URL. Shows connection status and a re-connect/revoke control.
- **Jarvis in chat** — the same steps delivered conversationally **for guidance only**.
  Jarvis walks the user through the console setup and explains each step, but the two
  **secret-bearing actions** — pasting the client JSON and pasting the redirected URL —
  are **handed off to the Settings REST path**. Secrets never transit the assistant
  transport. (Decided.) Jarvis can deep-link the user straight to the Settings connect flow.

The skill is the Hermes-style "ask the assistant to set it up" model applied to Jarv1s's own
skills architecture. **Build it with the `writing-skills` superpower** and validate it by
actually connecting Ben's account.

## 9. Downstream slice (named, not designed here)

After a Connection exists, a follow-on slice makes the data _useful_. The open fork
(deferred): **(A) inline grounding** — the briefing run reads live at compose time; vs
**(B) sync-to-cache** — a scheduled CLI/API sync upserts `calendar_events` / `email` (the
existing read caches with `UNIQUE(connector_account_id, external_id)` for idempotent
upsert), which a web view and Jarvis chat can also read. Resolve once the Connection works.

**Carried constraint for the sync slice (`provider_type` conflation — see ADR 0006):** the
unified Google connection uses `provider_type='google'`, so it is **not** found by
`WHERE provider_type='calendar'`/`'email'`, and the read-cache RLS insert policies on
`calendar_events`/`email` still key on those domain values. The sync slice must (a) discover
connections **by domain** (granted scopes or a service map), and (b) reconcile the legacy
`google-calendar`/`google-email` definition rows with the unified `google` connection (e.g.
update the read-cache insert policies / FK target). This is a known item, recorded so it is
not a latent surprise.

## 10. Security & invariants (must hold)

- Credentials AES-256-GCM at rest; **never** in logs, pg-boss payloads, exports, or AI
  prompts. (`encrypted_secret` already enforces at-rest encryption.)
- Owner-only RLS on `connector_accounts` (existing); no admin bypass.
- `DataContextDb` only; secrets handled via the connectors `crypto.ts` cipher.
- `state` CSRF check on the authorization exchange; `prompt=consent`/`access_type=offline`
  to guarantee a refresh token.

## 11. Verification

- **Live round-trip (issue #12):** the §2 success criterion, run on the headless box against
  Ben's real Google account — read (list events) + reversible write (create/delete a temp
  event). This also empirically answers the **~7-day testing-mode refresh-token** question
  (re-check token validity after the interval; if it expires, document "publish to
  production-unverified" as the mitigation).
- **Integration tests** (Postgres, RLS): credential bundle encrypts/decrypts; connection
  create/refresh/revoke transitions; owner-only visibility; `state` mismatch rejected.
  External Google calls are faked at the HTTP boundary (no live Google in CI).
- Gate: `pnpm verify:foundation` + `pnpm audit:release-hardening` green.

## 12. Open questions

1. **~7-day testing-mode refresh-token expiry** — confirm empirically (§11); fallback is
   "publish app to production-unverified." Not a blocker.
2. **Downstream grounding** (§9, inline vs sync-to-cache) — deferred to the next slice, to be
   decided once a Connection works.

_Resolved during design:_ unified single Google Connection (§6); Jarvis guides but secrets
hand off to Settings (§8); read+write scopes from first consent (§5).
