## Phase 21 — Module module-sdk

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 0
- MED: 3
- LOW: 4
- INFO: 3

### Findings

The package is a single 142-line, dependency-free type-declaration file
(`packages/module-sdk/src/index.ts`) plus a 12-line `package.json`. There is no `sql/`
directory and no runtime code, so review dimensions A (RLS/secrets/injection), E
(error handling), F (job payloads at runtime), and G (tests) have no executable surface
*inside* this package. The findings below concern the **contract** the SDK defines and
the invariants it implicitly promises but cannot enforce. Where a concern is really a
consumer-side gap, it is filed against the SDK because the type/field that invites the
gap lives here.

#### [MED] `metadataOnly` is a declared-but-unenforced attestation that gives false safety
**File:** `packages/module-sdk/src/index.ts:68`  
**Invariant violated / concern:** Hard invariant #6 (Metadata-only job payloads) — `ModuleJobManifest.metadataOnly?: boolean`.  
**Detail:** The SDK invites a module to *self-declare* that its pg-boss payload is metadata-only. A grep across `packages/**` shows the flag is set in two manifests (`packages/briefings/src/manifest.ts:128`, `packages/tasks/src/manifest.ts:223`) but is **read by nothing** — no registrar, no job enqueuer, no validator inspects it. An optional boolean that defaults `undefined` and is never checked is worse than no field: it reads as a satisfied invariant in code review while providing zero runtime or build-time guarantee. The metadata-only rule (a CRIT-class invariant) is therefore enforced entirely by convention at each enqueue site, not by the contract that pretends to model it.  
**Suggested fix:** Either (a) delete the field and enforce metadata-only at the enqueue boundary in `@jarv1s/jobs`, or (b) make it load-bearing — have the module registrar reject/flag any `jobs[]` entry lacking `metadataOnly: true` and (preferably) validate enqueued payloads against `payloadSchema` at the enqueue chokepoint. As-is it is decorative.

#### [MED] Declarative manifest fields (`payloadSchema`, `requestSchema`, `responseSchema`, `ownedTables`, `shareableResources`, `grantLevels`) are inert — no validator consumes them
**File:** `packages/module-sdk/src/index.ts:50-75` (`ModuleDatabaseManifest`, `ModuleRouteManifest`, `ModuleJobManifest`, `ModuleShareableResourceManifest`)  
**Invariant violated / concern:** Quality bar — "thin/identity abstractions"; incidental complexity preserved where a simpler model could delete it. Also touches invariants #2/#9 (sharing & module isolation) which these fields *appear* to model but do not enforce.  
**Detail:** A grep of the whole repo (excluding the manifests that *write* them and this index file) shows zero readers for `payloadSchema`, `requestSchema`, `responseSchema`, `ownedTables`, `shareableResources`, and `grantLevels`. There is no manifest validator anywhere (`module-registry` statically lists first-party manifests and never inspects these fields). The SDK thus carries a sizeable schema surface that documents intent but binds nothing: `ownedTables` does not gate which tables a module's RLS/migrations touch; `shareableResources`/`grantLevels` do not feed the sharing layer (`packages/db/src/sharing/`); route/job schemas do not drive validation (input validation is hand-rolled in `packages/ai/src/gateway/input-validation.ts` and reads only `assistantTools[].inputSchema`). This is a contract larger than its enforcement — exactly the "model bigger than the behavior" smell.  
**Suggested fix:** For each field, either wire a single consumer (e.g. registrar asserts migrations only create tables in `ownedTables`; sharing layer derives allowed grant levels from `shareableResources`) or remove it until the milestone that needs it ships. Keep the contract no wider than the enforcement.

