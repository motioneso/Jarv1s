# Module boundary enforcement (lint + dependency hygiene + known violations)

**Status:** draft (2026-07-04, rev 2 after adversarial cross-model review) — design spec for task
issue #802, part of epic #798 (module docking seams). Cheapest child of the epic; **build first** —
it locks the floor the other three stand on. Flip #802 to `RFA` once approved.

**Grounded on:** `origin/main` @ `1c307466` (audit findings verified at `2797fc1f`; rev 2 findings
verified at `1c307466`). Re-run `pnpm audit:preflight` before building.

---

## Problem

"Modules collaborate only through declared public APIs" is a Hard Invariant, but it is enforced
only by convention: pnpm package boundaries, narrow `exports` maps, and the composition-root
pattern. `eslint.config.mjs` carries no import-boundary rule (its only `no-restricted-imports` use
bans a lucide icon), and there is no dependency-cruiser or declared-deps check. The audit found the
predictable drift:

1. **`cli-runner` reaches into chat's unexported internals** via relative paths
   (`../../chat/src/live/*`) across ~10 files — `login-service.ts:34,40,41`, `connection.ts:27-36`,
   `login-adapters.ts:26-28`, `provider-token-store.ts:15`, `main.ts:17,18`, `catalog.ts:30,31`,
   `hello.ts:25`, `install-service.ts:58,59`, `engine-host.ts:22-37` — importing
   `cli-chat-engine.js`, `rpc-contract.js`, `login-contract.js`, `install-contract.js`,
   `errors.js`. `packages/chat` exports only `.` and `./priority-consumer`, so every one of these
   bypasses the package boundary.
2. **Wellness has three phantom workspace deps** — imports resolved only by pnpm hoisting, not
   declared in `packages/wellness/package.json`: `@jarv1s/jobs`, `@jarv1s/settings`,
   `@jarv1s/vault` (imported across `export-routes.ts`, `export-job.ts`, `data-export-port.ts`;
   re-verified against `origin/main` @ 1c307466 after the #809 wellness hygiene pass, which did
   not touch `package.json`).
3. **Sports declares `@jarv1s/structured-state` and never imports it** (dead dep).
4. Feature-to-feature workspace deps exist but are undocumented as sanctioned: chat→calendar/tasks,
   connectors→calendar/email, cli-runner→chat. Nothing stops a new one appearing silently.

## Goal

`pnpm verify:foundation` fails on any cross-package internal import, any undeclared or unused
workspace dependency, and any new feature-to-feature dependency not on an explicit allowlist. The
three known violations are fixed in the same pass (no-stale-concepts).

## Architecture

Three small mechanisms, all wired into the existing gate — no new heavyweight tooling
(dependency-cruiser rejected: one more config dialect for what two lint patterns + a ~150-line
script cover).

1. **ESLint boundary rules** (`eslint.config.mjs`, applied to `packages/*/src` and `apps/*/src`):

   ```js
   "no-restricted-imports": ["error", {
     patterns: [
       { group: ["@jarv1s/*/src/*"], message: "Deep import into another package's src. Use its public exports." },
       { group: ["../../*/src/*", "../../../*/src/*", "../../../../*/src/*"],
         message: "Relative import crossing a package boundary. Depend on the package and use its public exports." },
       { group: ["**/packages/*/src/*"],
         message: "Path import into a workspace package's src. Depend on the package and use its public exports." },
     ],
   }],
   ```

   The third group exists because `*` does not cross `/` in these globs: a sibling-package
   reach-in (`../../chat/src/x`) matches group two, but an app-to-package reach-in
   (`../../../packages/sports/src/x` from `apps/web/src`) has an extra `packages/` segment and
   would escape it. `**/packages/*/src/*` catches that shape at any depth.

   **Flat-config merge trap (implementation-critical):** in ESLint flat config, a later config
   object's `no-restricted-imports` entry **replaces** the earlier one — it does not merge.
   `eslint.config.mjs:82` already uses `no-restricted-imports` (a `paths` ban on lucide-react's
   `Sparkles` for `apps/web`). Naively appending a new config block with the boundary `patterns`
   would silently disable that existing ban wherever both apply (or vice versa). The
   implementation must produce **one effective rule per file scope** carrying both the existing
   `paths` and the new `patterns` — either by restructuring into a single rule entry where scopes
   overlap, or by scoping the blocks so they never both match a file. Acceptance check:
   `pnpm exec eslint --print-config <an apps/web file>` shows both the lucide `paths` ban and the
   boundary `patterns` active.

   Subpath exports (`@jarv1s/chat/live`, `@jarv1s/sports/settings`) remain legal — the rule bans
   `src/` reach-ins, not public subpaths. Intra-package relative imports are untouched (they never
   contain `/src/` after the package root). Test dirs (`tests/**`, `**/__tests__/**`) are exempt —
   tests may reach into source (the existing `settings-sports-pane.test.tsx` pattern), though
   package-boundary-respecting tests remain preferred.

