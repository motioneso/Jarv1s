# JS-965 Run-Now Dedupe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan inline. Under coordinated-build, subagent-driven-development and executing-plans are disabled.

**Goal:** Make repeated external-module run-now requests from the same user return `jobId: null` during a five-second anti-double-click window.

**Architecture:** Keep external queues on pg-boss STANDARD policy. Thread pg-boss's existing policy-independent `singletonSeconds` send option through `sendModuleJob`, then set it only on the manual route while preserving the existing per-user `singletonKey`.

**Tech Stack:** TypeScript, Fastify, pg-boss 12, Vitest, PostgreSQL integration tests

## Global Constraints

- Option A only; do not edit queue policy or `packages/module-registry/src/external/job-reconciler.ts`.
- No migration or index change; pg-boss `job_i4` already backs `singletonSeconds` independently of queue policy.
- Preserve metadata-only payloads and the actor-scoped key `manual:${moduleId}:${queueName}:${access.actorUserId}`.
- Use a five-second window: enough for accidental double-clicks, short enough for an intentional rerun; cite #965 in the code comment.
- Do not edit `docs/coordination/`; stage explicit paths only.

---

### Task 1: Time-window manual run-now dedupe

**Files:**

- Modify: `tests/unit/external-module-jobs.test.ts:49-61`
- Modify: `tests/integration/external-modules-routes.test.ts:121-151`
- Modify: `packages/jobs/src/module-jobs.ts:93-110`
- Modify: `apps/api/src/external-module-jobs.ts:1-79`

**Interfaces:**

- Consumes: pg-boss `SendOptions.singletonSeconds?: number` and existing policy-independent `job_i4`.
- Produces: `sendModuleJob(..., options?: Pick<SendOptions, "singletonKey" | "singletonSeconds">): Promise<string | null>`.
- Produces: manual route send options `{ singletonKey: <actor-scoped key>, singletonSeconds: 5 }`.

- [ ] **Step 1: Extend the unit contract and integration regression test first**

In `tests/unit/external-module-jobs.test.ts`, change the expected send options to:

```ts
{
  singletonKey: "manual:fixture:fixture.sync:00000000-0000-4000-8000-000000000001",
  singletonSeconds: 5
}
```

In the existing `enables the module, then /api/modules includes it with external:true` integration test, issue the same manual POST a second time immediately after asserting the first response:

```ts
const duplicateRun = await server.inject({
  method: "POST",
  url: "/api/modules/acme-widgets/queues/acme-widgets.manual/run",
  headers: { cookie: adminCookie, "content-type": "application/json" },
  payload: { jobKind: "manual" }
});
expect(duplicateRun.statusCode).toBe(202);
expect(duplicateRun.json()).toEqual({ jobId: null });
```

Keep the existing unit assertion containing `actorUserId` in `singletonKey`; it proves different owners receive different dedupe keys.

- [ ] **Step 2: Run both tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/unit/external-module-jobs.test.ts
```

Expected: FAIL because send options omit `singletonSeconds: 5`.

Run:

```bash
pnpm exec tsx scripts/test-integration.ts tests/integration/external-modules-routes.test.ts
```

Expected: FAIL because the second response contains a fresh UUID instead of `null` under STANDARD policy.

- [ ] **Step 3: Widen the existing sender option type**

In `packages/jobs/src/module-jobs.ts`, change only the option pick:

```ts
options?: Pick<SendOptions, "singletonKey" | "singletonSeconds">
```

Keep payload validation and `boss.send(queue.name, payload, options)` unchanged.

- [ ] **Step 4: Add the manual-only five-second window**

In `apps/api/src/external-module-jobs.ts`, add beside the imports:

```ts
// #965: five seconds catches accidental double-clicks without blocking an intentional rerun.
const MANUAL_RUN_SINGLETON_SECONDS = 5;
```

Change the existing manual send options to:

```ts
{
  singletonKey: `manual:${moduleId}:${queueName}:${access.actorUserId}`,
  singletonSeconds: MANUAL_RUN_SINGLETON_SECONDS
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/unit/external-module-jobs.test.ts tests/unit/jobs-pg-boss.test.ts
```

Expected: PASS.

Run:

```bash
pnpm exec tsx scripts/test-integration.ts tests/integration/external-modules-routes.test.ts
```

Expected: PASS; first manual POST returns a UUID and immediate duplicate returns `null`.

- [ ] **Step 6: Run the full local gate**

Run:

```bash
pnpm verify:foundation
```

Expected: exit 0, including format check, file-size check, typecheck, lint, unit tests, migrations, and integration tests.

- [ ] **Step 7: Commit the green task**

```bash
git add tests/unit/external-module-jobs.test.ts tests/integration/external-modules-routes.test.ts packages/jobs/src/module-jobs.ts apps/api/src/external-module-jobs.ts docs/superpowers/plans/2026-07-14-js-965-runnow-dedupe.md
git commit -m "fix(jobs): dedupe rapid external module runs" -m "Run-now now reports already queued for rapid repeated requests." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```
