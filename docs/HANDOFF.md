# Jarv1s Handoff And Next-Agent Instructions

Date: 2026-06-06

## Current State

This is a brand new project for an AI personal assistant OS called Jarv1s.

The GitHub remote is configured:

```txt
https://github.com/motioneso/Jarv1s.git
```

The repo now has a minimal MVP foundation scaffold around the proven security/job substrate, the
M1 Tasks module vertical slice, and the M2 platform contract hardening slice.

Two implementation spikes are complete and retained as executable proof:

- Spike 0001 proved auth/session context through Kysely transactions and Postgres RLS.
- Spike 0002 proved pg-boss can fit the worker RLS posture when job payloads are metadata-only and handlers enter `withDataContext()`.

The scaffold adds:

- pnpm workspace packages and apps
- `packages/db` with Kysely setup, typed tables, `AccessContext`, `withDataContext()`, and a raw SQL migration runner
- `packages/jobs` with pg-boss runtime client helpers, metadata-only payload conventions, and data-context worker registration
- `apps/api` with a minimal Fastify health server
- `apps/worker` with a minimal pg-boss probe worker
- `infra/docker-compose.yml` with Postgres, migrate, API, and worker services
- integration tests proving the substrate from real packages

M1 adds:

- `packages/module-sdk` with tiny built-in module manifest types
- `packages/module-registry` that loads built-in manifests, module SQL directories, queues, API routes, and worker registrations
- `packages/tasks` with manifest, module-owned SQL, RLS repository, Fastify routes, and one metadata-only worker job
- `app.tasks` and `app.task_activity` with `FORCE ROW LEVEL SECURITY`
- API routes for list, create, get, update, activity append, and deferred status enqueue
- integration tests proving task privacy, sharing, session-derived API context, metadata-only job payloads, and worker no-bypass behavior

M2 adds:

- `docs/architecture/plans/0003-platform-first-alpha-roadmap.md` as the M2-M7 roadmap
- expanded module manifest metadata for navigation, settings, permissions, feature flags, availability, jobs, routes, and assistant tools
- built-in module registration records that keep manifest metadata separate from runtime SQL, route, queue, and worker wiring
- shared Tasks REST request/response contracts and Fastify schemas in `packages/shared`
- ESLint, Prettier, Turborepo wiring, and a `pnpm check:file-size` guard for the 1000-line decomposition rule

M3 backend slice adds:

- `@jarv1s/auth` Better Auth integration for local email/password auth and session reads
- Better Auth mounted at `/api/auth/*` in the Fastify API
- request-level access-context resolution that supports Better Auth cookies and legacy bearer test sessions
- active workspace context validation so `x-jarvis-workspace-id` is accepted only for joined workspaces
- optional Google, GitHub, Microsoft, and generic OIDC auth-provider configuration from environment variables
- `app.auth_accounts`, `app.better_auth_sessions`, `app.auth_verifications`, `app.workspaces`, and `app.instance_settings`
- `app.admin_audit_events` for bootstrap and mutating admin/settings actions
- first-user bootstrap that marks the first Better Auth user as instance admin and creates a personal workspace
- required built-in Settings module registration with admin APIs for users, auth provider status, workspaces, memberships, resource grants, instance settings, and audit events
- shared Settings/Admin REST request/response contracts and Fastify schemas in `packages/shared`
- integration tests proving first-user bootstrap, admin-only settings APIs, auth provider status without secrets, workspace context validation, audit records, grant-created Tasks visibility, and grant/membership revocation

M4 app shell slice adds:

- `apps/web` React/Vite app with React Router, TanStack Query, authenticated routing, and PWA assets
- session handling for first-user bootstrap sign-up, email/password sign-in, sign-out, and `/api/me`
- app shell navigation sourced from authenticated `/api/modules` manifest metadata
- persisted workspace selector that sends `x-jarvis-workspace-id` through the REST API client
- Tasks list/create/read/update/archive UI over the existing Tasks REST API
- minimal Settings account/workspace/admin visibility surfaces
- install metadata, SVG app icon, service worker, and offline navigation fallback
- Playwright smoke tests for auth shell navigation, Tasks REST UI flows, and PWA manifest metadata

M5 Notes thin-core slice adds:

- `packages/notes` as a required built-in module with package manifest, owned SQL migration, RLS repository, and Fastify REST routes
- `app.notes` with private-by-default notes, optional workspace visibility, resource grants for `note`, and `FORCE ROW LEVEL SECURITY`
- `0007_tighten_workspace_update_rls.sql` to require active workspace context when Tasks or Notes are updated to workspace visibility
- shared Notes REST contracts and schemas in `packages/shared`
- module-registry wiring for Notes migration discovery, manifest metadata, navigation, routes, and shareable resource declaration
- `/notes` and `/notes/:noteId` web UI for create/list/read/update/archive through REST
- focused Notes integration tests and Playwright smoke coverage for the Notes UI flow

M5 Notifications thin-core slice adds:

