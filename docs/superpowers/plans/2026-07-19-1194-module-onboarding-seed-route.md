# #1194 module-onboarding seed route plan

**Goal:** Add safe core onboarding seeding, hidden per-turn module control, validated manifest guidance, and actor-scoped attachment text reads for external workers.

**Grounding:** Verified on `feat/1194-module-onboarding-seed`: the route, `controlContext`, `assistantOnboarding`, and `attachments.readText` do not exist. Existing seams are the evening-interview route, `ChatSessionManager.seedContext`/`buildEngineText`, external manifest validator, active-module resolver, worker RPC host, and `ChatAttachmentsService.readContent`.

## Task 1: Prompt safety and manifest contract

**Tests:** `tests/unit/chat-recall-seed.test.ts`, `tests/unit/external-module-job-search-manifest.test.ts`, external-manifest validator tests.

- First add failing cases for all four reserved delimiters, blanket escaping including literal `</trusted_instructions>`, guidance cap, and control-character rejection.
- Export `sanitizeExternalData` from `packages/chat/src/live/prompt-safety.ts`; reuse it from evening-interview and module onboarding.
- Add `assistantOnboarding.guidance` to compiled/JSON manifest types, positive validation, and external-tool-manifest propagation.
- Add the spec's checkpoint/sub-step/tool guidance to `external-modules/job-search/jarvis.module.json`.
- Run focused tests and commit green.

## Task 2: Seed route and hidden module control

**Tests:** `tests/integration/chat-live-api.test.ts`, `tests/unit/chat-session-manager.test.ts`.

- First add failing route cases for inactive/missing-guidance 404, idempotent hidden seed with no visible turn, and two-layer defanging.
- Add `POST /api/chat/module-onboarding` using the chat-mutation limiter. Resolve only an actor-active manifest with `assistantOnboarding`, read `${moduleId}.onboarding.get-state` through the existing read-only gateway seam, seed core-authored framing, and return `{ ok: true }`.
- First add failing turn cases for invalid/oversized control context and persistence isolation.
- Accept a JSON `controlContext`, allow only top-level `step`, `action`, and `values`, cap serialized UTF-8 at 8 KiB, sanitize every string recursively, append `<module_control>` after `buildEngineText`/attachments, and persist/emit only original `text`.
- Make module seeding idempotent per live engine session; engine recreation naturally permits reseeding.
- Run focused tests and commit green.

## Task 3: Actor-scoped worker attachment port

**Tests:** `tests/unit/module-sdk-worker.test.ts`, `tests/integration/module-worker-rpc.test.ts` or the equivalent filesystem-backed worker-port test.

- First add a failing `ctx.attachments.readText(id)` RPC round-trip and owner/non-owner read cases.
- Add the worker SDK port and `attachments.readText` RPC branch; validate the id and fail closed when unavailable/non-text/missing.
- Provision it from the API composition root with `ChatAttachmentsService.readContent({ actorUserId, requestId }, id)`, returning only filename, MIME, and extracted text.
- Run focused tests and commit green.

## Task 4: Full verification and handoff

- Run `pnpm verify:foundation` with an unpiped exit code.
- Sync code graph, inspect the explicit diff/status, then follow `coordinated-wrap-up` for pre-push checks, rebase, PR, and coordinator report. Do not merge.

## Defaults requiring coordinator confirmation

- Guidance max: 8 KiB; control-context max: 8 KiB serialized UTF-8.
- `controlContext` top-level allowlist: `step`, `action`, `values`; nested JSON remains data and every string is escaped.
- Missing/failed state read fails the seed route closed as 404 rather than seeding without durable state.
