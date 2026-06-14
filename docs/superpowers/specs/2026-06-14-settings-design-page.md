# Settings page — Jarvis Design System implementation

**Date:** 2026-06-14 · **Branch:** `feat/settings-design-page` · **Surface:** `apps/web` only

## Problem

The web `/settings` route is a flat stack of legacy panels (Profile, Connectors,
Google, AI providers, Auth providers, Admin users) that predates the Jarvis Design
System and does not match the locked design handoff. The design handoff (Claude
Design bundle, `ui_kits/jarvis-app/`, chat transcript `chats/chat5.md` "Settings
Architecture") defines a macOS/Notion-style two-column settings hub. **This design
overrides anything currently in place.**

## Decision (from the handoff + Ben, 2026-06-14)

Rebuild `/settings` as a two-column hub, faithful to the prototype, **all 13 panes,
Personal + Admin**. Wire panes to real APIs where they already exist; render the rest
exactly as the design shows with a clear **"Coming soon"** badge (the coming-soon rows
double as visual TODOs). **No new backend endpoints this pass.**

- **Shell:** `Personal ↔ Admin / Setup` segmented toggle + a persistent **Advanced**
  switch on top; a category sub-nav on the left; a detail pane on the right. Mode,
  active category (per mode), and Advanced state persist in `localStorage`.
- **Modules link OUT, never inline** — each module row deep-links to the module's own
  route. **Advanced** reveals provider/model/API-key/CLI fields in Assistant & AI and
  gates the entire Advanced-host pane (locked placeholder when off).
- **Coming-soon = a normal row with a badge, never a fake toggle.**
- Feedback layer: quiet **toast** for simple actions; **confirm dialog** for
  destructive ones (reuses `.jds-toast` / `.jds-dialog`).

## Pane → data mapping

| Mode     | Pane                    | Wiring                                                                                                                                                                |
| -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal | Profile & account       | **Real** `getMe()` (name/email/role). Sessions/export/security/delete → Coming soon                                                                                   |
| Personal | Assistant & AI          | Persona text + tone choices (local, Coming-soon persist). **Advanced**: **real** AI providers/models (`listAiProviders`/`listAiModels`, add/revoke), CLI-default auth |
| Personal | Memory & context        | **Real** `getMemorySettings`/`patchMemorySettings` (recall, facts); fact counts from `getMemoryFacts`; link → Knowledge. Retention/per-topic → Coming soon            |
| Personal | Connected accounts      | **Real** `listConnectorAccounts` (health/scopes), revoke. Connect → describes action                                                                                  |
| Personal | Data sources            | Provider-agnostic behaviour toggles + Notes/vault — **static/Coming-soon** (no settings API)                                                                          |
| Personal | Modules                 | **Real** `getMyModules` (active state) + self-service toggle `PATCH /api/me/modules/:id`; "Open settings" deep-links to module route                                  |
| Personal | General                 | Locale / quiet hours — **static/Coming-soon**                                                                                                                         |
| Admin    | People & access         | **Real** `listAdminUsers` + approve/reject/promote/demote/deactivate/reactivate. Invite → Coming soon                                                                 |
| Admin    | Identity & registration | **Real** `getRegistrationSettings`/`put…`; sign-in methods from `listAuthProviderStatuses` (read-only)                                                                |
| Admin    | Instance modules        | **Real** `listAdminModules` + `PATCH /api/admin/modules/:id`                                                                                                          |
| Admin    | Audit & operations      | Recent activity / backups — **static/Coming-soon**                                                                                                                    |
| Admin    | Connector oversight     | **Real** `listAdminConnectorAccounts` (health metadata only)                                                                                                          |
| Admin    | Advanced host setup     | Advanced-gated. **Real** `getChatMultiplexerSettings`; diagnostics/restart → Coming soon                                                                              |

## Non-goals

New endpoints (audit log, instance settings for locale/quiet-hours, data-source
behaviour persistence, invites, sessions, export/delete); per-module settings sub-views;
the cross-page "← Back to Settings" return bar (module links navigate normally).

## Verification

`pnpm lint && pnpm format:check && pnpm check:file-size && pnpm typecheck` green;
manual click-through of both modes + Advanced on/off in light & dark.