- `packages/notifications` as a required built-in module with package manifest, owned SQL migration, RLS repository, and Fastify REST routes
- `app.notifications` and `app.notification_reads` with private recipient notifications, workspace-visible notifications, per-user read state, metadata JSON, and `FORCE ROW LEVEL SECURITY`
- shared Notifications REST contracts and schemas in `packages/shared`
- module-registry wiring for Notifications migration discovery, manifest metadata, navigation, and routes
- `/notifications` web UI plus a shell unread indicator for list, unread count, mark read, and mark all read
- focused Notifications integration tests proving migration/RLS, admin non-bypass, private-by-default creation, active workspace context, read-state APIs, and repository data-context enforcement
- expanded Playwright smoke coverage to include the notification center

M5 Connectors/security foundation slice adds:

- `packages/connectors` as a required built-in module with package manifest, owned SQL migration, RLS repository, Fastify REST routes, and a small server-side crypto helper
- `app.connector_definitions` for safe provider definitions/status and `app.connector_accounts` for per-user connector authorizations with optional workspace scope, scopes, status, timestamps, and encrypted token JSON
- AES-256-GCM connector secret encryption using `JARVIS_CONNECTOR_SECRET_KEY`, with a development fallback outside production and a hard production requirement
- safe connector DTOs and Fastify schemas in `packages/shared`; APIs never return plaintext token material or ciphertext
- `0010_connector_admin_safe_metadata.sql` adds a metadata-only admin listing function that still requires an admin actor in data context and does not expose encrypted secrets
- `/api/connectors/providers`, `/api/connectors/accounts`, `/api/connectors/accounts/:id`, `/api/connectors/accounts/:id/revoke`, and `/api/admin/connectors/accounts`
- owner-only connector account RLS, active workspace context validation for workspace-scoped accounts, and no worker table grants
- a minimal Settings connectors UI for provider/account status, placeholder token JSON entry, status updates, and revoke
- focused connector integration tests proving encryption-at-rest, no API leakage, user isolation, workspace validation, production key requirement, admin no-secret behavior, and repository data-context enforcement
- expanded Playwright smoke coverage to include the connector settings flow

M5 Calendar and Email connector-backed read slice adds:

- `packages/calendar` and `packages/email` as required built-in modules with package manifests, owned SQL migrations, RLS repositories, and Fastify REST routes
- `app.calendar_events` and `app.email_messages` as local cached read-only product surfaces tied to `connector_account_id`, `owner_user_id`, optional workspace context, external IDs, and safe metadata only
- private-by-default RLS with active-workspace visibility for workspace rows, admin no-bypass behavior, connector account ownership/provider checks for local cache inserts, and `FORCE ROW LEVEL SECURITY`
- no worker table grants for Calendar or Email cache tables
- shared Calendar and Email REST DTOs/schemas in `packages/shared`
- module-registry wiring for Calendar and Email migration discovery, manifest metadata, navigation, routes, and queue-free registration
- `/calendar` and `/email` React views over TanStack Query with compact read surfaces
- focused Calendar/Email integration tests and expanded Playwright smoke coverage for Calendar and Email navigation/rendering with mocked REST

M6 AI provider/settings foundation slice adds:

- `packages/ai` as a required built-in module with package manifest, owned SQL migration, RLS repository, Fastify REST routes, and a small server-side crypto helper
- `app.ai_provider_configs` and `app.ai_configured_models` with current-user ownership, forced RLS, provider metadata/status, encrypted credential JSON, configured model IDs, and model capability metadata
- AES-256-GCM AI credential encryption using `JARVIS_AI_SECRET_KEY`, with a development fallback outside production and a hard production requirement
- safe AI provider/model/capability/tool DTOs and Fastify schemas in `packages/shared`; APIs never return plaintext credential material or ciphertext
- `/api/ai/providers`, `/api/ai/providers/:id`, `/api/ai/providers/:id/revoke`, `/api/ai/models`, `/api/ai/models/:id`, `/api/ai/capability-route/:capability`, and `/api/ai/assistant-tools`
- capability lookup that selects only current-user active models on active provider configs and returns safe metadata only
- assistant tool metadata serialization from module manifests only, including module, permission, risk, and optional input/output schemas, with no tool execution
- no worker table grants for AI provider/model tables
- a minimal Settings AI provider/model UI for create, deactivate/reactivate, revoke, model activation, capability lookup, and manifest tool metadata
- focused AI integration tests proving migration/RLS posture, encrypted-at-rest credentials, API non-leakage, user/admin isolation, DataContext-only repository access, capability routing, and manifest-derived assistant tool metadata

M6 Chat thin slice adds:

- `packages/chat` as a required built-in module with package manifest, owned SQL migration, RLS repository, and Fastify REST routes
- `app.chat_threads` and `app.chat_messages` with owner user IDs, optional active-workspace visibility, role/status/body fields, safe model/tool metadata JSON, timestamps, forced RLS, and no worker grants
- Chat repository methods for list/create/get thread, list messages, and append user message through `DataContextDb` only
- deterministic assistant-side message creation that records safe AI capability-route metadata for `chat` when a chat-capable configured model exists, or a safe `no_model` status when it does not
- selected assistant tool metadata recording by manifest-declared name, module, permission, and risk only; no tool execution and no cross-module mutation
- shared Chat REST DTOs/schemas in `packages/shared`
- `/api/chat/threads`, `/api/chat/threads/:id`, and `/api/chat/threads/:id/messages` routes through `AccessContext -> withDataContext() -> RLS`
- `/chat` React view with thread list/create, message list, composer, model-route status, and manifest tool metadata display/selection
- focused Chat integration tests proving migration/RLS/no worker grants, private-by-default behavior, admin no-bypass, DataContext-only repository access, workspace context enforcement, safe model/tool metadata, no provider/secret leakage, and no tool/task mutation
- follow-up Chat RLS hardening limits non-owner workspace participants to timestamp refreshes on shared threads; they cannot retitle or move another user's workspace chat thread
- Playwright Chat smoke coverage with split mock helpers so `tests/e2e/mock-api.ts` remains below the 1000-line guard

