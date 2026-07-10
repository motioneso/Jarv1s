# JS-01 — package contract and fail-closed fixture

**Status:** Draft — issue #930; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

## Goal

Establish `jarv1s.job-search` as an independently buildable external package without adding it to
`BUILT_IN_MODULES`, the default image, or a core composition root. This slice proves packaging and
activation only; it stores no product data and performs no source fetch or AI call.

## Contract

Source lives in this repository at `external-modules/job-search/`, outside the `packages/*` pnpm
workspace and outside built-in module discovery. The default image build must exclude
`external-modules/` through `.dockerignore`; a separate package build/release command produces the
installable artifact. CI may test both from the same repository, but the core build never compiles,
copies, or registers Job Search.

The package emits reviewed, prebuilt artifacts:

```text
jarv1s.job-search/
  package.json
  jarvis.module.json
  dist/worker.js
  dist/web/index.js
```

The JSON manifest uses the final #919 external ABI and declares:

- id `jarv1s.job-search`, compatible runtime range, and user-toggleable lifecycle;
- the external web contract-v1 entrypoint;
- the seven user-scoped KV namespaces from the parent design;
- no MVP credentials;
- namespaced permissions and assistant handler ids;
- reviewed fetch hosts and one monitor queue/schedule declaration once those runtime fields exist.

All identifiers are module-prefixed. Browser assets externalize the host React runtime. The worker
bundle is self-contained, receives a scrubbed environment, and has no repo-relative resolution.

## Fail-closed fixture

A minimal fixture package proves each state independently:

- discovered but absent enablement row: inactive;
- operator-disabled or user-disabled: no web root, tools, worker, queue, schedule, or KV access;
- incompatible contract version or invalid manifest: rejected;
- manifest/package hash drift after enable: auto-disabled;
- missing/malformed web or worker entrypoint: unavailable without partial registration;
- valid and enabled: only declared contributions appear.

The package artifact inspection asserts no job-search code or artifact exists in the default Jarv1s
image and no registration appears in `BUILT_IN_MODULES`.

## Verification

- Manifest schema/prefix/collision tests.
- Package path, traversal, symlink, hash, and contract-version tests.
- Browser bundle imports no Node/server code and uses the host React instance.
- Worker bundle resolves without workspace `node_modules`.
- Enable/disable/hash-drift integration fixture.
- Default-image and built-in-registry absence assertions.

## Non-goals

- No domain records, onboarding, live adapters, schedules, AI, UI design, or migrations.
- No marketplace, downloader, signing system, or web-initiated install flow.
