# Module Management Admin UX — Design Spec (delta on #964)

- **Date:** 2026-07-12
- **Issue:** to be filed — Part of epic #860 (pluggable modules)
- **Grounded on:** `origin/main` @ `a3b2b98b` (worktree verified to contain it)
- **Status:** DRAFT — awaiting Ben review
- **Depends on:** spec `2026-07-12-module-distribution-install.md` (#964, MERGED via PR #980)
  and spec `2026-07-08-open-module-system-user-authored-modules.md` (#818/#917, built)

## 1. Problem

The whole distribution pipeline shipped in #964 and works: registry fetch (host-pinned,
sha256-verified, safe-extract), admin download routes, boot reconcile, and a Settings
registry section with the full lifecycle including the **pending-restart** state
("Downloaded — restart to apply", `apps/web/src/settings/settings-module-registry-section.tsx:22`).
Three UX/product gaps keep it invisible and un-friendly on a real box:

1. **Hidden behind env vars.** The feature only exists when
   `JARVIS_ENABLE_EXTERNAL_MODULES === "1"` **and** `JARVIS_MODULES_DIR` is set
   (`apps/api/src/server.ts:141-142`, `apps/api/src/module-distribution-port.ts:32`,
   `apps/worker/src/worker.ts:82`, `scripts/start-jarv1s.ts:112`,
   `scripts/module-reconcile.ts:390-391`). Ben's direction: features must not hide in env
   variables — env is for genuine advanced overrides only. External modules become a
   default, always-on feature.
2. **Wrong built-in list.** The Instance-modules pane lists every `!module.required`
   built-in (`apps/web/src/settings/settings-admin-panes.tsx:598`) — today that is
   Wellness, Sports, News **plus** Commitments, People, Goals, Notes. Ben: everything
   beyond Wellness/Sports/News is core functionality and must not be toggleable as a
   module at all.
3. **Never exercised on prod.** Ben's deploy directory (`~/JarvisProd`) carries a
   pre-#964 copy of `docker-compose.prod.yml` — no `jarv1s-modules` volume, no module
   env, no `module-install` ops service — and `env.production.local` sets neither flag.
   Nothing module-related has ever rendered on the running box. That is the QA gap this
   spec closes with an explicit verify-on-prod acceptance step.

**Publishing is NOT a gap (verified 2026-07-12):** the rolling `modules` GitHub Release
exists and holds exactly `index.json` + `job-search-0.1.0.tgz`, maintained by
`.github/workflows/modules-registry.yml` (runs on `main` pushes touching
`external-modules/**`; prunes retired assets). The registry ships from this repo's own
CI — no relocation needed and none is proposed.

## 2. Goals

1. **Always-on:** remove the `JARVIS_ENABLE_EXTERNAL_MODULES` gate and the required
   `JARVIS_MODULES_DIR`; bake a sensible default modules dir into the image; boot
   reconcile runs unconditionally in the default compose path. A fresh install shows the
   Modules pane with the registry shelf, zero configuration.
2. **Exactly three toggles:** only Wellness / Sports / News appear as built-in
   enable/disable toggles. Commitments, People, Goals, Notes become core at the
   **manifest** level (genuinely non-disableable), not merely filtered in the UI.
3. **One friendly pane:** registry modules render download → restart-required →
   enable/disable as a single coherent row lifecycle, reusing the existing
   `pending-restart` state — no new mechanism, no auto-reboot, no restart button.
4. **Proven on prod:** compose/env changes land on Ben's box and the full
   download → restart → toggle loop is exercised there as an acceptance gate.

## 3. Non-goals

- **No redesign of the distribution pipeline.** Fetch/verify/extract/stage
  (`packages/module-registry/src/distribution/`), boot reconcile
  (`scripts/module-reconcile.ts`), routes (`packages/settings/src/routes-module-registry.ts`,
  `routes-modules.ts`), and contracts (`packages/shared/src/platform-api-modules.ts`)
  are reused as-is.
- **No registry-index relocation.** The remote GitHub-Release index stays authoritative;
  only the test-only `JARVIS_MODULE_REGISTRY_URL` override is refused in production
  (`packages/module-registry/src/distribution/registry-source.ts:24`) — the default
  download path is already prod-legal.
- **No in-app restart button and no auto-reboot** (unchanged #964 non-goal). The
  restart-required tag + footnote already exist; we reuse them.
- **No unbundling of built-ins.** Wellness/Sports/News and core modules stay
  compile-time bundled exactly as today; all _other_ modules arrive via the external
  download path. Moving a built-in out of the image is a separate epic-#860 phase.
- No marketplace, no third-party registries, no signing changes.

## 4. Design

### 4a. Always-on external modules (remove the env gate)

**Gate removal.** Delete the `JARVIS_ENABLE_EXTERNAL_MODULES` flag entirely. The four
gate sites become unconditional:

- `apps/api/src/server.ts:141` — `resolveApiServerConfig` drops `enableExternalModules`;
  `discoverExternalModules` (`server.ts:165`) always scans.
- `apps/api/src/module-distribution-port.ts:32` — the distribution port is always
  constructed, so the registry routes always register and
  `GET /api/admin/module-registry` always reports `enabled: true` (contract field kept
  to avoid a breaking change; it simply never reads `false` anymore).
- `apps/worker/src/worker.ts:82` — external worker registrations always load.
- `scripts/start-jarv1s.ts:112` — the `module-reconcile` one-shot always runs between
  `migrate.ts` and api/worker start. This is the "reconcile in the default compose"
  requirement: reconcile is a supervisor phase inside the main `jarv1s` service, not an
  opt-in profile. (`--profile ops run --rm module-install` remains the manual recovery
  hatch, unchanged.)

There is no residual off-switch. Always-on is safe because the feature is inert without
explicit admin action: an empty modules dir discovers nothing, downloads require an
authenticated admin (`assertAdminUser` first), nothing executes until restart, and every
module is individually disableable in the DB. The #917/#964 security posture (hash
pinning, drift auto-disable, privilege split) is untouched — the flag was an
availability gate, not a security boundary.

**Default modules dir.** `JARVIS_MODULES_DIR` becomes an advanced override with a baked
default:

- Container: `/data/modules` — `prepareRuntimeDirs` already creates and chowns it
  (`scripts/start-jarv1s.ts:141`) and the repo compose already mounts the
  `jarv1s-modules` volume there (`infra/docker-compose.prod.yml:134`).
- Non-container (dev/tsx): `<workspaceRoot>/data/modules`, resolved with the existing
  pnpm-workspace marker walk (`packages/cli-runner/src/catalog.ts:52` pattern) — a
  fixed `import.meta.url` offset breaks in the esbuild-bundled prod api, which is why
  the marker walk is the established mechanism. Created lazily on first use;
  `.gitignore`d.

One shared helper, `resolveModulesDir(env)` in `@jarv1s/module-registry/node`, replaces
the four independent env reads so the api, worker, supervisor, and reconcile script can
never disagree about the directory.

**Compose cleanup.** `infra/docker-compose.prod.yml` drops the now-dead
`JARVIS_ENABLE_EXTERNAL_MODULES` entries (lines 68, 107); `JARVIS_MODULES_DIR:
/data/modules` may stay as explicit documentation or drop (identical to the code
default). The `jarv1s-modules` volume is the only compose piece that remains
load-bearing — without it, downloads land in the container filesystem and are lost on
the next `docker compose pull`.

### 4b. Built-in toggles: exactly Wellness / Sports / News (manifest-level)

**Decision: change the manifests, not the UI filter.** Commitments, People, Goals, and
Notes get `lifecycle: "required"` + `availability: { defaultEnabled: true, required:
true }`, matching Calendar/Email/etc.:

- `packages/commitments/src/manifest.ts:23-24`
- `packages/people/src/manifest.ts:15-16`
- `packages/goals/src/manifest.ts:23-24`
- `packages/notes/src/manifest.ts:28-32`

Wellness/Sports/News stay exactly as they are — `lifecycle: "user-toggleable"`,
`defaultEnabled: true`, `required: false` (`packages/wellness/src/manifest.ts:42-48`,
`packages/sports/src/manifest.ts:38-44`, `packages/news/src/manifest.ts:59-65`).

Why manifest over a UI allowlist: the pane already filters `!module.required`
(`settings-admin-panes.tsx:598`), so after the manifest change it renders exactly W/S/N
with **zero frontend code change**, the toggle _routes_ stop accepting the core four
(they genuinely can't be turned off, per Ben — not just hidden), and there is no second
source of truth to drift. A hardcoded id list in the web bundle would leave the API
still honoring disable requests for "core" modules.

Migration of existing state: any `instanceDisabled` (or per-user disabled) row already
persisted for the newly-required four must be ignored/cleared by the existing
required-module handling — implementation must verify the module-settings reconciliation
treats `required: true` as unconditionally active regardless of stale rows, and add a
test for the previously-disabled → now-required transition.

Consequence to flag: `"required"` lifecycle also removes the **per-user** toggle for
these four (they are `user-toggleable` today). Ben's "part of core functionality, not
something that can be turned off" reads as intending exactly that, but it is a real
behavior change for Notes in particular — confirmed as open question Q2.

### 4c. One coherent Modules pane

`InstanceModulesPane` (`settings-admin-panes.tsx:554`) currently stacks three groups:
built-in toggles, #917 "External modules" (with enable switches), and the #964
`<ModuleRegistrySection />` (`settings-admin-panes.tsx:688`) — and a downloaded registry
module appears in **both** of the last two (the registry row shows state/Remove; the
external group holds its enable switch). The UX delta:

- **"Built-in modules" group:** the three W/S/N toggle rows (existing `Switch`, existing
  copy). No download affordance — these ship in the image.
- **"Available modules" group:** one row per registry module carrying the full
  lifecycle. Reuse the server-derived states verbatim
  (`ModuleRegistryRowDto.state`, `packages/shared/src/platform-api-modules.ts:415`):
  - `not-installed` → **Download** button (existing capability-review confirm).
  - `pending-restart` / `update-pending-restart` → the existing restart-required tag +
    the existing footnote ("Downloaded — restart to apply" +
    `docker compose pull && docker compose up -d` note). **This state IS Ben's
    "restart required" notification — confirmed present, reused, nothing new built.**
  - `installed-enabled` / `installed-disabled` → an enable/disable `Switch` on the
    registry row itself (wired to the existing `setExternalModuleEnabled` mutation from
    `routes-modules.ts`), plus Remove / Remove + purge.
  - `update-available`, `install-failed`, `declared-not-present`, `incompatible` →
    unchanged behavior, restyled copy only.
- **De-duplicate:** the #917 "External modules" group no longer lists modules that
  appear as registry rows; it remains (with its trusted-operator warning) only for
  local-only modules the registry doesn't know — the user-authored case it was built
  for. With the gate gone this group is always rendered; its existing empty-state row
  covers the common "none" case.
- **Styling:** the registry section is explicitly a functional pass
  (`settings-module-registry-section.tsx:2-4`); bring it onto the authored `Group` /
  `Row` / `Note` primitives and `jds-*` buttons already used by the rest of the pane. No
  new primitives; visual detail lands via Ben's annotation rounds as usual.
- **Drop "Refresh from registry"?** No — keep it. The index is remote and server-cached
  for 10 minutes (`module-distribution-port.ts:37`); the button is the manual cache
  bust and stays.

### 4d. Prod enablement + verify-on-prod (the flagged QA gap)

State on Ben's box today (verified 2026-07-12): `~/JarvisProd/docker-compose.prod.yml`
is a stale pre-#964 copy (no `module-install` service, no modules volume, no module
env), and `env.production.local` has no module variables. Since `install.sh` is retired
and deploys are `docker compose pull && up -d`, compose-file changes do **not**
propagate automatically — refreshing the deploy-dir copy is a manual operator step and
must be called out in release notes whenever compose changes.

Enablement plan:

1. Land 4a (defaults baked in) so `env.production.local` needs **no new variables**.
2. Copy the current `infra/docker-compose.prod.yml` to `~/JarvisProd/` (brings the
   `jarv1s-modules` volume — the persistence-critical piece — and the ops-profile
   recovery service).
3. `docker compose -p jarv1s-prod -f docker-compose.prod.yml --env-file
./env.production.local pull && … up -d`.

**Verify-on-prod acceptance step (blocking, performed on the real box):**

- [ ] Boot log shows the `module-reconcile` one-shot ran between migrate and api start.
- [ ] Settings → Instance modules renders: W/S/N toggles only (core four gone), and
      "Available modules" lists `job-search` as Not installed.
- [ ] Download `job-search` → capability confirm → row flips to the restart-required
      tag; **no reboot happens on its own**.
- [ ] `docker compose restart` (manual) → row becomes Installed with a working
      enable/disable switch; module surfaces in the shell when enabled.
- [ ] Remove (keep data) → files gone after restart; volume survives a
      `docker compose pull` cycle.

## 5. Security notes

- Removing the availability gate does not move any trust boundary: admin-gated routes,
  pinned registry hosts, sha256 → staged-hash → boot-acceptance chain, drift
  auto-disable, and the supervisor-only privilege plane are all unchanged (#964 spec
  §11).
- The production refusal of `JARVIS_MODULE_REGISTRY_URL` (`registry-source.ts:24`)
  gates only the test override; the default GitHub-Release path is and remains the
  production path. No change.
- Manifest hard-requiring the core four is strictly privilege-reducing (fewer things an
  admin can turn off).
- Compose/gating and manifest-availability changes are **security-adjacent** → the
  slices touching them QA at the security tier.

## 6. Verification

- **Unit:** `resolveModulesDir` (env override / container path / marker-walk fallback);
  manifest availability flags for the core four; registry-row derivation unchanged.
- **Integration:** existing #964 suite must pass with the gate deleted (mock-registry
  URL override still works under `NODE_ENV!==production`); previously-disabled →
  now-required module transition; `app.inject` on the registry/toggle routes (the
  fast-json-stringify field-drop trap — any new response field must be declared in
  `packages/shared/src/platform-api-modules.ts` schemas).
