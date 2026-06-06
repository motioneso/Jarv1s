# Plan 0003: Platform-First Alpha Roadmap

Status: Ready
Date: 2026-06-06

## Purpose

Optimize the remaining MVP for a platform-first self-hostable alpha with a thin useful core
module set.

The goal is not feature depth. The goal is to prove the full Jarv1s shape end to end: secure
auth, app shell, module boundaries, typed tools, connectors, notifications, and a few minimal
modules that work through the same substrate as Tasks.

## Current Baseline

M0 foundation and M1 Tasks are implemented. The next work should preserve these guardrails:

- Fastify REST remains the MVP API shape.
- `AccessContext -> withDataContext() -> RLS` remains the authorization boundary.
- Built-in modules use the same manifest and registration boundaries expected of external modules.
- pg-boss jobs carry operational metadata only.
- Assistant behavior goes through typed, permission-gated tools instead of direct database,
  repository, provider, or secret access.

## Milestone 2: Platform Contract Hardening

Harden the platform boundary before adding broad product surface area.

- Keep Fastify REST for MVP.
- Add route schemas and shared request/response types instead of adopting tRPC, oRPC, or another
  contract layer yet.
- Expand the module SDK and built-in registry enough for navigation entries, settings surfaces,
  permissions, feature flags, SQL directories, routes, jobs, assistant tools, and module
  availability metadata.
- Add ESLint, Prettier, Turborepo wiring, and maintainability checks that enforce the development
  standards, including the 1000-line decomposition rule.

Acceptance criteria:

- module manifests expose the platform metadata needed by shell/settings/assistant work
- route schemas are colocated with shared TypeScript request/response contracts
- verification includes lint, format, typecheck, tests, and file-size checks
- foundation and Tasks tests still pass

## Milestone 3: Auth, Users, Workspaces, Settings

Add real authentication and administrative control without changing the authorization model.

- Integrate Better Auth for local login plus OAuth/OIDC identity only.
- Preserve `AccessContext -> withDataContext() -> RLS`; Better Auth must not own authorization.
- Add bootstrap owner flow.
- Add user and workspace membership management.
- Add resource grants UI/API.
- Add a minimal settings/admin module.

Acceptance criteria:

- first-run owner bootstrap creates a durable admin path
- sessions resolve into `AccessContext`
- workspace switching is explicit and auditable
- user, workspace, grant, and admin settings APIs keep private data private by default

## Milestone 4: App Shell, PWA, Tasks UI

Build the first authenticated user experience over the existing substrate.

- Add a React/Vite app shell with authenticated routing, module navigation, workspace context, and
  mobile-first layout.
- Add installable PWA baseline.
- Add session handling, loading/error states, and TanStack Query.
- Build the Tasks UI against the existing Tasks API before expanding backend modules.

Acceptance criteria:

- authenticated users can navigate modules and switch workspace context
- Tasks CRUD works through the API, not direct client-side database access
- shell and Tasks UI are covered by Playwright smoke tests
- PWA install metadata and offline fallback are present

## Milestone 5: Thin Core Modules

Add breadth carefully, using the same module boundaries as Tasks.

- Add a minimal Notes module with private/workspace notes and activity or comments only if needed.
- Add Calendar and Email as connector-backed read surfaces first, not full clients.
- Add Notifications with an in-app notification center, unread state, preferences, and a
  metadata-only job/event pipeline.
- Add Settings/Admin surfaces for providers, connectors, modules, users, and workspace basics.

Acceptance criteria:

- each module proves private-by-default data and workspace scoping where applicable
- Calendar and Email avoid storing raw connector payloads in jobs/logs
- Notifications can show in-app state without requiring Web Push
- module settings are discoverable from manifests

## Milestone 6: AI Router, Chat, Briefings

Add AI features through typed tools and provider capabilities only.

- Add bring-your-own-provider configuration.
- Add capability-based model routing.
- Add typed provider adapters.
- Add Chat using typed, permission-gated tools only.
- Add Briefings as scheduled/read-only summaries over allowed module APIs.
- Add audit records and confirmation gates for risky assistant actions.

Acceptance criteria:

- no AI path has direct database, repository, model, or secret access
- provider selection happens through capability routing
- tools declare permission and risk metadata
- risky write actions require confirmation and audit records

## Milestone 7: Connector, Secrets, Audit, Release Hardening

Prepare the alpha for self-hosted use.

- Add encrypted secret storage.
- Keep connector authorization separate from login identity.
- Support Google and Microsoft calendar/email connectors first.
- Keep raw connector payloads out of jobs/logs.
- Harden Docker Compose deployment, migrations, backup/export/delete paths, audit coverage, and
  smoke tests.
- Keep Web Push as MVP+1 unless in-app notifications are complete early.

Acceptance criteria:

- secrets are encrypted at rest and never exposed to frontend or logs
- connector scopes are separate from login scopes
- backup, export, and delete paths are documented and tested
- Docker Compose can run a clean alpha deployment with smoke-test coverage

## Public Interfaces And Types

- Module manifests include navigation, settings, permissions, feature flags, assistant tool
  declarations, and availability metadata.
- API remains Fastify REST for MVP, with explicit schemas and shared TypeScript contracts per route.
- Auth/session resolves into `AccessContext`; authorization remains app/RLS-driven.
- Jobs remain pg-boss metadata-only payloads.
- AI features call the capability router and typed tools, never providers or repositories directly.

## Test Plan

- Keep `pnpm verify:foundation`, `pnpm test:tasks`, and `pnpm test:spike` passing throughout.
- Add integration tests for each new module proving private-by-default data, explicit sharing,
  workspace scoping, and worker no-bypass behavior.
- Add API tests for auth/session, workspace context, module availability, and connector permission
  boundaries.
- Add Playwright coverage for login, app shell navigation, Tasks UI, settings, notifications, and
  one AI/chat flow.
- Add maintainability checks around file size, lint, typecheck, and formatting before broad feature
  work lands.

## Assumptions

- MVP target is a platform-first alpha, not a polished consumer launch.
- Product breadth is the thin core set: Tasks, Notes, Email, Calendar, Chat, Briefings,
  Notifications, Settings/Admin.
- Plain Fastify REST is the MVP API contract default.
- Better Auth is used for authn/session/OAuth only, not authorization.
- Web Push is designed now but can ship MVP+1 if in-app notifications are solid.