#### [MED] `JsonSchema` is `Record<string, unknown>`, so every schema field is structurally `any` to consumers
**File:** `packages/module-sdk/src/index.ts:6-8`  
**Invariant violated / concern:** Quality/TypeScript bar — "cast-heavy contracts that obscure the real invariant"; unnecessary `unknown` muddying the contract.  
**Detail:** `JsonSchema` is `{ readonly [key: string]: unknown }`. It carries no shape, so every consumer that actually needs the schema must re-narrow by hand with unchecked casts. `packages/ai/src/gateway/input-validation.ts:32,39` does exactly this: `schema.required as string[]` and `(schema.properties ?? {}) as Record<string, { type?: string }>` — assertions with no runtime backstop. Because the public type promises nothing, the cast burden is pushed onto every reader and the "what fields exist on a schema" invariant is encoded informally in each consumer rather than once in the SDK.  
**Suggested fix:** Define a minimal structural `JsonSchema` (`type?`, `properties?`, `required?`, `items?`) — even a small closed interface eliminates the casts in `input-validation.ts` and documents the only subset the validator honors. If a full JSON-Schema type is overkill, narrow to the subset actually validated.

#### [LOW] `ToolResult.data` / `ToolInput` typed as open `Record<string, unknown>` — no per-tool contract
**File:** `packages/module-sdk/src/index.ts:10,18-20,29-33`  
**Invariant violated / concern:** Quality/TypeScript bar — open `unknown` contracts at the public boundary.  
**Detail:** `ToolInput = Record<string, unknown>` and `ToolResult.data: Record<string, unknown>` mean the SDK's central execution contract (`ToolExecute`) is untyped on both ends. Every tool implementation re-narrows input by hand (e.g. `packages/tasks/src/tools.ts:24` casts `input as { listId?: string; ... }`) and produces unchecked `data`. There is no generic seam (e.g. `ToolExecute<I, O>`) letting a module bind its own input/output types while staying erasable across the module→sdk boundary. The result: input validation correctness depends on a hand-cast at each call site matching the hand-written `inputSchema` JSON — two sources of truth with nothing tying them together.  
**Suggested fix:** Introduce generics `ToolExecute<TInput extends ToolInput = ToolInput, TData extends Record<string, unknown> = Record<string, unknown>>` and `ToolResult<TData>` so modules can opt into typed handlers without adding a runtime dependency. At minimum, document that the cast at the handler boundary must mirror `inputSchema`.

#### [LOW] `ToolExecute.scopedDb: unknown` leaks the DataContextDb-only invariant out of the type system
**File:** `packages/module-sdk/src/index.ts:22-33`  
**Invariant violated / concern:** Hard invariant #3 (DataContextDb only) — relies on a runtime guard instead of the type.  
**Detail:** `scopedDb` is `unknown` to avoid a `module-sdk → db` dependency (the comment explains this). The gateway passes a real `DataContextDb` (`packages/ai/src/gateway/gateway.ts:95`), and every handler re-establishes the invariant via `assertDataContextDb(scopedDb)` (verified present in all four `tools.ts` files: tasks/email/calendar/notifications). This works, but the DataContextDb-only invariant — a CRIT-class rule — is enforced only by a discipline that each handler must remember to call. A handler that forgets `assertDataContextDb` and casts directly would compile cleanly and silently accept a raw Kysely. The type system provides no help precisely where invariant #3 lives.  
**Suggested fix:** Acceptable given the deliberate no-`db`-dep design, but harden it: ship the branded `DataContextDb` type from a tiny zero-runtime types package (or re-export the brand) so `ToolExecute` can name the type without importing db runtime; alternatively make `assertDataContextDb` the only sanctioned entry and lint for handlers that touch `scopedDb` before asserting.

#### [LOW] No manifest validation seam — IDs, permissions, and capabilities are self-asserted with no uniqueness/scope check
**File:** `packages/module-sdk/src/index.ts:77-142` (`ModulePermissionManifest`, `JarvisModuleManifest`)  
**Invariant violated / concern:** Invariant #9 (module isolation) + #2 (private by default) — a manifest can declare arbitrary `permissions`, `assistantTools`, and `scope` with nothing checking them.  
**Detail:** The audit prompt flags "self-registration with arbitrary capabilities." Today all modules are first-party and statically enumerated in `packages/module-registry/src/index.ts:95` (`BUILT_IN_MODULES`), so the blast radius is limited — there is no third-party load path. But the SDK ships the *shape* for arbitrary capability declaration (any module may declare `permissions[].scope: "admin"|"system"`, any `assistantTools[].risk`, any `permissionId` string) and the registrar performs **no** validation: no duplicate-`id` check across modules, no check that `assistantTools[].permissionId` references a declared permission, no check that a tool's `permissionId` belongs to the declaring module. The gateway (`gateway.ts:172-197`) trusts `module.assistantTools` verbatim. If/when a non-built-in load path is added, this contract permits silent capability/permission-ID collisions and cross-module permission references.  
**Suggested fix:** Add a `validateManifest`/`validateModuleSet` function (in module-registry or a sibling) invoked at boot: assert unique module/permission/tool/route IDs, assert every `permissionId`/`featureFlagId` reference resolves to a declaration in the same manifest, and assert `assistantTools[].risk`/`scope` are within policy. File the seam now so the third-party path can't ship without it.

