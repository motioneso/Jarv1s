# Dataset connector SDK (generalize SportsSource into a core connector surface)

**Status:** draft (2026-07-04, rev 2 after adversarial cross-model review) — design spec for task
issue #800, part of epic #798 (module docking seams). Flip #800 to `RFA` once approved.

**Grounded on:** `origin/main` @ `1c307466` (audit findings verified at `2797fc1f`; rev 2 findings
verified at `1c307466`). Re-run `pnpm audit:preflight` before building.

---

## Problem

There is no generic way for a module to declare "I consume this external data set." The existing
seams cover internal streams well (`sourceBehaviors` + `proactiveMonitor`,
`packages/module-sdk/src/index.ts:433-438,:183-187`; pull providers; composition-root ports), and
`packages/connectors` owns Google/IMAP OAuth sync — but a module wanting a _new_ external source
gets no platform help. Sports had to build everything bespoke:

- `packages/sports/src/source/sports-source.ts` — the `SportsSource` adapter contract
  (LOADER-SEAM-tagged: "No route/service/manifest may bypass this").
- `packages/sports/src/source/espn-source.ts` — the only network-I/O file; injectable
  `fetchFn = fetch`; maps raw ESPN JSON to shared DTOs.
- `packages/sports/src/sports-cache.ts` — bespoke in-memory TTL cache (scoreboards 3 min,
  standings/headlines/schedule 10 min, teams 24 h) with degrade-to-authored-empties +
  `degraded: true` instead of 500s.
- CSP plumbing: `MODULE_IMAGE_CSP_HOSTS = createEspnSportsSource().imageHosts`
  (`packages/module-registry/src/index.ts:1250-1252`) consumed by
  `apps/api/src/static-web.ts:31`.
- Composition-root construction: `createEspnSportsSource(deps.fetchFn)` injected into
  `registerSportsRoutes` (`packages/module-registry/src/index.ts:1133-1138`).
- **A second, uninjected construction path:** `packages/sports/src/briefing-tool.ts:17-19` builds
  its own `new SportsService({ source: createEspnSportsSource(), ... })` with a throwing stub
  `dataContext` — so assistant-tool network I/O currently bypasses the composition root entirely
  (no injected `fetchFn`, no shared cache). Any generalization that only replaces the route wiring
  would leave this path outside the runtime's host pinning and caching.