- **Known trap:** if any migration is added (none expected — 4b is manifest-only),
  `foundation.test.ts` asserts the full migration list with `toEqual`.
- **Gate:** `pnpm verify:foundation` + full `pnpm test:integration`, then the §4d
  verify-on-prod checklist — the checklist is part of Done, not optional.

## 7. Build slices

| #   | Slice                                                                                                           | Risk tier                          | Effort   |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| S1  | Always-on: delete gate at 4 sites, `resolveModulesDir` helper + defaults, compose cleanup                       | **sensitive** (gating + compose)   | ~1 day   |
| S2  | Core-ify Commitments/People/Goals/Notes manifests + stale-disabled-state reconciliation test                    | **sensitive** (availability model) | ~0.5 day |
| S3  | Pane consolidation: W/S/N group + registry rows with toggle, de-dup external group, jds styling                 | routine (UI only)                  | ~1 day   |
| S4  | Prod enablement: deploy-dir compose refresh, release-note runbook line, verify-on-prod checklist executed w/Ben | **sensitive** (prod ops)           | ~0.5 day |

Registry publishing needs **no slice** — verified live (release `modules`: `index.json`,
`job-search-0.1.0.tgz`; workflow `.github/workflows/modules-registry.yml`).

## 8. Resolved-during-design decisions