M6 read-only assistant tool execution foundation slice adds:

- shared typed AI assistant tool invocation REST contracts and Fastify schemas in `packages/shared`
- `POST /api/ai/assistant-tools/:name/invoke` for server-side assistant tool invocation
- a small `packages/ai` read-only executor that accepts only manifest-selected tools and a `DataContextDb`
- read-only executor support for `tasks.listVisible`, `notes.listVisible`, `notifications.listVisible`, `calendar.listVisibleEvents`, and `email.listVisibleMessages`
- invocation responses with module/name/permission/risk/status metadata and bounded JSON REST DTO results
- safe blocking for `tasks.updateStatus` and any non-read risk tool with `status: blocked`, no mutation, and no pg-boss job enqueue
- focused `pnpm test:ai-tools` integration coverage for manifest-derived metadata, read RLS visibility, admin no-bypass, non-read blocking, no secret/ciphertext leakage, no new queues/jobs, and repository `DataContextDb` enforcement
- no Briefings, model/provider calls, embeddings, connector sync, jobs, write/destructive execution, root DB access, provider-client access, or secret access in this slice

M6 Briefings scheduled/read-only summary slice adds:

- `packages/briefings` as a required built-in module with package manifest, owned SQL migration, RLS repository, Fastify REST routes, and metadata-only pg-boss run worker
- `app.briefing_definitions` and `app.briefing_runs` with private-by-default visibility, optional active-workspace visibility, schedule metadata, selected read tool names, deterministic run summaries, source metadata counts/excerpts, and `FORCE ROW LEVEL SECURITY`
- narrow worker grants only for reading/updating owned briefing definitions and inserting/selecting briefing runs through RLS; no worker delete grants and no private-data bypass for admins
- Briefings repository methods for list/create/update definitions, list runs, and `generateRun()` through `DataContextDb` only
- deterministic generation through the AI read-only assistant tool executor for selected declared read-risk tools only; write/destructive tool names are rejected or blocked and never executed
- `briefings-run` queue with payloads limited to actor id, workspace id, definition id, run id, run kind, and idempotency key; no prompt text, summaries, raw tool results, secrets, ciphertext, or private source content in job payloads
- shared Briefings REST request/response contracts and Fastify schemas in `packages/shared`
- `/api/briefings/definitions`, `/api/briefings/definitions/:id`, `/api/briefings/definitions/:id/run`, and `/api/briefings/definitions/:id/runs` routes through `AccessContext -> withDataContext() -> RLS`
- `/briefings` React view for list/create/update/run-now and recent run summaries over mocked/real REST APIs
- focused `pnpm test:briefings` integration coverage for migration/RLS, admin no-bypass, active workspace context, deterministic read-only generation, write-tool rejection, no secret/ciphertext leakage, metadata-only payloads, worker RLS, and repository `DataContextDb` enforcement
- Playwright Briefings smoke coverage with split `tests/e2e/mock-briefings-api.ts` so e2e helper files stay under the 1000-line guard
- recurring schedule production remains deferred: definitions store cadence/schedule metadata, and run-now/worker execution proves the scheduled-run execution path without adding a broad scheduler in this slice

M6 assistant audit/confirmation gate slice adds:

- `app.ai_assistant_action_requests` with owner-only RLS, optional active-workspace context, forced RLS, and no worker grants
- shared assistant action list/resolve REST DTOs and Fastify schemas in `packages/shared`
- `/api/ai/assistant-actions` and `/api/ai/assistant-actions/:id/resolve` routes through `AccessContext -> withDataContext() -> RLS`
- non-read assistant tool invocations now create safe pending confirmation records and return blocked invocation metadata with `actionRequestId`
- confirmation resolution is metadata-only: confirming, rejecting, or cancelling a pending action updates audit state but does not execute write/destructive tools
- action input persistence is intentionally bounded to top-level input key names/counts, never raw input values, private source text, secrets, ciphertext, prompts, or job payload data
- focused `pnpm test:ai-tools` coverage for pending action creation, admin/user no-bypass, read-tool no-record behavior, metadata-only resolution, no source mutation, no jobs, and repository `DataContextDb` guards

M7 release-hardening lifecycle/Compose slice adds:

- `scripts/backup-database.ts` plus `pnpm backup:db` for sensitive full database backups through
  `pg_dump --format=custom`, with the database password passed through `PGPASSWORD` instead of
  command arguments
- `scripts/export-user-data.ts` plus `pnpm export:user` for actor-scoped user JSON exports through
  the app runtime role and `AccessContext -> withDataContext() -> RLS`
- export output omits connector `encrypted_secret`, AI `encrypted_credential`, auth access/refresh/ID
  tokens, password hashes, Better Auth session tokens, and pg-boss job payloads
- `scripts/delete-user-data.ts` plus `pnpm delete:user` for dry-run user deletion counts and an
  exact-confirmation execute path that writes metadata-only `user.delete` admin audit events before
  deleting `app.users.id`
