# Settings: Google OAuth client JSON upload (#472)

**Status:** approved
**Date:** 2026-06-25
**Owner:** Ben + Codex
**Grounded on:** `~/Jarv1s/apps/web/src/onboarding/google-connector-step.tsx` (`importCredentialsJson`,
`extractGoogleClientCredentials`), `apps/web/src/settings/settings-google-connect.tsx` (`GoogleConnect`),
`apps/web/src/connectors/use-google-connect-flow.ts`.

## 1. Decision

Add the same Google OAuth client JSON upload path that onboarding has to the **Settings → Connect
Google** screen. Pure frontend reuse — no new backend, routes, or secrets handling. The upload
simply populates the existing client ID / client secret fields; the current `useGoogleConnectFlow`

- encrypted-at-rest storage takes over unchanged.

This is a dogfood follow-up: live prod connector setup exposed that paste-only is error-prone.

## 2. Reuse, not duplicate

The two reusable pieces currently live in `apps/web/src/onboarding/google-connector-step.tsx`:

- `extractGoogleClientCredentials(payload)` (line 435) — pure parser, returns
  `{ clientId, clientSecret } | null` from a Google OAuth client JSON shape.
- `importCredentialsJson(event)` (line 78) — file-input handler that reads the file, parses, calls
  the extractor, and surfaces a status string.

**Extract both into `apps/web/src/connectors/google-credentials.ts`** (the shared module both
onboarding and settings already import `useGoogleConnectFlow` from). Onboarding and Settings then
import from the shared location. A future third surface gets it free.

`importCredentialsJson` is refactored to be UI-agnostic: it takes the file event and returns
`{ clientId, clientSecret } | { error: string }`, leaving the caller (onboarding or settings) to
wire its own status state — the onboarding version currently writes to a local `setJsonImportStatus`
directly, which couples it to one consumer.

## 3. Settings UI change

In `apps/web/src/settings/settings-google-connect.tsx`, inside `GoogleConnect`, add the JSON upload
affordance at the top of the existing **"1 · Paste your client credentials"** section (above the two
`CredField`s):

- A labeled file input (`<input type="file" accept="application/json,.json">`) with an upload icon
  and copy: **"Or upload your Google client JSON file"**.
- On success: populates `google.setClientId` / `google.setClientSecret` from the extracted values
  and shows a one-line status ("Credentials imported from JSON.") using the same status pattern the
  paste fields use.
- On failure (not valid JSON, or wrong Google credential shape): shows the extractor's clear error
  ("That file does not look like a Google OAuth client JSON file." / "Could not read that JSON
  file.").

The paste fields remain visible and editable below — upload is an alternative input for step 1, not
a replacement. A user who uploads can still inspect/edit the populated values before authorizing.

## 4. Security & invariants

- **No change to the secrets model.** The client secret never touches the network until the existing
  authorize/finish flow runs, which already encrypts at rest (CLAUDE.md invariant: connector/AI
  secrets are AES-256-GCM encrypted). The upload only sets local React state.
- **No persistence on upload.** Uploading the JSON does not save anything to the server; it fills
  the form. The user still clicks through the existing authorize → finish flow.
- **No secret in the status message.** The success/error strings above never echo the secret value.
- **Client-side parsing only.** The JSON is parsed in the browser; nothing is uploaded as a file to
  any API.

## 5. Acceptance criteria (from #472)

- [ ] Settings → Connect Google supports both manual paste AND JSON upload.
- [ ] Uploaded JSON extracts the same client ID / client secret fields onboarding accepts.
- [ ] Invalid JSON or wrong Google credential shape shows a clear validation error.
- [ ] No client secret is logged or persisted until the existing authorize flow runs.
- [ ] Onboarding's JSON upload still works after the extraction (no regression).
- [ ] No new API routes, DB migrations, or permissions.

## 6. Rollout / blast radius

- `apps/web/src/connectors/google-credentials.ts` — new shared module (extracted functions).
- `apps/web/src/onboarding/google-connector-step.tsx` — import from the shared module instead of
  defining locally.
- `apps/web/src/settings/settings-google-connect.tsx` — add the upload affordance + import from the
  shared module.

No backend changes. No migrations. No new permissions.

## 7. Out of scope

- Auto-detecting the JSON shape variants beyond the current Desktop-app client credential shape.
- A server-side JSON ingest endpoint (not needed; client parse suffices).
- Migrating the onboarding walkthrough UI itself (only the shared functions move).