- **Registry stays remote (GitHub Release).** Ben confirmed the repo's CI-published
  release _is_ "the registry that ships in the repo"; the download path is prod-legal
  today. The earlier repo-shipped-index idea is dropped — it would have re-plumbed a
  working, verified pipeline for zero user-visible gain.
- **No env kill switch retained.** Ben: env vars are for genuinely advanced things
  only. The per-module DB disable + admin gating is the control surface; deleting the
  flag also deletes the "works on my compose, hidden on yours" failure class that
  caused the prod gap.
- **Manifest-level core-ification over a UI allowlist** — single source of truth, and
  "can't be turned off" is enforced at the API, not cosmetically (§4b).
- **W/S/N + core stay bundled; everything else goes through download.** Unbundling a
  built-in is out of scope (epic #860 later phase); the image gains no module tarballs
  (no bloat).
- **Restart-required = the existing `pending-restart` state.** Confirmed already
  implemented end-to-end (server-derived state, UI tag, compose-command footnote); this
  spec reuses it verbatim and adds no restart machinery.

## 9. Open questions for Ben

1. **Q1 — no off-switch at all?** S1 deletes `JARVIS_ENABLE_EXTERNAL_MODULES` with no
   replacement. OK, or keep a `JARVIS_DISABLE_EXTERNAL_MODULES=1` advanced override for
   paranoid deployments?
2. **Q2 — per-user toggles for the core four.** Making Commitments/People/Goals/Notes
   `required` also removes their _per-user_ disable (they're `user-toggleable` today).
   Intended? Notes is the sharpest case (a user may not want vault sync surfaced).
3. **Q3 — launch shelf contents.** The registry currently offers exactly one module
   (`job-search`). Is a one-item shelf acceptable for this release, or should another
   module be packaged under `external-modules/` first so the pane doesn't look empty?
