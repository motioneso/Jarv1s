# Task 2 — email reply targets and provider links

## Scope

Implement only spec §5 / §9 Task 2 on issue #1371. No migration is needed. The existing
`EmailContextItem` already carries the provider external message key and optional cache row id;
Task 2 will make the cache lookup account-scoped and add the provider-owned link seam needed by
the later monitor task metadata.

## Seams check

- `packages/connectors/src/source-context/email.ts:245-247` loads briefing cache rows and currently
  indexes them by `external_id` alone; `:204-227` consumes that index and separately emits
  `cacheMessageId`.
- `packages/connectors/src/source-context/types.ts:57-79` is the public email-context seam. It
  keeps `messageKey` (provider id), `account.connectorAccountId`, `threadId`, and
  `cacheMessageId` as distinct values; the provider link will be nullable because IMAP has no
  stable v1 link.
- `packages/connectors/src/google-api-client.ts:69-77` proves Gmail message metadata exposes a
  message id and optional thread id; `packages/connectors/src/source-context/email.ts:121-127`
  already narrows cached thread metadata without exposing raw provider payloads.
- `packages/email/src/repository.ts:89-102` proves the existing cache repository resolves by the
  composite `(connectorAccountId, externalId)` key and is owner/RLS scoped. Connectors continues
  to receive only its structural list port; it will not import the email module or query its table.
- `packages/connectors/src/source-context/email-tasks.ts:71-83,140` proves `sourceRef` is the
  composite account/external key and is not a cache row id.
- `packages/email/src/tools.ts:178-196,254-256` proves reply tools accept only the opaque
  `cacheMessageId`; no source-ref-to-cache-id shortcut is valid.

## Decisions

1. Key the live triage reuse map with a private composite key of connector account id plus
   external id. Fallback already filters by account; the same account boundary must apply before
   triage reuse and thread lookup.
2. Add `sourceHref: string | null` to `EmailContextItem`. Build it through the new
   `packages/connectors/src/source-context/email-action-links.ts` helper from provider type and
   verified thread metadata. Gmail is enabled only for the verified dev-account URL convention;
   IMAP returns `null` until a stable provider link is available. Rows requiring a link are
   filtered by the later monitor task, not faked here.
3. Keep `messageKey`/`emailSourceRef` (the account + external provider identity) and
   `cacheMessageId` (opaque database identity) unchanged and separate. The helper never accepts or
   returns a cache row id.
4. Preserve the existing security posture: no body/snippet content in links, logs, or test
   diagnostics; no new database access and no migration.

## Changes

- `packages/connectors/src/source-context/email-action-links.ts`: export the minimal provider link
  input/output seam and Gmail builder; reject missing thread metadata and unsupported providers.
- `packages/connectors/src/source-context/types.ts`: add nullable `sourceHref` to the context item.
- `packages/connectors/src/source-context/email.ts`: use the composite cache key for live lookup,
  set `sourceHref` from the helper for live/cache items, and keep cache ids independent from the
  source ref.
- `tests/unit/email-monitor-run.test.ts`: add the required collision test and distinct-identity
  test through public monitor/source-context seams, including an IMAP no-link assertion.

## Verification

- `pnpm exec vitest run tests/unit/email-monitor-run.test.ts` — exit 0.
- `pnpm format:check` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm typecheck` — exit 0.

## Live Gmail verification / kill gate

Before enabling the Gmail builder, open the generated link against a real connected dev Gmail
account containing the matching cached thread and confirm it lands on that thread. If the
coordinator cannot provide a real connected account or the URL does not resolve to the intended
thread, the kill gate is to leave Gmail `sourceHref` null and ship only account-scoped cache
resolution plus IMAP omission. The coordinator owns that call; no guessed URL is enabled.
