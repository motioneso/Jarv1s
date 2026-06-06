# ADR 0001: Foundation Architecture

Status: Accepted
Date: 2026-06-06

## Context

Jarv1s is an AI personal assistant OS. It starts with tasks, email, calendar, notes, chat, briefings, and notifications, then grows through modular sections such as meeting companion, finance, wellness, research, smart home, media, sports, and user-created workflows.

The architecture must support self-hosting, multi-user instances, private-by-default data, explicit sharing, provider-agnostic AI, and a future module marketplace. The implementation standard is strict: avoid giant files, hidden control flow, ad-hoc branching, leaky boundaries, and abstractions that do not earn their keep.

The concrete maintainability bar is documented in `docs/DEVELOPMENT_STANDARDS.md` and follows the thermo-nuclear code quality review posture: structural simplification matters, file growth past 1000 lines is a presumptive blocker, and working code is not acceptable when it leaves the system materially messier.

## Decisions

### Runtime

Use TypeScript on Node.js as the primary runtime.

TypeScript is the default for the frontend, backend, module contracts, API payloads, assistant tools, and provider adapters. Specialized workers in Python, Go, or Rust may be added later only behind explicit service boundaries.

### Database

Use Postgres as the primary v1 database.

Jarv1s will use app-layer authorization plus Postgres row-level security where practical. SQLite is not part of v1. Data access must be designed so SQLite/local modes are not impossible later, but not at the cost of weakening v1 security.

### Frontend

Use React + Vite + TypeScript.

Use React Router for app routing and TanStack Query for server-state fetching, caching, invalidation, loading states, and optimistic updates. The frontend stack should be boring and predictable, but the product design should be custom, polished, mobile-friendly, and not a generic dashboard.

### Deployment

Use Docker Compose as the primary v1 deployment target.

The v1 deployment should include the Node app/API, worker process, migration path, Postgres container or external Postgres, and mounted volumes for file/module storage. Native Node/Postgres install is secondary for development and advanced users.

### Auth

Support local accounts plus OAuth/OIDC login from the start.

V1 login providers:

- Local email/password
- Google
- Microsoft
- GitHub
- Generic OIDC

Authentication identity is separate from connector authorization. Signing in with Google may offer to connect Gmail or Google Calendar, but connector access always requires separate explicit consent.

The first created user becomes the initial instance owner/admin during bootstrap.

### Core Domain And Authorization

Core primitives:

- Instance
- User
- Auth identity
- Role
- Permission
- Workspace
- Membership
- Resource
- Grant

Role inheritance is supported but scoped. Instance owner inherits instance admin, which inherits instance member. Workspace roles inherit only workspace roles. Module roles inherit only matching module/scope roles.

Hard privacy invariant:

Admins manage the instance. They do not automatically read private user data. Cross-user access requires explicit sharing through workspace membership, resource grants, or module-specific sharing rules.

### Sharing Model

Data is private by default. Sharing is explicit, scoped, revocable, and audited.

Do not model ownership only as `user_id`. Many resources may be:

- Private to a user
- Owned by a workspace
- Shared with a workspace
- Shared with explicit users
- Shared with a role or permission group

Resource grants should support at least `view`, `contribute`, and `manage` where appropriate. Modules define their own shareable resource types and grant levels.

### Module System

All product-facing sections are modules, including built-in and required sections.

Modules are package/manifest-based from day one and discovered at startup. Hot runtime loading is out of scope. Installing, updating, or removing code modules can require admin approval, migrations, rebuild, and restart.

Built-in modules must use the same SDK and manifest contract as external modules.

Module lifecycle classes:

- Required
- Optional
- User-toggleable
- Workspace-toggleable

Effective module availability depends on:

- Installed package
- Globally enabled by admin
- Workspace enabled, if applicable
- User enabled, if user-toggleable
- User permissions

Module definitions, code, manifests, and migrations live in module packages. Actual module data lives in the central Jarv1s Postgres database.

Uninstall should disable first. Data purge must be a separate explicit action.

### Module SDK

Create a strict `@jarvis/module-sdk`.

A module manifest should declare:

- id
- name
- version
- publisher
- compatibility
- lifecycle
- dependencies
- permissions
- settings
- database migrations and owned tables/schemas
- server routes
- web routes/nav/settings/widgets
- jobs
- events
- assistant tools/context/memory
- shareable resources
- public exports

Modules can collaborate only through declared, typed, permission-gated public APIs or events.

No module may:

- Import another module's internals
- Query another module's tables directly
- Gain undeclared permissions
- Register arbitrary global side effects

### User-Created Modules