- `scripts/smoke-compose.ts` plus `pnpm smoke:compose` for Compose config validation, Postgres
  readiness, migration execution, API/web/worker startup, and API `/health` polling
- `scripts/restore-database.ts` plus `pnpm restore:db` for custom-format backup restore drills
  through `pg_restore --clean --if-exists --no-owner --no-privileges`, with preview-by-default
  behavior and destructive execution gated by `--execute --confirm-restore`
- `infra/env.production.example` as the production environment checklist for database URLs,
  `NODE_ENV=production`, Better Auth URLs/secrets, connector/AI encryption keys, ports, subnet, and
  optional OAuth/OIDC identity-provider variables without development passwords
- `scripts/audit-release-hardening.ts` plus `pnpm audit:release-hardening` for operator audit
  checks covering runtime role power, forced RLS, protected-table DELETE grants, and
  `app.admin_audit_events` app/worker privileges
- `.github/workflows/ci.yml` with CI jobs for foundation verification, release-hardening tests,
  release-hardening audit, web build, Playwright smoke tests, and Compose deployment smoke on
  isolated host ports
- Compose node services use container-private `node_modules` mounts so container `pnpm install`
  runs do not purge or rewrite the host workspace install
- `docs/operations/release-hardening.md` and README command documentation
- focused `pnpm test:release-hardening` integration coverage proving safe export redaction,
  confirmed delete audit/count behavior, no app/worker delete grants on protected product/secret
  tables, password-free backup/restore/Compose command plans, restore confirmation gating,
  production-env example coverage, release audit coverage, CI workflow coverage, and
  container-private Compose dependency installs

Read these first:

- `docs/architecture/decisions/0001-foundation.md`
- `docs/architecture/decisions/0002-maintenance-system-posture.md`
- `docs/DEVELOPMENT_STANDARDS.md`
- `docs/architecture/spikes/0001-auth-rls-safety.md`
- `docs/architecture/spikes/0002-pg-boss-worker-rls.md`
- `docs/architecture/plans/0001-mvp-foundation-scaffold.md`
- `docs/architecture/plans/0002-tasks-module-mvp.md`
- `docs/architecture/plans/0003-platform-first-alpha-roadmap.md`
- `docs/HANDOFF_TASKS_M1.md`

Relevant proof code:

- `spikes/auth-rls-safety/`
- `spikes/pg-boss-rls/`

## Key Decisions

- Runtime: TypeScript on Node.js.
- Database: Postgres primary for v1.
- Frontend: React + Vite, React Router, TanStack Query.
- Deployment: Docker Compose primary.
- Auth: local accounts plus Google, Microsoft, GitHub, and generic OIDC.
- Modules: package/manifest-based from day one, startup-loaded, marketplace-ready.
- AI: BYO-provider from day one; no feature hardcodes a provider/model.
- Security: private by default, explicit sharing only, no admin private-data bypass.
- Jobs: separate worker process from v1, Postgres-backed durable jobs with pg-boss viable.
- PWA/notifications: PWA in MVP, Web Push designed immediately.

## Proven Substrate

The auth/RLS pattern is:

```txt
auth session -> AccessContext -> withDataContext()
  -> Kysely transaction -> transaction-local app.* settings
  -> repository receives branded transaction handle only
  -> Postgres RLS policy evaluates current actor/workspace
```

The data-context wrapper sets transaction-local values:

```sql
app.actor_user_id
app.workspace_id
app.request_id
```

Runtime app and worker roles must not own protected tables and must not have `BYPASSRLS`.

The worker pattern is:

```txt
pg-boss metadata job -> actor/workspace/resource ids in payload
  -> worker handler -> withDataContext()
  -> protected app repositories
```

pg-boss payloads are operational metadata. They may contain actor ids, workspace ids, resource ids, job kind, idempotency keys, and small command parameters. They must not contain secrets, private bodies, raw connector payloads, prompts containing private content, or model-visible private content.

## Hard Invariants

- Admin/owner power is configuration power, not private-data read power.
- Cross-user private data access requires explicit sharing/grants.
- Every product-facing section is a module, including required sections.
- Built-in modules must obey the same SDK boundaries as external modules.
- Modules may collaborate only through declared public APIs or events.
- Module data lives in the central Jarv1s Postgres DB.
- Secrets never go to frontend or logs.
- External/internal content is data, not authority.
- Models never get direct database or secret access.
- All AI actions go through typed, permission-gated tools.
- Changes must meet the thermo-nuclear maintainability bar in `docs/DEVELOPMENT_STANDARDS.md`: pursue structural simplification, block unjustified 1000-line file growth, and avoid ad-hoc branching or boundary leaks.

## Next Step

M2 platform contract hardening is implemented. The M3 backend slice for Auth, Users, Workspaces,
Settings, auth-provider configuration, admin audit records, and core management edges is also
implemented.

Goal for the next agent:

