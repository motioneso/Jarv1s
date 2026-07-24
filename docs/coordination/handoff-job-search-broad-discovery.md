# Handoff — Job Search broad discovery spec

**Pointer handoff. Read the linked files; do not expect a full recap here.**

## State: SPEC DONE, build gated

- Branch `spec/job-search-broad-discovery`, tip `2ca9f881` (spec-only worktree).
- Deliverable: `docs/superpowers/specs/2026-07-21-job-search-broad-discovery.md` (12 sections + 2
  appendices, prettier-clean, committed).
- Full context in agentmemory: `spec-job-search-broad-discovery` (recall
  `"jarvis broad discovery freehire"`).

## Decisions locked (Ben, 2026-07-21)

1. Scraping permitted (guardrails: public/unauth/courteous-low-volume).
2. **Source = freehire.dev** (`strelov1/freehire`), keyless public REST, no spike. Adzuna + scrape =
   documented-but-unbuilt fallbacks.
3. **Hosting = consume public `freehire.dev` now, self-host later** (config change via the
   `JobDiscoveryProvider` base URL, not module code). freehire is a standalone Go+PG+Meilisearch
   service — can't live inside the in-process TS module.

## Do NOT

- Change app code / migrations / deps / GitHub issues / board on this branch (handoff scope).
- Start building here. Build needs: spec approved + a GitHub `task` issue (Part of job-search epic) +
  a SEPARATE build worktree. (`build-needs-task-issue` HARD rule.)

## Next step (only when Ben approves build)

1. Ben marks spec approved.
2. File `task` issue (Part of #<job-search epic>).
3. New worktree; implement freehire `JobDiscoveryProvider` (base URL default `https://freehire.dev`,
   `GET /api/v1/jobs/search` through existing host-pinned `fetchBoard`; add `freehire.dev` to manifest
   `fetchHosts`; fail-closed compliance-registry entry; url-path identity; `absenceImpliesClosure:false`).
4. Build-time unknown to resolve by reading freehire Go handler code: exact `/jobs/search` query params
   + per-job JSON field names.
5. Real-dev-UAT (#1000 harness) against live `freehire.dev`, fresh user, no company URL → real matches.
