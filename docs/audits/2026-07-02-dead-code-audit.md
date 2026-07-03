# Project-Wide Dead Code Audit

**Date:** 2026-07-02
**Grounded on:** `d074936c` (`origin/main`) — verified via `pnpm audit:preflight` against a detached read-only worktree at `/tmp/audit-ground` (shared working tree was 25 commits behind; per CLAUDE.md grounding discipline, audit was run off-tree, never `git pull`ing the shared tree).
**Method:** Fleet of 6 parallel GLM agents (A–F), each scoped to a balanced slice of the monorepo. Each agent used the codebase-memory MCP graph (`home-ben-Jarv1s`, 18,953 nodes) + targeted grep + file reads, then applied false-positive guards (module public APIs, test fixtures, plugin contracts, indirect registration, design-system surface, applied migrations, CI scripts).
**Scope:** 3 apps + 33 packages + infra/scripts/config — ~580 source files reviewed.
**Read-only:** No files were modified, created, or deleted. This is a report only.

> **⚠️ Second-pass review (2026-07-02, Claude, grounded on `65ee9ca8`):** independent verification
> re-swept every HIGH/MED symbol on then-current `origin/main` plus contract/import-chain checks.
> Outcome: **1 finding REFUTED, 2 findings already stale, everything else CONFIRMED.**
>
> - **REFUTED — `apps/web/src/styles.css` is NOT dead.** `apps/web/src/styles/index.css:13`
>   imports it (`@import "../styles.css"` — cascade slot 5, "legacy task-screen compatibility
>   styles"). The import existed at this audit's grounding commit, so this was a genuine false
>   positive (the audit checked only `main.tsx`). **Do not delete.** Lesson: file-orphan claims
>   must grep the bare filename across CSS/HTML — CSS `@import` chains are invisible to
>   symbol-oriented sweeps.
> - **STALE — `connect-google-panel.tsx` and `time-bucket.tsx`** were deleted by PR #693 hours
>   after grounding. Correctly identified, already gone.
> - **Remedy error — `geocodeIp` / `fetchOpenMeteoForecast`:** "make non-exported" is impossible;
>   `weather-service.ts` imports them cross-file, so the `export` is required. Correctly
>   not-dead, but no action available short of merging files.
> - **Caveat — task-quadrant functions:** confirmed dead, but they are the readable spec the SQL
>   filter is documented against (`repository.ts:132` + the file's own doc-comment). Deleting
>   them requires updating those comments and accepts losing the executable anti-drift anchor.
> - **Bookkeeping:** headline counts mix units (Agent B header says 5 HIGH but lists 6; Agent F
>   says 24 HIGH but enumerates ~30 symbols). Adjusted headline: **HIGH actionable ≈ 30**
>   (33 − 1 refuted − 2 already deleted).
> - All other HIGH/MED findings verified on `65ee9ca8`: zero references incl. tests/specs, no
>   interface contracts broken by the memory repo method deletions, no barrel/alias re-export of
>   the dead web client functions, `db/src/types.ts` is handwritten (no codegen), and the
>   `classification.ts` re-exported constants ARE consumed (`drift.ts`, `repository.ts`) — keep them.
>
> Corrections are also annotated inline below, marked **[2nd-pass]**.

---

## Headline Numbers

| Confidence | Count | Meaning |
| --- | --- | --- |
| **HIGH** | **33** | Verified dead — zero references anywhere (incl. tests); safe to delete. |
| **MEDIUM** | **25** | Strong dead-code signal; one reviewer judgement call before removal. |
| **LOW** | **63** | Likely over-exported (the `export` keyword is dead, the symbol is live internally) OR public-API surface flagged only for visibility. Not actionable as "delete." |
| **Total candidates** | **121** | |

**Net actionable (HIGH + MEDIUM): 58**, of which the bulk cluster in **`apps/web/src/api/` (≈25 dead client functions)** and **a handful of orphan files / unused repo methods in `packages/`**.

> **[2nd-pass adjustment]:** net actionable is **≈55** — `styles.css` refuted (not dead), `connect-google-panel.tsx` and `time-bucket.tsx` already deleted by PR #693. See review note above.

---

## Top Themes (where the real dead weight is)

### 1. Frontend API client functions that mirror live backend routes but have no UI consumer (~25 functions, all HIGH)
The largest single cluster. `apps/web/src/api/client.ts`, `memory-client.ts`, `client-proactive.ts`, `weather-client.ts`, `usefulness-feedback-client.ts`, and the orphan `api/download.ts` all export functions whose backend routes exist and work — but the web UI for them was never built. Categories affected:
- Task list/tag editing (`renameTaskList`, `deleteTaskList`, `renameTaskTag`, `deleteTaskTag`, `createTaskList`)
- AI capability-route editing (`discoverAiProvidersModels`, `listAiCapabilityRoutes`, `putAiCapabilityRoute`)
- Chat/connector/calendar/briefing/onboarding (`testOnboardingProviderConnection`, `getCalendarEvent`, `switchChatProvider`, `listConnectorProviders`, `runBriefingDefinition`, `updateConnectorAccount`)
- Memory per-fact/correction CRUD (`getMemoryFacts`, `getMemoryCorrections`, `deleteMemoryFact`, `confirmMemoryFact`, `rejectMemoryFact`) — superseded by the dashboard flow
- Proactive monitoring config/refresh (`refreshProactiveCards`, `getProactiveMonitoringSettings`, `updateProactiveMonitoringSettings`)
- Weather location settings (`getWeatherLocation`, `putWeatherLocation`)
- Usefulness-feedback listing (`listUsefulnessFeedback`)
- Data export download (`downloadMyDataExport` in orphan `api/download.ts`)

**Action:** Decide per-feature whether the UI is still planned. If yes → keep (stub for future). If no → delete the function (and likely the backend route in a follow-up).

### 2. Orphan files in `apps/web/src/` (~~5~~ **2 remaining** files, HIGH) **[2nd-pass corrected]**
| File | Status |
| --- | --- |
| ~~`apps/web/src/styles.css` (983 lines)~~ | **REFUTED [2nd-pass]: NOT dead.** Imported by `styles/index.css:13` (`@import "../styles.css"`, cascade slot 5). Do not delete. |
| `apps/web/src/chat/memory-panel.tsx` | Intended consumer of the dead memory-client functions above; never rendered. **[2nd-pass: confirmed]** |
| ~~`apps/web/src/connectors/connect-google-panel.tsx`~~ | **Already deleted by PR #693.** |
| `apps/web/src/ui/provisional-region.tsx` | Local UI primitive, no importer. **[2nd-pass: confirmed]** |
| ~~`apps/web/src/ui/time-bucket.tsx`~~ | **Already deleted by PR #693.** |

### 3. Unused repository/service methods in `packages/memory/` (5 methods, HIGH)
| Method | Location |
| --- | --- |
| `GraphMemoryRecallService.link` | `memory/src/graph-recall-service.ts:164` — trivial passthrough to `remember`, zero callers. |
| `MemoryCandidatesRepository.findBySignature` | `memory/src/candidates-repository.ts:130` |
| `MemoryGraphDashboardRepository.listEntitiesForDashboard` | `memory/src/graph-dashboard-repository.ts:56` — sibling fact-list method IS used; only entity variant orphaned. |
| `ChatMemorySuppressionsRepository.insertCorrection` | `memory/src/suppressions-repository.ts:49` — leftover from an earlier correction-write design. |
| `ChatMemorySuppressionsRepository.listSuppressions` | `memory/src/suppressions-repository.ts:94` — its private `#mapRow` becomes dead if this goes. |

### 4. Dead task-quadrant classifier (`packages/tasks/`, HIGH)
`classifyTaskQuadrant`, `isTaskImportant`, `isTaskUrgent` (`tasks/src/classification.ts:24,28,36`). The Eisenhower-matrix logic is implemented **independently in SQL** inside `TasksRepository`; the in-memory TS helpers are kept alive only by each other and one comment. (The re-exported shared constants in the same file ARE used — keep those.)

### 5. Dead metadata constants (HIGH/MED)
| Constant | Location | Note |
| --- | --- | --- |
| `SETTINGS_EXPORT_QUEUE` | `settings/src/manifest.ts:5` | Duplicates canonical `EXPORT_BUILD_QUEUE` in `data-export-jobs.ts`. |
| `WELLNESS_EXPORT_QUEUE_NAME` | `wellness/src/manifest.ts:32` | Pure alias of `WELLNESS_EXPORT_QUEUE`; nobody imports the alias. |
| `WHEEL_VERSION` | `shared/src/wellness-api.ts:725` | Orphan; literal `"jarvis-emotion-v1"` also unreferenced. |
| `PROACTIVE_SOURCE_DEFAULT` | `shared/src/proactive-monitoring-api.ts:55` | Even its own module-mate ignores it (uses inline literal). |
| `buildScannerDependencies` | `proactive-monitoring/src/scanner.ts:253` | Factory superseded by inline `new AntiSpamPolicy(...)` at the wiring site. |

### 6. Abandoned extension points / scaffolding (MED)
| Symbol | Location | Note |
| --- | --- | --- |
| `DefaultSourceVerifierRegistry` (+ `SourceVerifier`, `SourceVerifierRegistry`) | `goals/src/verifier.ts:3`, `goals/src/types.ts:96,101` | Designed-but-never-wired goal-evidence verifier. Never instantiated. |
| `getFocusReadiness` (+ `ComposeDepsForPriority`) | `briefings/src/priority-consumer.ts:96` | Stub returning `return [];`; focus-readiness feature never landed. |
| `NotificationsRoutesDependencies`, `ListNotificationsResult`, `PgBossClientHooks` | `notifications/src/routes.ts`, `notifications/src/repository.ts`, `jobs/src/pg-boss.ts:126` | Leftover deps/result interfaces; registration sites build deps inline. |

### 7. Dead row-type aliases in `packages/db/src/types.ts` (12 types, MED)
`MemberOnboarding`, `NotificationRead`, `ConnectorAccount`, `ConnectorOauthPending`, `AiProviderConfig`, `AiConfiguredModel`, `UsefulnessFeedbackTarget`, `Preference`, `SportsFollow`, `ProactiveMonitorState`, `ProactiveCard`, `JsonObject`. Each is a `Selectable<…Table>` alias with zero name-importers (the corresponding `*Table` interfaces ARE used in the `Database` schema). `JsonObject` is a pointless alias of `JsonColumn`.

### 8. Over-exported internal symbols (LOW — not deletable, just loose `export`s)
~60 symbols across all packages whose `export` keyword serves no purpose (used only within the defining file/package). Cluster in: `packages/connectors/` (provider deps types, IMAP/Google constants), `packages/settings/` (repository input types, export types), `packages/module-sdk/` (manifest sub-interfaces structurally consumed via parent), `packages/chat/src/live/` (RPC contract types), `packages/cli-runner/src/index.ts` (6 unused barrel re-exports). A deliberate API-tightening pass could un-export most; they are **not** dead code in the strict sense.

---

## Full Findings by Agent

### Agent A — chat, cli-runner, module-registry, module-sdk (72 files)
**1 HIGH, 9 MED, 13 LOW (23 candidates)**

#### [HIGH] `UidSlot` interface
- **Location:** `packages/cli-runner/src/uid-allocator.ts:22`
- **Kind:** unreferenced export (type-only)
- **Evidence:** Only references are its own declaration and its use as `allocateUidSlot`'s return type, both in the same file. Not in barrel; no test names it.
- **Notes:** Safe to un-export / inline.

#### [MED] `ChatTurnSeed` interface
- **Location:** `packages/chat/src/live/types.ts:95`
- **Evidence:** Zero references anywhere; `in_degree:0` in graph. Pure orphan.

#### [MED] `RpcInstallProgress` interface
- **Location:** `packages/chat/src/live/install-contract.ts:78`
- **Evidence:** Zero references. Doc-comment itself says "RESERVED/future" frame shape.

#### [MED] `renderContextLineWithSupportId`
- **Location:** `packages/chat/src/live/answer-provenance.ts:176`
- **Evidence:** Zero callers; appears only in a plan doc as a "future follow-up."

#### [MED] `CHAT_MODULE_ID` const
- **Location:** `packages/chat/src/manifest.ts:12`
- **Evidence:** Only its own declaration (`:12`) and self-use (`:16`). Not in barrel.

#### [MED] Over-exported single-internal-caller functions
- **Location:** `handleEmbedTurnJob` (`chat/src/jobs.ts:71`), `createRpcEngineFactory` (`chat/src/live/runtime.ts:129`), `supportIdForIndex` (`chat/src/live/answer-provenance.ts:63`)
- **Evidence:** Each has exactly one caller inside the same file; zero external importers including tests.

#### [MED] `loadCatalog`
- **Location:** `packages/cli-runner/src/catalog.ts:327`
- **Evidence:** Only references are doc comment, declaration, and self-call at `:341`. Not in barrel; no test. `raw = RAW_CATALOG` default-arg suggests an intended test seam never wired.

#### [MED] Six unused `cli-runner` barrel re-exports
- **Location:** `packages/cli-runner/src/index.ts:8` (`NotLaunchedError`), `:13` (`newNonce`), `:19` (`Mutex`), `:21` (`readConfig`), `:22` (`createCliRunner`), `:43` (`LOGIN_ADAPTER_ISSUES`)
- **Evidence:** Each symbol's only barrel consumer (`module-registry`) imports just `PROVIDER_CATALOG` and `LOGIN_ADAPTERS`. Symbols are used inside cli-runner via relative imports (`./mutex.js`, etc.), so the barrel re-export carries no wiring. (`Mutex` confirmed: imported via `./mutex.js` in engine-host.ts:40 and install-service.ts:63, not the barrel.)

#### [MED] `RouteCoverageInput`
- **Location:** `packages/module-registry/src/route-guard.ts:136`
- **Evidence:** Only its own declaration and use as `assertRouteCoverage`'s param type, both in route-guard.ts. Not in barrel. Callers pass structural literals.

#### [LOW] 13 over-exported contract types (full list in agent raw output)
`McpTransportDependencies`, `CalendarWriteImplDeps`, `UpdateMemorySettings`, `RegisterChatJobWorkersOptions`, `RenderPersonaInput`, `CodexExecSessionOpts`, `ProbeProviderStatus`, `PassiveContextRetrieverDeps`, `PassiveRetrievalDecision/Input/Port`, `Rpc*Params`, `RpcError`, `SelfUpdateDisable`, `ArtifactInstallRecipe`, `LoginMode`, `*ChatEngineOpts`, `DEFAULT_JARVIS_PERSONA`, `realEngineFactory`, `RpcEngineFactory`, `DataContextChatPersistenceDeps`, `RecallResult`, plus module-sdk manifest sub-interfaces, module-registry barrel types. All structurally consumed; `export` is loose, not deletable.

---

### Agent B — memory, db, vault, jobs, structured-state, notifications, proactive-monitoring (75 files)
**5 HIGH, 8 MED, 10 LOW (23 candidates)**

#### [HIGH] `GraphMemoryRecallService.link`
- **Location:** `packages/memory/src/graph-recall-service.ts:164`
- **Evidence:** `grep "\.link("` returns nothing outside the file. Body is trivial delegate to `this.remember(...)`.

#### [HIGH] `MemoryCandidatesRepository.findBySignature`
- **Location:** `packages/memory/src/candidates-repository.ts:130`
- **Evidence:** Zero callers anywhere. Not part of any interface contract.

#### [HIGH] `MemoryGraphDashboardRepository.listEntitiesForDashboard`
- **Location:** `packages/memory/src/graph-dashboard-repository.ts:56`
- **Evidence:** Zero callers. Sibling fact-listing method IS used.

#### [HIGH] `ChatMemorySuppressionsRepository.insertCorrection`
- **Location:** `packages/memory/src/suppressions-repository.ts:49`
- **Evidence:** Zero callers. Likely leftover from earlier correction-write design.

#### [HIGH] `ChatMemorySuppressionsRepository.listSuppressions`
- **Location:** `packages/memory/src/suppressions-repository.ts:94`
- **Evidence:** Zero callers. Its private `#mapRow` becomes dead too.

#### [HIGH] `buildScannerDependencies`
- **Location:** `packages/proactive-monitoring/src/scanner.ts:253` (re-exported `index.ts:21`)
- **Evidence:** Only external ref is barrel re-export. Wiring site `registerProactiveMonitoringWorkers` builds `new AntiSpamPolicy(cardRepository)` inline.

#### [MED] `memoryEntityKinds` const
- **Location:** `packages/memory/src/graph-types.ts:1`
- **Evidence:** Only consumers are line 14 (derives `MemoryEntityKind` type) and itself. Runtime array never read.

#### [MED] `normalizeMemoryFactContent`
- **Location:** `packages/memory/src/fact-signature.ts:5` (re-exported `index.ts:63`)
- **Evidence:** Only external hit is the barrel re-export. Sibling `createMemoryFactSignature` IS used widely.

#### [MED] 12 dead `Selectable` row-type aliases in `db/src/types.ts`
- **Location:** `packages/db/src/types.ts:923,935,937,938,942,950,951,954,956,961,962`
- **Symbols:** `MemberOnboarding`, `NotificationRead`, `ConnectorAccount`, `ConnectorOauthPending`, `AiProviderConfig`, `AiConfiguredModel`, `UsefulnessFeedbackTarget`, `Preference`, `SportsFollow`, `ProactiveMonitorState`, `ProactiveCard`, `JsonObject`
- **Evidence:** Each has zero hits outside `db/src/types.ts`. Corresponding `*Table` interfaces ARE used; only these row aliases are dead.

#### [MED] `NotificationsRoutesDependencies`
- **Location:** `packages/notifications/src/routes.ts`
- **Evidence:** Only the def; no importer. Registration site builds deps inline.

#### [MED] `ListNotificationsResult`
- **Location:** `packages/notifications/src/repository.ts`
- **Evidence:** Only the def. `listVisible` returns structural shape inline.

#### [MED] `PgBossClientHooks`
- **Location:** `packages/jobs/src/pg-boss.ts:126`
- **Evidence:** Only used as default param type `hooks: PgBossClientHooks = {}` on `resolvePgBossConstructorOptions`. Never imported.

#### [LOW] 10 barrel-re-exported helper types w/ zero external type-imports
`SqlMigrationRunnerOptions`, `AppliedMigration`, `MigrationRunResult`, `RolePasswordEntry`, `GrantShareInput`, `RevokeShareInput`, `PGBOSS_SCHEMA`, `RUNTIME_ROLE_PASSWORD_DEFAULTS`, `vaultContextBrand`, `assertUuid` (1 consumer). All exposed via `export *`; parameter types of live functions — not deletable, just loose exports.

---

### Agent C — ai, shared, auth (79 files)
**0 HIGH, 4 MED, 7 LOW (11 candidates)**

#### [MED] `WHEEL_VERSION`
- **Location:** `packages/shared/src/wellness-api.ts:725`
- **Evidence:** `grep "\bWHEEL_VERSION\b"` repo-wide = 0 hits outside the def. Literal `"jarvis-emotion-v1"` also unreferenced.

#### [MED] `PROACTIVE_SOURCE_DEFAULT`
- **Location:** `packages/shared/src/proactive-monitoring-api.ts:55`
- **Evidence:** Zero usages. Sibling `defaultProactiveMonitoringPreference()` hard-codes the literal inline.

#### [MED] `inferTierFromModelId`
- **Location:** `packages/ai/src/model-discovery.ts:168`
- **Evidence:** Zero external callers. Used internally by private `inferModel` (`:197`). Drop the `export`, keep the function.

#### [MED] `RECURRENCE_FREQUENCIES`
- **Location:** `packages/shared/src/tasks-api.ts:9`
- **Evidence:** Used only inside `tasks-api.ts` (def, derived type `:10`, schema enum `:179`). Conservative — drives a public DTO type, so the `export` is defensible.

#### [LOW] 7 over-exported / test-only helpers
`herdrAvailable` (`ai/src/cli-availability.ts:100` — test-only), `priorityLabel`, `quadrantTasks`, `QuadrantMeta`, `PriorityGroup`, `PriorityLevel` (`shared/src/tasks-view.ts` — shared helpers w/ no consumer), redundant `export type` re-export in `ai/src/adapters/http-api.ts:15`.

---

### Agent D — settings, connectors, wellness, email, calendar, weather (105 files)
**2 HIGH, 2 MED, 27 LOW (31 candidates)**

#### [HIGH] `SETTINGS_EXPORT_QUEUE`
- **Location:** `packages/settings/src/manifest.ts:5`
- **Evidence:** Canonical `EXPORT_BUILD_QUEUE` lives in `data-export-jobs.ts:26`. Repo-wide grep: only the def matches the symbol. `routes.ts:134` references the literal only in a comment.

#### [HIGH] `WELLNESS_EXPORT_QUEUE_NAME`
- **Location:** `packages/wellness/src/manifest.ts:32`
- **Evidence:** `export const WELLNESS_EXPORT_QUEUE_NAME = WELLNESS_EXPORT_QUEUE;` — pure alias. Defining file uses the underlying constant directly (`:236`). No external importer.

#### [MED] Over-exported connector/wellness constants used only in own file
- **Location:** `connectors/src/email-extract.ts:4,21,30,32` (`MAX_BODY_CHARS`, `SUMMARY_BODY_SUBSTRING_FLOOR`, `MAX_SIGNAL_STR_CHARS`, `MAX_SIGNAL_ITEMS`); `connectors/src/oauth.ts:1,2` (`GOOGLE_AUTH_ENDPOINT`, `GOOGLE_TOKEN_ENDPOINT`); `connectors/src/google-schedule.ts:7` (`GOOGLE_SYNC_CRON`); `connectors/src/imap-schedule.ts:7` (`IMAP_SYNC_CRON`); `connectors/src/imap-email-read-provider.ts:10` (`IMAP_READ_WINDOW_DAYS`); `connectors/src/manifest.ts:30` (`CONNECTORS_MODULE_ID`).
- **Evidence:** Each symbol's only usages are inside the file that defines it. Note: `MAX_SUMMARY_CHARS`, `BODY_RECONSTRUCTION_FRACTION`, `IMAP_DEFAULT_FOLDER`, `IMAP_PROVIDER_IDS`, `GOOGLE_LOOPBACK_REDIRECT` look similar but ARE pulled by tests — keep those.

#### [MED] `geocodeIp`, `fetchOpenMeteoForecast`, `GeoLocation` — exported from non-barrel files
- **Location:** `weather/src/ip-geocoder.ts:9,15`; `weather/src/open-meteo.ts:48`
- **Evidence:** `weather/package.json` declares only `"."` export; these files aren't subpath-exports. Used internally by `weather-service.ts` only. ~~Make non-exported.~~ **[2nd-pass: remedy invalid — `weather-service.ts` imports `geocodeIp`/`fetchOpenMeteoForecast` cross-file, so the `export` keyword is required. No action available short of merging files; only the `GeoLocation` type (same-file use only) could be un-exported.]**

#### [LOW] 27 over-exported types/interfaces/constants (full list in agent raw output)
Bulk across settings (repository input types, export types, runtime-config types), connectors (Google/IMAP deps types, repo row types), email/calendar (routes deps types, repository input types, focus-time types). All live internally — only the `export` keyword is dead.

---

### Agent E — tasks, briefings, commitments, sports, people, notes, goals, web-research, usefulness-feedback, priority, source-behaviors (100 files)
**1 HIGH, 1 MED, 4 LOW (6 candidates)**

#### [HIGH] `classifyTaskQuadrant`, `isTaskImportant`, `isTaskUrgent`
- **Location:** `packages/tasks/src/classification.ts:24,28,36`
- **Evidence:** Only non-comment ref is the functions calling each other. One comment in `repository.ts:132`. Eisenhower logic lives in SQL in `TasksRepository`. Re-exported shared constants at top of file ARE used — keep those.

#### [MED] `DefaultSourceVerifierRegistry` (+ `SourceVerifier`, `SourceVerifierRegistry`)
- **Location:** `packages/goals/src/verifier.ts:3`; interfaces in `goals/src/types.ts:96,101`
- **Evidence:** Never instantiated. `register()`/`verify()` have no callers. Reachable only via barrel `export *` from `verifier.js`.

#### [LOW] 4 scaffolding/contract surface items
`getFocusReadiness` (+ `ComposeDepsForPriority`) in `briefings/src/priority-consumer.ts:96` — stub `return [];`; file not in barrel. `CalendarBriefingSignal`, `EmailBriefingSignal` (`briefings/src/signals.ts:1,17`) — file not in barrel. 8 people domain types (barrel contract). 5 tasks serialize helpers (internal, barrel-exported).

---

### Agent F — apps, infra, scripts, config (~150 files)
**24 HIGH, 1 MED, 2 LOW (27 candidates)**

#### [HIGH] ~~5~~ 2 orphan files **[2nd-pass corrected]**
- ~~`apps/web/src/styles.css` (983 lines)~~ — **REFUTED [2nd-pass]:** live via `styles/index.css:13` `@import "../styles.css"`; the audit checked only `main.tsx`. Do not delete.
- `apps/web/src/chat/memory-panel.tsx` — never rendered; intended consumer of the dead memory-client fns. **[confirmed]**
- ~~`apps/web/src/connectors/connect-google-panel.tsx`~~ — already deleted by PR #693.
- `apps/web/src/ui/provisional-region.tsx` — local UI primitive, no importer. **[confirmed]**
- ~~`apps/web/src/ui/time-bucket.tsx`~~ — already deleted by PR #693.

#### [HIGH] `apps/web/src/api/download.ts` (orphan file)
- **Evidence:** `api/client.ts` barrel re-exports `client-admin`/`client-proactive`/`account-client` — **not** `download.ts`. Live export surface uses `startDataExport`/`getDataExportStatus`/`getDataExportDownloadUrl` from `client.ts`.

#### [HIGH] 5 dead task-list/tag client functions (`client.ts:422,432,442,453,506`)
`renameTaskList`, `deleteTaskList`, `renameTaskTag`, `deleteTaskTag`, `createTaskList`. Siblings (`listTasks`, `createTask`, etc.) ARE used.

#### [HIGH] 3 dead AI provider/capability client functions (`client.ts:751,797,801`)
`discoverAiProvidersModels`, `listAiCapabilityRoutes`, `putAiCapabilityRoute`. (Do not confuse with live `discoverAiModels` at L760.)

#### [HIGH] 6 dead chat/connector/calendar/briefing/onboarding client functions (`client.ts:350,642,688,706,938,958`)
`testOnboardingProviderConnection`, `getCalendarEvent`, `switchChatProvider`, `listConnectorProviders`, `runBriefingDefinition`, `updateConnectorAccount`.

#### [HIGH] 5 dead memory-client functions (`memory-client.ts:38,42,46,52,58`)
`getMemoryFacts`, `getMemoryCorrections`, `deleteMemoryFact`, `confirmMemoryFact`, `rejectMemoryFact`. Superseded by the dashboard flow.

#### [HIGH] 3 dead client-proactive functions (`client-proactive.ts:14,20,24`)
`refreshProactiveCards`, `getProactiveMonitoringSettings`, `updateProactiveMonitoringSettings`. (`getProactiveCards` at L10 IS used.)

#### [HIGH] 2 dead weather-client functions (`weather-client.ts:13,17`)
`getWeatherLocation`, `putWeatherLocation`. (`getWeatherToday` at L9 IS used.)

#### [MED] `listUsefulnessFeedback` (`usefulness-feedback-client.ts:18`)
- **Evidence:** 0 refs. Siblings `createUsefulnessFeedback`/`undoUsefulnessFeedback` ARE used by `today/briefing-feedback-menu.tsx`.

#### [LOW] 2 non-findings (documented to prevent re-flagging)
- `apps/web/src/onboarding/MOCKUP-feelings-wheel-modal.md` — misplaced `.md` doc in `src/`, not code.
- `scripts/{rewrap-secrets,verify-google-connection,publish-images}.*` — LIVE operator/maintainer tools (referenced in `docs/operations/`). NOT dead.

---

## Recommended Cleanup Order (if/when Ben chooses to act)

This report makes **no changes**. If a cleanup follow-up is desired, the safest high-value order:

1. **The 2 remaining orphan files in `apps/web/src/`** (HIGH, zero risk) — `chat/memory-panel.tsx`, `ui/provisional-region.tsx`. **[2nd-pass: `styles.css` REFUTED — live via CSS `@import`, do not delete; `connect-google-panel.tsx` + `time-bucket.tsx` already deleted by PR #693.]**
2. **The 5 unused `packages/memory/` repository methods** (HIGH, zero risk) — `link`, `findBySignature`, `listEntitiesForDashboard`, `insertCorrection`, `listSuppressions`. **[2nd-pass: confirmed — no interface contracts broken.]**
3. **The 3 dead task-quadrant functions** (`tasks/src/classification.ts`) — keep the re-exported constants, drop the 3 fns. **[2nd-pass caveat: they are the documented spec for the SQL filter — also update `repository.ts:132` comment and the file's doc-comment.]**
4. **The 4 dead metadata constants** — `SETTINGS_EXPORT_QUEUE`, `WELLNESS_EXPORT_QUEUE_NAME`, `WHEEL_VERSION`, `PROACTIVE_SOURCE_DEFAULT`.
5. **The ~25 dead frontend API client functions** — needs a product decision per feature (planned UI vs abandoned). Group by feature area.
6. **The 12 dead `db/src/types.ts` row aliases** — safe but cosmetic.
7. **Abandoned extension points** (`DefaultSourceVerifierRegistry`, `getFocusReadiness`, `buildScannerDependencies`) — confirm not on a near-term roadmap before removing.
8. **The ~60 LOW over-exported symbols** — defer to a deliberate API-tightening pass; not dead code.

---

## Methodology & False-Positive Guards Applied

Every agent ran the same false-positive checklist before reporting:
- **Barrel re-exports** (`export * from`, `export {X} from`) treated as wiring, not dead — unless the target symbol had zero consumers anywhere including via the barrel.
- **Module public APIs / contract surface** (especially `shared/*-api.ts` REST contracts, `module-sdk` manifest types) — not flagged as dead.
- **Test fixtures/helpers** under `*.test.ts`, `__fixtures__/`, `__mocks__/`, `test-helpers/` — excluded.
- **Plugin/extension points** — provider base classes, interface contracts — not flagged.
- **Indirect registration** — string-keyed job queues, route registrars, module manifests, decorator-based handlers — grepped the registration string, not just the symbol.
- **Provider registries** — connector adapters, AI providers checked via registry key.
- **Applied DB migrations** — loaded by filename convention; not flagged.
- **CI-invoked scripts** — checked `.github/workflows/` before flagging any script.
- **Design-system surface** — `jds-*` primitives and tokens protected per CLAUDE.md.
- **Dynamic imports / lazy()** — grepped path strings, not just symbol names.
- **`import type`-only consumers** — flagged LOW, not HIGH.
- **Composition roots** — verified DI wiring in `apps/api/src/server.ts`, `apps/worker/src/worker.ts`, `packages/module-registry/src/index.ts` before flagging repo/service classes.
- **Dead branches & commented-out code** — scanned all reviewed files; **none found** (all comments are prose doc-comments).

## Per-Agent Raw Reports
Full per-agent reports with every LOW finding enumerated are attached to this audit's session log. This consolidated report includes all HIGH/MED findings verbatim and summarizes LOW findings by theme.
