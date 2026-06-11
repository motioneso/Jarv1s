## Phase 7 — Module vault

### CRIT / HIGH / MED / LOW / INFO counts

- CRIT: 0
- HIGH: 2
- MED: 2
- LOW: 3
- INFO: 2

### Findings

#### [HIGH] `withVaultContext` never validates `actorUserId` before joining it into the vault root
**File:** `packages/vault/src/vault-context.ts:31`  
**Invariant violated / concern:** Hard invariant #2 (Private by default — owner-only, no cross-user access). The sibling `DataContextRunner.withDataContext` explicitly guards `if (!accessContext.actorUserId) throw` (`packages/db/src/data-context.ts:26`); the vault runner does not.  
**Detail:** `const vaultRoot = join(this.vaultsBaseDir, accessContext.actorUserId)` is computed from an unvalidated, untrusted-shaped string. If `actorUserId` is `""`, `join("/data/vaults", "")` collapses to the shared base dir `/data/vaults` — the resulting `VaultContext` is rooted at the parent of every user's vault, so `resolveVaultPath` (which only forbids escaping `vaultRoot`) now treats `alice/secret.md`, `bob/secret.md` as in-bounds. If `actorUserId` contains path separators or `..` (e.g. `../bob`), the vault root is silently relocated into or past another user's tree. `resolveVaultPath`'s containment check is computed against this already-poisoned root, so it provides no protection here. Today the upstream contract is that `actorUserId` is a UUID, but the vault layer is the security boundary for files and must not assume that — the DB layer does not.  
**Suggested fix:** Mirror the DB runner: reject empty `actorUserId`, and additionally validate it against a strict format (UUID regex, or at minimum reject any value where `basename(actorUserId) !== actorUserId` / containing `/`, `\`, `..`, or NUL). After computing `vaultRoot`, assert `resolve(vaultRoot)` is a direct child of `resolve(this.vaultsBaseDir)` before any `mkdir`.

#### [HIGH] Path containment is lexical (`resolve`), so symlinks inside a vault can escape it
**File:** `packages/vault/src/vault-path.ts:15-22`  
**Invariant violated / concern:** Hard invariant #2 (Private by default) and the path-traversal concern called out for this module. Decrypt/cross-user leak via filesystem.  
**Detail:** `resolveVaultPath` uses `path.resolve` + a string-prefix check, which is purely lexical and does not follow symlinks. If any symlink exists inside a user's vault (created by a prior bug, a restore from backup, an attacker who can write to the vault dir, or a module that one day calls a not-yet-existing `symlink` op), `readVaultFile`/`writeVaultFile`/`deleteVaultFile` will resolve it at the OS level and read/write/delete *through* it — e.g. `notes/escape -> ../../bob` passes the lexical check because `notes/escape` is under root, but the underlying `readFile` follows it to bob's vault. The same applies to `listVaultFilesRecursive`/`collectFilesRecursive`, which traverse symlinked directories.  
**Suggested fix:** Resolve symlinks before the containment check (`fs.realpath` on the parent dir for writes, on the target for reads), or open with `O_NOFOLLOW`/pass `{ withFileTypes: true }` and skip symlink entries in directory walks (`entry.isSymbolicLink()` → ignore or reject). At minimum, `collectFilesRecursive` should refuse to descend into symlinked directories.

#### [MED] `assertVaultContext` is dead code — the brand is never enforced at any op boundary
**File:** `packages/vault/src/vault-context.ts:14-22`, re-exported `packages/vault/src/index.ts:2`  
**Invariant violated / concern:** Identity-abstraction / thin-wrapper smell (Development Standards); the branded type gives a false sense of a runtime guarantee that does not exist.  
**Detail:** `assertVaultContext` exists to prove a value was minted by `withVaultContext`, but no op (`readVaultFile`, `writeVaultFile`, etc. in `vault-ops.ts`) ever calls it — they only read `ctx.vaultRoot`. The `unique symbol` brand is therefore purely a compile-time hint; at runtime any object literal `{ vaultRoot, actorUserId }` (or a hand-rolled root pointing anywhere) is accepted. The "DataContextDb only / VaultContext for all I/O" invariant relies on the brand being load-bearing, but here it is decorative. Either the assertion should run on every op (cheap), or the dead export should be removed to stop implying a guarantee that isn't enforced.  
**Suggested fix:** Call `assertVaultContext(ctx)` at the top of each op in `vault-ops.ts` (one line each), making the brand actually unforgeable at the boundary. If runtime enforcement is deemed unnecessary, delete `assertVaultContext` rather than ship an unused guard.

#### [MED] `writeVaultFile` does not set an explicit file mode — written notes inherit process umask
**File:** `packages/vault/src/vault-ops.ts:18-19`  
**Invariant violated / concern:** Private-by-default at the filesystem layer; inconsistent with the deliberate `0o700` on every directory in this module.  
**Detail:** Directories are created `mode: 0o700` (`vault-ops.ts:18,46`, `vault-context.ts:32`), but the file write itself (`writeFile(fullPath, content, "utf8")`) passes no `mode`, so the file lands at `0o666 & ~umask` — typically `0o644`, world-readable. On a single-tenant host the `0o700` parent dir mitigates this, but the protection is then entirely dependent on the parent perm and breaks if a vault dir is ever served, copied, or backed up with looser dir perms. The intent throughout the module is owner-only; the file mode should match.  
**Suggested fix:** Pass `{ mode: 0o600 }` to `writeFile` (and consider `0o600` consistency across reads/restores). Add a test asserting written-file mode like the existing `0o700` dir-mode tests.

#### [LOW] Vault stores plaintext on disk — no encryption-at-rest for note content
**File:** `packages/vault/src/vault-ops.ts:19` (and module-wide; no `sql/` dir, no crypto)  
**Invariant violated / concern:** Context for hard invariant #5 (secrets encrypted at rest). Note content is personal data but not "connector/AI secrets," so this is not a strict invariant violation — flagged because the audit explicitly asks about AES-256-GCM and the module has none.  
**Detail:** The module is plain `node:fs` I/O; notes are written as UTF-8 plaintext. The AES-256-GCM / IV-uniqueness / tag-verification / key-derivation concerns from the audit brief do not apply because no encryption layer exists. Confidentiality rests entirely on directory perms (`0o700`) and the path-containment checks above. This appears to be an intentional design (vault = local markdown), but it should be a recorded, explicit decision, not an implicit gap — especially since memory/structured-state ingest this content into embeddings.  
**Suggested fix:** None code-wise if plaintext-at-rest is the accepted design; document it as an ADR / note in `docs/operations/` so the "where is the vault encryption" question has a deliberate answer, and ensure backups (`backup:db`/vault) account for plaintext-at-rest.

#### [LOW] `vaultFileExists` swallows all `stat` errors as "false," masking non-ENOENT failures
**File:** `packages/vault/src/vault-ops.ts:36-41`  
**Invariant violated / concern:** Error handling — swallowed catch hides real failures (EACCES, EIO, ELOOP, ENOTDIR).  
**Detail:** `catch { return false }` treats *every* error as "file absent." A permission error, an I/O error, or a symlink loop (`ELOOP`) all report the file as not existing, which can drive callers (e.g. structured-state write-back deciding create-vs-update) into wrong branches. The path-traversal case is correctly handled by calling `resolveVaultPath` outside the try (good, and tested at `vault.test.ts:177`), but other errno classes are conflated with absence.  
**Suggested fix:** Narrow the catch: return `false` only on `err.code === "ENOENT"` (and arguably `ENOTDIR`), and rethrow everything else.

#### [LOW] `VaultContext.actorUserId` is carried but never used by any op — redundant field widening the contract
**File:** `packages/vault/src/vault-context.ts:10`, consumed nowhere in `vault-ops.ts`  
**Invariant violated / concern:** Unnecessary surface / incidental complexity (Development Standards).  
**Detail:** Every op derives everything it needs from `ctx.vaultRoot`; `actorUserId` is set on the context (`vault-context.ts:36`) and asserted in a test (`vault.test.ts:75`) but read by no production code. It is harmless but it implies the ops are user-aware/auditable when they are not — the only thing enforcing isolation is `vaultRoot`. Keeping it is defensible for future audit logging, but as-is it is dead surface.  
**Suggested fix:** Either use it (e.g. structured logging/audit on writes keyed by `actorUserId`) or drop it from the interface to keep the context minimal and honest about what enforces isolation.

#### [INFO] No vault DB tables / RLS — isolation is purely filesystem-path based (reviewed, by design)
**File:** `packages/vault/` (no `sql/` directory present)  
**Invariant violated / concern:** N/A — informational. The audit asks about "RLS on vault tables"; there are none.  
**Detail:** The vault module has no SQL/migrations and no Postgres tables; cross-user isolation is enforced entirely by per-user `vaultRoot` + path containment (see the two HIGH findings, which are where that enforcement is weak). RLS as a defense layer does not exist here, so the path-containment and `actorUserId`-validation logic *is* the entire isolation boundary and warrants the elevated scrutiny applied above.  
**Suggested fix:** None; recorded so reviewers know there is no DB-layer backstop behind the filesystem checks.

#### [INFO] Module is small, cohesive, and within the file-size limit — overall structure is clean
**File:** `packages/vault/src/*.ts` (150 LOC total; largest file `vault-ops.ts` at 69 lines)  
**Invariant violated / concern:** N/A — informational.  
**Detail:** No file approaches the 1000-line limit; no `any`/`unknown`/non-null assertions; public functions have explicit return types; ops are thin, single-purpose, and free of mode flags or special-case sprawl. The package boundary is respected (consumers in `structured-state` and `memory` import only the public `@jarv1s/vault` surface). No code-judo simplification is warranted — the issues above are correctness/security gaps, not complexity.  
**Suggested fix:** None.
