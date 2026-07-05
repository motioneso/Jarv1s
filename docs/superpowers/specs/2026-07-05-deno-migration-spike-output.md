# Deno Migration Research Spike — Output (#741)

**Status:** Spike complete — findings for Ben's review
**Date:** 2026-07-05
**Type:** Research spike (no code changes, no migration undertaken)

## Summary / Recommendation

**No-op.** Do not adopt Deno, in whole or in part, for Jarv1s. The stack already runs on Node
without friction Deno would fix, while migrating touches ~114k lines across 34 workspace packages,
a Docker deploy pipeline hand-tuned around Node/pnpm semantics, and a `import.meta.url`-relative
path-resolution scheme that has already caused one production incident (the bundled-path-resolution
trap, v0.1.0/#357) — multiplying exposure to that exact class of bug for a payoff (marginal
throughput/latency deltas on a single-operator, self-hosted app) that isn't a problem Jarv1s has.
No unmet operational need — security, build time, or dependency surface — points at Deno today.

## Current stack inventory (grounded in this repo)

- **Workspace shape:** pnpm workspace (`pnpm-workspace.yaml`) — `apps/*` (api, web, worker) +
  `packages/*` (34 packages: ai, auth, briefings, calendar, chat, cli-runner, commitments,
  connectors, db, email, goals, jobs, memory, module-registry, module-sdk, notes, notifications,
  people, priority, proactive-monitoring, settings, settings-ui, shared, source-behaviors, sports,
  structured-state, tasks, usefulness-feedback, vault, weather, web-research, wellness) + 2
  `spikes/*` packages. Root `package.json` orchestrates via `turbo` (typecheck/lint) and `tsx` for
  scripts (migrate, build, backup, export/delete-user, audit).
- **Size:** ~114,000 lines of `.ts`/`.tsx` across `packages/` and `apps/` (excludes `node_modules`,
  `dist`).
- **Runtime deps:** Fastify `^5.6.2`, Kysely `^0.29.2`, `pg` `^8.21.0`, `pg-boss` `^12.18.2`.
  Frontend: Vite + React `^19.0.0` in `apps/web`. Dev tooling: `esbuild` (production
  `scripts/build-app.ts` bundler for api/worker), `tsx` (scripts + dev servers), `vitest`,
  `playwright`, `turbo`, `eslint`/`prettier`.
- **Native addons:** `onnxruntime-node` + `sharp`, required transitively by
  `@huggingface/transformers` (in-process embeddings, M-A1) — pnpm-workspace.yaml explicitly marks
  these `onlyBuiltDependencies` because they need prebuilt binaries at install time.
- **Node-specific API usage:** 104 files import `node:*` builtins directly (`node:crypto`,
  `node:fs`, `node:fs/promises`, `node:http`, `node:https`, `node:net`, `node:os`, `node:path`,
  `node:stream`, `node:stream/promises`, `node:url`, `node:util`, `node:dns/promises`). Zero
  CommonJS `require(...)` calls (project is `"type": "module"` throughout). 25 files rely on
  `import.meta.url` for repo-relative path resolution (all 17 module `manifest.ts` files, plus
  `cli-runner`'s `main.ts`/`main-entry.ts`/`install-service.ts`/`catalog.ts`, `apps/web/vite.config.ts`,
  `apps/api/src/server.ts`, `apps/worker/src/worker.ts`, `packages/briefings/src/manifest.ts`). This
  is a **known fragile seam**: the bundled-path-resolution trap (project memory) already broke prod
  once when esbuild bundling collapsed these paths.
