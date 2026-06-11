## Phase 28 — Standards Compliance Sweep

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 2
- LOW: 4
- INFO: 5

### Findings

This phase ran mechanical, repo-wide compliance checks (file-size, forbidden patterns, module
isolation, dead exports, debt inventory) across `packages/`, `apps/`, `scripts/`, and `infra/`
(excluding `node_modules`, `dist`, `*.d.ts`). The codebase is unusually clean on the mechanical
bar: zero files over the 1000-line limit, zero `as any`, zero `BYPASSRLS`, zero raw `require(`,
zero cross-module internal imports, and effectively zero stray `console` calls. The findings below
are the residual smells worth recording, ordered most-severe first.

#### [MED] Duplicated `JARVIS_CHAT_HOME` resolution helper across two chat modules
**File:** `packages/chat/src/live/persona.ts:46`  
**Invariant violated / concern:** Bespoke helper duplicating logic (DEVELOPMENT_STANDARDS — duplicate helpers / single source of truth for env resolution).  
**Detail:** The chat-home base-directory resolution
`process.env.JARVIS_CHAT_HOME ?? join(homedir(), ".jarvis", "chat")` is implemented identically in
both `packages/chat/src/live/persona.ts:46` and `packages/chat/src/live/runtime.ts:105`. This is the
canonical on-disk location for per-user chat transcripts, so two divergent copies is a real drift
risk: if one is updated (e.g. to namespace by user or relocate under a data root) the other silently
disagrees, and the transcript-dir dash-encoding gotcha already recorded in memory makes a split path
contract especially dangerous. There is no `chat`-package config/env module — both modules read
`process.env` directly.  
**Suggested fix:** Extract a single `resolveChatHome()` (and any related env reads) into one small
`packages/chat/src/live/chat-home.ts` (or a chat-local `config.ts`), export it, and have both
`persona.ts` and `runtime.ts` consume it. Keep `process.env` reads confined to that module.

#### [MED] `tokens!` / `gateway!` non-null assertions in chat routes obscure the real wiring invariant
**File:** `packages/chat/src/routes.ts:93`  
**Invariant violated / concern:** Unjustified non-null assertions muddying the real contract (DEVELOPMENT_STANDARDS — TypeScript soundness / no `!`).  
**Detail:** `tokens` and `gateway` are declared `let … : T | undefined` and only assigned inside the
`if (dependencies.resolveActiveModules && dependencies.mcpServerUrl)` block (lines 65–82). They are
then force-asserted non-null at `routes.ts:93`, `:96` (`tokens!`) and `:126` (`gateway!`). The
assertions happen to be reached only when the same guard is true (the `tokens && mcpServerUrl` ternary
and the `if (gateway && tokens)` block), so they are not actual bugs — but TS cannot narrow `let`
bindings across the closures/blocks, so the `!` is papering over a structural smell: the
"either all three of {tokens, gateway, confirmations} exist or none do" invariant is expressed as
three independent optionals plus four `!` escapes rather than as one object.  
**Suggested fix:** Make the gateway wiring a single nullable bundle —
`const wiring = (resolveActiveModules && mcpServerUrl) ? { tokens, gateway, mcpServerUrl } : null;`
— so a single truthy check narrows all members and the `!` operators disappear. This is a behavior-
preserving code-judo move that deletes four assertions and the proxy-notifier ordering comment becomes
local to the bundle.

#### [LOW] `process.env` read inside `module-registry` rather than a config seam
**File:** `packages/module-registry/src/index.ts:149`  
**Invariant violated / concern:** Config/env access leaking into feature/infrastructure code (DEVELOPMENT_STANDARDS — env reads belong in config modules).  
**Detail:** The MCP server URL is assembled inline as
`http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp`. This duplicates the API server's own port
resolution and hardcodes both the loopback host and the `/api/mcp` path. If the API port default or
the MCP mount path ever changes, the registry's advertised URL drifts from reality. There is no
`module-registry` config module; the read is buried in feature logic.  
**Suggested fix:** Inject the resolved `mcpServerUrl` from the API server's composition root (it
already computes its own port) rather than re-deriving it from `process.env.PORT` here.

#### [LOW] `process.env` rate-limit knobs read inline in connectors routes
**File:** `packages/connectors/src/routes.ts:79`  
**Invariant violated / concern:** Env access scattered into route handlers instead of a config seam (DEVELOPMENT_STANDARDS — incidental complexity / config locality).  
**Detail:** `const oauthMax = Number(process.env.JARVIS_RL_OAUTH_MAX ?? 5);` reads and parses an env
var directly inside the route module. `Number(undefined-or-garbage)` yields `NaN` for a malformed
value, which would silently disable the rate limit rather than fall back to `5`. Same pattern risk
applies to any sibling `JARVIS_RL_*` knobs.  
**Suggested fix:** Centralize rate-limit config parsing in one place with explicit `NaN`/bounds
validation (clamp to a sane default on parse failure), and pass typed numbers into the routes.

#### [LOW] `as unknown as Record<string, unknown>` casts in payload metadata guards
**File:** `packages/tasks/src/jobs.ts:73`  
**Invariant violated / concern:** Cast-heavy contract obscuring the real type (DEVELOPMENT_STANDARDS — structural soundness).  
**Detail:** The metadata-only payload guards are invoked as
`isDeferredTaskStatusPayloadMetadataOnly(job.data as unknown as Record<string, unknown>)` —
repeated at `packages/tasks/src/routes.ts:265`, `packages/briefings/src/jobs.ts:72`, and
`packages/briefings/src/routes.ts:132`. The double `as unknown as` cast defeats type checking at
exactly the boundary (pg-boss payload validation) where the metadata-only invariant — a hard
invariant — is enforced. The guard functions are presumably typed `(payload: Record<string, unknown>)`,
so callers launder typed payloads through `unknown` to satisfy them.  
**Suggested fix:** Type the guard parameters as `(payload: unknown)` (a type guard's job is to narrow
from `unknown`), eliminating the `as unknown as Record<…>` at all four call sites. This is the correct
shape for a runtime validator and removes the casts without changing behavior.

