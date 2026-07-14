# Host, Account, Diagnostics, and Operator Truth — Security Design (#993)

**Status:** Proposed — approval-ready; no build before approval

**Date:** 2026-07-13

**Issue:** #993

**Security tier:** Security

**Grounded on:** rebased planning head `b1529307` after `pnpm audit:preflight` confirmed zero commits
behind `origin/main` (`e0553ed5`) on 2026-07-14

## Context

The current settings UI is backed by real host diagnostics, multiplexer status, and account data,
but it presents several different kinds of truth as though they were the same:

- `herdrInstalled` means the binary exists in the Jarv1s container, while `available.herdr` means
  the binary and an app-runtime root pane are both ready. Production Compose additionally pins the
  active backend to tmux.
- diagnostics show a flat list of technical checks before saying whether the host is healthy or
  what the operator should do;
- log level is a read-only environment fact presented as a settings row;
- email appears in both the identity header and Account group, with no supported secure change
  flow or named source of authority;
- the profile header has little visual hierarchy despite existing settings-card patterns.

The existing #866 and #255 security decisions remain binding: the web process must not install
binaries, execute arbitrary host commands, or offer a blind restart endpoint.

## Goals

1. Describe the container/runtime state precisely: installed, ready, selected, active, and pinned
   are distinct facts.
2. Give an eligible admin exact deployment-specific setup and restart instructions without adding
   host mutation to the API.
3. Put a health summary and fixed recovery guidance before safe diagnostic detail.
4. Remove the inert log-level settings row rather than add a new runtime configuration system.
5. Show email once and identify whether Jarv1s credentials or a named external sign-in provider own
   that identity.
6. Strengthen profile hierarchy using existing settings primitives and tokens.

## Non-goals

- No web-triggered Herdr install, shell execution, restart, or arbitrary command endpoint.
- No runtime log-level mutation or DB-backed runtime configuration framework.
- No email mutation until Jarv1s has a verified-email delivery and re-authentication design.
- No 2FA, password-management, auth-provider provisioning, or account-linking project.
- No raw environment dump, log viewer, stack trace, secret, URL credential, or private path in
  diagnostics.
