# Wellness AI Access Consent (#474)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/packages/wellness/src/tools.ts` (`wellness.recentCheckIns`,
`wellness.medicationAdherence`), `packages/wellness/src/manifest.ts`,
`packages/structured-state/src/preferences-repository.ts` (`app.preferences`, owner-scoped RLS),
`packages/module-sdk/src/index.ts` (`ToolServices` opaque service registry),
`packages/module-registry/src/active-modules-resolver.ts` (`resolveActiveModules`).

**Depends on:** the Module Settings Connector spec (`2026-06-25-module-settings-connector.md`) —
this surface is the first contributed module settings component.

## 1. Decision

Give users an explicit, editable control over whether Jarvis (AI) can read their Wellness data.
Ship it as the **first contributed module settings surface** (lives in
`packages/wellness/src/settings/`, not in `apps/web`).

Two policy decisions locked in grilling:

1. **Both Wellness AI-read tools gate behind the same consent switch** — `wellness.recentCheckIns`
   _and_ `wellness.medicationAdherence`. Medication adherence is sensitive health data; one switch =
   one mental model ("Jarvis may read my Wellness data"); a half-gate leaves a footgun for future
   detail-leaks. The prior "counts-only, no gate" posture is retired.
2. **Consent defaults ON for Wellness-enabled users** (existing and new), realized by
   **derive-on-read** — see §4. No migration, no silent writes.

## 2. Consent state model

Single source of truth: the `wellness.ai_consent_granted` preference in `app.preferences`
(owner-scoped RLS, already mutable by app runtime via `PreferencesRepository.upsert`).

**Effective consent** (what the tools actually enforce):

```
effectiveConsent =
  explicit pref if the preference is set
  else (wellness module active for this user) ? true   // inherit module enablement
  else false
```

A user who has Wellness enabled but has never touched the consent control gets `true` (default ON).
A user who has never enabled Wellness gets `false`. Toggling the control writes the explicit pref
and severs the derivation.

The Settings switch shows an "Inherited" `Badge` (neutral tone) when the pref is unset, and a plain
on/off state when explicitly set.

## 3. UI — contributed Wellness settings surface

`packages/wellness/src/settings/index.tsx` exports a default React component rendered by the
Module Settings Router. Contents:

- `<PaneHead>` — "Wellness" / "What Jarvis can read from your Wellness data."
- A `<Group title="AI access">` containing one `<Row>` with a `<Switch>`:
  - **Name:** "Allow Jarvis to read your wellness data"
  - **Desc:** "When on, Jarvis can read your mood check-ins and medication adherence to reference
    them in briefings and answer questions about them. Counts only — never a medication list. Turn
    off anytime; Jarvis will explain how to re-enable if asked."
  - **"Inherited" badge** when pref unset (effective ON via module enablement).
  - Toggling writes `wellness.ai_consent_granted` via a new endpoint (§5).
- A `<Note>`: "Disabling this does not turn off the Wellness module itself — you'll still log
  check-ins and meds; Jarvis just won't see them."

The surface is reached from the Modules pane "Configure" link on the Wellness row (the router's
generic contributed-surface branch added in the connector spec).

## 4. Tool-path derivation (the cycle problem)