Every one of those pieces except the ESPN payload mapping is platform-shaped. The next
external-data module (weather #217, finance, news) would copy-paste the cache, the degradation
contract, the host pinning, and the CSP wiring.

## Goal

A module declares its external data sets in the manifest; the platform owns fetching, TTL caching,
graceful degradation, outbound host pinning, and CSP aggregation. The module writes only the
adapter (endpoint → DTO mapping) and its feature logic. Sports migrates onto the SDK with zero
behavior change, proving the seam.

## Architecture

**One new manifest contribution point + one platform runtime.** Terminology: an **external source**
is a provider (ESPN); a **dataset** is one fetchable, cacheable unit (nfl scoreboard for a date).

1. **Manifest declaration** (`packages/module-sdk/src/index.ts`, new field on
   `JarvisModuleManifest`):

   ```ts
   readonly externalSources?: readonly ModuleExternalSourceManifest[];

   interface ModuleExternalSourceManifest {
     readonly id: string; // e.g. "espn" — globally unique, asserted at registration
     readonly displayName: string;
     readonly credential: "none" | "api-key"; // OAuth deliberately excluded (non-goal)
     readonly fetchHosts: readonly string[]; // exact hostnames the adapter may hit
     readonly imageHosts?: readonly string[]; // aggregated into the web CSP img-src
     readonly datasets: readonly ModuleDatasetManifest[];
   }

   interface ModuleDatasetManifest {
     readonly key: string; // e.g. "scoreboard" — unique within the source
     readonly ttlMs: number;
     readonly staleness: "serve-stale-on-error" | "degrade-empty"; // sports uses degrade-empty
     readonly staleRetentionMs?: number; // serve-stale-on-error only; default 6 h
   }
   ```

   `module-sdk` stays dependency-free; the adapter implementation type lives beside it:
   `ExternalSourceAdapter` — `{ fetchDataset(datasetKey, params, ctx): Promise<unknown> }` where
   `ctx` carries the platform-provided `fetchFn` and (if `credential: "api-key"`) the decrypted
   key. Adapters never call global `fetch` directly.

2. **Platform runtime: `@jarv1s/datasets` (new package)** — `createDatasetClient(source, adapter,
deps)` returning `getDataset(key, params)`:
   - **TTL cache**: generalizes `SportsCache` (per-dataset TTL from the manifest, keyed by
     `sourceId/datasetKey/params-hash`). In-memory, per-process — same as today. No persistence
     (explicit non-goal; sports README §9 defers snapshot tables).
   - **Degradation contract**: on adapter failure, apply the dataset's `staleness` policy and
     surface `degraded: true` in the envelope — the sports pattern, now standard:
     `{ data, degraded, fetchedAt }`. Note `serve-stale-on-error` is a **new capability, not a
     generalization**: today's `SportsCache` deletes expired entries on read
     (`if (Date.now() > entry.expiresAt) this.map.delete(key)`), so nothing stale survives to be
     served. The runtime cache therefore keeps two horizons per entry: `expiresAt` (TTL — entry no
     longer fresh, refetch) and `evictAt` (`expiresAt + staleRetentionMs` — entry actually
     dropped). `degrade-empty` datasets set `evictAt = expiresAt` (today's behavior, byte-identical
     for sports); `serve-stale-on-error` datasets retain the expired entry within the stale window
     and serve it with `degraded: true` when the refetch fails.
   - **Host pinning**: the runtime wraps `fetchFn` and rejects any request whose hostname is not in
     `fetchHosts` (exact match, no wildcards; https only; redirects re-checked). This is the SSRF
     floor — an adapter bug or hostile URL in payload data cannot make the platform fetch elsewhere
     (the v0.1.0 audit's `web.read` SSRF chain is the cautionary precedent).
   - **Injectable `fetchFn`** for tests/fixtures, exactly like `EspnSportsSource` today.
   - **Rate courtesy**: minimum-interval guard per source (config on the source decl, default none)
     so a busy instance cannot hammer an unauthenticated public API.

3. **Registration + wiring** (`packages/module-registry/src/index.ts`):
   - `BuiltInModuleRegistration` gains `externalSourceAdapters?: Record<sourceId, factory>`; the
     composition root builds one `DatasetClient` per declared source and passes it into
     `registerRoutes`/`registerWorkers` deps (replacing the bespoke
     `createEspnSportsSource(deps.fetchFn)` special case at `:1133-1138`).
   - `assertModuleRegistryConsistency` (`:1254-1281`) extends to enforce globally-unique source
     ids and valid host lists (non-empty, lowercase hostnames, no IPs, no ports).
   - `MODULE_IMAGE_CSP_HOSTS` (`:1250-1252`) becomes derived: the union of every registered
     source's `imageHosts`. `apps/api/src/static-web.ts:31` is unchanged;
     `tests/unit/static-web-csp.test.ts` keeps the sync honest.

4. **Credentials: deferred — this slice ships `none` only.** The enum reserves `"api-key"`, but
   no keyed source exists yet and, more importantly, no generic dataset-secret storage exists
   today: connector and AI credentials each have their own dedicated encrypted tables and
   ownership models — there is no "existing machinery" a dataset key could simply reuse. Shipping
   `api-key` would require a new table + migration, an ownership decision (instance-level vs
   per-user), a settings surface, and RLS classification — real design work that belongs in its
   own slice with the first keyed source (weather #217 is the likely driver). Until then:
   registration **rejects** any manifest declaring `credential: "api-key"` with a pointer to this
   spec, so the enum can't be used half-built. The runtime's adapter `ctx` shape leaves room for
   the future `credential` field. All Hard-Invariant handling requirements (AES-256-GCM at rest,
   decrypt only inside the runtime, never logged / in job payloads / in responses; absent key ⇒
   permanently `degraded`, never an error page) transfer to that future spec as constraints.

   **Cache-key user-scoping constraint (#836):** `DatasetClient`'s cache is instance-level, keyed
   `sourceId:datasetKey:params` with no separate user dimension (see the `buildCacheKey` doc
   comment, `packages/datasets/src/client.ts`). This is correct only because every source shipped
   so far is `credential: "none"` — public, non-personalized data. The keyed-credential slice this
   section defers MUST ensure any per-user dataset's `params` carries the user's identity (e.g. a
   `userId` field), or the instance-level cache will serve one user's cached response to another
   by key collision. This note and #833's PR-body traceability note both cover this constraint; no
   code change is required until a per-user source actually exists.

5. **Sports migration (the proof):** `SportsSource`'s five methods become five dataset keys
   (`teams`, `scoreboard`, `schedule`, `standings`, `headlines`); `EspnSportsSource` becomes the
   `espn` adapter (payload mapping unchanged); `SportsCache` is deleted in favor of the runtime
   cache with identical TTLs; `SportsService` consumes the `DatasetClient`. **Both construction
   paths migrate:** the route wiring at `module-registry:1133-1138` AND the briefing tool's
   self-built service (`packages/sports/src/briefing-tool.ts:17-19`) — the briefing tool must
   receive the same composition-root `DatasetClient` (sharing its cache and host pinning) instead
   of constructing `createEspnSportsSource()` itself. A registration-time assertion or lint sweep
   confirms no module code calls a source factory outside the runtime. Fixtures
   (`packages/sports/src/source/__fixtures__/*.json`) drive the same unit tests through the
   injectable `fetchFn`. Behavior change: zero (assert via existing
   `sports-service/espn-source/sports-cache` test suites, updated only for the new seams).

## Non-goals

- **No OAuth flows** (scope guardrail: real OAuth callbacks need their own milestone).
- **No `api-key` sources in this slice** — enum value reserved, registration rejects it until the
  dataset-credential spec lands (see Architecture §4).
- **No persisted snapshots / sync workers** — on-demand fetch only, matching sports today. A
  future spec can add a snapshot worker without changing the manifest shape (add a
  `schedule` field then).
- **No replacement of `packages/connectors`** — Google/IMAP sync, monitors, and
  `connector_accounts` are a different trust/consent domain and stay as-is.
- **No third-party/out-of-process adapters** — in-process trusted code only (ADR 0009 §5 posture).

## Verification

- Unit: host-pinning rejection (including redirect-hop escape attempt), TTL expiry, both staleness
  policies (incl. stale-retention: expired entry served with `degraded: true` inside the window,
  evicted after), registration rejection of `credential: "api-key"`, CSP union derivation.
- Integration: sports routes + briefing tool behave byte-identically against fixtures (briefing
  tool now exercised through the shared `DatasetClient`); registry assertions reject a duplicate
  source id and a malformed host.
- `pnpm verify:foundation` + `test:release-hardening` green; `audit:release-hardening` — extend the
  release-hardening audit script to sweep `externalSources` host lists.

## Risks / open questions

- **Cache memory growth** with parameterized datasets: bound the cache (LRU, per-source entry cap,
  default 500) — sports' unbounded map is fine at its scale but the SDK must not be.
- **Weather (#217)** should be the second consumer; if its shape doesn't fit this manifest, the
  design is wrong — sanity-check the spec against #217's needs during review.
- **Briefing-tool DataContext stub:** migrating the briefing tool onto the composition-root client
  removes its throwing `dataContext` stub only for source I/O; the stub pattern itself (tool runs
  without user data access) is out of scope here — note it for the lifecycle spec if it recurs.
- Resolved (was open): `api-key` entry ships with the first keyed source, not this slice — no
  speculative UI, no half-specified secret storage (Architecture §4).
