# JS-09 Acceptance Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. (In this coordinated build the assigned agent executes inline per coordinated-build; execution sub-skills are disabled in this repo.)

**Goal:** Author the JS-09 acceptance harness — the missing automated-gate coverage for epic #913
(issue #938) — plus the counts-only release-review evidence generator, with bounded defect fixes
only.

**Architecture:** Extend the existing test machinery (`tests/integration/job-search-rpc-harness.ts`,
`ExternalModuleWorkerRuntime`, `createExternalModuleJobHandler`, `generateStructured` seams). Three
net-new surfaces: (1) an end-to-end acceptance integration test that builds the real package,
enables it with REAL computed hashes, walks the six onboarding checkpoints over real Postgres RLS,
runs a scheduled monitor sweep through the real spawned worker with sentinel privacy scanning, and
proves hash-drift refusal at load; (2) a provider-independence test driving structured evaluation
through two real wire-protocol adapter shapes; (3) a counts-only evidence renderer with fail-closed
input validation. Everything else on the spec's 12-item automated gate is already covered by
JS-01..08 suites (coverage map verified 2026-07-11 on `ba4ed180`).

**Tech Stack:** vitest, real Postgres (integration DB harness), `@jarv1s/module-registry/node`,
`@jarv1s/ai` structured layer, `node:http` for wire-protocol fakes, tsx script.

## Global Constraints

- Risk tier `security`: owner-private data, RLS isolation, privileged install. Build defensively.
- **Zero new migrations.** If one seems needed, STOP and escalate (scope creep).
- **No new product scope** — tests + evidence artifact + bounded defect fixes only.
- `git add` by explicit path only; never touch `docs/coordination/`.
- No résumé/profile/private text in any payload, log, prompt, doc, or the evidence artifact.
- Sentinel constants used across tasks (state in PR body for QA re-run):
  `JS09-ACCEPT-RESUME-SENTINEL-93d1c4`, `JS09-ACCEPT-PROFILE-SENTINEL-93d1c4`,
  `JS09-ACCEPT-QUERY-SENTINEL-93d1c4`.
- Provider-identifier regex (shared with existing suites):
  `/openai|anthropic|claude|gemini|gpt-|mistral|llama|sonnet|haiku|deepseek|bedrock|vertex/i`.
- Evidence artifact destination: **issue/PR comment on #938**, not a committed `.md`
  (MEMORY.md "GitHub source of truth"; handoff Fable-note #2). Confirm with coordinator at plan
  approval.
- File-size gate: every new file < 1000 lines.
- Existing coverage is NOT duplicated. Criteria 2 (fail-closed variants), 3 (unit-level
  checkpoints), 4 (isolation/export/delete/disable/purge), 5 (fixtures/capture), 6/7 (dedup,
  changed-content), 9 (independent degradation), 10 (ranking fields + 25/day cap), 11
  (retention/tombstones) are covered by the JS-01..08 suites; this plan adds only the E2E linkage
  and the four verified gaps.

---

### Task 1: Acceptance E2E integration test — real-hash enable, six checkpoints on real RLS, scheduled sweep through the real worker, sentinel privacy scan, drift refusal

Covers spec gate items: independent install/enable (real hashes), six checkpoints (integration
level), scheduled run with browser/chat closed + payload/log scans (Fable-note #1), run-twice dedup
at E2E level, hash-drift refusal at load.

**Files:**

- Create: `tests/integration/external-module-job-search-acceptance.test.ts`
- Test: itself (this is a test-authoring task)

**Interfaces:**

- Consumes: `loadJobSearchModule`, `kvForActor`, `jobSearchSourceDir`, `bootstrapJobSearchRows`
  from `tests/integration/job-search-rpc-harness.ts`; `resetFoundationDatabase`,
  `connectionStrings`, `ids` from `tests/integration/test-database.ts`;
  `buildExternalModule` from `scripts/build-external-module.js`;
  `getExternalModuleRegistrations`, `ExternalModuleWorkerRuntime`,
  `createExternalModuleRpcHandler` from `@jarv1s/module-registry/node`;
  `createExternalModuleJobHandler` from `apps/worker/src/external-module-job-handler.js`;
  onboarding/run handlers from `external-modules/job-search/src/worker/handlers/`;
  `createModuleCredentialSecretCipher` from `@jarv1s/settings`.
- Produces: sentinel constants + scan pattern that Task 3's evidence test and the PR body reuse.

- [ ] **Step 1: Write the test skeleton + real-hash enable**

Model the `beforeAll` on `tests/integration/js08-decide-confirm-audit.test.ts:78-95`, with one
deliberate difference — the enabled row uses REAL hashes computed by discovery, not
`sha256:job-search`:

```ts
// tests/integration/external-module-job-search-acceptance.test.ts
//
// JS-09 (#938) acceptance harness. Proves on real Postgres RLS:
//  (1) the independently built package is discovered with real hashes and
//      enabled without BUILT_IN_MODULES/default-image changes;
//  (2) a fresh user walks all six onboarding checkpoints through the real
//      RPC kv;
//  (3) a scheduled monitor sweep completes through the REAL spawned
//      dist/worker.js with no browser/chat anywhere, and sentinel scans prove
//      resume/profile text never reaches job payloads, run records, or
//      worker log output (handoff Fable-note #1 — sentinels documented in the
//      PR body so QA can re-run);
//  (4) two identical sweeps do not duplicate opportunities/evaluations;
//  (5) a package-hash drift (tampered dist/worker.js) is refused at load —
//      the enabled module contributes nothing.
import { appendFileSync, copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { Kysely } from "kysely";

import { createDatabase, DataContextRunner, type JarvisDatabase } from "@jarv1s/db";
import {
  createExternalModuleRpcHandler,
  ExternalModuleWorkerRuntime,
  getExternalModuleRegistrations
} from "@jarv1s/module-registry/node";
import { createModuleCredentialSecretCipher } from "@jarv1s/settings";
import { createExternalModuleJobHandler } from "../../apps/worker/src/external-module-job-handler.js";
import { buildExternalModule } from "../../scripts/build-external-module.js";
import { jobSearchSourceDir, kvForActor, loadJobSearchModule } from "./job-search-rpc-harness.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const RESUME_SENTINEL = "JS09-ACCEPT-RESUME-SENTINEL-93d1c4";
const PROFILE_SENTINEL = "JS09-ACCEPT-PROFILE-SENTINEL-93d1c4";
const QUERY_SENTINEL = "JS09-ACCEPT-QUERY-SENTINEL-93d1c4";
```

`beforeAll` (120s timeout): `resetFoundationDatabase()`, `buildExternalModule(jobSearchSourceDir)`,
then compute the real registration:

```ts
const registrations = getExternalModuleRegistrations({
  modulesDir: externalModulesDir, // fileURLToPath(new URL("../../external-modules", import.meta.url))
  coreVersion // read from root package.json — match whatever discovery callers pass; verify against packages/module-registry/src/node.ts:32
});
const registration = registrations.find((entry) => entry.module.id === "job-search");
// Discovery accepting the built package IS the install acceptance: hashes are
// real, manifest validated, no BUILT_IN_MODULES/default-image involvement
// (exclusion side already pinned by external-module-job-search-absence.test.ts).
if (!registration) throw new Error("job-search not discovered from the built package");
await bootstrap.query(
  `INSERT INTO app.external_modules (id, status, manifest_hash, package_hash, enabled_at, enabled_by)
   VALUES ('job-search', 'enabled', $1, $2, now(), $3)`,
  [registration.manifestHash, registration.packageHash, ids.adminUser]
);
```

(Exact registration entry shape — `.module` vs flat fields, `manifestHash`/`packageHash` casing —
read from `packages/module-registry/src/node.ts:32` and the failclosed test's usage at
`tests/unit/external-module-job-search-failclosed.test.ts` before coding; adjust names to compile.)

- [ ] **Step 2: Run to verify the skeleton fails (no assertions yet → add first `it`)**

First `it`: "independently built package is discovered with real hashes and enabled" — assert
`registration.manifestHash`/`packageHash` are `sha256:`-prefixed and the DB row round-trips them.

Run: `pnpm vitest run tests/integration/external-module-job-search-acceptance.test.ts`
Expected: PASS (this asserts existing machinery; a FAIL here is a real defect — triage per Task 4).

- [ ] **Step 3: Six-checkpoint walkthrough over real RPC kv, seeding sentinels**

Mirror the unit walkthrough (`tests/unit/external-module-job-search-handlers-onboarding.test.ts:246`
— copy its exact handler-call sequence for the six `STEP_ORDER` checkpoints
`resume_intake → resume_critique → resume_approval → profile → sources_schedule → review_enable`),
but with `kv = kvForActor({ module, workerDb, requestIdPrefix: "js09-accept" }, ids.userA)` (real
RPC host + real Postgres) instead of the memory kv, and a stub `JobSearchAi` that returns a
truth-guard-compliant critique/revision (copy the stub object the unit walkthrough uses). Seed:

- resume intake text: `` `# Resume\n${RESUME_SENTINEL} worked at Initech.` ``
- profile field value: `` `${PROFILE_SENTINEL} staff engineer` ``
- monitor query: `` `${QUERY_SENTINEL}` `` with a greenhouse board config (copy the monitor shape
  from `tests/unit/external-module-job-search-handlers-run.test.ts` setup).

Assert after each checkpoint that `getStateHandler` reports the expected step, ending `"done"` with
monitoring enabled. **Positive control:** `bootstrapJobSearchRows`/bootstrap query shows
`RESUME_SENTINEL` present in the stored resume row — proves the sentinels are actually in the data
the privacy scan later sweeps against.

Run: same vitest command. Expected: PASS (defect → Task 4 triage).

- [ ] **Step 4: Scheduled sweep through the REAL spawned worker with log capture**

Build the production job handler with real deps, wrapping only two seams:

```ts
const workerLogs: string[] = [];
const runtime = new ExternalModuleWorkerRuntime({
  // flushLogs forwards captured worker stderr + non-protocol stdout here —
  // this is the "worker log output" surface the sentinel scan sweeps.
  logger: { warn: (obj: unknown, msg?: string) => workerLogs.push(JSON.stringify({ obj, msg })) }
});

// Serve the greenhouse fixture instead of the network: wrap the rpc handler the
// production job handler builds, intercepting only fetch.request.
const fixtureBody = readFileSync(
  join("tests/fixtures/job-search", "greenhouse-board.json"),
  "utf8"
);
const runtimeWithFixtureFetch = {
  invoke: (mod, handler, input, rpc) =>
    runtime.invoke(mod, handler, input, async (method, params, rememberSecret) =>
      method === "fetch.request"
        ? { status: 200, bodyText: fixtureBody } // match ModuleFetchResponse shape in worker-rpc-host.ts
        : rpc(method, params, rememberSecret)
    )
};

const handler = createExternalModuleJobHandler({
  module: registration.module,
  queue: sweepQueue, // the manifest's job-search.monitor-sweep declaration
  runtime: runtimeWithFixtureFetch,
  workerDb,
  dataContext: new DataContextRunner(workerDb),
  cipher: createModuleCredentialSecretCipher(),
  discoveryById: new Map([["job-search", registration.module]]),
  listActiveUserIds: async () => [ids.userA],
  ai: async () => ({ ok: true, object: stubEvaluation }) // valid evaluate outputSchema object — copy from worker-evaluate.test.ts validOutput
});
await handler({ id: "js09-sweep-1", data: sweepPayload } as Job<ExternalModuleJobPayload>);
```

`sweepPayload`: `{ moduleId: "job-search", actorUserId: ids.userA, jobKind: "job-search.monitor-sweep", idempotencyKey: ... }`
— copy the exact payload shape from `tests/integration/module-worker-queue-ai.test.ts:69-130`
(`assertModuleJobPayload` gates it, which is itself part of the acceptance: metadata-only payload).

Assertions ("scheduled run completes with browser/chat closed" — nothing in this path touches the
web app or assistant chat; the worker is a bare spawned `node dist/worker.js`):

- run record exists with ok status and ingested count > 0 (via `kvForActor` domain reads — copy the
  run-record read from `handlers-run` unit suite);
- feed/opportunities populated from the fixture.

Run: same vitest command. Expected: PASS.

- [ ] **Step 5: Sentinel privacy scan + run-twice dedup**

```ts
const SENTINELS = [RESUME_SENTINEL, PROFILE_SENTINEL, QUERY_SENTINEL];

// (a) job payload is sentinel-free (metadata-only invariant).
for (const sentinel of SENTINELS) expect(JSON.stringify(sweepPayload)).not.toContain(sentinel);

// (b) worker log output (stderr + stray stdout captured by the runtime logger)
//     is sentinel-free. Guard against vacuity: the scan surface must exist —
//     workerLogs may legitimately be empty; assert the POSITIVE control below
//     carries the burden instead of log volume.
for (const sentinel of SENTINELS) {
  expect(workerLogs.join("\n")).not.toContain(sentinel);
}

// (c) every job-search.runs record and every opportunity/feed row is
//     sentinel-free (copy the kv.dump()-style sweep from
//     tests/unit/external-module-job-search-handlers-run.test.ts:179, but read
//     rows via bootstrapJobSearchRows over module_kv namespaces runs/opportunities/feed).

// (d) POSITIVE control (scan is live): resume row DOES contain RESUME_SENTINEL.
```

Then invoke the handler again with an identical second payload (`id: "js09-sweep-2"`, same monitor)
and assert: no new opportunity rows, no new evaluation rows, run record reports
suppressed/duplicate counts (copy expected counts shape from
`tests/integration/external-module-job-search-kv-isolation.test.ts:685`).

Run: same vitest command. Expected: PASS.

- [ ] **Step 6: Hash-drift refusal at load**

```ts
it("a drifted package contributes nothing at load", async () => {
  const workerPath = join(jobSearchSourceDir, "dist/worker.js");
  const original = readFileSync(workerPath);
  try {
    appendFileSync(workerPath, "\n// tampered");
    const drifted = getExternalModuleRegistrations({
      modulesDir: externalModulesDir,
      coreVersion
    }).find((entry) => entry.module.id === "job-search");
    // Recomputed hash no longer matches the enabled row → production handler skips.
    expect(drifted.packageHash).not.toBe(registration.packageHash);
    const invocations: unknown[] = [];
    const skipped = createExternalModuleJobHandler({
      ...sameDepsAsStep4ButWith,
      module: drifted.module,
      discoveryById: new Map([["job-search", drifted.module]]),
      runtime: {
        invoke: async (...args) => {
          invocations.push(args);
          return undefined;
        }
      }
    });
    await expect(skipped({ id: "js09-drift", data: sweepPayload })).resolves.toBeUndefined();
    expect(invocations).toHaveLength(0);
  } finally {
    writeFileSync(workerPath, original); // restore for later suites in the same run
  }
});
```

(The queue-layer skip is already unit-proven at `tests/integration/module-worker-queue-ai.test.ts:180-187`
with synthetic hashes; the acceptance value here is REAL drift — tampered artifact → recomputed
real hash → refusal against the real enabled row.)

Run: same vitest command. Expected: PASS.

- [ ] **Step 7: Full-file pass + commit**

Run: `pnpm vitest run tests/integration/external-module-job-search-acceptance.test.ts`
Expected: PASS, all tests.

```bash
git add tests/integration/external-module-job-search-acceptance.test.ts
git commit -m "test(job-search): JS-09 acceptance E2E — real-hash enable, six checkpoints, scheduled sweep with sentinel privacy scan, drift refusal (#938)"
```

---

### Task 2: Provider independence — two configured wire-protocol adapter shapes, no identifier leakage

Covers spec gate item 12 (the verified gap): structured evaluation through `ctx.ai` with **two
configured adapter shapes**, and no provider/model identifier in package code or RPC output.

**Files:**

- Create: `tests/integration/job-search-provider-independence.test.ts`
- Modify: `tests/unit/external-module-job-search-bundle.test.ts` (add package-wide identifier sweep)

**Interfaces:**

- Consumes: `seedProvider`/`seedModel` pattern from `tests/integration/ai-structured.test.ts:40-68`
  (POST `/api/ai/providers` accepts `providerKind`; add `baseUrl` — verify the route schema accepts
  it, else seed via direct SQL per `tests/integration/multi-user-isolation.test.ts:520` with
  `createAiSecretCipher(process.env).encryptJson(...)`); `generateStructured` from `@jarv1s/ai`
  (real `HttpApiAdapter` default at `packages/ai/src/structured/generate-structured.ts:101-105`,
  honors `base_url` for every kind); `createModuleWorkerAiBridge` from
  `apps/worker/src/external-module-ai-bridge.js`; the real job-search evaluation `outputSchema`
  (import the same schema object `worker/evaluate.ts` passes to `ctx.ai`).
- Produces: nothing downstream; standalone gate coverage.

- [ ] **Step 1: Wire-protocol fake server + two providers**

`node:http` server on an ephemeral localhost port; route by path: Anthropic shape
(`POST /v1/messages`, `x-api-key` header, response `{content:[{type:"text",text:"<json>"}],usage:{input_tokens,output_tokens}}`)
and OpenAI shape (`POST /chat/completions`, `Authorization: Bearer`, response
`{choices:[{message:{content:"<json>"}}],usage:{prompt_tokens,completion_tokens}}`). **Read
`packages/ai/src/adapters/http-api.ts` + `http-api-structured.ts` first and copy the exact
paths/headers/response fields the adapter parses** — the value of this test is that the REAL
adapter parses two genuinely different wire shapes. The served `<json>` body is a valid job-search
evaluation object (reuse `validOutput` from
`tests/unit/external-module-job-search-worker-evaluate.test.ts:121`).

Seed two providers + one json-capable model each (`anthropic` kind + `openai-compatible` kind, both
`baseUrl` → the fake server), then bind `module.job-search` to each in turn (binding PUT route per
`tests/integration/ai-structured.test.ts:259`).

- [ ] **Step 2: Drive the REAL bridge through both shapes**

For each provider kind, with that kind bound/selected:

```ts
const bridge = createModuleWorkerAiBridge({ aiRepository: new AiRepository(), logger: quiet });
const result = await dataContext.withDataContext(actorContext, (scopedDb) =>
  bridge(scopedDb, "job-search", { schema: evaluateOutputSchema, prompt: "Evaluate fit." })
);
expect(result).toMatchObject({ ok: true });
// Identical module-visible result regardless of provider shape:
// usage/model/provider dropped by the bridge (external-module-ai-bridge.ts:36).
const serialized = JSON.stringify(result);
expect(serialized).not.toMatch(PROVIDER_RE);
expect(serialized).not.toContain(providerModelId); // e.g. "json-economy-a" / "json-economy-o"
```

Also assert the fake server actually saw BOTH wire shapes (record method/path/auth header per
request — proves two distinct adapter shapes were exercised, not one shape twice).

Run: `pnpm vitest run tests/integration/job-search-provider-independence.test.ts`
Expected: PASS. (`needs_config`/`provider_error` → real wiring defect or wrong wire fake — fix the
fake first; a genuine core defect goes to Task 4 triage.)

- [ ] **Step 3: Package-wide identifier sweep (code half of criterion 12)**

Extend `tests/unit/external-module-job-search-bundle.test.ts` (it already holds the built-artifact
hygiene tests and builds in `beforeAll`):

```ts
it("no provider/model identifier anywhere in package source or built worker", () => {
  const files = [...walk(join(moduleDir, "src")), join(moduleDir, "dist/worker.js")];
  for (const file of files) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(PROVIDER_RE);
  }
});
```

(Existing narrower grep at `tests/unit/external-module-job-search-worker-evaluate.test.ts:470`
covers `evaluate.ts` only; keep it, this supersedes in breadth. If the sweep trips on a legitimate
hit — e.g. a comment — fix the module source, that's a bounded defect. `walk` = small local
recursive readdir helper in the test file.)

Run: `pnpm vitest run tests/unit/external-module-job-search-bundle.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/job-search-provider-independence.test.ts tests/unit/external-module-job-search-bundle.test.ts
git commit -m "test(job-search): provider independence through two real wire shapes; package-wide identifier sweep (#938)"
```

---

### Task 3: Counts-only evidence artifact renderer (fail-closed) + CLI

Covers the spec "Evidence artifact" section + handoff Fable-note #2 (self-sentinel-scan; destination
= issue/PR comment on #938, agreed with coordinator).

**Files:**

- Create: `scripts/job-search-acceptance-evidence.ts`
- Create: `tests/unit/job-search-acceptance-evidence.test.ts`
- Modify: `package.json` (add `"evidence:job-search": "tsx scripts/job-search-acceptance-evidence.ts"`)

**Interfaces:**

- Consumes: `EVAL_DAILY_CAP` from `external-modules/job-search/src/domain/limits.js`; module
  manifest (`jarvis.module.json`) for id/version/adapter list; root `package.json` version.
- Produces: `renderAcceptanceEvidence(input: AcceptanceEvidenceInput): string` (exported for the
  unit test) + CLI `main()` printing markdown to stdout.

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/unit/job-search-acceptance-evidence.test.ts
import { describe, expect, it } from "vitest";
import {
  renderAcceptanceEvidence,
  type AcceptanceEvidenceInput
} from "../../scripts/job-search-acceptance-evidence.js";

const PROVIDER_RE =
  /openai|anthropic|claude|gemini|gpt-|mistral|llama|sonnet|haiku|deepseek|bedrock|vertex/i;

const input: AcceptanceEvidenceInput = {
  coreVersion: "0.1.10",
  moduleVersion: "0.1.0",
  nodeVersion: "v22.0.0",
  enabledAdapters: ["greenhouse", "lever", "ashby"],
  runCounts: { scheduledRuns: 2, ingested: 3, suppressedDuplicates: 2, evaluated: 3 },
  dedup: { secondRunNewOpportunities: 0, secondRunNewEvaluations: 0 },
  gates: {
    verifyFoundation: "pass",
    releaseHardening: "pass",
    moduleBuild: "pass",
    isolationSuite: "pass",
    failClosedSuite: "pass",
    lifecycleSuite: "pass"
  },
  evalDailyCap: 25,
  sevenDayResult: "pending"
};

describe("job-search acceptance evidence artifact (#938)", () => {
  it("renders every required section, counts-only", () => {
    const out = renderAcceptanceEvidence(input);
    for (const section of [
      "Package/runtime versions",
      "Enabled adapters",
      "Run counts",
      "Dedup/evaluation results",
      "Security/lifecycle gate outcomes",
      "Seven-day success result"
    ])
      expect(out).toContain(section);
    expect(out).toContain("pending");
    expect(out).not.toMatch(PROVIDER_RE);
  });

  it("fails closed on free text smuggled into any string field", () => {
    for (const bad of [
      { ...input, coreVersion: "JS09-ACCEPT-RESUME-SENTINEL-93d1c4 worked at Initech" },
      { ...input, enabledAdapters: ["greenhouse", "My resume says confidential things"] },
      { ...input, sevenDayResult: "he worked at Initech since 2019" as never }
    ])
      expect(() => renderAcceptanceEvidence(bad)).toThrow(/counts-only|invalid/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/job-search-acceptance-evidence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement renderer + CLI**

`scripts/job-search-acceptance-evidence.ts`: typed input; validation is structural fail-closed —
versions must match `/^v?\d+\.\d+\.\d+$/`, adapter ids `/^[a-z][a-z0-9-]{0,31}$/`, counts
non-negative integers, gate outcomes from the union `"pass" | "fail"`, `sevenDayResult` from
`"pending" | "met" | "insufficient-supply"`. Any violation throws
`Error("evidence artifact is counts-only: invalid <field>")`. Renderer emits markdown with the six
sections above; NO field is interpolated without passing validation (this is the structural
guarantee that résumé/profile text, descriptions, credentials, prompts, and private tool output
cannot enter — the banned classes are all free text, which no field accepts). CLI `main()`
(guarded by `import.meta.url` main-check, same pattern as `scripts/build-external-module.ts:48`)
gathers versions/adapters/cap from the repo, reads counts + gate outcomes from a `--results <path>`
JSON, prints to stdout. Comment in the header: destination = comment on issue #938 (GitHub source
of truth) — never committed to the repo; posting is coordinator/QA's step.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/job-search-acceptance-evidence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/job-search-acceptance-evidence.ts tests/unit/job-search-acceptance-evidence.test.ts package.json
git commit -m "feat(job-search): counts-only acceptance evidence renderer + evidence:job-search script (#938)"
```

---

### Task 4: Full gate, bounded defect fixes, evidence dry-run

**Files:**

- Modify: only what defects require (bounded — no new scope; escalate anything structural).

- [ ] **Step 1: Module build + targeted suites**

Run: `pnpm build:external:job-search && pnpm vitest run tests/unit/external-module-job-search-bundle.test.ts tests/unit/job-search-acceptance-evidence.test.ts tests/integration/external-module-job-search-acceptance.test.ts tests/integration/job-search-provider-independence.test.ts`
Expected: PASS.

- [ ] **Step 2: Full core gate**

Run: `pnpm verify:foundation` then `pnpm audit:release-hardening`
Expected: exit 0 both. Any failure: fix if bounded (test bug, missed format, a real module defect
within JS-01..08 scope); ESCALATE to coordinator if a fix would need a migration, a new endpoint,
or cross-module surgery. Record exact commands + exit codes for the PR body.
(Note: integration suite is PG-heavy — do not run concurrently with another agent's integration
run; MEMORY.md multi-agent PG contention.)

- [ ] **Step 3: Evidence dry-run**

Run: `pnpm evidence:job-search --results <scratchpad>/js09-results.json` with counts transcribed
from the Step 1/2 outputs. Expected: markdown on stdout; sentinel + provider regex scan of the
output comes back clean (pipe through grep to verify). Save output to scratchpad for the PR body.

- [ ] **Step 4: Commit any fixes + wrap**

```bash
git add <explicit defect-fix paths only>
git commit -m "fix(job-search): <defect> surfaced by JS-09 acceptance gate (#938)"
```

Then `coordinated-wrap-up`: pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`),
fresh rebase on origin/main, push, PR. PR body MUST include: sentinel strings + how QA re-runs the
scan (Fable-note #1); evidence artifact destination = comment on #938 (Fable-note #2); the
day-one MANUAL acceptance steps for Ben (spec "Manual acceptance" 1-5; Fable-note #5 — merge stays
gated on it + council, not on this build); commands + exit codes for the local gate.

---

## Self-review notes (spec coverage)

- Spec gate items vs tasks: install/enable → Task 1 Steps 1-2; fail-closed/drift → Task 1 Step 6
  (+ existing failclosed suite); six checkpoints → Task 1 Step 3 (+ existing unit walkthrough);
  isolation/export/delete/disable/re-enable/purge → existing kv-isolation suite (verified, not
  duplicated); fixtures/capture → existing adapter+capture suites; dedup twice-run → Task 1 Step 5
  (+ existing unit/integration); changed-content re-eval → existing (`handlers-run:513`,
  `worker-evaluate:217`); scheduled headless + payload/log scan → Task 1 Steps 4-5; degradation →
  existing (`handlers-run:158,264`, `worker-evaluate:344`); ranking fields + cap → existing
  (`worker-evaluate:121,291`); retention/tombstones → existing (`kv-retention`); provider
  independence ≥2 shapes → Task 2. Evidence artifact → Task 3. "Module runs its full gate" →
  Task 4 (per Fable-note #3, core gate + module build + module suites IS the module gate).
  Manual acceptance + seven-day observation → Ben's, documented in PR body (Fable-note #5).
- Zero migrations, zero new endpoints, zero product code (only possible bounded defect fixes in
  Task 4 and a possible comment-level fix if Task 2 Step 3's sweep trips).

```

```