`packages/wellness` **cannot** import `@jarv1s/module-registry` (the registry imports wellness —
that's a cycle). So the module-active lookup must be **injected** via the existing `ToolServices`
opaque registry (constructed by the composition host, which already has the registry).

### Shared helper

New file `packages/wellness/src/ai-consent.ts`:

```ts
export interface WellnessActiveService {
  readonly wellnessActive: boolean;
}

/** Returns effective consent: explicit pref if set, else inherited from module-active. */
export async function resolveEffectiveWellnessConsent(
  scopedDb: DataContextDb,
  preferences: PreferencesRepository,
  services: ToolServices | undefined
): Promise<boolean> {
  const explicit = await preferences.get(scopedDb, "wellness.ai_consent_granted");
  if (explicit === true || explicit === false) return explicit;
  // Pref unset → inherit module enablement.
  return (services as WellnessActiveService | undefined)?.wellnessActive ?? false;
}
```

### Tool changes (`packages/wellness/src/tools.ts`)

Both `wellnessRecentCheckInsExecute` and `wellnessMedicationAdherenceExecute` replace their current
consent check with a call to `resolveEffectiveWellnessConsent(scopedDb, preferences, services)` and
return the existing `{ error: "Consent not granted", code: "WELLNESS_CONSENT_REQUIRED" }` when
denied. The meds tool currently has _no_ gate — add the same gate (this is the half-gate fix).

The tool signatures already accept `services?: ToolServices` (4th param); the gateway already
passes the registry-built registry through. No `ToolContext` change, no `AccessContext` change.

### Composition host wiring

The composition host (where `ToolServices` is built — find via the gateway wiring) adds one entry:

```ts
services: {
  wellnessActive: await resolveActiveModules(actorUserId).some((m) => m.id === "wellness");
}
```

This is the only place that touches the registry; wellness stays cycle-free.

## 5. API surface

One new route, owned by the Wellness module (added to `manifest.routes[]` and
`packages/wellness/src/routes.ts`), guarded by `wellness.view`:

- `GET /api/wellness/ai-consent` → `{ effective: boolean, explicit: boolean | null }`
  (`explicit: null` = pref unset → inherited).
- `PUT /api/wellness/ai-consent` body `{ granted: boolean }` → writes the pref, returns the new
  effective state.

These reuse `PreferencesRepository.get`/`upsert` and the existing
`resolveActiveModules`-via-injected-service pattern for the `effective` derivation on the read
side. (The route handler is in the API process which _can_ see the registry directly — no cycle
there.)

Schemas added to `packages/shared/src/wellness-api.ts`: `wellnessAiConsentResponseSchema`,
`putWellnessAiConsentRequestSchema`.

## 6. Web client

In `apps/web/src/api/client.ts` (or a new `wellness-client.ts` mirroring `notes-client.ts`):

- `getWellnessAiConsent()` → `GET`
- `putWellnessAiConsent(granted)` → `PUT`

`queryKeys.wellness.aiConsent` added to `apps/web/src/api/query-keys.ts`.

The contributed settings component (§3) uses these via React Query; toggling invalidates
`queryKeys.wellness.aiConsent` and shows a toast.

## 7. Jarvis can explain

Per the issue acceptance ("Jarvis can explain where to enable access when a tool returns
consent-required"): the `WELLNESS_CONSENT_REQUIRED` tool result already carries a `code`. The
assistant system prompt / tool-result summarizer describes this code as: _"The user has not granted
Wellness AI access. Direct them to Settings → Modules → Wellness → Configure."_ No new tool needed —
the model already has the code and a one-line description suffices.

## 8. Acceptance criteria (from #474 + grilling)

- [ ] User-visible control exists in Settings to grant/revoke Jarvis AI access to Wellness data.
- [ ] Control lives in `packages/wellness/src/settings/` (contributed via the connector, NOT in
      `apps/web` core).
- [ ] Control updates `wellness.ai_consent_granted`.
- [ ] **Both** `wellness.recentCheckIns` and `wellness.medicationAdherence` respect the consent
      switch; both return `WELLNESS_CONSENT_REQUIRED` when denied.
- [ ] Default ON for Wellness-enabled users (pref unset → inherited true); default OFF for users
      without Wellness enabled.
- [ ] Settings switch shows "Inherited" badge when pref unset; plain on/off when explicitly set.
- [ ] Revoking consent takes effect immediately on the next tool call (no caching of the grant
      beyond the per-call read).
- [ ] Jarvis can direct the user to the control when a tool returns consent-required.
- [ ] No migration. No silent data write on deploy. No new `AccessContext`/`ToolContext` fields.
- [ ] `packages/wellness` does not import `@jarv1s/module-registry` (cycle-free).

## 9. Rollout / blast radius

- `packages/wellness/src/ai-consent.ts` — new (shared consent helper).
- `packages/wellness/src/tools.ts` — both tools gate; meds tool gains a gate.
- `packages/wellness/src/manifest.ts` — add the settings surface (`entry: "./settings"`) and the
  two `/api/wellness/ai-consent` routes.
- `packages/wellness/src/settings/index.tsx` — new contributed surface.
- `packages/wellness/src/routes.ts` — consent GET/PUT handlers.
- `packages/shared/src/wellness-api.ts` — consent DTOs + schemas.
- `apps/web/src/api/client.ts` (or `wellness-client.ts`) + `query-keys.ts` — client fns + key.
- Composition host (ToolServices builder) — inject `wellnessActive`.
- **No DB migration** (uses existing `app.preferences`).

No changes to `apps/web/src/settings/*` core files — the surface mounts via the router from the
connector spec.

## 10. Out of scope

- Migrating Briefings/Chat/Notifications to contributed surfaces (connector spec).
- Per-tool granularity (single switch governs both Wellness read tools; no matrix).
- A consent audit log (could be added later via the existing audit infrastructure).
- Re-evaluating the "counts only, never a medication list" meds-tool output shape (unchanged; only
  the gate is added).

## 11. Addendum (2026-07-04, #769) — enumerate every AI-prompt surface the switch governs

**Gap found:** `WellnessRecallContributor.refreshEnergyTrendFact` writes a
`[wellness:energy-trend] …` profile fact via `ChatMemoryFactsRepository` on every check-in
create/update (`routes.ts`). Chat-memory facts are read back into chat prompts — an AI-prompt
surface exactly like the two read tools — but this contributor was never wired to
`resolveEffectiveWellnessConsent`. §4/§8 above only enumerated the two tools; the switch's
_actual_ contract ("Jarvis can/cannot use my Wellness data") is broader than "the two read
tools," and a recall contributor silently fell outside it. Fixed in #769: the contributor now
takes the resolved effective-consent boolean and skips the write when consent is withheld, and
revoking consent (`PUT /api/wellness/ai-consent` with `granted: false`) immediately supersedes
any already-active `[wellness:energy-trend]` fact rather than waiting for the next check-in.

**Rule going forward:** `wellness.ai_consent_granted` governs **every** surface that feeds
Wellness-derived content into an AI prompt, not just tool calls. Enumerated surfaces as of
2026-07-04:

- `wellness.recentCheckIns` tool (`tools.ts`) — gated.
- `wellness.medicationAdherence` tool (`tools.ts`) — gated.
- `WellnessRecallContributor.refreshEnergyTrendFact` chat-memory fact (`recall-context.ts`) —
  gated (this addendum).

**Explicitly NOT governed** (not AI-prompt paths): `focus-signal.ts` (`wellnessFocusSignal`) feeds
the in-app "Today" UI focus/readiness surface, not a prompt — no change needed there.

Any future Wellness recall contributor, briefing section, or notification-composer input that
feeds Wellness-derived content into an LLM prompt must resolve effective consent the same way
(`resolveEffectiveWellnessConsent`) before writing/including that content. Do not assume "it's not
one of the two tools" means the consent gate doesn't apply.
