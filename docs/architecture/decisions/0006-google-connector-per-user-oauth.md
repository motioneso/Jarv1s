# 0006 — Users connect Google via their own per-user OAuth Desktop-app client, guided by a skill

**Status:** accepted (2026-06-08)
**Context:** M-B1 · Real connectors (epic #8). Full design:
`docs/superpowers/specs/2026-06-08-m-b1-google-connector-oauth.md`. Goal: real Gmail +
Google Calendar (**read and write**) so daily briefings ground on real data and Jarvis can
act on the user's behalf. Reverses nothing; builds on the existing `connectors` /
`calendar` / `email` substrate (encrypted token store + read caches already exist).

## Decision

A user connects Google through **their own per-user OAuth client**, walked through it by a
**skill**. Five load-bearing choices:

1. **Per-user OAuth, not a shared instance app.** Each user who wants Google creates their
   own Google Cloud **"Desktop app"** OAuth client and authorizes their own Connection.
   There is no instance-wide OAuth client. Users who don't use Gmail/Calendar simply never
   connect — the instance admin's use does not force anyone else.

2. **Loopback-copy-paste authorization** (not OOB, not a hosted callback). The Desktop-app
   loopback redirect is used; after consent the browser is _expected to fail_ loading
   `http://localhost:<port>`; the user copies the **entire redirected URL** (which carries
   `?code=…`) back into Jarv1s; the server exchanges the code for tokens **server-to-server**.
   No inbound callback is ever received, so this works on a headless / LAN-only box with
   zero extra infrastructure.

3. **Testing-mode, self-as-test-user → no Google verification.** Each per-user app stays
   unverified in "Testing" publishing status with the user added as a test user. Because we
   never publish an app _for third parties_, Google's restricted-scope verification / CASA
   assessment **never applies**.

4. **Read + write scopes from the first consent** (`gmail.modify` + Calendar read/write), so
   the user consents **once** and Jarvis can later send mail / create events without a
   second trip through Google's consent screen.

5. **Guided by a skill, dual-surface.** The walkthrough is reachable from the **Settings**
   page and from **Jarvis in the chat drawer**. The user's OAuth client credentials _and_
   the resulting tokens live in the existing **AES-256-GCM `connector_accounts` secret**,
   owner-only under RLS.

## Considered and rejected

- **Drive the LLM-CLI's vendor connectors** (have Jarvis call Claude/Gemini's hosted
  Gmail/Calendar MCP tools over the existing tmux transport). **Proven working in a live
  probe** (real calendars + Gmail labels returned as structured JSON), near-zero build, and
  it skips Google verification. Rejected as the primary because it routes **raw mail/calendar
  through the LLM vendor's cloud** (wrong for a sovereignty pitch), **couples** the capability
  to which CLI the user runs (Codex may lack it), and its availability in the **autonomous,
  headless briefing run** is unverified. May return later as an opt-in convenience.
- **Shared instance-operator OAuth app.** Easiest end-user consent ("Connect Google" →
  done), but it **concentrates trust** in the operator and forces the operator through
  Google's **restricted-scope verification + annual CASA** to serve other users without the
  unverified-app wall. Rejected: per-user keeps each person sovereign and sidesteps
  verification entirely.
- **ICS secret URL / IMAP app-password (no OAuth).** Trivial and infra-free, but ICS is
  **read-only and stale**, and basic-auth IMAP is **dead for Microsoft** and tightening for
  Google. Incompatible with the read+write requirement. Rejected.

## Why (the trade-offs)

- **Per-user over shared:** the product is single-user-per-actor and sovereignty-minded;
  per-user apps mean no operator data-controller role and, decisively, **no verification
  gauntlet** for the self-host case.
- **Loopback-copy-paste over a hosted callback:** the redirect never has to _reach_ the box
  — the human relays the code and the token exchange is outbound-only — so a headless/LAN
  deployment needs no Tailscale, reverse proxy, HTTPS cert, or SSH tunnel. (Google's own
  guidance keeps the loopback flow supported for Desktop-app clients; only the old `oob`
  redirect was removed.)
- **Testing-mode over verified:** trades a heavier per-user setup for zero verification. The
  accepted cost is the possible **~7-day refresh-token expiry** that Google applies to
  testing-mode apps with sensitive scopes — measured empirically in the connect round-trip
  (issue #12), with "publish to production (still unverified)" as the fallback if it bites.

## Consequences

- Per-user setup is a multi-step Google Cloud Console crawl; the **guided skill exists to
  make that bearable**. Higher per-user onboarding cost is the deliberate price of
  sovereignty + no verification.
- The `connector_accounts` secret now holds a **credential bundle** (the user's OAuth
  `client_id`/`client_secret` _plus_ access/refresh tokens), still AES-256-GCM encrypted,
  owner-only, and never emitted to logs, pg-boss payloads, exports, or AI prompts.
- **Microsoft is out of this slice** (handled separately for now); the same connection model
  generalizes to an Azure AD app later.
- The **sync engine and briefing grounding are a separate downstream slice** — this ADR
  covers _connecting_, not yet _consuming_. Whether the briefing reads a synced local cache
  or grounds inline is deferred (see the spec's open questions).
- **`connector_provider_type` now mixes data-domain and vendor values.** The enum meant a data
  domain (`calendar` / `email`); adding `'google'` makes it also carry a vendor identity. As a
  result **`WHERE provider_type = 'calendar'` will NOT match the unified Google connection.**
  This is acceptable for the connection-only slice (no sync runs yet), but the **deferred sync
  slice must**: (a) discover a user's connections **by domain** — via granted scopes or an
  explicit service map — rather than by `provider_type`; and (b) **reconcile** the legacy
  `google-calendar` / `google-email` definition rows (which the read-cache RLS insert policies
  still key on via `provider_type='calendar'`/`'email'`) with the unified `google` connection.
  Recorded here so the conflation is explicit, not a latent surprise.
