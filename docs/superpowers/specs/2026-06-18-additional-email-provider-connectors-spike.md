# Additional Email Provider Connectors Spike

**Status:** Approved spike
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #270

## Goal

Decide what the next non-Google email connector should be and what connector seam must exist before
building it.

## Current State

Jarv1s has one real connector family today:

- Google connection via per-user OAuth desktop-app credentials.
- One unified `google` connector account for Gmail + Calendar scopes.
- Google sync job that populates calendar/email read caches.
- Onboarding UI lists Outlook, Microsoft 365, Proton Mail, iCloud, Yahoo Mail, and Fastmail as
  "Soon", but only Google is wired.

The connector module is not provider-generic yet. The route names, OAuth service, sync queue, API
client, and onboarding copy are all Google-specific. That is fine for the first provider, but adding
another mail provider should extract only the seam proven by the second implementation.

## Spike Questions

Answer these before implementation:

- Which provider ships next?
  - Microsoft 365 / Outlook is the likely first candidate because it covers both consumer Outlook
    and work/school Microsoft accounts with OAuth.
  - IMAP-only providers are lower priority unless Ben explicitly wants read-only/simple mail first.
- What scope is V1?
  - Email read cache only?
  - Email send/modify?
  - Calendar too, or email-only?
- What auth model is acceptable?
  - Per-user OAuth app, matching Google sovereignty.
  - Operator/shared OAuth app.
  - App password / IMAP where still supported.
- What provider restrictions matter?
  - Microsoft tenant/app registration complexity.
  - Consumer vs work/school account differences.
  - IMAP app-password availability and 2FA constraints.
  - Provider API quota and webhook/polling limits.
- What data shape differs from Gmail?
  - Folder/label model.
  - Thread IDs.
  - Message IDs and delta sync tokens.
  - Attachment metadata.
  - Calendar event identity if calendar is included.

## Recommended Spike Output

Produce one provider-specific design note, not code:

- provider choice and rejected alternatives;
- OAuth/app-registration walkthrough;
- exact scopes;
- token refresh behavior;
- message list/get API mapping to `app.email_messages`;
- delta sync strategy;
- error/status labels for connector health (#254);
- migration impact;
- UI/onboarding copy changes;
- verification plan with one live-account manual acceptance path.

## Likely Architecture Direction

Do not build a broad connector framework first.

For the second provider, extract the minimum common seam:

- `ConnectorAuthFlow` for start/complete/revoke status where it actually overlaps.
- `EmailSyncProvider` with list/get/delta methods returning provider-neutral parsed mail records.
- Provider-specific API clients remain separate.
- The existing cache writer stays owned by the email module.
- Connector account secrets stay in `app.connector_accounts`, encrypted and owner-scoped.

Leave calendar support separate unless the chosen provider must ship email+calendar together.

## Guardrails

- No raw email body persistence beyond the existing email-sync policy.
- No provider tokens, client secrets, or refresh tokens in logs, pg-boss payloads, exports, or AI
  prompts.
- Sync jobs remain metadata-only.
- RLS owner scoping remains the data boundary.
- Admin connector oversight shows safe metadata only.
- Do not widen non-admin provider/account metadata to support the spike.

## Out Of Scope

- Implementing Microsoft/IMAP/Proton/iCloud/Fastmail.
- Generic plugin marketplace for connectors.
- Webhooks/push notifications.
- Shared hosted OAuth app.
- Attachment indexing.

## Activation Trigger

Move from spike to implementation only when Ben chooses the next provider and the design note answers
the auth model, scopes, sync shape, and acceptance account.

## Acceptance Criteria

- #270 is no longer a vague "more providers" issue.
- The next provider is explicitly chosen or deferred with a trigger.
- A build agent has a provider-specific spec before writing code.
- Existing Google connector behavior remains untouched.
