# Handoff — Job Search broad discovery BUILD

**Pointer handoff. Read the spec + linked files; no full recap here.**

## State: BUILDING (spine started)

- Worktree `.claude/worktrees/job-search-broad-discovery-build`, branch
  `build/job-search-broad-discovery`, tip `d033584d`.
- Task issue **#1229** (Part of epic **#913**). Spec approved (Ben: "start the build").
- Spec: `docs/superpowers/specs/2026-07-21-job-search-broad-discovery.md` (authoritative).
- agentmemory: recall `"jarvis broad discovery freehire"` → `spec-job-search-broad-discovery`.

## Done

- `src/adapters/discovery-types.ts` — the `JobDiscoveryProvider` seam
  (DiscoveryQuery/DiscoveryRequest + caps `MAX_BROAD_POSTINGS_PER_RUN=50`,
  `MAX_BROAD_TITLE_REQUESTS=3`). Committed `d033584d`.

## Remaining spine (Opus — invariant-dense)

All under `external-modules/job-search/src/adapters/`:

1. **`freehire.ts`** — provider. `id:"freehire"`, `fetchHosts:["freehire.dev"]`,
   `compliance.status:"allowed"` (reviewedBy `"coordinator/automated"`, reviewedAt today),
   `courtesyIntervalMs:60*60*1000`. Factory w/ default base URL `https://freehire.dev`.
   - `buildRequests`: per-title (≤3) `GET /api/v1/jobs/search?q=<title>&limit=&offset=0&sort=posted_at&order=desc&countries=<ISO2>` + `&work_mode=remote` iff `remote`. Send ONLY titles+country+coarse remote (AC5 — NO salary/dealbreakers/company).
   - `normalize`: freehire `{data:[...],meta:{}}` → `NormalizedPosting[]`. Map `url`→`canonicalUrl`, **`externalId:""`** (⇒ url-path identity §6.6). Sanitize+cap every field (`sanitizeInlineField`, TITLE/COMPANY/LOCATION caps from types.ts). `description = truncateUtf8(stripHtmlToText(decodeEntities(...)), DESCRIPTION_MAX_BYTES)`. Per-item try/record guard; count drops → `skippedCount`. Throw `JobSearchFetchError("malformed_payload")` only on envelope shape violation.
2. **`discovery-registry.ts`** — mirror `registry.ts`: `DISCOVERY_PROVIDERS`, `KILL_SWITCHED`, fail-closed `activeProviders` (`compliance.status==="allowed" && !killSwitched`), `getDiscoveryProvider(id)`, `listDiscoveryProviders()`.
3. **`fetch-discovery.ts`** — mirror `fetch-board.ts` host-pinned orchestration: reuse `AdapterFetch`/`courtesyDue`/`fetchFromWorkerContext`. Per request: compliance→courtesy→**re-assert URL host ∈ provider.fetchHosts**→fetch→status/JSON guards→normalize. Sum postings across a query's requests, **hard-truncate to `MAX_BROAD_POSTINGS_PER_RUN` (AC6)**. FIXED error messages (never echo external body).
4. Barrel exports in `src/adapters/index.ts`.

Idioms: copy `greenhouse.ts`/`lever.ts`/`ashby.ts` verbatim in shape. `sanitize.ts` = `stripHtmlToText`/`decodeEntities`/`sanitizeInlineField`. `truncateUtf8` @ `src/domain/opportunities.ts:107`. Limits @ `limits.ts` (`DESCRIPTION_MAX_BYTES=16384`).

## Slice 2 (backend wiring)

- `MonitorConfig.query.kind`: add `"broad"` (default `"board"`, additive, schemaVersion stays 1).
- `src/worker/handlers/run.ts`: branch on `query.kind` — broad path resolves `getDiscoveryProvider`, `fetchDiscovery(...)`, binds records to `sourceKey(provider.id, "broad")`.
- `src/domain/freshness.ts`: broad sources `absenceImpliesClosure:false` — exempt from `markFreshnessAfterRun` staleness (§ carve-out).

## Slice 3 (web/onboarding — hand to Codex gpt-5.6-sol, review on Opus)

- `jarvis.module.json`: add `"freehire.dev"` to `fetchHosts` + update assistantOnboarding.guidance.
- Onboarding `sources_schedule` step §5.1: broad ON by default, summary from profile titles+locations, primary CTA "Start my search" completes w/ broad alone; company watches collapsed/optional. `monitor.save` `query.kind:"broad"`.
- SourcesControl demotion + feed provenance chip.

## Tests / exit

- Unit: freehire normalize fixture; buildRequests query-minimization (AC5); fetch-discovery host-pin + volume cap (AC6).
- Real-dev-UAT #1000 harness: fresh user, NO company URL → real matches from live `https://freehire.dev` (AC1; mocks insufficient).
- `pnpm verify:foundation` green; no file >1000 lines.

## Guardrails

Fail-closed registry; host-pin every fetch; outbound = titles+location+coarse-remote only; FIXED error strings; url-path identity (`externalId:""`); build only on THIS worktree; stage explicit paths (shared tree). Freehire keyless ⇒ no credential UI, no secrets.