- treat `docs/architecture/plans/0002-tasks-module-mvp.md` and `docs/HANDOFF_TASKS_M1.md` as completed M1 context
- treat `docs/architecture/plans/0003-platform-first-alpha-roadmap.md` as the current MVP roadmap
- preserve the current foundation, Tasks, and spike verification commands
- preserve Fastify REST route schemas/shared contracts unless M3 proves a stronger need
- keep Better Auth scoped to authentication/session/OAuth identity only; keep authorization in `AccessContext -> withDataContext() -> RLS`
- Calendar, Email, the narrow AI provider/settings capability-router foundation, Chat, the read-only assistant tool execution foundation, Briefings, and assistant audit/confirmation gates are now complete
- the M7 lifecycle/Compose hardening follow-up targets are complete: restore drills, production
  environment examples, broader audit review, and CI/deployment smoke automation
- next M7 work should focus on either running/verifying the full CI-equivalent command set in a clean
  environment, real external OAuth/OIDC callback verification against deployed provider apps, or
  production pg-boss/Postgres operational settings; do not start new product features before that
- preserve Briefings metadata-only jobs and assistant action metadata-only confirmation gates; avoid real provider calls/embeddings/connector sync/write or destructive tool execution, and preserve `AccessContext -> withDataContext() -> RLS`

Still do not build casually:

- full UI
- full module system
- real OAuth providers beyond the M3 auth/session requirement
- real connectors
- full email/calendar clients or rich Notes surfaces
- final API contract layer unless M3 proves plain Fastify REST is insufficient
- arbitrary workflow engine

## Completed M1 Work

- moved the migration advisory lock before migration ledger reads
- added `pnpm verify:foundation`
- made the Compose API host port and Docker subnet configurable and documented them
- added minimal built-in module SDK/registry support
- added the Tasks module package, SQL, repository, API routes, and worker job
- wired module SQL migrations and queues into the migration flow
- added integration tests proving task privacy, sharing, API session context, and worker posture

## Completed M2 Work

- added the M2-M7 platform-first alpha roadmap
- expanded `packages/module-sdk` manifest types for platform metadata
- added built-in module registration records in `packages/module-registry`
- added shared Tasks REST contracts and JSON schemas in `packages/shared`
- attached shared schemas to Tasks Fastify routes and module route/job/tool manifests
- added ESLint, Prettier, Turborepo wiring, and file-size enforcement scripts

## Completed M3 Backend Slice

- added Better Auth as the authentication/session runtime in `packages/auth`
- added environment-driven Google, GitHub, Microsoft, and generic OIDC auth identity configuration
- mounted Better Auth routes under `/api/auth/*`
- kept legacy bearer session resolution for existing substrate integration tests
- validated active workspace headers against workspace membership during access-context resolution
- added M3 auth/workspace/settings SQL migration and Kysely table types
- added `app.admin_audit_events` and audit writes for first-owner bootstrap plus mutating admin actions
- added the required Settings built-in module and admin/settings APIs
- added admin APIs for auth-provider status, workspace membership listing/removal, resource grant listing/removal, and audit event listing
- moved module route dependencies to request-level access-context resolution
- added focused M3 integration tests for bootstrap, admin permissions, provider status, workspace context, settings, grants, audit records, revocation, and Tasks grant visibility

## Completed M4 App Shell Slice

- added `apps/web` as the first authenticated React/Vite user experience
- added shared module metadata DTOs and an authenticated `/api/modules` endpoint
- added shell navigation, workspace context selection, and account sign-out
- added Tasks create/list/detail/update/archive and activity append UI against existing REST routes
- added PWA manifest, service worker registration, offline fallback, and app icon
- added Playwright smoke tests with mocked REST calls for shell and Tasks workflows
- added a Docker Compose `web` service and README web dev commands

## Completed M5 Notes Slice

- added `@jarv1s/notes` with manifest metadata, SQL migration directory, repository, routes, and package wiring
- added `app.notes` with `private`/`workspace` visibility, `archived_at`, owner-change protection, resource-grant reads, manage-grant updates, workspace-member access, and forced RLS
- added a follow-up RLS/API hardening migration so Tasks and Notes cannot be made workspace-visible without matching active workspace context
- intentionally did not add Notes jobs; the worker role has no `app.notes` table grant in this slice
- added shared Notes REST DTOs/schemas and registered `/api/notes` plus `/api/notes/:id`
- added Notes module navigation at `/notes` and minimal React UI for create/list/read/update/archive through the API
- added focused Notes integration tests proving migration/RLS, admin non-bypass, grants, workspace context, API ownership, archive, and repository data-context enforcement
- expanded Playwright smoke coverage to include Notes create/read/update/archive

## Completed M5 Notifications Slice

- added `@jarv1s/notifications` with manifest metadata, SQL migration directory, repository, routes, and package wiring
- added `app.notifications` with `private`/`workspace` visibility, actor/recipient/workspace scoping, title/body summary fields, non-secret metadata JSON, and forced RLS
- added `app.notification_reads` so read/unread state is per actor, including workspace-visible notifications
- intentionally did not add Notifications jobs/events in this thin slice; the worker role has no `app.notifications` or `app.notification_reads` table grant
- intentionally did not add notification preferences, Web Push, email push, delivery schedules, digests, connectors, AI-generated notifications, or broad settings UI
- added shared Notifications REST DTOs/schemas and registered `/api/notifications`, `/api/notifications/:id/read`, and `/api/notifications/read-all`
- added Notifications module navigation at `/notifications`, a topbar unread badge, and minimal React UI for list/filter/read-state operations
- added focused Notifications integration tests proving migration/RLS, admin non-bypass, private-by-default behavior, workspace context, API read state, and repository data-context enforcement
- expanded Playwright smoke coverage to include Notifications list/mark-read/mark-all-read

