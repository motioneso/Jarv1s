# M7 Operations Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the alpha is operable before new product work by verifying CI-equivalent commands,
external auth callbacks, and production Postgres/pg-boss settings.

**Architecture:** This plan does not add product features. It exercises the existing
Fastify/Kysely/Postgres/RLS substrate, Better Auth identity configuration, pg-boss worker posture,
Docker Compose deployment, and M7 operator scripts, then records evidence and follow-up decisions in
project docs.

**Tech Stack:** pnpm, Node.js 24, Docker Compose, Postgres, Fastify, Better Auth, pg-boss, Vitest,
Playwright, GitHub Actions.

---

## Scope

This is the next bounded M7 slice. Do not start full UI work, real connector sync, real AI provider
calls, embeddings, assistant write/destructive execution, or broad product-module expansion while
this plan is incomplete.

## Files

- Modify: `docs/HANDOFF.md`
- Modify: `docs/operations/release-hardening.md`
- Modify: `infra/env.production.example`
- Modify: `README.md`
- Optional modify: `.github/workflows/ci.yml`
- Optional create: `docs/operations/m7-verification-results.md`
- Optional create: `docs/operations/auth-callback-verification.md`
- Optional create: `docs/operations/production-postgres-pgboss.md`

## Hard Invariants

- Keep Better Auth scoped to authentication/session/OAuth identity only.
- Keep authorization in `AccessContext -> withDataContext() -> RLS`.
- Keep runtime app and worker roles away from protected-table ownership and `BYPASSRLS`.
- Keep pg-boss payloads metadata-only.
- Keep assistant confirmation records metadata-only.
- Do not put secrets, raw connector payloads, prompts containing private content, or private bodies
  into logs, exports, jobs, or docs.

## Task 1: Clean CI-Equivalent Verification

**Files:**

