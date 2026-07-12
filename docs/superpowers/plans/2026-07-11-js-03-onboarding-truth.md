# JS-03 Onboarding + Resume Truth Guard Implementation Plan

> **For agentic workers:** the superpowers execution skills (`executing-plans`,
> `subagent-driven-development`) are disabled in this repo — drive this plan yourself,
> task by task, with `superpowers:test-driven-development`. Steps use checkbox (`- [ ]`)
> syntax for tracking.

**Task issue:** #932 (Part of epic #913). PR closes #932.
**Spec:** `docs/superpowers/specs/2026-07-10-job-search-js-03-onboarding-truth-guard.md`
**Design:** `docs/superpowers/specs/2026-07-10-job-search-module-design.md`
**Risk tier:** SECURITY (cross-provider council QA gate).

**Goal:** Wire the Job Search module's conversational onboarding (six checkpoints) and the
resume truth guard onto the JS-02 KV domain, implementing 10 of the 13 manifest tools, plus
the missing host `ctx.ai` bridge (severable Task 0, see design-fork note below).

**Architecture:** Module worker handlers are pure functions over injectable ports
(`{kv, ai, now}`), built on the JS-02 domain barrel. AI critique output passes a
deterministic truth guard (exact-quote provenance OR recorded user confirmation) before any
persistence. The host gains one new worker RPC, `ai.generateStructured`, backed by the
already-merged parent structured-AI seam (#915/PR #923) via an injected callback so
`@jarv1s/module-registry` stays AI-agnostic.

**Tech Stack:** TypeScript, vitest, JS-02 domain layer (`external-modules/job-search/src/domain`),
`@jarv1s/module-sdk` worker protocol, `@jarv1s/ai` `generateStructured`.

## Spec-vs-branch verification result (step ½, done)

All spec premises verified current on `feat/js-03-onboarding-truth` (rooted `a8d638e4`) except
ONE drift, escalated `[DESIGN-FORK]` to the Coordinator with this plan:

- **Drift:** the task-decomposition doc says JS-03 depends on "#919 gateway dispatch and
  #919 `ctx.ai`". #919 merged (ff2ab3a7) with gateway dispatch + `ctx.kv/auth/fetch` but
  **without** the child `ctx.ai` bridge: no `ai.*` method in
  `packages/module-registry/src/external/worker-rpc-host.ts`, no `ai` member on
  `ModuleWorkerContext` in `packages/module-sdk/src/worker.ts`. The parent seam
  (`generateStructured`, bounds, `module.${id}` service keys) IS merged.
- **Resolution proposed:** build the bridge here as severable **Task 0** (below). If the
  Coordinator rejects Task 0, Tasks 1–10 still land: the worker `ai` port is nullable and the
  critique path degrades to a graceful "AI critique unavailable" question.
- Everything else current: JS-02 domain complete behind its barrel; worker handlers are JS-01
  `not-implemented` stubs; manifest declares 13 tools with placeholder `{"type":"object"}`
  input schemas; #916 starter action landed.

## Global Constraints (verbatim from spec/design/JS-02)

- **ZERO migrations, no SQL, no direct DB.** Persistence is platform `module_kv` via `ctx.kv`
  only. No raw `fs`.
- **Owner-only isolation** on all persisted state; proven by adversarial cross-owner test.
- Resume input cap: `RESUME_INPUT_MAX_BYTES = 49_152`; rejection copy is exactly
  `RESUME_TOO_LARGE_MESSAGE` = "Resume text is over the 48 KB limit (49,152 bytes of UTF-8).
  Trim it and paste it again." (fixed copy — never append computed sizes).
- KV record cap: `KV_VALUE_MAX_BYTES = 65_535` via `writeRecord` (fires before DB's 65,536).
- Ids: `/^[A-Za-z0-9_-]{1,64}$/` (`assertId`); hashes via `contentHash` (32-hex sha256).
- Revision `"0"` = immutable pasted original (`kind: "original"`); AI revisions never claim it.
- Approval writes ONLY the active pointer; missing pointed-at revision fails closed.
- **Provider-agnostic:** no provider/model names in package code, prompts, or RPC/tool
  results. Errors surfaced to the module are only
  `needs_config | validation_failed | provider_error | aborted`.
- Structured-AI bounds (parent enforces): prompt ≤ 65,536 B, schema ≤ 16,384 B, result
  ≤ 131,072 B, forbidden schema keywords (`$ref`, `pattern`, …).
- Domain code stays `@jarv1s/*`-import-free (bundler-independent); worker handlers import the
  domain **barrel only** (`../domain/index.js`).
- Error messages never embed record content (`JobSearchKvError` discipline).
- Truth guard: material claims (employer, role, date, skill, credential, metric, outcome)
  need an exact source quote from stored revisions OR a recorded explicit user confirmation;
  unsupported content is returned as a question and **never persisted**.
- Non-goals: no PDF/DOCX parsing, no job-specific resume tailoring, no cover letters, no
  application submission. `opportunities.*`, `opportunity.decide`, `monitor.run` stay stubs.

## File map

| File                                                                                         | Action | Responsibility                                                                            |
| -------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `packages/module-sdk/src/worker.ts`                                                          | modify | Task 0: `ctx.ai` member + `ai.generateStructured` RPC proxy                               |
| `packages/module-registry/src/external/worker-rpc-host.ts`                                   | modify | Task 0: `ai.generateStructured` method via injected callback; `forbidden_ai_call`         |
| `apps/api/src/external-module-tools.ts`                                                      | modify | Task 0: thread optional `ai` closure per module                                           |
| `apps/api/src/server.ts`                                                                     | modify | Task 0: build closure over `generateStructured` + `AiRepository` + `createAiSecretCipher` |
| `external-modules/job-search/src/domain/diff.ts`                                             | create | line-based LCS diff, hunk output                                                          |
| `external-modules/job-search/src/domain/confirmations.ts`                                    | create | user-confirmation records (`confirmation/<id>` in resume NS)                              |
| `external-modules/job-search/src/domain/truth-guard.ts`                                      | create | claim types, `verifyClaims`, critique schema + parser                                     |
| `external-modules/job-search/src/domain/resume.ts`                                           | modify | `evidence` becomes structured `ResumeEvidence[]`                                          |
| `external-modules/job-search/src/domain/keys.ts`                                             | modify | add `resumeConfirmation` key builder (additive)                                           |
| `external-modules/job-search/src/domain/index.ts`                                            | modify | export new surface                                                                        |
| `external-modules/job-search/src/worker/ai-port.ts`                                          | create | `JobSearchAi` structural port + adapter (no SDK import)                                   |
| `external-modules/job-search/src/worker/validate.ts`                                         | create | input readers, `InputError`                                                               |
| `external-modules/job-search/src/worker/handlers/flow.ts`                                    | create | step order, derived step, `updateOnboarding`                                              |
| `external-modules/job-search/src/worker/handlers/onboarding.ts`                              | create | `onboarding.get-state`                                                                    |
| `external-modules/job-search/src/worker/handlers/resume.ts`                                  | create | `resume.get / save-draft / approve`                                                       |
| `external-modules/job-search/src/worker/handlers/profile.ts`                                 | create | `profile.get / save-draft / approve`                                                      |
| `external-modules/job-search/src/worker/handlers/monitor.ts`                                 | create | `monitor.list / get / save`                                                               |
| `external-modules/job-search/src/worker/index.ts`                                            | modify | wire ctx → ports → handlers; error wrap                                                   |
| `external-modules/job-search/jarvis.module.json`                                             | modify | tight input schemas for the 10 implemented tools                                          |
| `tests/unit/module-sdk-worker.test.ts`                                                       | modify | Task 0 SDK bridge test                                                                    |
| `tests/integration/module-worker-rpc.test.ts`                                                | modify | Task 0 host RPC tests (fake ai callback)                                                  |
| `tests/unit/external-module-job-search-diff.test.ts`                                         | create | diff behavior                                                                             |
| `tests/unit/external-module-job-search-truth-guard.test.ts`                                  | create | guard + confirmations                                                                     |
| `tests/unit/external-module-job-search-handlers-{onboarding,resume,profile,monitor}.test.ts` | create | handler suites incl. six-checkpoint walkthrough, leak sweeps                              |
| `tests/unit/external-module-job-search-kv-resume.test.ts`                                    | modify | evidence type follow-through if it asserts shape                                          |
| `tests/unit/external-module-job-search-manifest.test.ts`                                     | modify | schema-tightening expectations                                                            |
| `tests/integration/external-module-job-search-kv-isolation.test.ts`                          | modify | cross-owner resume/profile/confirmation isolation                                         |

## Core interfaces

```ts
// worker-rpc-host.ts (Task 0)
export interface ExternalModuleAiRequest {
  readonly schema: Record<string, unknown>;
  readonly prompt: string;
  readonly maxOutputTokens?: number;
  readonly tierHint?: "reasoning" | "interactive" | "economy";
}
export type ExternalModuleAiResult =
  | { readonly ok: true; readonly object: unknown }
  | {
      readonly ok: false;
      readonly error: "needs_config" | "validation_failed" | "provider_error" | "aborted";
    };
// new optional dep on createExternalModuleRpcHandler input:
//   ai?: (scopedDb: DataContextDb, request: ExternalModuleAiRequest) => Promise<ExternalModuleAiResult>
// new ExternalModuleRpcError code: "forbidden_ai_call"

// module-sdk worker.ts (Task 0) — ModuleWorkerContext gains:
readonly ai: {
  generateStructured(input: {
    schema: Record<string, unknown>;
    prompt: string;
    maxOutputTokens?: number;
    tierHint?: "reasoning" | "interactive" | "economy";
  }): Promise<
    | { ok: true; object: unknown }
    | { ok: false; error: "needs_config" | "validation_failed" | "provider_error" | "aborted" }
  >;
};

// domain/truth-guard.ts
export type MaterialClaimKind =
  | "employer" | "role" | "date" | "skill" | "credential" | "metric" | "outcome";
export interface MaterialClaim {
  kind: MaterialClaimKind;
  text: string;   // ≤ 500 chars
  quote?: string; // ≤ 200 chars, must be exact substring of a source
}
export interface ResumeEvidence {
  claimKind: MaterialClaimKind;
  claimText: string;
  status: "sourced" | "confirmed";
  sourceRevisionId?: string;
  quote?: string;
  confirmationId?: string;
}
export interface TruthGuardVerdict {
  ok: boolean;
  evidence: ResumeEvidence[];
  unsupported: MaterialClaim[];
}
export const CRITIQUE_SCHEMA: Record<string, unknown>;
export function parseCritique(object: unknown):
  | { critiqueSummary: string; proposedMarkdown: string; materialClaims: MaterialClaim[] }
  | null;
export function verifyClaims(input: {
  claims: readonly MaterialClaim[];
  sources: readonly { revisionId: string; content: string }[];
  confirmationIds: ReadonlySet<string>;
}): TruthGuardVerdict;

// domain/confirmations.ts
export interface ConfirmationRecord {
  schemaVersion: 1;
  confirmationId: string;
  claimKind: MaterialClaimKind;
  claimText: string; // ≤ 500 chars
  confirmedAt: string;
}
export function confirmationIdFor(kind: MaterialClaimKind, text: string): string; // contentHash(`confirm\0${kind}\0${text}`)
export async function saveConfirmation(kv: JobSearchKv, record: ConfirmationRecord): Promise<void>;
export async function listConfirmationIds(kv: JobSearchKv): Promise<ReadonlySet<string>>;

// domain/diff.ts
export interface DiffHunk { type: "equal" | "added" | "removed"; lines: readonly string[] }
export function diffLines(before: string, after: string): readonly DiffHunk[];

// domain/resume.ts (changed field only)
evidence?: readonly ResumeEvidence[]; // was readonly string[]; nothing stored uses it yet

// worker/ai-port.ts (structural, no SDK import — mirrors kv-port pattern)
export type JobSearchAiResult =
  | { ok: true; object: unknown }
  | { ok: false; error: string };
export interface JobSearchAi {
  generateStructured(input: {
    schema: Record<string, unknown>;
    prompt: string;
    maxOutputTokens?: number;
    tierHint?: "reasoning" | "interactive" | "economy";
  }): Promise<JobSearchAiResult>;
}
export function aiFromWorkerContext(ai: JobSearchAi): JobSearchAi; // wraps, maps rejections → { ok:false, error:"provider_error" }

// worker handlers
export interface WorkerPorts { kv: JobSearchKv; ai: JobSearchAi | null; now(): Date }
// every handler: (ports: WorkerPorts) => (input: Record<string, unknown>) => Promise<Record<string, unknown>>
// responses: { status: "ok", ... } | { status: "question", question, ... } | { status: "error", code, message }

// worker/handlers/flow.ts
export const STEP_ORDER = [
  "resume_intake", "resume_critique", "resume_approval",
  "profile", "sources_schedule", "review_enable"
] as const;
export function deriveStep(completed: Record<string, boolean>): string; // first incomplete, else "done"
export async function updateOnboarding(
  kv: JobSearchKv,
  patch: {
    complete?: readonly string[];
    approvedResumeRevisionId?: string;
    approvedProfileRevisionId?: string;
  }
): Promise<OnboardingState>;
```

**Design notes locked here:**

- Six checkpoints map 1:1 to `OnboardingState.completed` flags; `step` is stored but always
  recomputed as the first incomplete checkpoint (`deriveStep`) at save time. Backward
  movement = saving new drafts at any time; completed flags and approved pointers are never
  deleted (spec: backward movement without deleting approved history).
- Deterministic revision ids: `contentHash(`rev\0${parentId}\0${content}`)` for resume,
  `contentHash(`profile\0${provenance}\0${canonicalJson(fields)}`)` for profile — retries
  are idempotent via JS-02's canonical-JSON immutability check.
- **Manual saves are user-truth:** `resume.save-draft {mode:"manual"}` carries user-authored
  content through a `risk:"write"` tool — the gateway's approval/confirm IS the explicit user
  confirmation the spec requires, so no truth guard runs on manual content. The guard runs on
  every AI-produced revision (`mode:"critique"`), which is the only path where unverified AI
  output could otherwise become ground truth.
- **Enable gate:** `monitor.save` with `enabled:true` requires an approved resume AND an
  approved profile; otherwise returns a question and persists nothing.
- **Inferred stays inactive:** `profile.approve` refuses `provenance:"inferred"` revisions
  with a question naming the field keys (never values); the confirm path is a re-save with
  `provenance:"user"` (new revision id) then approve.
- `monitor.list` returns metadata only (`monitorId, adapterId, enabled, createdAt, updatedAt`)
  — no `query`, no documents (spec: list responses never leak full documents). `monitor.get`
  returns the full config.
- Host restricts `ai.generateStructured` to non-`read` tool risk (fail-closed: read tools
  can't silently burn AI tokens); the only caller is `resume.save-draft` (write).
- Confirmation records live in `NS.resume` under `confirmation/<id>`; id is derived from
  normalized (kind, text) so re-confirmation is idempotent.

---

### Task 0 (SEVERABLE — [DESIGN-FORK], Coordinator must confirm): host `ctx.ai` bridge

**Files:**

- Modify: `packages/module-sdk/src/worker.ts`
- Modify: `packages/module-registry/src/external/worker-rpc-host.ts`
- Modify: `apps/api/src/external-module-tools.ts`
- Modify: `apps/api/src/server.ts` (external tools wiring ~line 361; `aiRepository` exists at ~line 211)
- Test: `tests/unit/module-sdk-worker.test.ts`, `tests/integration/module-worker-rpc.test.ts`

**Interfaces:** produces `ExternalModuleAiRequest/Result`, `ctx.ai` (see Core interfaces).
Consumes `generateStructured(scopedDb, {service, schema, prompt, tierHint?, maxOutputTokens?}, {repository, cipher, logger})`
from `@jarv1s/ai` with service key `` `module.${module.id}` ``.

- [ ] **Step 0.1: failing integration tests for the host RPC.** Extend
      `tests/integration/module-worker-rpc.test.ts` (reuse `moduleA` + existing handler-builder
      pattern; add `toolRisk`/`ai` variations):

```ts
describe("ai.generateStructured", () => {
  const base = {
    module: moduleA,
    actorUserId: ids.userA,
    requestId: "req-ai",
    workerDataContext: new DataContextRunner(workerDb),
    cipher: createModuleCredentialSecretCipher(),
    isActorAdmin: async () => false
  };
  const noSecret = () => {};

  it("returns a sanitized result from the injected callback", async () => {
    const rpc = createExternalModuleRpcHandler({
      ...base,
      toolRisk: "write",
      ai: async (_db, request) => ({ ok: true, object: { echoed: request.prompt } })
    });
    await expect(
      rpc("ai.generateStructured", { schema: { type: "object" }, prompt: "hi" }, noSecret)
    ).resolves.toEqual({ ok: true, object: { echoed: "hi" } });
  });

  it("fails closed when the host has no ai dependency", async () => {
    const rpc = createExternalModuleRpcHandler({ ...base, toolRisk: "write" });
    await expect(
      rpc("ai.generateStructured", { schema: { type: "object" }, prompt: "hi" }, noSecret)
    ).rejects.toMatchObject({ code: "invalid_rpc" });
  });

  it("read-risk tools cannot call ai", async () => {
    const rpc = createExternalModuleRpcHandler({
      ...base,
      toolRisk: "read",
      ai: async () => ({ ok: true, object: {} })
    });
    await expect(
      rpc("ai.generateStructured", { schema: { type: "object" }, prompt: "hi" }, noSecret)
    ).rejects.toMatchObject({ code: "forbidden_ai_call" });
  });

  it("rejects unknown params, bad tier, bad maxOutputTokens", async () => {
    const rpc = createExternalModuleRpcHandler({
      ...base,
      toolRisk: "write",
      ai: async () => ({ ok: true, object: {} })
    });
    for (const params of [
      { schema: { type: "object" }, prompt: "p", extra: 1 },
      { schema: { type: "object" }, prompt: "" },
      { schema: [], prompt: "p" },
      { schema: { type: "object" }, prompt: "p", tierHint: "opus" },
      { schema: { type: "object" }, prompt: "p", maxOutputTokens: -1 },
      { schema: { type: "object" }, prompt: "p", maxOutputTokens: 1_000_000 }
    ]) {
      await expect(rpc("ai.generateStructured", params, noSecret)).rejects.toMatchObject({
        code: expect.stringMatching(/invalid_rpc/)
      });
    }
  });

  it("coerces unexpected error labels to provider_error (no leak channel)", async () => {
    const rpc = createExternalModuleRpcHandler({
      ...base,
      toolRisk: "write",
      ai: async () => ({ ok: false, error: "anthropic exploded" as never })
    });
    await expect(
      rpc("ai.generateStructured", { schema: { type: "object" }, prompt: "hi" }, noSecret)
    ).resolves.toEqual({ ok: false, error: "provider_error" });
  });
});
```

- [ ] **Step 0.2:** run `pnpm test:integration -- tests/integration/module-worker-rpc.test.ts`
      (via `tsx scripts/test-integration.ts` per package.json) → new tests FAIL (`invalid_rpc`
      thrown for all, since the method is unknown).
- [ ] **Step 0.3: implement host side.** In `worker-rpc-host.ts`: add `"forbidden_ai_call"`
      to the error-code union; add `ai?` dep + `ExternalModuleAiRequest/Result` exported types
      (import `type DataContextDb` from `@jarv1s/db`); inside `withDataContext` right after the
      `set_config` statement insert:

```ts
if (method === "ai.generateStructured") {
  if (!input.ai) throw new ExternalModuleRpcError("invalid_rpc");
  if (input.toolRisk === "read") throw new ExternalModuleRpcError("forbidden_ai_call");
  const request = aiRequest(params);
  const result = await input.ai(scopedDb, request);
  // Rebuild the envelope from scratch: host-side extras (usage, model/provider ids)
  // must never cross into module workers.
  if (result.ok) return { ok: true, object: result.object };
  return { ok: false, error: AI_ERRORS.has(result.error) ? result.error : "provider_error" };
}
```

with module-level constants + validator:

```ts
const AI_ERRORS = new Set(["needs_config", "validation_failed", "provider_error", "aborted"]);
const AI_TIERS = new Set(["reasoning", "interactive", "economy"]);
const AI_MAX_OUTPUT_TOKENS_CAP = 32_768;

function aiRequest(value: Record<string, unknown>): ExternalModuleAiRequest {
  const allowed = new Set(["schema", "prompt", "maxOutputTokens", "tierHint"]);
  if (
    Object.keys(value).some((key) => !allowed.has(key)) ||
    typeof value.prompt !== "string" ||
    value.prompt.length === 0 ||
    (value.maxOutputTokens !== undefined &&
      (!Number.isInteger(value.maxOutputTokens) ||
        (value.maxOutputTokens as number) <= 0 ||
        (value.maxOutputTokens as number) > AI_MAX_OUTPUT_TOKENS_CAP)) ||
    (value.tierHint !== undefined && !AI_TIERS.has(value.tierHint as string))
  ) {
    throw new ExternalModuleRpcError("invalid_rpc");
  }
  const schema = record(value.schema);
  return {
    schema,
    prompt: value.prompt,
    ...(value.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: value.maxOutputTokens as number }),
    ...(value.tierHint === undefined
      ? {}
      : { tierHint: value.tierHint as ExternalModuleAiRequest["tierHint"] })
  };
}
```

- [ ] **Step 0.4:** integration tests pass. Then extend `tests/unit/module-sdk-worker.test.ts`:
      mirror the file's existing kv-RPC bridge test, asserting a handler calling
      `ctx.ai.generateStructured({schema:{type:"object"}, prompt:"p"})` emits the JSON-RPC frame
      `{"method":"ai.generateStructured","params":{"schema":{"type":"object"},"prompt":"p"}}` and
      resolves with the frame's `result` verbatim. Run
      `pnpm test:unit -- tests/unit/module-sdk-worker.test.ts` → FAIL (ctx.ai undefined).
- [ ] **Step 0.5: implement SDK side.** In `packages/module-sdk/src/worker.ts` add the `ai`
      member (see Core interfaces) next to `kv`:

```ts
const ai = {
  generateStructured: (aiInput: {
    schema: Record<string, unknown>;
    prompt: string;
    maxOutputTokens?: number;
    tierHint?: "reasoning" | "interactive" | "economy";
  }) =>
    callParent("ai.generateStructured", aiInput) as Promise<
      | { ok: true; object: unknown }
      | { ok: false; error: "needs_config" | "validation_failed" | "provider_error" | "aborted" }
    >;
};
```

and pass `ai` into the handler context object. Unit test passes.

- [ ] **Step 0.6: wire the API.** `apps/api/src/external-module-tools.ts`: accept optional
      `ai?: (scopedDb: DataContextDb, moduleId: string, request: ExternalModuleAiRequest) => Promise<ExternalModuleAiResult>`
      and pass `...(input.ai ? { ai: (db, req) => input.ai!(db, module.id, req) } : {})` into
      `createExternalModuleRpcHandler`. `apps/api/src/server.ts`: next to the
      `createExternalModuleTools` call build:

```ts
const aiSecretCipher = createAiSecretCipher();
// …
ai: async (scopedDb, moduleId, request) => {
  try {
    const result = await generateStructured(
      scopedDb,
      { service: `module.${moduleId}`, ...request },
      { repository: aiRepository, cipher: aiSecretCipher, logger: server.log }
    );
    return result.ok
      ? { ok: true, object: result.object } // drop usage — module workers never see token/model data
      : { ok: false, error: result.error };
  } catch {
    // Bounds violations / unexpected throws: opaque to modules.
    return { ok: false, error: "provider_error" };
  }
};
```

(imports from `@jarv1s/ai`; reuse an existing AI cipher instance if server.ts already has
one in scope — grep first). `pnpm typecheck` green.

- [ ] **Step 0.7: commit.**
      `git add packages/module-sdk/src/worker.ts packages/module-registry/src/external/worker-rpc-host.ts apps/api/src/external-module-tools.ts apps/api/src/server.ts tests/unit/module-sdk-worker.test.ts tests/integration/module-worker-rpc.test.ts`
      → `feat(external-modules): ctx.ai structured-generation bridge for module workers (#932)`.

### Task 1: domain `diff.ts`

**Files:** Create `external-modules/job-search/src/domain/diff.ts`; barrel export in
`domain/index.ts`; Test `tests/unit/external-module-job-search-diff.test.ts`.
**Interfaces:** produces `diffLines(before, after): readonly DiffHunk[]` (Core interfaces).

- [ ] **Step 1.1: failing tests** — identical → single `equal` hunk; pure insert / delete;
      replace produces `removed` then `added`; empty-vs-content; hunks concatenate back to both
      inputs (property: `equal+removed` lines == before, `equal+added` lines == after) checked on
      a few fixed fixtures. Run `pnpm test:unit -- tests/unit/external-module-job-search-diff.test.ts` → FAIL.
- [ ] **Step 1.2: implement** — split on `\n`; trim common prefix/suffix; LCS DP over the
      middle (inputs already ≤ 48 KB by resume gates; guard: if either side > 10_000 lines return
      `[{type:"removed",…},{type:"added",…}]` wholesale instead of DP). Merge consecutive
      same-type lines into hunks. No imports beyond `errors.js` (none needed).
- [ ] **Step 1.3:** tests pass →
      `git add external-modules/job-search/src/domain/diff.ts external-modules/job-search/src/domain/index.ts tests/unit/external-module-job-search-diff.test.ts`
      → `feat(job-search): line diff for resume revisions (#932)`.

### Task 2: domain `confirmations.ts` + `keys.resumeConfirmation` + structured evidence

**Files:** Create `domain/confirmations.ts`; Modify `domain/keys.ts` (add
`resumeConfirmation: (id: string) => \`confirmation/${id}\``to the`keys`object — additive),`domain/resume.ts`(evidence type →`readonly ResumeEvidence[]`, type imported from
`truth-guard.js`— declare the`ResumeEvidence`interface in Task 2 inside a new`truth-guard.ts`containing ONLY the types for now),`domain/index.ts`.
Test: `tests/unit/external-module-job-search-truth-guard.test.ts`(confirmations half);
check`tests/unit/external-module-job-search-kv-resume.test.ts` still passes (evidence unused there — update only if it asserts the old string[] shape).

- [ ] **Step 2.1: failing tests** — `confirmationIdFor` is deterministic + kind/text-sensitive
      (`confirmationIdFor("employer","Acme") !== confirmationIdFor("role","Acme")`);
      `saveConfirmation` round-trips via memory kv (`createMemoryKv()` helper) under key
      `confirmation/<id>` in `NS.resume`; re-save idempotent; `claimText` > 500 chars rejected
      (`invalid_record`, message names the cap, never the text); `listConfirmationIds` returns
      ids of saved confirmations only (ignores `revision/*` keys).
- [ ] **Step 2.2: implement** `confirmations.ts` (uses `contentHash`, `readRecord`/`writeRecord`,
      `keys.resumeConfirmation`, `NS.resume`; cap constant `CONFIRMATION_TEXT_MAX_CHARS = 500`).
- [ ] **Step 2.3:** tests pass; run
      `pnpm test:unit -- tests/unit/external-module-job-search-kv-resume.test.ts` to confirm no
      regression. Commit:
      `feat(job-search): user-confirmation records + structured resume evidence types (#932)`.

### Task 3: domain `truth-guard.ts` (verify + critique schema/parser)

**Files:** Extend `domain/truth-guard.ts`; barrel exports; Test
`tests/unit/external-module-job-search-truth-guard.test.ts` (guard half).
**Interfaces:** `CRITIQUE_SCHEMA`, `parseCritique`, `verifyClaims` (Core interfaces).

- [ ] **Step 3.1: failing tests**
  - claim with exact `quote` found in a source → `sourced` evidence carrying
    `sourceRevisionId` + quote;
  - quote NOT a substring of any source → `unsupported` (quote is not trusted testimony);
  - claim without quote whose `confirmationIdFor(kind,text)` ∈ `confirmationIds` → `confirmed`
    evidence with `confirmationId`;
  - claim with neither → `unsupported`, `ok:false`;
  - > 64 claims → treat entire critique as unsupported (`ok:false`) — cap prevents evidence
    > blobs from blowing the 65,535-byte record cap alongside 48 KB content;
  - quote > 200 chars or text > 500 chars → that claim `unsupported`;
  - `parseCritique` accepts only `{critiqueSummary: string ≤ 2000, proposedMarkdown: string, materialClaims: array ≤ 64 of {kind ∈ enum, text, quote?}}`, rejects extra keys / wrong types → `null`.
- [ ] **Step 3.2: implement.** `CRITIQUE_SCHEMA` (JSON Schema literal, `additionalProperties:false`,
      the seven-kind enum, maxLength/maxItems mirroring the parser); `parseCritique` = hand-rolled
      shape check (no ajv in the worker bundle); `verifyClaims` = for each claim: quote path
      (exact `String.prototype.includes` against each source, first match wins) else confirmation
      path else unsupported. Pure module — no kv access (callers pass `confirmationIds`).
- [ ] **Step 3.3:** tests pass. Commit:
      `feat(job-search): resume truth guard — quote/confirmation claim verification (#932)`.

### Task 4: worker scaffolding — `ai-port.ts`, `validate.ts`, `flow.ts`, handler wiring shell

**Files:** Create `src/worker/ai-port.ts`, `src/worker/validate.ts`,
`src/worker/handlers/flow.ts`; Modify `src/worker/index.ts`.
Test: `tests/unit/external-module-job-search-handlers-onboarding.test.ts` (flow half).
**Interfaces:** `WorkerPorts`, `STEP_ORDER`, `deriveStep`, `updateOnboarding`, `wrap` (below).

- [ ] **Step 4.1: failing tests** — `deriveStep({}) === "resume_intake"`;
      `deriveStep({resume_intake:true}) === "resume_critique"`; all six true → `"done"`;
      `updateOnboarding` creates the initial record on first call, merges `complete` flags
      monotonically (never unsets), stores derived `step`, persists approved revision ids, and
      round-trips through memory kv; unknown-key protection still enforced (JS-02
      `saveOnboardingState` guard is the write path).
- [ ] **Step 4.2: implement.**
  - `flow.ts`: uses `getOnboardingState`/`saveOnboardingState` from the barrel;
    `updateOnboarding` loads (or `{schemaVersion:1, step:"resume_intake", completed:{}}`),
    sets each `patch.complete` flag true, copies approved ids if given, recomputes `step`,
    saves, returns the new state.
  - `validate.ts`: `class InputError extends Error { code = "invalid_input" }`;
    `readString(input, key, {required?, maxBytes?})`, `readBool`, `readPlainObject`,
    `readEnum(input, key, values)` — errors name the key and the constraint only, never the
    value (pasted-content hygiene).
  - `ai-port.ts`: types per Core interfaces; `aiFromWorkerContext(ai)` returns an object whose
    `generateStructured` awaits and catches rejections → `{ok:false, error:"provider_error"}`.
  - `index.ts`: `wrap(handler)` catches `JobSearchKvError`/`InputError` →
    `{status:"error", code, message}` (messages are scrubbed by construction); everything
    else rethrows (→ generic `handler_failed` at the protocol layer). Build
    `ports(ctx) = { kv: kvFromWorkerContext(ctx.kv), ai: ctx.ai ? aiFromWorkerContext(ctx.ai) : null, now: () => new Date() }`
    — the `ctx.ai ?` guard is what makes Task 0 severable. Keep the four JS-05/06 handlers +
    `monitor.run` as `notImplemented`.
- [ ] **Step 4.3:** tests pass. Commit:
      `feat(job-search): worker ports, input validation, onboarding flow engine (#932)`.

### Task 5: `onboarding.get-state` handler

**Files:** Create `src/worker/handlers/onboarding.ts`; wire in `index.ts`.
Test: extend `tests/unit/external-module-job-search-handlers-onboarding.test.ts`.
**Interfaces:** produces `getStateHandler(ports)(input) → {status:"ok", step, completed, gates:{resumeApproved, profileApproved, monitorEnabled}, approvedResumeRevisionId?, approvedProfileRevisionId?}`.

- [ ] **Step 5.1: failing tests** — fresh kv → step `resume_intake`, all gates false; after
      seeding approved resume + profile + an enabled monitor (via domain functions) → all gates
      true; response JSON never contains resume/profile content (assert
      `JSON.stringify(result)` does not include seeded content markers).
- [ ] **Step 5.2: implement** — read state (or initial), gates via `getActiveResume` /
      `getActiveProfile` (non-null) and `listMonitorIds`→`getMonitor` any-enabled.
- [ ] **Step 5.3:** pass; commit `feat(job-search): onboarding.get-state tool (#932)`.

### Task 6: profile handlers

**Files:** Create `src/worker/handlers/profile.ts`; wire in `index.ts`.
Test: `tests/unit/external-module-job-search-handlers-profile.test.ts`.
**Interfaces:** `getProfileHandler`, `saveProfileDraftHandler`, `approveProfileHandler`.
Allowed field keys (module-design §profile): `targetTitles, adjacentTitles, industries,
seniority, skillsDemonstrated, skillsDeveloping, compensation, locations, remotePreference,
employmentTypes, needsSponsorship, mustHaves, dealbreakers, preferredCompanies,
excludedCompanies, narrative` (empty arrays = no preference).

- [ ] **Step 6.1: failing tests** —
  - save-draft with unknown field key → `{status:"error", code:"invalid_input"}` naming the
    key only;
  - save-draft returns deterministic `revisionId` (same fields+provenance → same id; retry
    idempotent);
  - approve of `provenance:"inferred"` → `{status:"question", …}` listing field NAMES, active
    pointer unchanged, onboarding `profile` flag unchanged (spec: inferred values inactive
    until confirmed);
  - re-save same fields with `provenance:"user"` then approve → active, onboarding
    `completed.profile === true`, `approvedProfileRevisionId` set;
  - get returns active revision + `draftRevisionIds` (ids only — no fields of non-active
    revisions in the response).
- [ ] **Step 6.2: implement** per Design notes (revision id
      `contentHash(\`profile\0${provenance}\0${canonicalJson(fields)}\`)`; approve reads the
revision via `readRecord(kv, NS.profile, keys.profileRevision(id))`, refuses inferred,
else `approveProfile`+`updateOnboarding({complete:["profile"], approvedProfileRevisionId})`).
- [ ] **Step 6.3:** pass; commit `feat(job-search): profile draft/approve tools with inferred-value gate (#932)`.

### Task 7: `resume.get` (+ diff projection)

**Files:** Create `src/worker/handlers/resume.ts` (get only in this task); wire in `index.ts`.
Test: `tests/unit/external-module-job-search-handlers-resume.test.ts`.
**Interfaces:** `getResumeHandler(ports)(input: {revisionId?, includeDiff?})`.

- [ ] **Step 7.1: failing tests** — no resume at all → `{status:"question"}` inviting paste;
      default read = active revision, falling back to revision `"0"` when nothing approved yet;
      explicit `revisionId`; `includeDiff:true` on a revision with a parent returns
      `diff: DiffHunk[]` where added/removed lines reconstruct parent→child; evidence array
      passed through verbatim.
- [ ] **Step 7.2: implement** (uses `getActiveResume`, `readRecord` +
      `keys.resumeRevision`, `diffLines`).
- [ ] **Step 7.3:** pass; commit `feat(job-search): resume.get with revision diff (#932)`.

### Task 8: `resume.save-draft` — manual + critique modes (the truth-guard seam)

**Files:** Extend `src/worker/handlers/resume.ts`; wire in `index.ts`.
Test: extend `tests/unit/external-module-job-search-handlers-resume.test.ts` with a fake
`JobSearchAi` (`{generateStructured: async () => canned}`).
**Interfaces:** `saveResumeDraftHandler(ports)(input: {mode, content?, parentRevisionId?, baseRevisionId?, instructions?, confirmedClaims?})`.

- [ ] **Step 8.1: failing tests — manual mode:**
  - first manual save (no revision `"0"`) writes the immutable original at `"0"` and marks
    `resume_intake` complete;
  - content of exactly 49_153 bytes → `{status:"error", code:"resume_input_too_large"}` with
    message EXACTLY `RESUME_TOO_LARGE_MESSAGE`, nothing persisted (memory-kv dump unchanged);
  - second manual save creates a markdown revision with deterministic id, parent defaulting
    to active-else-`"0"`;
  - `confirmedClaims:[{kind:"employer", text:"Acme Corp"}]` writes a confirmation record
    retrievable via `listConfirmationIds`.
- [ ] **Step 8.2: failing tests — critique mode:**
  - `ports.ai === null` → `{status:"question"}` mentioning AI is unavailable — and asserts the
    message contains NO provider names (regex `/anthropic|openai|claude|gpt|gemini/i`);
  - fake ai returns `{ok:false, error:"needs_config"}` → question, nothing persisted;
  - fake ai returns a critique whose claims all have exact quotes from revision `"0"` →
    markdown revision persisted with `evidence` all `sourced`, `resume_critique` marked
    complete, response `{status:"ok", revisionId, critiqueSummary, evidence}`;
  - **adversarial:** fake ai fabricates a claim (`kind:"metric"`, no quote, no confirmation)
    → `{status:"question", unsupportedClaims:[…]}` and the kv dump proves NOTHING was
    persisted; subsequent `resume.approve` of the (never-created) deterministic id fails
    `missing_revision` — an unsupported claim can never become the approved resume;
  - same fabricated claim AFTER the user confirms it (confirmation record saved via manual
    `confirmedClaims`) → persists with `confirmed` evidence;
  - fake ai returns shape garbage (`parseCritique → null`) → question, nothing persisted;
  - fake ai returns `proposedMarkdown` > 49_152 bytes → `resume_input_too_large` error path,
    nothing persisted.
- [ ] **Step 8.3: implement.** Manual: confirmations first, then original-or-revision write,
      then `updateOnboarding({complete:["resume_intake"]})`. Critique: require revision `"0"`
      (else question); sources = unique [revision "0", base, active]; prompt = fixed instruction
      block + base content + optional user `instructions` (≤ 2000 bytes via `readString`);
      `ai.generateStructured({schema: CRITIQUE_SCHEMA, prompt, maxOutputTokens: 16_384})`;
      `parseCritique` → `verifyClaims` → persist only on `ok`, else questions. The fixed
      instruction text tells the model: propose improvements in markdown, list every material
      claim (seven kinds) with an exact quote from the provided resume, and NEVER invent
      employers, roles, dates, skills, credentials, metrics, or outcomes.
- [ ] **Step 8.4:** pass; commit
      `feat(job-search): resume drafts — manual intake + truth-guarded AI critique (#932)`.

### Task 9: `resume.approve`

**Files:** Extend `src/worker/handlers/resume.ts`; wire in `index.ts`; extend resume handler tests.
**Interfaces:** `approveResumeHandler(ports)(input: {revisionId})`.

- [ ] **Step 9.1: failing tests** — approve existing revision → active pointer set,
      onboarding marks `resume_intake/resume_critique/resume_approval` complete +
      `approvedResumeRevisionId`; approve unknown id → `{status:"error", code:"missing_revision"}`;
      approving an OLDER revision later (backward movement) works and does not delete any
      revision or confirmation (dump: history intact).
- [ ] **Step 9.2: implement** (`approveResume` + `updateOnboarding`).
- [ ] **Step 9.3:** pass; commit `feat(job-search): resume approval checkpoint (#932)`.

### Task 10: monitor handlers + enable gate + six-checkpoint walkthrough

**Files:** Create `src/worker/handlers/monitor.ts`; wire in `index.ts`.
Test: `tests/unit/external-module-job-search-handlers-monitor.test.ts`; walkthrough +
leak-sweep tests in `…-handlers-onboarding.test.ts`.
**Interfaces:** `listMonitorsHandler`, `getMonitorHandler`, `saveMonitorHandler`.

- [ ] **Step 10.1: failing tests** —
  - save with `enabled:true` but no approved resume/profile → `{status:"question"}` naming
    what's missing, nothing persisted;
  - save disabled monitor → persisted, `sources_schedule` complete, `review_enable` NOT;
  - after approvals, save enabled → persisted, `review_enable` complete, step `"done"`;
  - update preserves `createdAt`, refreshes `updatedAt` (inject `now`);
  - `monitor.list` items have exactly `{monitorId, adapterId, enabled, createdAt, updatedAt}`
    (assert `Object.keys` — the `query` document never appears in list responses);
  - `monitor.get` returns full config + cursor timestamps only.
  - **Six-checkpoint walkthrough** (onboarding suite): fresh kv → paste resume → critique
    (fake ai, sourced claims) → approve resume → profile draft (user) → approve → save
    monitor → enable; after EVERY step, re-run `onboarding.get-state` on a fresh handler
    instance over the same kv (durable checkpoint resume — state lives in kv, not memory)
    and assert the derived step matches `STEP_ORDER` progression; then backward movement:
    new critique draft after enable → flags/pointers unchanged, history intact.
  - **Provider-leak sweep:** run every implemented handler across ok/question/error
    scenarios, assert `JSON.stringify(result)` never matches
    `/anthropic|openai|claude|gpt-|gemini|sonnet|opus/i`.
  - **Monitor jobs cannot edit resume/profile:** assert the wired handler map sends
    `monitor.run` to the `notImplemented` stub (import the handlers table from a small
    exported registry in `index.ts` — export `HANDLERS` for testability) and that
    `handlers/monitor.ts` has no import from `resume.ts`/`profile.ts`/`confirmations`.
- [ ] **Step 10.2: implement** per Design notes.
- [ ] **Step 10.3:** pass; commit
      `feat(job-search): monitor config tools with approval-gated enablement (#932)`.

### Task 11: manifest input schemas + manifest test

**Files:** Modify `external-modules/job-search/jarvis.module.json` (the 10 implemented tools
get `additionalProperties:false` schemas matching the handler inputs — mode/content/…
for `resume.save-draft` incl. the seven-kind `confirmedClaims` enum; `revisionId`/`includeDiff`
for `resume.get`; `fields`/`provenance` for `profile.save-draft`; `revisionId` for approvals;
`monitorId`/`adapterId`/`query`/`enabled` for `monitor.save`; `monitorId` required for
`monitor.get`; empty-object schemas stay for `onboarding.get-state`, `profile.get` gets
optional `revisionId`, `monitor.list` stays empty; the 3 JS-05/06 stubs keep `{"type":"object"}`).
Test: update `tests/unit/external-module-job-search-manifest.test.ts` expectations.

- [ ] **Step 11.1:** update manifest test to assert the tightened schemas (at minimum:
      every implemented tool has `additionalProperties === false`) → FAIL.
- [ ] **Step 11.2:** edit the manifest; `pnpm test:unit -- tests/unit/external-module-job-search-manifest.test.ts`
  - `…-bundle.test.ts` + `…-failclosed.test.ts` green.
- [ ] **Step 11.3:** commit `feat(job-search): strict tool input schemas (#932)`.

### Task 12: adversarial cross-owner integration proof

**Files:** Modify `tests/integration/external-module-job-search-kv-isolation.test.ts`.

- [ ] **Step 12.1:** following the file's existing JS-02 pattern (real rpc handlers per
      actor), add: user A writes resume revision `"0"`, a confirmation record, a profile
      revision + active pointer through A's rpc-backed kv; user B's rpc-backed kv `get`/`list`
      on `job-search.resume` / `job-search.profile` sees NONE of it (null/empty); B's
      `resume.get` handler over B's kv returns the "no resume yet" question, never A's content;
      admin actor (isActorAdmin true) STILL cannot read A's user-scoped records (no admin
      private-data bypass).
- [ ] **Step 12.2:** run `pnpm test:integration -- tests/integration/external-module-job-search-kv-isolation.test.ts`
      green (should pass immediately if JS-02 isolation holds — the point is the adversarial
      proof for THIS slice's record families on the record). Commit:
      `test(job-search): cross-owner isolation proof for onboarding/resume/profile records (#932)`.

### Task 13: full gate + wrap-up entry

- [ ] `pnpm verify:foundation` (full local gate) — record exit code.
- [ ] Targeted suites: `pnpm test:unit -- tests/unit/external-module-job-search-* tests/unit/module-sdk-worker.test.ts`,
      `pnpm test:integration -- tests/integration/module-worker-rpc.test.ts tests/integration/external-module-job-search-kv-isolation.test.ts`.
- [ ] Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`;
      `git fetch origin main && git rebase origin/main`.
- [ ] Invoke `coordinated-wrap-up` (PR body: release-note summary; `Closes #932`).

## Self-review (done)

- **Spec coverage:** state machine ✔ (Tasks 4/5/8/9/10 walkthrough), truth guard ✔ (3/8),
  size/revision/provenance/diff invariants ✔ (7/8, JS-02 reuse), approval transitions ✔
  (6/9/10), unsupported-claim-cannot-be-approved adversarial ✔ (8), inferred-inactive ✔ (6),
  write-confirm+audit ✔ (gateway host-side, unchanged; risk flags already in manifest),
  list-no-leak ✔ (10), no monitor-job edits ✔ (10), durable checkpoint resume ✔ (10),
  provider-name absence ✔ (0/8/10), non-goals untouched ✔.
- **Placeholders:** none; every step names files, code, commands.
- **Type consistency:** `ResumeEvidence`/`MaterialClaim` defined once in `truth-guard.ts`;
  handler factory signature uniform; `ExternalModuleAiRequest/Result` shared host-side names.
