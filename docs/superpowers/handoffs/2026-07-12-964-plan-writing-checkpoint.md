# Checkpoint: #964 plan-writing (2026-07-12)

Pointer-style state for resuming the writing-plans phase of issue #964 (epic #860) if the
session compacts or restarts mid-write. Read the spec first — it is the source of truth.

## Where things stand

- Branch: `spec/964-module-distribution` @ `89d9bd97` (spec committed).
- Spec: `docs/superpowers/specs/2026-07-12-module-distribution-install.md` (approved by Ben; "Please write up the detailed plan" was the last instruction).
- Plan target: `docs/superpowers/plans/2026-07-12-module-distribution-install.md` — write per superpowers:writing-plans (header, Global Constraints, per-task Files/Interfaces, TDD steps, complete code, explicit-path commits). If the file exists partially, read its tail and continue from the last complete task.
- Gates (issue #964): Fable-authored plan only (no Sonnet), adversarial council review of spec+plan after, Ben approval before build. Do NOT spawn a builder.
- Shared tree: other sessions have uncommitted work. Never `git add -A`/`git add .` — explicit paths only. Prettier the plan doc before committing (handoff-doc prettier trap).

## 10-task plan structure (finalized; recon complete)

1. Registry index schema + ensure-list parsing — new `packages/module-registry/src/distribution/index-schema.ts` (+ `ensure-list.ts`), exported via `./node`. `validateRegistryIndex` (envelope fail-closed, bad entries dropped+collected), `resolveRegistryArtifact` (checks `previousVersions`), `parseModulesEnsure` (`id` / `id@version`, comma/space separated).
2. Manifest `database.ownedTables` — `packages/module-sdk/src/index.ts` adds `database?: { ownedTables: readonly string[] }` to `JsonJarvisModuleManifest`; `packages/module-registry/src/external/validate.ts` removes `"database"` from FORBIDDEN_FIELDS (lines 37-55), adds positive validation (tables match `/^app\.[a-z][a-z0-9_]*$/` AND prefix `app.<slug>_`, slug = id hyphens→underscores, ≤32, unique) + include in the re-shape literal (~L426-448); `external/hash.ts` adds `sql/**` block mirroring dist/web.
3. Migration `packages/settings/sql/0161_external_module_distribution.sql` (ONE ALTER TABLE adding staged_version/staged_package_hash/staged_at/staged_by/staged_source CHECK('admin-download','compose-ensure')/purge_requested_at/purge_requested_by/last_install_error ≤2000); Kysely cols in `packages/db/src/types.ts` (ExternalModulesTable ~L157/1058); repo fns in `packages/settings/src/repository-external-modules.ts` (updateExternalModuleStaging / setExternalModulePurgeRequested / listExternalModuleAdminStates); make `externalModuleAuditWriter` in repository.ts PUBLIC (routes call standalone fns — repository.ts is at 970 lines, avoid delegates); foundation list row `{ version: "0161", name: "0161_external_module_distribution.sql" }` in `tests/integration/foundation-schema-catalog.test.ts` after L275.
4. `scripts/publish-module-registry.ts` (`buildRegistryArtifacts`, reuses `buildExternalModule` from `scripts/build-external-module.ts:14`, tar gzip portable of jarvis.module.json + dist/** + sql/**, previousVersions merge cap 5) + `.github/workflows/modules-registry.yml` (push main paths-filtered + dispatch, contents:write, rolling release `modules`, upload --clobber, prune unreferenced).
5. Distribution pipeline `packages/module-registry/src/distribution/`: constants (INDEX 1 MiB / ARTIFACT 50 MiB / EXTRACT 4x / 2000 entries; hosts github.com, objects.githubusercontent.com, release-assets.githubusercontent.com), resolve-registry-url (env override refused in NODE_ENV=production), registry-client (createHostPinnedFetch), download (stream+cap+streaming sha256), extract (safeExtractModuleTarball: File/Directory only, no abs/`..`/links, size+entry caps), stage (atomic swap `.prev` restore + sweepStaging), pipeline (`downloadAndStageModule` → typed error codes; runs validateExternalModuleManifest + version match + hashExternalPackage on temp BEFORE swap). Deps: `tar` ^7.5.16 → module-registry; `tar-stream` → root devDep.
6. Shared contracts in `packages/shared/src/platform-api-modules.ts` (ModuleRegistryRowDto, 9-state enum, GetModuleRegistryResponse, download/remove schemas — additionalProperties:false, FULL required arrays); pure `deriveModuleRegistryRows`; 3 routes in `packages/settings/src/routes-modules.ts` (assertAdminUser FIRST); structural `moduleDistribution?` dep in routes.ts (settings CANNOT import module-registry — cycle); apps/api server.ts wiring + 10-min index cache closure (?refresh=1).
7. `scripts/module-reconcile.ts` (`reconcileModules` + CLI): advisory lock `hashtext('jarv1s:module-reconcile')`; order sweep-staging → purges (journal owned_tables via assertQualifiedTableName → DROP ... CASCADE → module rows → DROP OWNED/ROLE via moduleRuntimeRoleName/moduleInstallRoleName → rm files → external_modules row LAST) → ensure-present (compose-ensure, staged_by NULL, warn-continue) → scan (getExternalModuleRegistrations) → accept-staged (hash match → enabled) → installModule (fail → journal failed + last_install_error + disabled, continue) → drift persist. Loosen installModule's manifest option to structural `{ database?: { ownedTables?: readonly string[] } }`.
8. Boot/compose: `scripts/start-jarv1s.ts` oneShot→oneShots array (reconcile appended when JARVIS_ENABLE_EXTERNAL_MODULES==="1"); update `tests/unit/start-jarv1s-plan.test.ts:20` (plan.oneShot → plan.oneShots[0]); prepareRuntimeDirs + "/data/modules"; `infra/docker-compose.prod.yml` jarv1s-modules volume + env on jarv1s + module-install services, module-install command → module-reconcile.ts; root package.json `db:reconcile`.
9. Web UI: client fns + query key `adminModuleRegistry`; NEW file `apps/web/src/settings/settings-module-registry-section.tsx` (settings-admin-panes.tsx is 987/1000 lines) rendered from InstanceModulesPane (~L553); `requireText?: string` added to ConfirmOptions in `settings-feedback.tsx` (149 lines, read fully — dialog at L117-146). Functional pass only.
10. Integration suite vs mock registry (node:http on 127.0.0.1:0, JARVIS_MODULE_REGISTRY_URL), app.inject schema checks, docs, spec-example id fix (`jarv1s.job-search` → `job-search`), prettier, full verify:foundation + test:integration.

## Key deviations to note in the plan

- Install-failed state derives from new `last_install_error` column, NOT the app.module_installs journal (0156 is FORCE-RLS supervisor-plane; app role can't read it).
- Spec's "dev boot runs same reconcile" is unimplementable (no scripts/dev.ts) → dev parity = `db:reconcile` script + docs note.
- Download route never touches the purge mark; UI hides download while purge pending.

## Verbatim anchors (verified this session)

- `validateExternalModuleManifest(raw, expectedId, coreVersion?, reservedQueueNames?)` at validate.ts:198; `MODULE_ID_RE` at :24; `hashExternalPackage(dir)` at hash.ts:63; `getExternalModuleRegistrations({modulesDir, coreVersion?, reservedQueueNames?})` at node.ts:32; node.ts re-exports `./external/hash.js` etc.
- repository.ts delegates region ~L302-346; `externalModuleAuditWriter` currently private.
- ci.yml: pnpm/action-setup@v4 version 10.6.2, setup-node@v5 node 24, checkout@v5 — mirror in new workflow.

## Remaining steps

Write plan (chunked Write/Edit) → self-review (spec §12/§13 coverage, placeholder scan, type consistency) → prettier → commit plan + spec-id fix by explicit path → present to Ben with execution options + council-review gate note.

## FINAL (2026-07-12, post-write)

Plan COMPLETE at `docs/superpowers/plans/2026-07-12-module-distribution-install.md`
(10 tasks, 5464 lines, self-reviewed: spec §5–§13 coverage incl. all §12 integration
scenarios in Task 10's 13-test suite; §8 capability-review confirm + Note restart hint
in Task 9; packModuleArtifact signature + web import specifiers verified). Remaining:
council adversarial review of spec+plan, then Ben approval. Do NOT spawn a builder.
