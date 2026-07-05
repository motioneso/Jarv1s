# Dataset connector SDK (generalize SportsSource into a core connector surface)

**Status:** draft (2026-07-04) — design spec for task issue #800, part of epic #798 (module docking
seams). Flip #800 to `RFA` once approved.

**Grounded on:** `origin/main` @ `cc23e808` (audit verified at `2797fc1f`). Re-run
`pnpm audit:preflight` before building.

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
     `{ data, degraded, fetchedAt }`.
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

4. **Credentials (`api-key` sources only).** Stored via the existing encrypted secret machinery
   (AES-256-GCM at rest, same store the connectors/AI credentials use), entered through a settings
   surface, decrypted only inside the dataset runtime, handed to the adapter per-call, never
   logged, never in job payloads, never in responses (Hard Invariant: secrets never escape). An
   `api-key` source whose key is absent behaves as permanently `degraded` — never an error page.

5. **Sports migration (the proof):** `SportsSource`'s five methods become five dataset keys
   (`teams`, `scoreboard`, `schedule`, `standings`, `headlines`); `EspnSportsSource` becomes the
   `espn` adapter (payload mapping unchanged); `SportsCache` is deleted in favor of the runtime
   cache with identical TTLs; `SportsService` consumes the `DatasetClient`. Fixtures
   (`packages/sports/src/source/__fixtures__/*.json`) drive the same unit tests through the
   injectable `fetchFn`. Behavior change: zero (assert via existing
   `sports-service/espn-source/sports-cache` test suites, updated only for the new seams).

## Non-goals

- **No OAuth flows** (scope guardrail: real OAuth callbacks need their own milestone; `credential`
  is `none | api-key` only, and the enum leaves room).
- **No persisted snapshots / sync workers** — on-demand fetch only, matching sports today. A
  future spec can add a snapshot worker without changing the manifest shape (add a
  `schedule` field then).
- **No replacement of `packages/connectors`** — Google/IMAP sync, monitors, and
  `connector_accounts` are a different trust/consent domain and stay as-is.
- **No third-party/out-of-process adapters** — in-process trusted code only (ADR 0009 §5 posture).

## Verification

- Unit: host-pinning rejection (including redirect-hop escape attempt), TTL expiry, both staleness
  policies, api-key never appears in an error/log envelope (grep-based assertion in test), CSP
  union derivation.
- Integration: sports routes + briefing tool behave byte-identically against fixtures; registry
  assertions reject a duplicate source id and a malformed host.
- `pnpm verify:foundation` + `test:release-hardening` green; `audit:release-hardening` — extend the
  release-hardening audit script to sweep `externalSources` host lists.

## Risks / open questions

- **Cache memory growth** with parameterized datasets: bound the cache (LRU, per-source entry cap,
  default 500) — sports' unbounded map is fine at its scale but the SDK must not be.
- **Weather (#217)** should be the second consumer; if its shape doesn't fit this manifest, the
  design is wrong — sanity-check the spec against #217's needs during review.
- Open: does `api-key` entry ship in this slice or land with the first keyed source? Default:
  define the enum + runtime plumbing now, build the settings entry UI with the first keyed source
  (avoid speculative UI).