## Completed M5 Connectors/Security Foundation Slice

- added `@jarv1s/connectors` with manifest metadata, SQL migration directory, repository, crypto helper, routes, and package wiring
- added `app.connector_definitions` and `app.connector_accounts` with forced RLS, owner-only account visibility, optional active-workspace scoping, safe provider metadata, encrypted token JSON, and no worker grants
- added connector secret encryption with `JARVIS_CONNECTOR_SECRET_KEY`; production requires the env secret while development/test can use a deterministic fallback
- intentionally kept connector authorization separate from Better Auth login accounts and did not add OAuth provider flows
- added shared Connectors REST DTOs/schemas and registered connector provider/account/admin-safe metadata routes
- added a narrow admin-safe connector metadata function so Settings/Admin can see account metadata without private token bypass
- added a minimal Settings connector UI for provider status, safe account metadata, placeholder token JSON create, status update, and revoke
- added focused Connectors integration tests proving migration/RLS, encryption-at-rest, no plaintext/ciphertext API leakage, user isolation, active workspace validation, admin no-secret behavior, and repository data-context enforcement
- expanded Playwright smoke coverage to include connector account create/update/revoke in Settings

## Completed M5 Calendar/Email Read Slice

- added `@jarv1s/calendar` and `@jarv1s/email` with manifest metadata, SQL migration directories, repositories, routes, and package wiring
- added `app.calendar_events` and `app.email_messages` with forced RLS, owner-private rows, active-workspace rows, connector account foreign keys, external IDs, safe metadata JSON, and no raw connector payload or secret columns
- enforced connector account ownership/provider compatibility on cache inserts through RLS while keeping product REST APIs read-only
- intentionally did not add real Google/Microsoft APIs, OAuth flow, sync jobs, background token refresh, email sending, calendar writes, attachments, or full search
- added shared Calendar and Email REST DTOs/schemas and registered `/api/calendar/events`, `/api/calendar/events/:id`, `/api/email/messages`, and `/api/email/messages/:id`
- added Calendar and Email module navigation and minimal React list/read surfaces at `/calendar` and `/email`
- added focused Calendar/Email integration tests proving migration/RLS, private-by-default behavior, active workspace context for reads and cache inserts, admin no-bypass, connector account/provider enforcement, read-only API behavior, and repository data-context enforcement
- expanded Playwright smoke coverage to navigate Calendar and Email surfaces with mocked REST

## Completed M6 AI Provider/Settings Foundation Slice

- added `@jarv1s/ai` with manifest metadata, SQL migration directory, repository, crypto helper, routes, and package wiring
- added `app.ai_provider_configs` and `app.ai_configured_models` with forced RLS, current-user ownership, encrypted credential JSON, safe provider metadata, model capability metadata, and no worker grants
- added AI credential encryption with `JARVIS_AI_SECRET_KEY`; production requires the env secret while development/test can use a deterministic fallback
- intentionally did not add Chat, Briefings, real provider adapters/calls, scheduled jobs, embeddings, assistant execution, or tool execution
- added shared AI REST DTOs/schemas and registered provider/model configuration, capability lookup, and assistant tool metadata routes
- added manifest-only assistant tool metadata serialization; the route returns permission/risk/schema declarations and cannot execute tools
- added a minimal Settings AI UI for provider/model configuration and capability lookup without exposing secrets after create/update
- added focused AI integration tests proving migration/RLS, no worker grants, encryption-at-rest, no plaintext/ciphertext API leakage, user/admin no-bypass, DataContext repository enforcement, active capability routing, and manifest-derived tool metadata
- expanded Playwright smoke coverage to include AI provider/model configuration and capability routing in Settings, with shared e2e mock helpers split out to keep files under the 1000-line guard

## Completed M6 Chat Thin Slice

- added `@jarv1s/chat` with manifest metadata, SQL migration directory, repository, routes, and package wiring
- added `app.chat_threads` and `app.chat_messages` with forced RLS, private/workspace visibility, safe model/tool metadata JSON, role/status/body fields, timestamps, and no worker table grants
- kept Chat provider behavior metadata-only: it calls the AI capability router for safe chat model metadata and never decrypts credentials or calls an external provider
- kept tool behavior metadata-only: selected tools are recorded by manifest name/module/permission/risk, risky write/destructive selections are blocked as pending future confirmation/audit behavior, and no tools execute
- added shared Chat REST DTOs/schemas and registered thread/message routes under `/api/chat/...`
- added a minimal `/chat` React view for thread creation, message list, composer, chat route status, and assistant tool metadata display/selection
- added focused Chat integration tests proving migration/RLS/no worker grants, private-by-default behavior, admin no-bypass, repository `DataContextDb` enforcement, API workspace context, no secret/provider leakage, safe metadata only, and no Tasks mutation from selected tool metadata
- tightened Chat thread update RLS/trigger behavior so workspace participants may refresh shared thread timestamps during append flows but cannot change another user's thread title, workspace, or visibility
- expanded Playwright smoke coverage to include Chat creation/message flow and split E2E module/chat helpers to keep checked files under 1000 lines

## Completed M6 Read-Only Assistant Tool Execution Foundation