Support safer declarative user-created modules before arbitrary user code.

Declarative modules may contain dashboards, widgets, saved views, prompts, workflows, forms, task templates, and automation recipes. These can be direct-shared first and later distributed through a community marketplace.

Trusted code modules are more powerful and require install-time review, declared permissions, dependency checks, migrations, and stronger marketplace validation later.

### AI Provider Architecture

Jarv1s is bring-your-own-provider from day one.

No feature may hardcode an AI provider or model. All AI calls go through a capability router.

Admins configure a system default provider/model and may bind specific features or capabilities to different providers, models, or specialized backends.

Features request capabilities, not providers. Example capabilities:

- chat
- fast_chat
- reasoning
- long_context
- json_object
- tool_calling
- vision
- embeddings
- transcription
- daily_briefing
- research
- summarization

Provider-specific quirks live only in provider adapters. Specialized services such as NotebookLM-style research can be modeled as feature backends instead of generic chat providers.

Assistant tools, context providers, and memory providers must be typed, permission-gated, confirmation-gated for risky actions, and audited.

### Jobs, Events, And Automation

V1 has a separate worker process from the API/web server.

Use Postgres-backed durable jobs with retries, backoff, scheduled jobs, one-off jobs, history, and concurrency keys. Avoid Redis as a required v1 dependency unless a real need appears.

Use durable domain events for facts, not commands. Heavy event handlers should enqueue jobs.

Future user automation and agent task boards are first-class resources. The model should support durable state, step history, tool-call audit, human approval gates, pause/resume, cancellation, permissions, and user/workspace scoping. Do not overbuild a workflow engine in v1.

### Data, Privacy, And Security

Security rules:

- Private by default
- Explicit scoped sharing only
- No admin private-data bypass
- App-layer authorization plus Postgres RLS
- Data classification for module data
- Encrypted secret store
- No secrets in frontend or logs
- Audit sensitive actions
- Design export/delete/revoke/disconnect/purge paths early

Data classifications:

- public
- shared
- private
- sensitive
- secret

AI data exposure policy uses admin-set maximums plus user/workspace/resource-level stricter preferences. Users can restrict their own data further and choose among admin-approved providers where allowed, but cannot loosen admin policy. The effective policy uses the most restrictive applicable rule.

Prompt injection defenses are mandatory. External/internal content is data, not authority. Models never get direct database or secret access. All AI actions go through typed, permission-gated tools with app/RLS authorization, source trust labeling, output validation, confirmation gates for risky actions, and audit logs.

### Notifications And PWA

PWA support is part of MVP.

MVP includes:

- Installable PWA
- Responsive mobile-first UI
- In-app notification center
- Unread state
- Notification preferences
- Event-driven notification pipeline

Web Push should be designed immediately and implemented in MVP or MVP+1. Push payloads must be minimal and avoid sensitive content. Opening the app fetches real data through normal auth/RLS.

Android/Desktop Web Push should work through standard service worker and Push API support. iOS/iPadOS requires adding the PWA to the Home Screen and enabling notifications from the installed app.

### MVP Modules

Initial product-facing modules:

- Tasks
- Email
- Calendar
- Notes
- Briefings
- Chat
- Notifications
- Settings/admin, as appropriate

Core framework packages:

- Auth/session
- Users/roles/workspaces/grants
- Module registry
- AI router/tool registry
- Jobs/events
- Secret store
- Audit
- Connector framework

Tasks should be designed to grow beyond a simple todo list. It should support task activity, timestamped journal notes/comments, mentions of Jarvis or users, assignments/watchers, source links, and future agent runs from task activity.

## Implementation Direction

Preferred tooling, pending spikes:

- Package manager: pnpm
- Monorepo runner: Turborepo
- Backend: Fastify
- Database queries: Kysely
- Migrations: explicit versioned SQL
- Jobs: Postgres-backed worker; pg-boss is viable for v1 per Spike 0002
- Authn/session/OAuth: Better Auth candidate
- API contract layer: undecided; evaluate after security spike
- UI components: Tailwind plus shadcn/Radix-style owned components
- Testing: Vitest, Playwright, Postgres integration tests
- Lint/format: ESLint + typescript-eslint + Prettier

## First Required Spike

Before full scaffold or MVP development, prove the auth/RLS/pool/worker seam. See `docs/architecture/spikes/0001-auth-rls-safety.md`.

That spike is complete. The follow-up pg-boss worker posture spike is also complete; see `docs/architecture/spikes/0002-pg-boss-worker-rls.md` and `docs/architecture/decisions/0002-maintenance-system-posture.md`.