2. **Declared-deps check: `scripts/check-package-deps.ts`** (new; precedent for this style of gate:
   `scripts/check-no-ambient-dates.ts`, `check:file-size`). For each workspace package: scan
   `src/**` import specifiers (regex over `import ... from "x"` / `import("x")` /
   `export ... from "x"`; type-only imports count too — they still require the dep for
   typechecking);
   - **undeclared**: specifier's package not in `dependencies`/`peerDependencies` (dev-only
     entrypoints like config files are out of scope since only `src/**` is scanned) → error;
   - **unused**: declared `@jarv1s/*` dependency with zero import hits → error (scoped to workspace
     deps only; external packages can be indirectly required and are noisier — out of scope).
     Wire as `check:package-deps` in the root `package.json`, added to `verify:foundation`.

3. **Sanctioned-coupling allowlist test** (`tests/unit/module-dependency-allowlist.test.ts`): reads
   every `packages/*/package.json`, classifies packages as platform
   (db/shared/module-sdk/module-registry/jobs/vault/auth/settings-ui/structured-state/ai/memory/…)
   vs feature module, and asserts the feature→feature edge set equals an explicit allowlist
   constant:

   ```ts
   // ILLUSTRATIVE — the real list is derived from the actual package graph at
   // implementation time, not copied from this spec. Known members include:
   const SANCTIONED_FEATURE_COUPLINGS = [
     "chat -> calendar",
     "chat -> tasks",
     "chat -> connectors", // verified in packages/chat/package.json
     "connectors -> calendar",
     "connectors -> email",
     "cli-runner -> chat",
     "briefings -> notifications" // + priority, source-behaviors, usefulness-feedback
   ];
   ```

   **The first implementation step is to derive the complete edge set from every
   `packages/*/package.json`** and seed the allowlist with what actually exists (all of it
   pre-sanctioned — this gate freezes the status quo, it doesn't relitigate it). The example
   above is known-incomplete; treating it as exhaustive would break the build on day one.
   Adding an edge afterwards means editing the allowlist in the same PR — a visible, reviewable
   act (and per the invariant, one that needs a spec-level justification). The platform/feature
   classification is likewise finalized during implementation; the test file documents it.

4. **Fix the known violations:**
   - **chat/cli-runner:** add a `"./live"` subpath export to `packages/chat` exposing exactly the
     five reached-into modules (`cli-chat-engine`, `rpc-contract`, `login-contract`,
     `install-contract`, `errors`) via a new `src/live/public.ts` barrel; rewrite cli-runner's ~10
     relative imports to `@jarv1s/chat/live`. No logic changes; the contracts are already de-facto
     public API — this makes the boundary honest. (Alternative — moving the contracts into
     `@jarv1s/shared` — rejected: they are chat-owned protocol, and shared is browser-bundled.)
   - **wellness:** add `@jarv1s/jobs`, `@jarv1s/settings`, `@jarv1s/vault` to its `dependencies`.
   - **sports:** remove `@jarv1s/structured-state` from its `dependencies`.

## Non-goals

- No runtime enforcement, no dependency-cruiser/nx/turbo adoption, no import graph visualization.
- No new cross-module SQL check — the audit found feature modules SQL-clean toward each other, and
  the settings hub's table reads are addressed by the data-lifecycle spec (#801), not here.
- No refactor of the sanctioned couplings themselves (chat→calendar/tasks stay).

## Verification

- Red/green demos in the PR description: temporarily add (a) a deep import, (b) an undeclared
  import, (c) an unused workspace dep, (d) a new feature edge — show each fails its gate, revert.
- `pnpm verify:foundation` green on the fixed tree; full `test:integration` (chat + cli-runner
  suites especially — the CLI engine path has runtime import semantics worth exercising, see the
  chat/CLI gotchas history).
- Grep proof in PR: zero remaining `\.\./\.\..*src/` cross-package imports under `packages/*/src`.

## Risks / open questions

- **Rule-pattern false negatives** (aliasing tricks, `require`): acceptable — this is a drift
  fence, not a security boundary; RLS remains the hard floor.
- **cli-runner runtime**: it ships as a per-user CLI engine; verify its build/bundling still
  resolves `@jarv1s/chat/live` (the esbuild bundled-path trap #357 is the cautionary tale — test
  the built artifact, not just tsx).
- Open: should the allowlist test also pin platform→feature edges (e.g. settings' reads)? Default
  no — platform packages are expected hubs; revisit after #801 shrinks settings' surface.
