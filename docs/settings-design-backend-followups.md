# Settings design — backend follow-ups

The 2026-06-14 settings design pass landed the UI for every settings surface. Several
surfaces render against **representative/sample data or local-storage** because the backend
piece does not exist yet. Each one is marked in code with a greppable token:

```sh
grep -rn "BACKEND-TODO" apps/web/src/settings
```

This file is the consolidated checklist. Nothing below is wired to real persistence/compute
unless stated. When you build one, remove its `BACKEND-TODO` marker and tick it here.

## Assistant & AI (Admin)

- [ ] **Auto-detect models on connect** — on provider connect, return the available models with
      capability + tier tags. Today the UI has a manual "Add model" form as a stand-in.
      `settings-ai-admin-pane.tsx` (`AddModelForm`, `ProviderCard` roster).
- [ ] **Test-connection endpoint** — back the "Test" buttons on provider cards and the API-key
      field. Today they emit a "coming soon" toast. `settings-ai-admin-pane.tsx` (`ProviderCard`).
- [ ] **Capability routing persistence** — persist the routing map (capability → modelId)
      instance-wide and make the per-capability dropdowns settable. Today they read the computed
      route and the dropdown onChange is a placeholder toast. `settings-ai-admin-pane.tsx`
      (`RouterRow`).

## Assistant & AI (Personal)

- [ ] **Persona persistence + system-prompt feed** — persist persona text + the four dials and
      feed them into the system prompt. Today saved to local storage; the live preview is a
      deterministic illustration (`personaSample`). `settings-ai-pane.tsx` (`Persona`),
      `settings-persona-preview.ts`. **Open question:** the voice preview is fake — real version
      should reflect the true system-prompt-driven voice.
- [ ] **Personal chat-model override** — per-user "which model powers my chat" preference layered
      on the instance chat route. Today local storage only. `settings-ai-pane.tsx` (`ChatModel`).
      **Decision needed:** allow per-user override at all, or drop to a read-only line?

## Profile & account

- [x] **Profile update endpoint** — persist Display name + "How Jarvis addresses you". Wired:
      `PATCH /api/me/profile` (name → `app.users`, addressed → `app.preferences`). `GET /api/me`
      now returns `profilePrefs.addressed`.
- [ ] **Data export** — server-side archive build → poll-for-ready → signed download URL. Today
      the job lifecycle is simulated client-side and "Download" emits a fixed-content JSON, not a
      real archive. `settings-profile-subviews.tsx` (`DataExport`).
- [ ] **Active sessions** — list-sessions endpoint (device / browser·OS / LAN IP / last-seen from
      the better-auth session table); wire per-device + bulk revoke to it. Today the device list is
      `SAMPLE_SESSIONS`. `settings-profile-subviews.tsx` (`Sessions`),
      `settings-sample-data.ts`.
- [ ] **Security / delete account** — held intentionally (depends on the auth provider:
      password/2FA, account deletion). Still `Coming soon` on purpose.

## Data sources

- [ ] **Server-side vault path chooser** — host-filesystem listing API (reachable mounts +
      directory contents) and read-only mount enforcement. Today browses the `SERVER_FS` sample
      tree. `settings-vault-chooser.tsx`, `settings-sample-data.ts` (`SERVER_FS`).
- [ ] **Vault link + behaviors persistence** — persist the chosen folder and the notes behavior
      toggles. Today local state. `settings-personal-data-panes.tsx` (`SourcesPane`).
- [ ] **Calendar/email source behaviors** — the per-source behavior states are illustrative
      badges; persist + apply them. `settings-personal-data-panes.tsx` (`DATA_SOURCES`).

## Modules

- [ ] **Per-module settings persistence** — persist + apply the Briefings / Chat / Notifications
      settings objects (cadence, sections, depth, read-aloud / length, streaming, suggestions,
      cross-session memory, voice / sensitivity, channels, per-type mutes). Today local state only.
      `settings-module-subviews.tsx`.
- [ ] **Curated module list** — the personal Modules pane is filtered to a user-facing allowlist
      (`USER_FACING_MODULES`) because the registry exposes internal infra modules. If a new
      user-facing module is added, it must be added to that allowlist (and to `OPTIONAL_MODULES`
      if it's opt-in). `settings-personal-data-panes.tsx`.

## General

- [x] **Locale persistence** — time zone, language/region, and date format are wired to
      `GET/PUT /api/me/locale`. `settings-personal-data-panes.tsx` (`GeneralPane`).
- [ ] **Quiet hours persistence** — quiet-hours enable + window. Today uncontrolled defaults,
      no persistence. `settings-personal-data-panes.tsx` (`GeneralPane`).

## Admin — host

- [ ] **Host diagnostics / restart / verbose logging** — "Restart server", "Run diagnostics" and
      verbose logging are placeholder toasts. `settings-admin-panes.tsx` (`HostPane`).

## Already real (no follow-up)

- Provider add/remove/auth-method/credential editing — wired (`updateAiProvider` takes
  `baseUrl` + `credentialPayload`).
- Google connect (full OAuth flow), connector revoke.
- People & access (approve/decline/promote/demote/deactivate/remove), registration settings,
  instance-module enable/disable, connector oversight.
- Audit log — reads real `AdminAuditEventDto`; filters + CSV export are real. The `auditPhrase`
  action→copy map should be extended as new action types appear server-side.
