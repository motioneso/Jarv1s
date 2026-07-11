# Job Search external module

Issue #930 (epic #913). This directory is the source of the Job Search **external** module
package. It is not part of the pnpm workspace, is excluded from the default Jarvis image via
`.dockerignore`, and never appears in `BUILT_IN_MODULES` — the core build must not compile, copy,
or register anything here.

## Package artifact

`pnpm build:external:job-search` produces the installable artifact:

```text
job-search/
  package.json        # metadata only; NO "type" field — dist/worker.js runs as CJS
  jarvis.module.json  # the contract manifest (schemaVersion 1)
  dist/worker.js      # self-contained CJS bundle; SDK compiled in; node builtins only
  dist/web/index.js   # ESM browser bundle; default export {contractVersion: 1, Root}
```

Install = place that directory under the host's `JARVIS_MODULES_DIR` (directory name must equal
the module id `job-search`) with `JARVIS_ENABLE_EXTERNAL_MODULES=1`. The host hashes
`jarvis.module.json`, `dist/worker.js`, and `dist/web/**` (`package.json` is not hashed).

## Contract summary

- **Id:** `job-search` (plain kebab — the platform id grammar forbids dots; the design's
  `jarv1s.job-search` was superseded by coordinator ruling 2026-07-10).
- **Permissions:** one per assistant tool, `permissionId == tool name` (ruling 2026-07-10; the
  consolidated permission model is deferred to JS-06).
- **Storage:** seven user-scoped KV namespaces (`job-search.onboarding`, `.profile`, `.resume`,
  `.monitors`, `.opportunities`, `.runs`, `.feed`). No instance-scoped data.
- **Credentials:** none in MVP — no `auth` section.
- **Worker:** JSON-RPC over stdio via `@jarv1s/module-sdk/worker` (contract version 1). Handlers:
  13 assistant-tool stubs + `monitor.run`; all answer `{status: "not-implemented"}` until later
  slices. Scrubbed env (LANG/LC_ALL/TZ only); no repo-relative resolution.
- **Web:** contract v1, entrypoint `dist/web/index.js`, uses the host React instance from the
  frozen `window.__JARVIS_MODULE_RUNTIME__` global; never bundles its own React.
- **Queue/schedule:** `job-search.monitor-run` (retryLimit 3) swept by user-scoped schedule
  `job-search.monitor-sweep` (`*/15 * * * *`). Declaration only in JS-01.
- **Fetch hosts (reviewed):** `boards-api.greenhouse.io`, `api.lever.co`, `api.ashbyhq.com` —
  keyless public job-board APIs, consumed from JS-04 on.

## Fail-closed behavior (host-enforced, fixture-tested)

Invalid manifest, wrong schema/contract versions, path traversal or symlink escape, and post-
enable hash drift all keep (or auto-return) the module inactive; enablement is explicit and
admin-gated. See `tests/unit/external-module-job-search-*.test.ts` and
`tests/integration/external-module-job-search.test.ts`.