- added shared `InvokeAiAssistantToolRequest`/`InvokeAiAssistantToolResponse` contracts and `invokeAiAssistantToolRouteSchema`
- registered `POST /api/ai/assistant-tools/:name/invoke` in the AI module manifest and Fastify routes
- added `AiAssistantToolExecutor` in `packages/ai`, with fixed read-only dispatch for the five current read tools
- kept execution behind `AccessContext -> withDataContext() -> DataContextDb -> module repositories -> Postgres RLS`
- reused module REST serializers for Tasks, Notes, Notifications, Calendar, and Email assistant tool results
- blocked `tasks.updateStatus` and any non-read risk tool with a typed 403 blocked invocation response
- kept unknown tool names non-invokable with 404 because only manifest-declared tools may be selected
- added `pnpm test:ai-tools` and focused integration coverage for RLS visibility, admin no-bypass, no task mutation, no pg-boss job creation, no new queues, no secret/ciphertext leakage, and repository data-context guards
- intentionally did not add Briefings, model/provider calls, embeddings, connector sync, jobs, audit persistence, UI, write/destructive execution, root DB access, provider-client access, or secret access

## Completed M6 Briefings Slice

- added `@jarv1s/briefings` with manifest metadata, SQL migration directory, repository, routes, jobs, and package wiring
- added `app.briefing_definitions` and `app.briefing_runs` with forced RLS, private/workspace visibility, schedule metadata, selected read tool names, last-run timestamps, summary text, and source metadata JSON
- kept Briefings generation deterministic and provider-free: it invokes only manifest-declared read-risk assistant tools through `AiAssistantToolExecutor` under `DataContextDb`
- kept Briefings jobs metadata-only: `briefings-run` payloads contain actor/workspace IDs, definition/run IDs, run kind, and idempotency key only
- added narrow worker grants for Briefings run production while preserving `FORCE ROW LEVEL SECURITY` and no admin private-data bypass
- added shared Briefings REST DTOs/schemas and registered definition list/create/update, run-now enqueue, and run-list routes under `/api/briefings/...`
- added a minimal `/briefings` React view for definition list/create/update/run-now and recent summaries
- added focused Briefings integration tests proving migration/RLS, active workspace context, deterministic read-only generation, non-read tool rejection, no source secret/ciphertext leakage, metadata-only payloads, worker RLS behavior, and repository `DataContextDb` guards
- expanded Playwright smoke coverage to include the Briefings flow and split Briefings e2e mocks into `tests/e2e/mock-briefings-api.ts`
- intentionally did not add real provider/model calls, embeddings, connector sync, write/destructive assistant tool execution, rich notification delivery, or a recurring scheduler beyond stored cadence/schedule metadata plus run-now worker execution

## Completed M6 Assistant Audit/Confirmation Gate Slice

- added `app.ai_assistant_action_requests` in the AI module with forced RLS, owner-only visibility, optional active-workspace context, safe tool metadata, safe input summaries, and no worker grants
- added shared assistant action REST contracts/schemas plus manifest route metadata for listing and resolving pending assistant actions
- updated non-read assistant tool invocation so `tasks.updateStatus` and future write/destructive tools create a pending confirmation record and return blocked invocation metadata with `actionRequestId`
- kept confirmation resolution metadata-only: `confirmed`, `rejected`, and `cancelled` update audit state but never execute write/destructive tools, mutate source modules, enqueue jobs, call providers, or decrypt secrets
- bounded persisted input summaries to top-level input key names/counts so action records do not contain raw task IDs, private text, prompts, credential material, ciphertext, or raw connector payloads
- added focused `pnpm test:ai-tools` coverage for pending action records, admin/user no-bypass, read-tool no-record behavior, metadata-only resolution, no task mutation, no jobs, no leakage, and repository `DataContextDb` enforcement

## Verification Commands

Foundation verification:

```txt
pnpm install
pnpm db:up
pnpm verify:foundation
```

Focused Tasks verification:

```txt
pnpm test:tasks
```

Focused Notes verification:

```txt
pnpm test:notes
```

Focused Notifications verification:

```txt
pnpm test:notifications
```

Focused Connectors verification:

```txt
pnpm test:connectors
```

Focused Calendar/Email verification:

```txt
pnpm test:calendar-email
```

Focused AI foundation verification:

```txt
pnpm test:ai
```

Focused AI assistant tools verification:

```txt
pnpm test:ai-tools
```

Focused Chat verification:

```txt
pnpm test:chat
```

Focused Briefings verification:

```txt
pnpm test:briefings
```

Focused release-hardening verification:

```txt
pnpm test:release-hardening
```

Release-hardening audit:

```txt
pnpm audit:release-hardening
```

Current known-good M7 release-hardening result:

```txt
pnpm test:release-hardening
Test Files  1 passed (1)
Tests       10 passed (10)

pnpm format:check
All matched files use Prettier code style!

pnpm audit:release-hardening
passed true; failures []
```

Current known-good foundation result:

```txt
pnpm verify:foundation
lint, format:check, file-size, typecheck pass
no SQL migrations applied; 16 already current
Integration Test Files  12 passed (12)
Integration Tests       113 passed (113)
```

Current known-good Tasks result:

```txt
pnpm test:tasks
Test Files  1 passed (1)
Tests       14 passed (14)
```