#### [LOW] `tasks/src/recurrence.ts` double-casts the recurrence column through `unknown`
**File:** `packages/tasks/src/recurrence.ts:78`  
**Invariant violated / concern:** Cast-heavy contract hiding a JSON-column shape mismatch (DEVELOPMENT_STANDARDS — TypeScript soundness).  
**Detail:** `const spec = task.recurrence as unknown as RecurrenceSpec;` (line 78) and the inverse
`nextRecurrence as unknown as Record<string, unknown>` (line 116) launder the recurrence JSONB column
between its DB column type and `RecurrenceSpec` with no runtime validation. If a malformed
`recurrence` row exists (or the spec shape evolves), the cast hides it and downstream code operates on
an unchecked shape.  
**Suggested fix:** Parse/validate the recurrence JSON into `RecurrenceSpec` once at the boundary
(narrow from `unknown` via a small guard or schema), and store back through a typed serializer, so
the two `as unknown as` casts collapse into one validated conversion.

#### [INFO] File-size check: clean — no source file exceeds 1000 lines
**File:** `scripts/check-file-size.ts:4`  
**Invariant violated / concern:** None (DEVELOPMENT_STANDARDS — 1000-line ceiling, enforced).  
**Detail:** `wc -l` over all non-`d.ts` `*.ts`/`*.tsx` under `packages/`, `apps/`, `scripts/`
produced zero files over 1000 lines. The largest source files are
`packages/ai/src/routes.ts` (790), `packages/shared/src/ai-api.ts` (714),
`packages/tasks/src/routes.ts` (619), `packages/shared/src/platform-api.ts` (619),
`packages/shared/src/tasks-api.ts` (614), and `packages/settings/src/routes.ts` (550). All comfortably
under the limit; the gate (`maxLines` default 1000, overridable via `JARVIS_MAX_SOURCE_LINES`) has
nothing to flag. Worth keeping an eye on `ai/src/routes.ts` and `ai-api.ts` as they approach the bar.

#### [INFO] Forbidden-pattern scan: clean on `BYPASSRLS`, `as any`, `@ts-ignore`, raw `require(`
**File:** `infra/postgres/bootstrap/0000_roles.sql:35`  
**Invariant violated / concern:** None — confirms Hard Invariant 1 (no BYPASSRLS) and TS quality rules.  
**Detail:** (1) `BYPASSRLS` appears only as the safe negated form `NOBYPASSRLS` in
`infra/postgres/bootstrap/0000_roles.sql` (lines 35, 43, 51, 59) and the auth-rls-safety spike — no
runtime role is ever granted BYPASSRLS. (2) Zero `as any` across the entire tree (0 occurrences,
0 files). (3) Exactly one `@ts-expect-error`, at
`tests/integration/tasks-web-contract.test.ts:12`, with an inline same-line justification
("in_progress is no longer assignable to TaskApiStatus") — this is the correct usage. (4) Zero raw
`require(` in TS source.

#### [INFO] Console usage: clean — only the worker entrypoint logs to console
**File:** `apps/worker/src/worker.ts:38`  
**Invariant violated / concern:** None (DEVELOPMENT_STANDARDS — no stray console in library code).  
**Detail:** The only non-test `console.*` calls are the worker process bootstrap banner
(`apps/worker/src/worker.ts:38`) and a fatal-startup `console.error` (`:53`). Both are legitimate
process-entrypoint logging, not library-internal logging. No `console.*` leaked into any `packages/*`
library module.

#### [INFO] Module isolation: clean — no cross-module internal imports
**File:** `packages/chat/src/routes.ts:4`  
**Invariant violated / concern:** None — confirms Hard Invariant 9 (module isolation).  
**Detail:** Grep for cross-module deep imports
(`packages/X/src/{internal,repositories,repos}` and relative `../*/src/*` reaches across packages)
returned zero hits. Modules import siblings only through package entrypoints (e.g. chat imports
`@jarv1s/ai`, `@jarv1s/memory`, `@jarv1s/db`, `@jarv1s/shared` by package name at
`packages/chat/src/routes.ts:4-15`), never another module's source internals. `new Kysely` appears
only in the canonical `packages/db/src/database.ts:15` (plus the spike), confirming Hard Invariant 3
(no root Kysely outside the data-context layer).

#### [INFO] Dead-export spot check & TODO/debt inventory
**File:** `packages/chat/src/jobs.ts:109`  
**Invariant violated / concern:** None (known-debt inventory).  
**Detail:** Spot-checked exports are live: `StubEmbeddingProvider` is exported from
`packages/memory/src/embedding-provider.ts`, re-exported via `packages/memory/src/index.ts`, selected
in `embedding-provider-config.ts`, and consumed by `tests/integration/memory.test.ts` — not dead
(it is the documented test/opt-out provider). The entire repo-wide `TODO|FIXME|HACK|XXX` inventory
across non-test source is a single entry:
`packages/chat/src/jobs.ts:109` — `// TODO(phase3-facts): call capability router to extract structured
facts`. This is correctly scoped to a future phase (Phase 3 structured-facts) and is the only tracked
inline debt marker in the codebase.
