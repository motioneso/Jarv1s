# Phase 2 Deploy Checkpoint And Final Epic Gate

**Status:** Manual acceptance required
**Date:** 2026-06-18
**Owner:** Ben
**GitHub:** #306

## Goal

Define the final acceptance gate for the Phase 2 deploy checkpoint before closing the Phase 2 epic.

This is not an implementation issue. It is a human/live-instance validation gate for the deployable
stack and first-run path.

## Current State

The deploy and acceptance materials already exist:

- `docs/superpowers/specs/2026-06-12-p2-deployable-containerized-stack-design.md`
- `docs/operations/dev-environment.md`
- `docs/coordination/2026-06-13-phase2-5-test-plan.md`

The Phase 2 work should not be closed only because code merged. Ben should validate that the stack
can actually be run, restarted, and used from a clean instance.

## Gate

Keep #306 open with `manual-acceptance` until Ben or an explicitly delegated operator completes the
checks below on the target host.

### 1. Production Compose Smoke

Run the production compose path, not the dev compose path:

```bash
pnpm smoke:compose:prod
```

Pass condition:

- images build or pull successfully;
- migrate one-shot exits 0;
- API health is green;
- worker starts;
- web serves the app;
- no source bind mounts are required for runtime services.

### 2. Fresh Instance Bootstrap

Start from a clean database.

Pass condition:

- `/api/bootstrap/status` returns `needsBootstrap: true`;
- first signup becomes active bootstrap owner and instance admin;
- later signup follows registration/approval settings;
- owner/admin state survives restart.

### 3. Reboot Survival

Verify the systemd/supervised stack survives host restart.

Pass condition:

- stack comes back after reboot or service restart;
- API health returns green;
- worker resumes;
- web is reachable;
- the host multiplexer bridge still works for live CLI chat.

Use the existing script where available:

```bash
bash scripts/verify-reboot-survival.sh
```

### 4. Operator Secrets And Env Sanity

Check the production env file and compose interpolation.

Pass condition:

- `JARVIS_IMAGE_TAG` is pinned, not `latest`;
- `POSTGRES_PASSWORD` is set and not the dev default;
- auth, connector, and AI secret keys are present where required;
- no secrets are baked into images or committed files;
- `docker compose --env-file ... config` resolves required values.

### 5. Minimal Daily-Driver Walkthrough

Run the shortest practical product walkthrough from
`docs/coordination/2026-06-13-phase2-5-test-plan.md`.

Pass condition:

- owner onboarding can complete or skip without trapping the user;
- tasks create/update/complete works;
- briefing run can be created or degrades honestly without a model;
- Google connector can connect/sync if credentials are available;
- live chat launches through the chosen multiplexer;
- write tools still require approval where required.

## Failure Handling

If any gate fails:

- leave #306 open;
- record the failing command, date, host, and short failure summary in the issue;
- file or link a concrete fix issue if the failure is not already tracked;
- do not close the Phase 2 epic.

Do not treat low-priority, already-documented deferred items as gate failures unless they block
deploy/use directly.

## Out Of Scope

- Building new deploy features.
- Reworking the acceptance plan.
- Closing later Phase 3–5 product gaps.
- Fixing deferred design-direction items.

## Acceptance Criteria

- Ben can deploy the production stack from documented commands.
- The stack survives restart/reboot.
- A clean instance can be bootstrapped and used.
- The core live path works: web, API, worker, DB, onboarding, tasks, chat, and deploy health.
- Any failures are recorded as concrete follow-up issues before the epic is closed.
