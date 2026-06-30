# Gate cached email/calendar reads by per-account feature grants (#501)

**Status:** approved
**Date:** 2026-06-29
**Owner:** Ben + Stanley
**Parent:** Follow-up (Phase 2) of #482 per-account feature grants (Phase 1 = #502).
**Grounded on:** local working tree —
`packages/email/src/tools.ts` (`emailListVisibleMessagesExecute` → `repository.listVisibleForBriefing(scopedDb)`, no grant check, output already carries `connectorAccountId`),
`packages/calendar/src/tools.ts:21` (`calendarListVisibleEventsExecute` → `repository.listVisible`, no grant check),
`packages/calendar/src/serialize.ts:22` (`connectorAccountId` serialized),
`packages/connectors/src/feature-grants.ts` (`isFeatureGranted` / `resolveEffectiveGrants` — the #482 helper),
`packages/connectors/src/repository.ts:96` (`listAccounts(scopedDb)` → accounts + scopes),
`packages/briefings/src/compose.ts:284` (`tool.execute(scopedDb, {}, ctx)` — **no `services` arg**, lines 456/476 invoke the two read tools),
`packages/chat/src/live/cross-tool-reasoning.ts:469` (`reader.runReadTool(actorUserId, toolName, input)` — third read path),
`packages/chat/src/routes.ts:535` (`buildChatToolServices` — already has `connectorsRepository`),
`packages/module-sdk/src/index.ts:66` (`ToolExecute = (scopedDb, input, ctx, services?)`),
`packages/email/sql/0012_email_module.sql:3` (`connector_account_id uuid NOT NULL REFERENCES app.connector_accounts(id) ON DELETE CASCADE`),
`packages/calendar/src/manifest.ts:198` (`requiresServices` precedent on write tools).

## 1. Problem

#482 Phase 1 (#502) gates the **per-account** feature axis (email/calendar on/off per connected
account) in the places that take an account id: Google sync (`sync-jobs.ts`), the live per-account
tools, calendar write, and the settings toggles. It could **not** cleanly gate the two **cached,
module-wide read tools** — `email.listVisibleMessages` and `calendar.listVisibleEvents` — because
they aggregate cached rows across _all_ of the owner's connected accounts and receive **no account
id**. So today, revoking email-for-account-X still lets account-X's cached emails flow into AI reads
(chat, briefings, cross-tool reasoning). This is the Phase-2 gap #501 closes.

Out of `#501` scope (already handled, do not duplicate): the module-wide on/off axis is governed by
`sourceBehaviors` (e.g. `email.briefings`); this spec adds only the **per-account** axis on top, and
the two compose (module-wide off ⇒ never used; per-account ⇒ a subset of the remaining rows).

## 2. Decision (the six resolved forks)

1. **The gate applies to every AI read path** — live chat, briefings, and cross-tool reasoning. A
   revoked account's cached rows are invisible to _all_ tool-driven reads, not just chat.
2. **Per-row filtering**, not an account-scoped tool. The tools keep their current module-wide
   aggregate shape and `{}` input; each row is dropped when its `connector_account_id` is not in the
   "granted for this feature" set. Both `EmailMessage` and `CalendarEvent` rows already carry and
   serialize `connector_account_id`, so no row-shape change is needed. (Rejected: an `accountId`
   input shape — it would force every caller to enumerate accounts and fan out N calls, breaking the
   aggregate contract briefings/cross-tool depend on, for zero extra safety.)
3. **An injected, connectors-owned service** carries the grant knowledge across the module boundary —
   the `calendarWrite` / `notesSync` precedent. No `email`/`calendar` → `connectors` compile-time
   dependency is added (grep confirms **no feature module imports another feature module's package
   today**; doing so would brush the "module isolation" hard invariant). This is exactly the
   "ToolServices seam" #482 §4 already named.
4. **The service is a required dependency** of both read tools: `execute` throws if it is absent, and
   the manifest entries declare `requiresServices: ["featureGrants"]`. A forgotten wire becomes a
   **loud** failure caught by existing integration tests — never a silent leak (fail-open) nor a
   silent blank (fail-closed-quiet).
