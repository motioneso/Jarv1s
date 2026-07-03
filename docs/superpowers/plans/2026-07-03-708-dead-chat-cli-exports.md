# Plan — #708 dead chat / cli-runner / module-registry exports

**Spec:** GitHub issue #708 (from `docs/audits/2026-07-02-dead-code-audit.md`).
**Risk tier:** `routine`. **Branch:** `coord/708-dead-chat-cli-exports` at `origin/main` `80bad5eb`.
**Goal:** Re-confirm zero-consumer findings and trim dead exports. Prefer **un-export / inline** over
delete where the implementation is live internally; **delete** only true orphans.

## Re-confirmation (grounded on current tree)

Every finding was re-grep'd on `coord/708-dead-chat-cli-exports` at `80bad5eb`. All premises hold —
no drift since the audit.

## Tasks (one commit each, green per commit)

### Task 1 — chat: drop zero-reference orphan types + function

**File:** `packages/chat/src/live/types.ts`

- **Delete** `export interface ChatTurnSeed { … }` (zero references anywhere; not barrel-exported).

**File:** `packages/chat/src/live/install-contract.ts`

- **Delete** `export interface RpcInstallProgress { … }` + its JSDoc block (zero references; reserved
  future frame shape that never landed; not in the barrel — only `ProviderCatalog`, `CatalogEntry`,
  `InstallRecipe`, `RpcInstallProvider*` are re-exported).

**File:** `packages/chat/src/live/answer-provenance.ts`

- **Delete** `export function renderContextLineWithSupportId(…)` (zero callers; not barrel-exported).
  Keep `supportIdForIndex` for Task 3.
- **Un-export** `supportIdForIndex` (Task 3).

### Task 2 — chat: un-export same-file-only helpers

- `packages/chat/src/jobs.ts`: **drop `export`** from `handleEmbedTurnJob` (only same-file call at
  `jobs.ts:321`; `export *` re-exports it through the barrel but no external consumer imports it).
- `packages/chat/src/live/runtime.ts`: **drop `export`** from `createRpcEngineFactory` (only same-file
  call at `runtime.ts:182`; `export *` re-exports it but no external consumer imports it).
- `packages/chat/src/live/answer-provenance.ts`: **drop `export`** from `supportIdForIndex` (only
  same-file callers at lines 107, 160; not barrel-exported).

### Task 3 — chat: un-export self-only `CHAT_MODULE_ID`

**File:** `packages/chat/src/manifest.ts`

- `CHAT_MODULE_ID` is consumed only at `manifest.ts:16` (same file). It IS re-exported via
  `export *` (barrel line 73), but no external consumer imports it.
- **Action:** drop `export` from `const CHAT_MODULE_ID`. (Inline not needed — single self-use of a
  named const is clearer than a magic string; just make it module-private.)

### Task 4 — cli-runner: un-export same-file-only symbols

- `packages/cli-runner/src/uid-allocator.ts`: **drop `export`** from `interface UidSlot` (only used as
  the return type of `allocateUidSlot` in the same file; `allocateUidSlot` is imported by
  `engine-host.ts` but `UidSlot` itself is never imported anywhere).

- `packages/cli-runner/src/catalog.ts`: **drop `export`** from `function loadCatalog` (only same-file
  call at `catalog.ts:341`; not in the barrel — only `PROVIDER_CATALOG` +
  `CATALOG_VALIDATION_ISSUES` are re-exported).

### Task 5 — cli-runner: trim dead barrel re-exports

**File:** `packages/cli-runner/src/index.ts`

External consumers of `@jarv1s/cli-runner` import only `LOGIN_ADAPTERS` (onboarding-login.ts) and
`PROVIDER_CATALOG` (onboarding-install.ts). The following barrel re-exports have **zero external
consumers** (confirmed via repo-wide grep incl. `*.test.ts`):

- `NotLaunchedError` (from engine-host.js) — used only inside engine-host.ts.
- `newNonce` (from hello.js) — used only inside hello.ts.
- `Mutex` (from mutex.js) — used only via relative imports inside cli-runner (engine-host.ts,
  install-service.ts).
- `readConfig`, `createCliRunner` (from main.js) — no external import.
- `LOGIN_ADAPTER_ISSUES` (from login-adapters.js) — `LOGIN_ADAPTERS` + `loadLoginAdapters` +
  `LoginAdapterIssue` type stay; only `LOGIN_ADAPTER_ISSUES` is dead externally.

**Action:** remove only these six names from `index.ts`. Keep their source-file `export`s (internal
relative imports across cli-runner files rely on them). Do **not** touch live relative imports.

### Task 6 — module-registry: un-export same-file type

**File:** `packages/module-registry/src/route-guard.ts`

- `interface RouteCoverageInput` is only used as the param type of `assertRouteCoverage` in the same
  file. It is NOT in the module-registry barrel (only `assertRouteCoverage` + others are). External
  callers pass object literals and let TS infer.
- **Action:** drop `export` from `interface RouteCoverageInput`.

## Verification

After all edits, run focused gate:

```bash
pnpm --filter @jarv1s/chat typecheck
pnpm --filter @jarv1s/cli-runner typecheck
pnpm --filter @jarv1s/module-registry typecheck
pnpm vitest run packages/chat packages/cli-runner packages/module-registry tests/unit/route-guard-index.test.ts
pnpm typecheck   # whole-repo catch-all
```

If typecheck reveals an external consumer the audit missed, restore that one symbol and note it.

## Out of scope

- No behavior change. No migration. No barrel for non-flagged symbols. No `docs/coordination/` edits
  from this branch (collision note).