#### [LOW] `ToolContext` duplicates `AccessContext` plus a `chatSessionId` field with documented Phase-2-temporary semantics
**File:** `packages/module-sdk/src/index.ts:12-16`  
**Invariant violated / concern:** Invariant #4 (AccessContext shape is exactly `{ actorUserId, requestId }`) — adjacent contract drift; quality smell (parallel near-duplicate type).  
**Detail:** `ToolContext` is `{ actorUserId, requestId, chatSessionId }` — i.e. `AccessContext` + one field. The gateway constructs an `AccessContext` by *dropping* `chatSessionId` (`gateway.ts:93,110`) before `withDataContext`, which is correct and keeps invariant #4 intact at the db boundary. But the SDK now defines a second "actor context" shape that consumers must not confuse with `AccessContext`. `chatSessionId` carries documented temporary semantics — `packages/chat/src/gateway-notifier.ts:7` notes "In Phase 2, chatSessionId === actorUserId" — and `packages/ai/src/routes.ts:421` passes `chatSessionId: ""` as a placeholder, signaling the field is not always meaningful. A field that is sometimes empty and equals another field "for now" is latent incidental complexity.  
**Suggested fix:** Keep `ToolContext` distinct from `AccessContext` (correct that they don't share a type), but make `chatSessionId` honest: either mark it clearly optional with a doc comment that handlers must not depend on it for identity (identity = `actorUserId` only), or, if no handler reads it, drop it from `ToolContext` and pass session routing through the notifier path instead of the tool contract. Re-evaluate at the multi-session milestone.

#### [INFO] Package is a clean, dependency-free type contract — reviewed and structurally sound
**File:** `packages/module-sdk/src/index.ts:1-142`  
**Invariant violated / concern:** None — positive note.  
**Detail:** All 142 lines are `type`/`interface` declarations with `readonly` members and union literals; no runtime code, no `any`, no non-null assertions, no node:* imports, no `db`/vault dependency. Well under the 1000-line limit. The deliberate no-`db`-dependency design (scopedDb as `unknown`, narrowed by `assertDataContextDb` downstream) is a reasonable layering choice that keeps the SDK importable by the browser-bundled and worker contexts alike. The structural concerns above are about *under-specification* (open records, inert attestations), not unsoundness in what is declared.  
**Suggested fix:** None. Address the MED/LOW under-specification items as the module system grows beyond first-party.

#### [INFO] No `sql/` directory and no executable surface — dimensions A/E/F/G N/A inside this package
**File:** `packages/module-sdk/` (package root)  
**Invariant violated / concern:** None — scope note.  
**Detail:** There is no `packages/module-sdk/sql/` directory and the only source file is the type index. Migration invariant #11, RLS holes, secret exposure, error-handling, and test coverage have no in-package surface; the runtime behaviors those dimensions cover live in the *consumers* (`packages/ai/src/gateway/*`, `packages/module-registry`, each module's `tools.ts`/`repository.ts`) and are in scope for their respective phases. Reviewed and confirmed empty here.  
**Suggested fix:** None.

#### [INFO] `package.json` exports raw TS (`./src/index.ts`) with no build step — intentional monorepo convention
**File:** `packages/module-sdk/package.json:6-8`  
**Invariant violated / concern:** None — convention note.  
**Detail:** The package `exports` point directly at `./src/index.ts` (type-only, consumed via `import type`), so no compiled output ships. Consistent with the workspace's TS-path approach and harmless for a types-only package. Flagged only so a future reader doesn't assume a missing build.  
**Suggested fix:** None.