- No work in `tests/uat/**`, `docs/coordination/**`, or
  `apps/web/src/settings/settings-module-registry-section.tsx` (#1042 owns that lane).

## Resolved Decisions

### 1. One host state model, with no optimistic labels

The existing admin multiplexer response remains the source of truth. The UI renders its fields as:

- **Installed:** `herdrInstalled` — the binary is visible inside the Jarv1s runtime container.
- **Ready:** `available.herdr` — the binary exists and a root pane or root tab is configured.
- **Active:** `active` — the backend new chat sessions actually use.
- **Selected:** the persisted admin choice.
- **Pinned:** `envOverride` — deployment configuration overrides the admin choice.

“Herdr unavailable” must never be used as shorthand for all five states. A host-installed Herdr
binary outside the container is not an app-runtime backend and must not be reported as one.

The shared readiness predicate must recognize every root source the Herdr adapter supports:
`JARVIS_HERDR_ROOT_TAB`, `JARVIS_HERDR_ROOT_PANE`, or `HERDR_PANE_ID`. The multiplexer resolver and
status probe reuse that predicate so selection and reporting cannot drift again.

### 2. Production Compose becomes configurable, not mutable from the web

`infra/docker-compose.prod.yml` keeps tmux as the default but permits the operator's env file to set:

```yaml
JARVIS_MULTIPLEXER: "${JARVIS_MULTIPLEXER:-tmux}"
JARVIS_HERDR_ROOT_TAB: "${JARVIS_HERDR_ROOT_TAB:-}"
```

Settings shows fixed instructions for the detected Compose deployment:

1. from the production deployment directory, install the pinned/checksummed binary with
   `docker compose -p jarv1s-prod -f docker-compose.prod.yml --env-file ./env.production.local exec jarv1s /app/scripts/install-herdr.sh`;
2. set `JARVIS_MULTIPLEXER=herdr` and `JARVIS_HERDR_ROOT_TAB=jarv1s` in the deployment env file;
3. recreate the app container so Compose reloads that env file:
   `docker compose -p jarv1s-prod -f docker-compose.prod.yml --env-file ./env.production.local up -d jarv1s`;
4. refresh diagnostics and confirm **Active: Herdr**.

`docker compose restart` is not acceptable after an env-file change because restart does not
recreate the container or reload its environment. The current `docker compose restart api` hint also
targets a nonexistent production service and omits the shipped project, compose-file, and env-file
selectors. The fixed copy uses `up -d jarv1s` with all three selectors. A notes-enabled deployment
must additionally retain its shipped `-f docker-compose.notes.yml` override. Unknown deployment modes
get no guessed command.

### 3. Diagnostics summary is derived in the browser

The existing admin-only, allowlisted `HostDiagnosticsDto` is sufficient. No new diagnostics route,
probe, or data field is needed.

The page derives an overall summary from `checks`:

- any `fail` → “Host needs attention”;
- otherwise any `warn` → “Host is running with warnings”;
- otherwise → “Host checks passed.”

Fixed recovery guidance is keyed only by the existing safe check id. Technical metadata
(environment, version, commit, bind address, modules/routes, mux fields) moves under a native
`<details>` disclosure. Database or job-queue detail never includes raw errors.

### 4. Log level is removed from the settings surface

The dedicated Log level row is deleted. `LOG_LEVEL` remains deployment configuration and may remain
in the secret-safe diagnostics DTO for support tooling, but Settings no longer implies it is an
editable preference. A future runtime setting requires its own approved persistence/restart design.

### 5. Email has one authoritative surface and no unsafe mutation

The profile header stops repeating email. The Account group is the only email surface.

`GET /api/me` gains only safe identity-source metadata, derived through the auth runtime from
`app.auth_accounts.provider_id`; it never selects or serializes passwords, tokens, account ids, or
provider payloads. The UI maps `credential` to “Jarv1s sign-in” and known social ids to their provider
names. Mixed methods are named as linked sign-in methods.

- Credential-owned email: “Managed by Jarv1s sign-in. Email changes are not supported yet.”
- External-owned email: “Managed by <provider>. Change it with that provider.”
- Unknown/absent auth runtime: “Identity owner unavailable” — never guess “provider managed.”

No email-change action ships. Changing `app.users.email` without re-authentication, uniqueness
handling, new-address verification, session review, and notification of the old address would create
an account-takeover path. Those capabilities do not exist today.

### 6. Profile hierarchy reuses existing authored styles

The Identity summary uses the same tokenized warm surface, border, radius, and spacing pattern as
existing settings cards. It keeps serif/mono/sans design rules, existing `Avatar`, `Badge`, `Group`,
and `Field` primitives, and introduces no new component library or raw color.

## Security Boundaries

| Threat                                         | Required control                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Admin session becomes host RCE                 | No install/restart/command mutation route; instructions are fixed text only.                   |
| Host state lies across container/host boundary | Report only container-observable installed/readiness state and active source.                  |
| Resolver and status drift                      | One shared Herdr-root predicate used by both call paths.                                       |
| Diagnostics disclose secrets or private data   | Existing admin gate, allowlisted DTO, sanitizer, bounded fixed details; no contract expansion. |
| Email takeover                                 | No email mutation; identity-source query selects provider ids only.                            |
| Auth metadata leaks another user               | `/api/me` resolves only the authenticated actor; no admin bypass or arbitrary user id input.   |
| Deployment command injection                   | Commands contain no user-provided interpolation and are never executed by Jarv1s.              |

## Exact Owned Product Paths

- `packages/ai/src/adapters/multiplexer-resolve.ts`
- `packages/module-registry/src/chat-multiplexer.ts`
- `packages/auth/src/index.ts`
- `packages/shared/src/platform-api.ts`
- `packages/settings/src/routes.ts`
- `apps/api/src/server.ts`
- `infra/docker-compose.prod.yml`
- `apps/web/src/settings/settings-admin-panes.tsx`
- `apps/web/src/settings/settings-personal-panes.tsx`
- `apps/web/src/styles/settings-panes.css`

No #993 task may claim `apps/web/src/settings/settings-personal-data-panes.tsx` or the #1042
settings-module registry file.

## Verification and Live-path Proof

- Unit: all three Herdr root sources produce the same ready/selection answer; installed-without-root,
  env-pinned tmux, and invalid override remain distinct.
- Integration: `/api/me` returns only the current actor's bounded identity-source metadata; auth
  tokens/password hashes never appear.
- Unit/UI: diagnostics summary prioritizes failure, recovery copy is fixed, technical detail is
  secondary, log-level row is absent, and email renders once with truthful ownership.
- Compose: rendered config defaults to tmux, accepts an env-file Herdr/root-tab override, and the
  shown `-p`/`-f`/`--env-file ... up -d jarv1s` command recreates the app with those values.
- Live path: navigate normally to Settings → Advanced host setup on the deployed Compose instance,
  capture installed/ready/active/pinned states, run diagnostics, follow the shown recreation command,
  and confirm the refreshed active state. Then navigate to Account & preferences and confirm email
  appears once with the correct owner label. Do not deep-link or use `tests/uat/**`.

## Exit Criteria

- Every #993 acceptance item is covered by the decisions above without weakening a hard invariant.
- No web-triggered privileged operation exists.
- Diagnostics remain admin-only and secret-safe.
- Email mutation remains unavailable until a separately approved verified-change design exists.
- `pnpm verify:foundation`, `pnpm check:design-tokens`, focused tests, and the live-path proof pass.