- Create: `docs/operations/m7-verification-results.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Start from the committed baseline**

  Run:

  ```bash
  git status --short --branch
  git log --oneline --decorate -3
  ```

  Expected: working tree is clean, branch is `main`, and the latest commit is the current alpha
  scaffold/docs commit.

- [ ] **Step 2: Install dependencies from the lockfile**

  Run:

  ```bash
  pnpm install --frozen-lockfile
  ```

  Expected: install completes without lockfile mutation.

- [ ] **Step 3: Start the foundation database**

  Run:

  ```bash
  pnpm db:up
  ```

  Expected: Docker Compose reports Postgres healthy.

- [ ] **Step 4: Run the CI verify job commands locally**

  Run:

  ```bash
  pnpm verify:foundation
  pnpm test:release-hardening
  pnpm audit:release-hardening
  pnpm build:web
  pnpm test:e2e
  ```

  Expected:
  - lint, format, file-size, typecheck, migrations, and integration tests pass
  - release-hardening test passes
  - release-hardening audit returns `passed: true` with no failures
  - web typecheck and Vite build pass
  - Playwright smoke tests pass

- [ ] **Step 5: Run the Compose deployment smoke path**

  Run:

  ```bash
  JARVIS_API_PORT=3099 JARVIS_WEB_PORT=5180 pnpm smoke:compose -- --api-port 3099
  docker compose -f infra/docker-compose.yml down -v
  ```

  Expected: Compose config validates, Postgres/migrate/API/web/worker start, and the API health
  check passes on port `3099`.

- [ ] **Step 6: Run the retained spike proof**

  Run:

  ```bash
  pnpm spike:db:up
  pnpm test:spike
  pnpm spike:db:down
  ```

  Expected: auth/RLS and pg-boss/RLS spike tests pass.

- [ ] **Step 7: Record verification evidence**

  Create `docs/operations/m7-verification-results.md` with:

  ```markdown
  # M7 Verification Results

  Date: 2026-06-06

  ## Baseline

  - Commit: `<commit_sha>`
  - Branch: `main`
  - Node: `<node_version>`
  - pnpm: `<pnpm_version>`
  - Docker: `<docker_version>`

  ## Results

  | Command                                                                           | Result    | Notes |
  | --------------------------------------------------------------------------------- | --------- | ----- |
  | `pnpm install --frozen-lockfile`                                                  | pass/fail |       |
  | `pnpm db:up`                                                                      | pass/fail |       |
  | `pnpm verify:foundation`                                                          | pass/fail |       |
  | `pnpm test:release-hardening`                                                     | pass/fail |       |
  | `pnpm audit:release-hardening`                                                    | pass/fail |       |
  | `pnpm build:web`                                                                  | pass/fail |       |
  | `pnpm test:e2e`                                                                   | pass/fail |       |
  | `JARVIS_API_PORT=3099 JARVIS_WEB_PORT=5180 pnpm smoke:compose -- --api-port 3099` | pass/fail |       |
  | `pnpm test:spike`                                                                 | pass/fail |       |

  ## Failures And Follow-Ups

  - None.
  ```

  Replace placeholders with actual command output summaries. If a command fails, record the exact
  failing command, concise error, and next fix.

- [ ] **Step 8: Update handoff**

  In `docs/HANDOFF.md`, update the M7 next-step section to point at
  `docs/operations/m7-verification-results.md` and summarize which verification commands passed or
  failed.

- [ ] **Step 9: Commit verification evidence**

  Run:

  ```bash
  git add docs/HANDOFF.md docs/operations/m7-verification-results.md
  git commit -m "Document M7 verification results"
  ```

## Task 2: External OAuth/OIDC Callback Verification

**Files:**

- Create: `docs/operations/auth-callback-verification.md`
- Modify: `infra/env.production.example`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Choose verification target origins**

  Decide and record:

  ```txt
  API origin: https://<api-host>
  Web origin: https://<web-host>
  Better Auth base URL: https://<api-host>
  Trusted origins: https://<web-host>
  ```

  Expected: the API and web origins are stable enough to register with provider apps.

- [ ] **Step 2: Verify current provider env coverage**

  Run:

  ```bash
  rg "JARVIS_AUTH_" infra/env.production.example README.md packages/auth/src/index.ts
  ```

  Expected: Google, GitHub, Microsoft, and generic OIDC identity variables are documented, and no
  connector scopes are mixed into login identity configuration.

- [ ] **Step 3: Register callback URLs in provider apps**

  Configure provider app redirect/callback URLs for the deployed Better Auth route mounted under
  `/api/auth/*`. Record the exact callback URL used for each provider in
  `docs/operations/auth-callback-verification.md`.

  Expected: provider apps accept the callback URLs without requesting connector/mail/calendar
  scopes.

- [ ] **Step 4: Configure runtime environment**

  Populate operator-managed environment values outside git using the variables from
  `infra/env.production.example`:

  ```txt
  JARVIS_AUTH_BASE_URL
  JARVIS_AUTH_TRUSTED_ORIGINS
  JARVIS_AUTH_GOOGLE_CLIENT_ID
  JARVIS_AUTH_GOOGLE_CLIENT_SECRET
  JARVIS_AUTH_GITHUB_CLIENT_ID
  JARVIS_AUTH_GITHUB_CLIENT_SECRET
  JARVIS_AUTH_MICROSOFT_CLIENT_ID
  JARVIS_AUTH_MICROSOFT_CLIENT_SECRET
  JARVIS_AUTH_MICROSOFT_TENANT_ID
  JARVIS_AUTH_OIDC_PROVIDER_ID
  JARVIS_AUTH_OIDC_DISPLAY_NAME
  JARVIS_AUTH_OIDC_CLIENT_ID
  JARVIS_AUTH_OIDC_CLIENT_SECRET
  JARVIS_AUTH_OIDC_DISCOVERY_URL
  ```

  Expected: no secret values are committed or copied into project docs.

- [ ] **Step 5: Verify browser login callbacks**

  For each configured provider, perform one browser login flow:

  ```txt
  Google: pass/fail
  GitHub: pass/fail
  Microsoft: pass/fail
  Generic OIDC: pass/fail
  ```

  Expected:
  - login completes and lands back in the Jarv1s web app
  - `/api/me` returns the authenticated user
  - first-user bootstrap behavior remains correct on a fresh instance
  - workspace context is still resolved by Jarv1s access context, not provider scopes

- [ ] **Step 6: Record callback verification evidence**

  Create `docs/operations/auth-callback-verification.md` with:

  ```markdown
  # Auth Callback Verification

  Date: 2026-06-06

  ## Origins

  - API origin: `https://<api-host>`
  - Web origin: `https://<web-host>`
  - Better Auth base URL: `https://<api-host>`
  - Trusted origins: `https://<web-host>`

  ## Provider Results

  | Provider     | Callback URL     | Result    | Notes |
  | ------------ | ---------------- | --------- | ----- |
  | Google       | `<callback_url>` | pass/fail |       |
  | GitHub       | `<callback_url>` | pass/fail |       |
  | Microsoft    | `<callback_url>` | pass/fail |       |
  | Generic OIDC | `<callback_url>` | pass/fail |       |

  ## Scope Boundary

  Login providers used identity scopes only. Connector authorization remains separate.

  ## Failures And Follow-Ups

  - None.
  ```

  Do not include client secrets, tokens, account emails, or screenshots containing private account
  data.

- [ ] **Step 7: Update production env documentation**

  If provider verification reveals missing or ambiguous environment variables, update
  `infra/env.production.example` comments only. Keep values as placeholders.

- [ ] **Step 8: Update handoff**

  In `docs/HANDOFF.md`, move verified provider callbacks out of open questions and record remaining
  callback gaps.

- [ ] **Step 9: Commit callback evidence**

  Run:

  ```bash
  git add docs/HANDOFF.md docs/operations/auth-callback-verification.md infra/env.production.example
  git commit -m "Document external auth callback verification"
  ```

## Task 3: Production Postgres And pg-boss Operations Review

**Files:**

- Create: `docs/operations/production-postgres-pgboss.md`
- Modify: `docs/operations/release-hardening.md`
- Modify: `infra/env.production.example`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Inspect role and grant posture**

  Run against the production-like database after migrations:

  ```bash
  pnpm audit:release-hardening
  ```

  Expected: runtime roles are not superusers, cannot create DBs or roles, cannot bypass RLS, cannot
  delete protected product/secret tables, and worker cannot read admin audit events.

- [ ] **Step 2: Verify production environment checklist**

  Run:

  ```bash
  sed -n '1,220p' infra/env.production.example
  rg "DATABASE_URL|BETTER_AUTH|JARVIS_CONNECTOR_SECRET_KEY|JARVIS_AI_SECRET_KEY|PG_BOSS|NODE_ENV" infra/env.production.example
  ```

  Expected: production requires distinct database role URLs, `NODE_ENV=production`,
  `BETTER_AUTH_SECRET`, `JARVIS_CONNECTOR_SECRET_KEY`, and `JARVIS_AI_SECRET_KEY`.

- [ ] **Step 3: Document database role operating rules**

  Create `docs/operations/production-postgres-pgboss.md` and include:

  ```markdown
  # Production Postgres And pg-boss Operations

  Date: 2026-06-06

  ## Database Roles

  - Bootstrap/operator role: used for role setup, backup, restore, release-hardening audit, and
    destructive operator maintenance scripts.
  - Migration owner role: owns schema migration execution and protected table DDL.
  - App runtime role: handles API requests and must not own protected tables or bypass RLS.
  - Worker runtime role: handles metadata-only jobs and must not own protected tables or bypass RLS.

  ## Required Rules

  - Do not grant `BYPASSRLS` to app or worker roles.
  - Do not make app or worker roles owners of protected product or secret-bearing tables.
  - Keep `FORCE ROW LEVEL SECURITY` enabled on protected module tables.
  - Run `pnpm audit:release-hardening` after migrations, restores, and manual grant changes.

  ## pg-boss Payload Rules

  - Allowed: actor IDs, workspace IDs, resource IDs, job kind, idempotency keys, and small command
    parameters.
  - Forbidden: secrets, private bodies, raw connector payloads, prompts containing private content,
    model-visible private content, and provider tokens.

  ## Backup And Restore

  - Run `pnpm backup:db -- --output backups/jarv1s-alpha.dump` before destructive maintenance.
  - Run `pnpm restore:db -- --input backups/jarv1s-alpha.dump` to preview restore commands.
  - Run `pnpm restore:db -- --input backups/jarv1s-alpha.dump --execute --confirm-restore` only
    against the intended database.
  ```

- [ ] **Step 4: Check pg-boss runtime configuration**

  Run:

  ```bash
  sed -n '1,220p' packages/jobs/src/pg-boss.ts
  sed -n '1,180p' apps/worker/src/worker.ts
  ```

  Expected: pg-boss uses the worker runtime URL, and handlers enter module worker registrations that
  use data context for protected module access.

- [ ] **Step 5: Decide whether new env placeholders are needed**

  If production pg-boss settings need explicit operator control, add placeholder comments to
  `infra/env.production.example`. Keep this narrow to settings the current code can actually read,
  or add a follow-up issue instead of inventing unused variables.

- [ ] **Step 6: Update release-hardening docs**

  Add a short section in `docs/operations/release-hardening.md` linking to
  `docs/operations/production-postgres-pgboss.md`.

- [ ] **Step 7: Update handoff**

  In `docs/HANDOFF.md`, summarize production Postgres/pg-boss decisions and remove resolved open
  questions.

- [ ] **Step 8: Commit operations review**

  Run:

  ```bash
  git add docs/HANDOFF.md docs/operations/release-hardening.md docs/operations/production-postgres-pgboss.md infra/env.production.example
  git commit -m "Document production Postgres and pg-boss operations"
  ```

## Task 4: Final M7 Gate

**Files:**

- Modify: `README.md`
- Modify: `docs/HANDOFF.md`
- Modify: `docs/architecture/plans/0003-platform-first-alpha-roadmap.md`

- [ ] **Step 1: Confirm all M7 evidence docs exist**

  Run:

  ```bash
  test -f docs/operations/m7-verification-results.md
  test -f docs/operations/auth-callback-verification.md
  test -f docs/operations/production-postgres-pgboss.md
  ```

  Expected: all commands exit `0`.

- [ ] **Step 2: Run final documentation formatting**

  Run:

  ```bash
  pnpm exec prettier --check README.md docs/HANDOFF.md docs/architecture/plans/0003-platform-first-alpha-roadmap.md docs/architecture/plans/0004-m7-operations-verification-plan.md docs/operations/release-hardening.md docs/operations/m7-verification-results.md docs/operations/auth-callback-verification.md docs/operations/production-postgres-pgboss.md infra/env.production.example
  ```

  Expected: all matched files use Prettier code style.

- [ ] **Step 3: Run final verification gate**

  Run:

  ```bash
  pnpm verify:foundation
  pnpm test:release-hardening
  pnpm audit:release-hardening
  pnpm build:web
  pnpm test:e2e
  ```

  Expected: all commands pass.

- [ ] **Step 4: Update roadmap status**

  In `docs/architecture/plans/0003-platform-first-alpha-roadmap.md`, add a short note under
  Milestone 7 that M7 operations verification has passed, with links to the three evidence docs.

- [ ] **Step 5: Update README continuation point**

  In `README.md`, change the next-work guidance from M7 operations hardening to the next selected
  post-M7 roadmap slice.

- [ ] **Step 6: Update handoff**

  In `docs/HANDOFF.md`, mark M7 verification complete and set the next agent target to the selected
  post-M7 slice. Preserve all hard invariants.

- [ ] **Step 7: Commit final M7 gate**

  Run:

  ```bash
  git add README.md docs/HANDOFF.md docs/architecture/plans/0003-platform-first-alpha-roadmap.md
  git commit -m "Close M7 operations verification gate"
  ```

## Acceptance Criteria

- A clean or production-like environment has run the CI-equivalent local commands and Compose smoke
  path.
- External auth callback behavior has been verified or explicit provider-specific blockers are
  documented.
- Production Postgres role/grant rules and pg-boss payload/runtime settings are documented.
- `docs/HANDOFF.md` points to actual evidence, not only intended next steps.
- The repo has focused commits for verification evidence, auth callback verification, operations
  review, and final M7 gate closure.
- No secrets, private content, raw connector payloads, provider tokens, or personal account details
  are committed.

## Self-Review

- Spec coverage: the plan covers clean CI-equivalent verification, external OAuth/OIDC callback
  verification, production Postgres/pg-boss operations, handoff updates, and commit hygiene.
- Placeholder scan: template placeholders are limited to values that must be filled with
  environment-specific origins, commit IDs, and command results during execution.
- Boundary check: every task preserves current M7 scope and explicitly blocks new product feature
  work until operations verification is complete.
