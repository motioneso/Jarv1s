# Pin the Native-Build Posture — Design (P1 #58)

**Status:** Approved for build (2026-06-09)
**Date:** 2026-06-09  **Owner:** Ben  **Issue:** #58 (Part of epic #46)

## Context

pnpm 10 blocks dependency install scripts by default. Three transitive packages pulled in by
`@huggingface/transformers` (the M-A1 embedding runtime) carry lifecycle scripts that are silently
not executed unless explicitly allowed:

| Package | Script type | What it does |
| --- | --- | --- |
| `onnxruntime-node@1.21.0` | `postinstall` | Downloads pre-built native ONNX binaries for the current platform |
| `sharp@0.34.5` | `install` | Downloads pre-built libvips binaries (or compiles from source as fallback) |
| `protobufjs@7.4.x` | `postinstall` | Emits a version-scheme warning if a dependant uses a mismatched version prefix; harmless if skipped |

`onnxruntime-node` is the critical one: without its postinstall, the `.node` binding and
`libonnxruntime.so.1` are absent and `@huggingface/transformers` fails at runtime with a module-not-
found error. `sharp` is required by `@huggingface/transformers` for image-processing tasks; the
embedding path does not exercise it, but it is still a declared dependency. `protobufjs` is benign
when blocked (pure-JS path still works).

The binaries currently exist in `node_modules` because the lockfile was populated before the
block-by-default posture was enforced or the packages were downloaded at a point where the install
scripts ran. A clean `pnpm install --frozen-lockfile` on a fresh CI runner (or a developer machine)
will silently skip all three scripts, leaving `onnxruntime-node` non-functional and the default local
embedding provider broken on the next `pnpm install`.

There is no `pnpm.onlyBuiltDependencies` or `pnpm.ignoredBuiltDependencies` anywhere in
`package.json` or `pnpm-workspace.yaml` today.

## Goals

1. Record the intended build posture explicitly in `package.json` under the `"pnpm"` key so it is
   checked into source and reproduced on every `pnpm install`.
2. Allow `onnxruntime-node` and `sharp` install scripts (both download pre-built binaries — no
   compiler required; security profile is comparable to downloading a pre-built npm artifact).
3. Leave `protobufjs` in `ignoredBuiltDependencies` (its postinstall is harmless noise; blocking it
   is intentional and documents that the decision was not an accident).
4. After the change, `pnpm install --frozen-lockfile` on a clean environment must leave
   `onnxruntime-node`'s `.node` binding present and loadable.

## Non-Goals

- Auditing every other package in the dependency tree for build scripts (scope: the three
  identified packages above).
- Switching from pre-built binaries to compile-from-source for any of these packages.
- Pinning exact versions of the native packages (that is handled by the lockfile).
- Changing how `@huggingface/transformers` is loaded or used (M-A1 is done).

## Resolved Decisions

| # | Decision | Choice | Why |
| - | -------- | ------ | --- |
| 1 | Config location | `pnpm-workspace.yaml` | **Corrected during build (2026-06-09 calibration):** pnpm 10.6.2 in this workspace does **not** read `onlyBuiltDependencies` from the root `package.json` `"pnpm"` key — it stayed a no-op (the ignored-scripts warning persisted, lockfile unchanged). The settings ARE read from `pnpm-workspace.yaml`; placing them there + `pnpm rebuild onnxruntime-node sharp` cleared the warning and produced the linux binding. |
| 2 | `onnxruntime-node` | Allow (in `onlyBuiltDependencies`) | Downloads pre-built ONNX binary — mandatory for the embedding provider to function. |
| 3 | `sharp` | Allow (in `onlyBuiltDependencies`) | Downloads pre-built libvips — declared dep of `@huggingface/transformers`; may be needed for future image modalities. |
| 4 | `protobufjs` | Ignore (in `ignoredBuiltDependencies`) | Postinstall is a version-scheme warning only; blocking it is safe and intentional; documenting the intent prevents future confusion. |

## Resolved Decisions (was open)

**`sharp` → allow (`onlyBuiltDependencies`).** `sharp`'s install script only downloads a pre-built
libvips binary (no compiler invoked), so the security profile is low. Allowing it now is zero-risk
and avoids silent breakage of the embedding path or future image embeddings. `protobufjs` is inert
(its postinstall is only a version-scheme warning) and stays in `ignoredBuiltDependencies`. The
final posture is an explicit `pnpm.onlyBuiltDependencies` of `["onnxruntime-node", "sharp"]` with
`ignoredBuiltDependencies` of `["protobufjs"]` (see Resolved Decisions rows 2–4).

## Approach

**`pnpm-workspace.yaml`** (NOT `package.json` — see Resolved Decision 1) — add top-level keys:

```yaml
onlyBuiltDependencies:
  - onnxruntime-node
  - sharp
ignoredBuiltDependencies:
  - protobufjs
```

No other files change. On an **existing** install pnpm won't re-run the now-approved scripts (it
reports "up to date"); run `pnpm rebuild onnxruntime-node sharp` once to materialize the binding.
On a **fresh** `pnpm install` the scripts run automatically.

**Validation:** after `pnpm install --frozen-lockfile` (or `pnpm install` on a clean tree),
confirm the ONNX binding is present:

```sh
ls node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v3/
# expect: libonnxruntime.so.1, onnxruntime_binding.node (linux/x64) or equivalent
```

## Collision notes

`package.json` + `pnpm-lock.yaml` are shared with:
- **#51** (adds `test:unit` script + updates `verify:foundation`) — **lands first** (Wave A).
- **#53** (adds `@fastify/rate-limit` dependency) — lands last.

**#58 must rebase on #51 before merge** (Wave B). The lockfile will conflict; resolve by running
`pnpm install` after the `package.json` merge is clean to regenerate the lockfile. There is no
overlap with #51's `scripts` section — #58 only adds a new top-level `"pnpm"` key.

## Exit Criteria

1. `package.json` contains a `"pnpm"` key with `onlyBuiltDependencies: ["onnxruntime-node", "sharp"]`
   and `ignoredBuiltDependencies: ["protobufjs"]`.
2. `pnpm install --frozen-lockfile` on a clean `node_modules` (e.g. `rm -rf node_modules && pnpm install`)
   leaves `onnxruntime-node`'s native binary loadable:
   `node -e "import('./node_modules/onnxruntime-node/dist/index.js').then(() => console.log('ok'))"` exits 0.
3. `pnpm verify:foundation` green after the lockfile update.
4. `pnpm install --frozen-lockfile` in a fresh CI environment (simulated by the CI `verify` job)
   remains clean with no "run scripts" warnings about blocked packages.

## Hard Invariants honored

- No new migrations, no schema changes, no modules touched.
- Secrets never escape — these packages contain only native binaries, no credentials.
- `DataContextDb` / `AccessContext` / `VaultContext` invariants untouched — this is a dependency
  management change only.
- No file >1000 lines — `package.json` gains a 4-line object block.