Current known-good M4 web result:

```txt
pnpm build:web
web typecheck and Vite production build pass

pnpm test:e2e
10 passed (chromium)
```

Current known-good Notes result:

```txt
pnpm test:notes
Test Files  1 passed (1)
Tests       9 passed (9)
```

Current known-good Notifications result:

```txt
pnpm test:notifications
Test Files  1 passed (1)
Tests       9 passed (9)
```

Current known-good Connectors result:

```txt
pnpm test:connectors
Test Files  1 passed (1)
Tests       9 passed (9)
```

Current known-good Calendar/Email result:

```txt
pnpm test:calendar-email
Test Files  1 passed (1)
Tests       9 passed (9)
```

Current known-good AI foundation result:

```txt
pnpm format
prettier --write . completed

pnpm test:ai
Test Files  1 passed (1)
Tests       9 passed (9)

pnpm build:web
web typecheck and Vite production build pass

pnpm lint
eslint completed with 0 warnings

pnpm test:integration
Test Files  12 passed (12)
Tests       113 passed (113)

pnpm test:e2e
10 passed (chromium)
```

Current known-good M6 read-only assistant tools result:

```txt
pnpm format
prettier --write . completed

pnpm test:ai-tools
Test Files  1 passed (1)
Tests       9 passed (9)

pnpm verify:foundation
lint, format:check, file-size, typecheck pass
no SQL migrations applied; 16 already current
Integration Test Files  12 passed (12)
Integration Tests       113 passed (113)
```

Current known-good Chat thin slice result:

```txt
pnpm format
prettier --write . completed

pnpm test:chat
Test Files  1 passed (1)
Tests       8 passed (8)

pnpm build:web
web typecheck and Vite production build pass

pnpm test:e2e
10 passed (chromium)

pnpm verify:foundation
lint, format:check, file-size, typecheck pass
no SQL migrations applied; 16 already current
Integration Test Files  12 passed (12)
Integration Tests       113 passed (113)
```

Current known-good M6 Briefings result:

```txt
pnpm format
prettier --write . completed

pnpm test:briefings
Test Files  1 passed (1)
Tests       9 passed (9)

pnpm build:web
web typecheck and Vite production build pass

pnpm test:e2e
10 passed (chromium)

pnpm verify:foundation
lint, format:check, file-size, typecheck pass
no SQL migrations applied; 16 already current
Integration Test Files  12 passed (12)
Integration Tests       113 passed (113)
```

Current known-good M6 assistant audit/confirmation gates result:

```txt
pnpm test:ai-tools
Test Files  1 passed (1)
Tests       9 passed (9)

pnpm test:ai
Test Files  1 passed (1)
Tests       9 passed (9)

pnpm build:web
web typecheck and Vite production build pass

pnpm test:e2e
10 passed (chromium)

pnpm verify:foundation
lint, format:check, file-size, typecheck pass
no SQL migrations applied; 16 already current
Integration Test Files  12 passed (12)
Integration Tests       113 passed (113)
```

Spike verification:

```txt
pnpm spike:db:up
pnpm test:spike
```

Current known-good spike result:

```txt
Test Files  2 passed (2)
Tests       15 passed (15)
```

`pnpm db:migrate` is idempotent; a second run should report no SQL migrations applied and pg-boss current.

## Tooling Direction

Preferred after spike results:

- pnpm workspaces
- Turborepo
- Fastify
- Kysely
- Explicit versioned SQL migrations
- Better Auth candidate for authn/session/OAuth only
- pg-boss for Postgres-backed jobs, with metadata-only payloads and handlers entering `withDataContext()`
- Tailwind plus shadcn/Radix-style owned components
- Vitest + Playwright
- ESLint + typescript-eslint + Prettier

API contract tooling remains intentionally conservative. Fastify REST plus explicit route schemas and shared TypeScript contracts is the MVP default. Evaluate a heavier contract layer only if the current pattern stops scaling.

## Open Questions

- Real external OAuth/OIDC callback verification against deployed provider apps.
- Production-hardening details for Postgres roles and grants.
- pg-boss schedule/supervise/BAM production settings.
- Final post-MVP API contract layer: continue plain Fastify REST, tRPC, ts-rest, oRPC, or OpenAPI-first.
- Detailed visual design direction for the Jarv1s shell.
- Exact long-term module migration discovery/ledger format.
- Exact task recurrence/reminder model.
- Exact M3 Better Auth schema/session mapping.
- Exact bootstrap owner flow.
- Exact follow-up scope for Notes comments/activity, rich text, full search, and sharing management UI.
- Exact follow-up scope for Notifications preferences, Web Push, event/job production, delivery schedules, and digesting.
- Exact follow-up scope for Calendar/Email real sync, refresh scheduling, external provider adapters, dedupe, attachment handling, full search, and read detail UI.

## Review Notes For Next Agent

- The repository is still early and many files are currently untracked.
- Do not delete the spike directories; they are retained historical proof and still pass.
- Do not weaken `FORCE ROW LEVEL SECURITY`.
- Do not give normal app or worker roles table ownership or `BYPASSRLS`.
- Do not put private content into pg-boss payloads.
- Do not let repositories accept a root Kysely instance.
- Keep scope tight. The next slice should be bounded around M7 release hardening, not a broad product expansion.