5. **Contract:** `grantedAccountIds(scopedDb, feature) → Promise<Set<string>>`, computed **fresh per
   call** (no cross-request cache, so revoke takes effect on the next read). The tool filters its own
   rows locally (`connector_account_id ∈ set`). Connectors only ever speaks in account ids; the read
   modules only ever touch their own row shape.
6. **Silent filtering** — the tool output schema is unchanged. No `disabledAccountCount` or
   "access off" signal is added to the payload (it would leak per-account topology into the AI prompt
   for marginal benefit; an empty result is already a behavior `sourceBehaviors`-off produces today).

## 3. The service

### 3.1 Interface (consumed by the read tools)

Declared as a small structural interface in the consuming modules (mirroring how `calendar` owns the
`CalendarWriteService` interface it consumes), so neither read module imports a `connectors` type:

```ts
// shape the email/calendar tools narrow the 4th `services` param against
export interface FeatureGrantService {
  grantedAccountIds(
    scopedDb: DataContextDb,
    feature: "email" | "calendar"
  ): Promise<ReadonlySet<string>>;
}
```

### 3.2 Implementation (owned by connectors)

One builder in `packages/connectors/src`, wired at composition. Pure read; owner-scoped via
`scopedDb` RLS:

```ts
// packages/connectors/src/feature-grant-service.ts (new)
export function buildFeatureGrantService(deps: {
  connectorsRepository: ConnectorsRepository;
  preferences: PreferencesRepository;
}): FeatureGrantService {
  return {
    async grantedAccountIds(scopedDb, feature) {
      const accounts = await deps.connectorsRepository.listAccounts(scopedDb); // owner-scoped, carries scopes
      const ids = new Set<string>();
      for (const a of accounts) {
        const stored = await deps.preferences.get(scopedDb, featureGrantsPrefKey(a.id));
        // resolveEffectiveGrants already AND-s scope ∧ grant, with default-on parity for no pref row
        if (resolveEffectiveGrants(a.scopes, stored)[feature]) ids.add(a.id);
      }
      return ids;
    }
  };
}
```