- **Process spawning:** 4 files use `node:child_process` — `apps/api/src/server.ts`,
  `packages/ai/src/cli-availability.ts`, `packages/ai/src/adapters/tmux-bridge.ts`,
  `packages/cli-runner/src/runner-io.ts`. The `cli-runner` module forks its own tmux server inside
  the container and drives provider CLIs (claude/codex/agy) through it (#342) — a Node/shell
  integration with no Deno-native equivalent in wide use.
- **Docker deploy:** single multi-stage `Dockerfile` (`node:24-bookworm-slim` base) builds the
  whole pnpm workspace, deliberately keeps the **full** `node_modules` + dev deps in the runtime
  stage (documented rationale: pnpm's `.pnpm` symlink layout breaks if pruned, and `tsx
  scripts/migrate.ts` needs the full tree), installs `tmux`/`git`/`ca-certificates`/`bubblewrap` for
  the in-container CLI chat sidecar, and runs everything via `tsx`. `scripts/publish-images.sh` does
  multi-arch (amd64/arm64) buildx publish to GHCR — no runtime-specific logic there, but it publishes
  the same Dockerfile.

## Translation assessment (per the issue's explicit list)

**Would translate cleanly (low friction):**
- **Kysely** — runtime-agnostic by design, zero dependencies, explicitly used in production at Deno
  itself. The existing `pg`-based `PostgresDialect` works under Deno's npm compat layer unchanged;
  no code change needed even if the runtime changed underneath it.
- **`pg` (node-postgres)** — officially lists Deno as a supported runtime.
- **MCP SDK** (`@modelcontextprotocol/sdk`) — already used via npm specifiers under Deno in the
  wild; the incoming v2 split (`@modelcontextprotocol/server`/`client`, targeting the 2026-07-28 spec)
  explicitly lists Deno as a first-class target alongside Node and Bun.
- **Fastify** — runs under Deno's Node compat layer today; real benchmarks show Fastify-on-Node and
  Deno's native `Deno.serve()` within ~10-15% of each other on throughput/p99 latency. Not a
  meaningful upgrade for a single-operator household deploy that isn't request-bound.
- **Plain `node:*` builtin usage** (crypto/fs/path/os/util/etc.) — Deno 2.9+ resolves bare and
  `node:`-prefixed specifiers to its compat layer; the 104 files using these would very likely load
  unchanged.

**Would not translate cleanly (real friction, grounded in this repo's usage):**
- **`import.meta.url`-relative path resolution (25 files, all module manifests + cli-runner).** This
  is the single highest-risk item precisely *because* it already broke once (bundled-path-resolution
  trap). Deno's module resolution, permission model, and its own bundler/compile behavior around
  `import.meta.url` are not identical to Node's — re-validating all 25 sites (17 manifests +
  cli-runner's install/catalog/main paths + the api/worker entrypoints + `vite.config.ts`) under a
  different runtime reopens a bug class that took a production incident to find and fix under Node
  alone.
- **`onnxruntime-node` + `sharp` native addons (embeddings, M-A1).** Deno's native-addon story
  (loading `.node` files via an FFI bridge) is a **Deno 3, 2026-era** capability — recent, and not
  something this project has any operational experience with. It unblocks packages like these in
  principle, but "recently unblocked" is a materially different risk profile than "battle-tested,"
  for a dependency this project depends on for a core feature (in-process semantic embeddings).
- **`cli-runner`'s tmux/child_process integration (#342).** Forking a tmux server and driving
  provider CLIs through pseudo-terminals via `child_process` is a Node/shell-process pattern with no
  mature Deno-native replacement in production use elsewhere. `Deno.Command` exists but this
  project's specific pattern (tmux server + PATH-injected login shells + provider CLI auth flows)
  has zero prior art to lean on.
- **pg-boss.** No documented native Deno support; it likely runs via npm compat + its `pg`
  dependency, but this is unverified in practice and the broader Deno community (per a January 2026
  `denoland/deno` discussion) still flags Postgres driver support generally — including `pg`'s Deno
  path — as an unresolved pain point (TLS/reconnect edge cases), not a fully blessed solution.
- **Vite/React build.** Works in Node today with zero issues. Deno has no fully native, built-in
  Vite integration — it requires the actively-developed but still-shifting `@deno/vite-plugin` to
  bridge Deno module resolution into Vite. Switching would trade a working, unremarkable Node/Vite
  setup for an additional plugin-compatibility layer, for no feature or performance gain this
  project needs.
- **Docker deploy pipeline.** The current `Dockerfile` bakes in Node/pnpm-specific reasoning at
  every stage: `node:24-bookworm-slim` base, `corepack`/pnpm store layout (explicitly *not* pruned
  because pruning breaks the `.pnpm` symlink tree), `tsx`-based migrate/build scripts, and the
  tmux/bubblewrap/git layer for the CLI sidecar. None of this ports without a full rewrite of the
  image; Deno's own container story is a smaller ecosystem with far less operational precedent for
  this project's shape (multi-role single image: api + worker + migrate + tmux-CLI-sidecar).
- **`turbo`/pnpm workspace tooling.** Not runtime-blocking (turbo just shells out to scripts
  regardless of runtime), but the whole `onlyBuiltDependencies`/native-binary install story
  (`pnpm-workspace.yaml`) is pnpm-specific tooling with no Deno equivalent; Deno's own dependency
  model (import maps / JSR / npm compat) is a different paradigm entirely, not a drop-in.
- **`vitest`/`playwright`.** Reported to "generally work" under Deno with minimal changes, but
  real-world reports (2026) also show module-resolution breakage inside Deno workspaces
  (`Cannot find module .../node_modules/.deno/...`) and Playwright requiring naming/config
  workarounds (`.spec.ts` vs `.test.ts`, stripping `webServer` from config, `PW_DISABLE_TS_ESM`).
  This project's `verify:foundation` gate — lint, format, file-size, design-tokens,
  no-ambient-dates, typecheck, `test:unit`, `db:migrate`, `test:integration` — is load-bearing CI
  infrastructure; re-validating it on a runtime with documented rough edges is a real cost, not a
  formality.

## Cost / risk analysis

- **Rough migration cost:** high, not because any single piece is impossible, but because the
  friction concentrates exactly where this project is already fragile: 25 `import.meta.url` path
  sites, a hand-tuned Docker image, a bespoke tmux/CLI-provider integration, and the full
  `verify:foundation` gate (8 checks, including two integration test suites). This is not a
  "swap the runtime and see what breaks" change — every one of those surfaces needs individual
  re-validation, and several (native addons, pg-boss, `import.meta.url`) have no clean Deno
  precedent to copy from.
- **Highest-risk incompatibilities, ranked:**
  1. Native addons for embeddings (`onnxruntime-node`, `sharp`) — Deno 3's FFI bridge for `.node`
     files is new (2026) and unproven for this project's exact dependency chain.
  2. `import.meta.url`-based path resolution across 25 files — the exact bug class that already
     caused a production incident under Node alone; re-testing it under a second runtime's module
     resolution semantics is real, not theoretical, risk.
  3. `cli-runner`'s tmux/child_process provider-CLI integration — no mature Deno equivalent exists
     to de-risk against.
  4. pg-boss under Deno — unverified in practice; community consensus still flags Postgres driver
     support broadly as unresolved on Deno.
  5. Docker image rebuild — the current image's design decisions (no dep-pruning, tmux/bubblewrap
     layer, `tsx`-based multi-role entrypoint) don't carry over; it would be built from scratch.
- **What Deno would actually buy:** marginal server throughput/latency (Fastify-on-Deno vs
  Fastify-on-Node benchmarks differ by ~10-15%, within noise for a self-hosted household app that
  isn't CPU- or request-bound), a permissions model Jarv1s doesn't currently need (single-operator
  deploy, not running untrusted code), and no dependency-surface reduction — Kysely/`pg`/Fastify/MCP
  SDK are the same npm packages either way, just loaded through a different compat layer.
- **What Deno would cost:** a full re-validation of the deploy pipeline, the embeddings pipeline,
  the CLI-provider integration, and the test/verify gate — for a project whose actual documented
  pain points (per project memory: settings backend follow-ups, connector architecture, Task/Goal
  data model work, design-language work) are feature and architecture problems, not runtime
  problems.

## Recommendation detail — no-op, and why

No PoC is warranted. The issue's own bar — "would Deno reduce operational complexity, security
risk, build time, or dependency surface **enough to justify migration cost**" — fails at the first
clause: there is no operational complaint about Node in this project's history to fix. Node/pnpm/tsx
is unremarkable infrastructure here; the actual friction on record (bundled-path-resolution trap,
handoff-doc prettier trap, multi-agent PG contention, deploy Compose env trap) is about this
project's specific scripts and Docker/Compose wiring, not about Node as a runtime — and every one of
those traps sits on the same `import.meta.url`/path-resolution and process-management surfaces that
a Deno migration would most disturb. Migrating would spend real engineering time re-opening
already-closed risk for a runtime whose main advertised gains (perf, permissions, npm-free
dependency story) don't address anything Jarv1s is short on.

**Revisit triggers** (conditions under which this recommendation should be re-examined, not now):
- Deno's native-addon FFI bridge and Postgres driver story mature and get independent
  production track record (not just "added in Deno 3") — say, 12+ months of real-world reports.
- pg-boss (or a direct successor) ships explicit, tested Deno support.
- A concrete operational problem emerges that Node is actually the cause of (e.g., a real build-time
  or dependency-security incident traceable to the Node/pnpm toolchain specifically).

None of these hold today, so there is no minimal proof-of-concept scope to propose — a PoC would be
spending effort to explore a direction with no identified problem to solve.

## Non-goals (restated per issue #741)

- **No production migration occurred or is proposed under this issue.** This document is research
  output only; zero application code changed.
- **The current runtime (Node/pnpm/TypeScript) is not being replaced.** Any future runtime change
  requires its own approved design spec per `docs/superpowers/specs/` (CLAUDE.md's spec-before-build
  gate), grounded in an actual identified problem Deno would solve — not present at time of this
  spike.

## Sources

- Deno Node/npm compatibility docs: https://docs.deno.com/runtime/fundamentals/node/
- "Deno 2.0 in Production: Six Months of Migration From Node.js" (2026): https://blog.rebalai.com/en/2026/03/09/deno-20-in-production-2026-migration-from-nodejs-a/
- Deno 3 / npm compatibility guide (2026): https://www.pkgpulse.com/guides/deno-3-new-features-npm-compatibility-2026
- `@deno/vite-plugin` (official): https://github.com/denoland/deno-vite-plugin
- `vite-plugin-deno` (community, JSR-focused): https://github.com/deno-plc/vite-plugin-deno
- pg-boss (repo, Node engine requirement): https://github.com/timgit/pg-boss
- node-postgres (`pg`) runtime support: https://node-postgres.com/
- `denoland/deno` discussion on Postgres driver support gaps (Jan 2026): https://github.com/denoland/deno/discussions/30494
- Kysely (runtime-agnostic design, Deno usage at Deno Inc.): https://kysely.dev/, https://github.com/kysely-org
- `kysely-deno-postgres` community dialect: https://github.com/barthuijgen/kysely-deno-postgres
- Deno testing docs (Deno.test / node:test): https://docs.deno.com/runtime/fundamentals/testing/
- Playwright-on-Deno workarounds: https://www.kapp.technology/en/blog/run-playwright-on-deno-javascript-runtime/, https://honman.dev/posts/deno-2-and-playwright
- MCP TypeScript SDK v2 beta announcement (2026-07-28 spec): https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/