Reuses the existing `featureGrantsPrefKey` + `resolveEffectiveGrants` (#482) verbatim — same
two-gate semantics (`scope ∧ grant`), same default-on-for-missing-row parity. For the realistic
handful of accounts this is one `listAccounts` query + a few single-key pref reads per call;
acceptable, and it guarantees instant revoke.

## 4. The read-tool change

Both `emailListVisibleMessagesExecute` and `calendarListVisibleEventsExecute`:

1. Narrow `services.featureGrants` to `FeatureGrantService`; **throw** if missing
   (`"featureGrants service is not available"`, matching the `narrowCalendarWrite` pattern).
2. After fetching rows from the repository as today, `const ok = await
featureGrants.grantedAccountIds(scopedDb, "email" | "calendar")` and keep only rows where
   `ok.has(row.connector_account_id)`.
3. Serialize the surviving rows exactly as today. Output schema unchanged.

Add `requiresServices: ["featureGrants"]` to the two read-tool manifest entries
(`packages/email/src/manifest.ts:142`, `packages/calendar/src/manifest.ts:190`) so the gateway's own
fail-closed filter is consistent with the in-tool guard.

**Orphaned rows:** `connector_account_id` is `NOT NULL ... ON DELETE CASCADE`, so deleting an account
removes its cached rows — there is no post-delete orphan. The only "row with no live grant" case is a
**revoked-but-retained** account (#482 §5 keeps the cache): it is still in `listAccounts`, its grant
resolves off, and the row is dropped. Both cases yield the correct fail-closed result.

## 5. Wiring the three hosts

The service must be injected everywhere these read tools execute. All three already have (or can
trivially build) `connectorsRepository` + `preferences`:

- **Chat gateway** — `buildChatToolServices` (`packages/chat/src/routes.ts:535`) already receives
  `connectorsRepository`; add `services.featureGrants = buildFeatureGrantService({...})`.
- **Briefings** — `packages/briefings/src/compose.ts:284` currently calls
  `tool.execute(scopedDb, {}, ctx)` with **no 4th arg**. Add a `featureGrants` collaborator to the
  briefings deps and pass it as the 4th `services` arg for the two read tools (or for all manifest
  tools — harmless, only these two consume it).
- **Cross-tool reasoning** — the `reader.runReadTool` path
  (`packages/chat/src/live/cross-tool-reasoning.ts:469`) must thread the same service through to the
  tool `execute`. (Confirm at build time whether `reader` already shares the gateway's services map;
  if so this is a no-op, if not it gains the same injection.)

Because the tool is `requiresServices`-declared and throws when unwired, any missed host fails loudly
in CI rather than leaking.

## 6. Security & invariants

- **Two-gate access preserved + extended to cached reads.** A cached row is read only when
  `scope ∧ grant` for its account — now enforced in chat, briefings, and cross-tool, closing the
  Phase-1 gap.
- **Private by default / no silent leak.** Required service + throw + `requiresServices` means there
  is no code path that returns un-gated cached rows.
- **Module isolation held.** No new cross-module package dependency; the grant knowledge crosses the
  boundary only as an injected service speaking in account ids.
- **AccessContext unchanged.** No new context fields; the grant read is per-actor via `scopedDb` RLS.
- **No secrets surface.** The service returns a set of account ids (the owner's own); no tokens, no
  content. Output schema of the tools is unchanged.
- **Cached data retained, not purged.** This spec only blocks _use_; #482 §5's retain-on-revoke and
  the deferred purge action are unchanged.

## 7. Acceptance criteria

- [ ] Revoking email (or calendar) for one account removes that account's cached rows from
      `email.listVisibleMessages` / `calendar.listVisibleEvents` results in **chat**, **briefings**,
      and **cross-tool reasoning** — verified per path.
- [ ] Re-enabling instantly restores the rows (no sync needed; cache retained).
- [ ] A second connected account whose grant is still on continues to surface, in the same call.
- [ ] Revoking _all_ accounts for a feature yields an empty result with no error and no added output
      field.
- [ ] Removing the `featureGrants` wire from any host makes the relevant integration test fail loudly
      (no silent un-gated read).
- [ ] No new DB table, migration, route, or output-schema field; no `email`/`calendar` → `connectors`
      compile dependency.

## 8. Rollout / blast radius

- `packages/connectors/src/feature-grant-service.ts` — **new** (`buildFeatureGrantService`).
- `packages/connectors/src/index.ts` — export the builder + `FeatureGrantService` type from the
  package entrypoint (the declared public API).
- `packages/email/src/tools.ts` + `packages/email/src/manifest.ts` — gate `execute`, add
  `requiresServices`.
- `packages/calendar/src/tools.ts` + `packages/calendar/src/manifest.ts` — same.
- `packages/chat/src/routes.ts` — wire `featureGrants` into `buildChatToolServices`.
- `packages/briefings/src/compose.ts` — accept + inject the collaborator at the tool-execute site.
- `packages/chat/src/live/cross-tool-reasoning.ts` (+ its `reader`) — thread the service.
- Tests: per-path integration coverage (chat / briefings / cross-tool) + a unit test for
  `grantedAccountIds` (default-on parity, revoke, multi-account intersect).

**No DB migration. No new route. No new permission.** Pure read-path filtering over #482's existing
`app.preferences` grants.

## 9. Out of scope

- Purge cached data on revoke (still deferred to #473 reconciliation, per #482 §11).
- Any new UI — the per-account toggles already shipped in #482 Phase 1.
- An "email access is off" message surfaced to the model (deferred; would come from grant state in a
  later UX slice, not this tool's payload).
- The module-wide `sourceBehaviors` axis (already gates module-wide cached usage).
- Admin-managed or time-windowed grants (#482 §11).

## 10. Process gate

Per repo hard rule: this draft needs (a) Ben sign-off → `Status: approved`, and (b) a GitHub `task`
issue (`Part of #501`) before any build. Build is for the model-diverse build/QA gate, not the spec
author.
