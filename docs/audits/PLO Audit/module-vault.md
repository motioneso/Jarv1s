# packages/vault — Thermo-Nuclear Code Quality & Security Audit

**Scope:** `packages/vault/src/` (all files), plus vault usage in `packages/memory/`, `packages/structured-state/`, `scripts/ingest-vault.ts`, and `tests/integration/vault.test.ts`
**Date:** 2026-06-10
**Auditor:** Automated thermo-nuclear review (Sonnet 4.6 subagent)

---

## Executive Summary

The vault package is small (150 LOC across 5 files), well-structured, and its core path traversal guard is correct and well-tested. The VaultContext brand pattern enforces that callers cannot accidentally pass an unscoped handle, and the `resolveVaultPath` function correctly blocks parent-traversal, absolute paths, and empty inputs on all platforms (using `resolve` + `sep` normalization).

However, six findings require attention. The most serious is that vault files are written without a restrictive file mode — they inherit the process umask (typically 0o644) rather than the 0o600 that personal-data files demand. The vault package also contains no encryption at rest: all note files are written as plaintext UTF-8 on disk, which is a deliberate architectural choice but is not documented anywhere in the package. Two secondary findings address a symlink traversal gap that `resolveVaultPath` cannot prevent, and the fact that `assertVaultContext` is exported but never called by any production consumer. Architecture gaps cover the persona filesystem (chat package) which uses raw `fs` without VaultContext, and the absence of `listVaultFilesRecursive` coverage in the dedicated vault unit tests.

---

## Findings

### [HIGH] Vault Files Written Without Restrictive File Mode (0o644 Instead of 0o600)

- **File:** `packages/vault/src/vault-ops.ts:19`
- **Category:** Security
- **Finding:** `writeVaultFile` calls Node's `writeFile` without a `mode` option. Node's default file creation mode is `0o666`, which after a typical `umask 0o022` yields `0o644` — world-readable. Vault files contain private user notes, personal knowledge, and structured-state write-back content (entity names, life areas, relationship data). Directories are correctly created at `0o700` (vault-context.ts:32, vault-ops.ts:18, vault-ops.ts:46), but the files themselves are not.
- **Evidence:**
  ```typescript
  // vault-ops.ts:18-19
  await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
  await writeFile(fullPath, content, "utf8");   // no mode — defaults to 0o666 minus umask
  ```
  Contrast with directory creation which explicitly sets `0o700`.
- **Impact:** On a multi-user host (the default `/data/vaults` path sits under a system directory), any local user can read vault files for any Jarvis user. Even on a single-user host, group-readable files expose data to services running under supplementary groups. The directory permissions are 0o700, so the file permissions only matter after an attacker gains access to the parent directory, but a defense-in-depth posture demands both layers.
- **Recommendation:** Pass `{ mode: 0o600 }` as the options object to `writeFile`:
  ```typescript
  await writeFile(fullPath, content, { encoding: "utf8", mode: 0o600 });
  ```
  This is a one-line change in `writeVaultFile`. Existing files will retain their current permissions; a migration script or documentation note should advise operators to run `chmod 600` on all existing vault files.

---

### [HIGH] Vault Files Are Stored as Plaintext — No At-Rest Encryption

- **File:** `packages/vault/src/vault-ops.ts` (entire file), `packages/vault/src/vault-config.ts`
- **Category:** Security
- **Finding:** The vault package provides no encryption of file contents. All `readVaultFile`/`writeVaultFile` operations are raw UTF-8 reads and writes. The CLAUDE.md hard invariants state "Connector/AI credentials … are AES-256-GCM encrypted at rest," and the connector/AI packages implement this correctly with the `@jarv1s/db` Keyring + AES-256-GCM cipher. Vault files contain private personal knowledge (notes, entity relationships, life-area data) which arguably warrants the same protection level.
- **Evidence:**
  ```typescript
  export async function writeVaultFile(
    ctx: VaultContext,
    relativePath: string,
    content: string
  ): Promise<void> {
    const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
    await mkdir(dirname(fullPath), { recursive: true, mode: 0o700 });
    await writeFile(fullPath, content, "utf8");   // plaintext, no cipher
  }
  ```
  Compare with `packages/ai/src/crypto.ts` and `packages/connectors/src/crypto.ts` which encrypt every stored credential.
- **Impact:** If the filesystem is compromised (backup exposure, VM snapshot, container volume mount, accidental volume share), all vault content is immediately readable. For a product that "holds lots of personal data," plaintext note storage at rest is a significant gap.
- **Recommendation:** Either (a) document the plaintext-by-design decision explicitly in the package README and CLAUDE.md (noting that directory-level 0o700 + OS-level disk encryption is the intended mitigation), or (b) add an encryption layer to `readVaultFile`/`writeVaultFile` using the same Keyring + AES-256-GCM pattern from `@jarv1s/db`. Option (b) is the stronger posture given the sensitivity of personal knowledge data.

---

### [MEDIUM] Symlink Traversal Not Prevented — `resolveVaultPath` Checks Lexical Path Only

- **File:** `packages/vault/src/vault-path.ts:10-22`, `packages/vault/src/vault-ops.ts:7-10`
- **Category:** Security
- **Finding:** `resolveVaultPath` uses `path.resolve` to normalize the lexical path and checks that it falls within `vaultRoot`. However, Node's `readFile`, `writeFile`, `readdir`, and `stat` all follow symlinks by default. If a symlink is placed inside a vault directory (e.g., `/data/vaults/user123/link -> /etc/passwd`), `resolveVaultPath("link")` returns `/data/vaults/user123/link` which passes the containment check, but `readFile` will read `/etc/passwd`. The reverse is also true for write operations.
- **Evidence:**
  ```typescript
  // vault-path.ts — checks lexical path only
  const normalized = resolve(vaultRoot, relativePath);   // resolves symlinks lexically
  if (normalized !== normalizedRoot && !normalized.startsWith(normalizedRoot + sep)) {
    throw new VaultPathError(relativePath);
  }
  // vault-ops.ts — then passes to fs functions that follow symlinks
  return readFile(fullPath, "utf8");   // follows symlinks
  ```
  The `resolveVaultPath` function uses `path.resolve` (lexical), not `fs.realpath` (follows symlinks). These can disagree when symlinks are present.
- **Impact:** If an attacker can place a symlink inside the vault directory (e.g., through a compromised writer that somehow bypasses the vault API, or through a future feature that imports external content), they can read or overwrite arbitrary files on the host. In the current architecture this requires prior filesystem access, but the gap is real and grows in importance if vault import features are added.
- **Recommendation:** Add a `realpath` check after `resolveVaultPath`:
  ```typescript
  import { realpath } from "node:fs/promises";
  const real = await realpath(fullPath);
  if (real !== fullPath && !real.startsWith(ctx.vaultRoot + sep)) {
    throw new VaultPathError(relativePath);
  }
  ```
  Alternatively, use `O_NOFOLLOW` flags via `fs.open`. Note that `realpath` itself requires the path to exist, so it applies only to reads/deletes; for writes the directory real-path should be checked.

---

### [MEDIUM] `assertVaultContext` Is Exported but Never Called in Production Code — Dead Export

- **File:** `packages/vault/src/vault-context.ts:14-22`, `packages/vault/src/index.ts:2`
- **Category:** Architecture / Code Quality
- **Finding:** `assertVaultContext` is exported from the package and intended as a runtime guard to verify a `VaultContext` was properly minted by `VaultContextRunner`. However, grep across the entire codebase shows it is never imported or called by any production module — only defined and re-exported. The brand pattern (`vaultContextBrand`) already provides compile-time safety, but `assertVaultContext` was presumably meant to guard dynamic entry points (e.g., Fastify route handlers receiving a context object). No such callsite exists.
- **Evidence:**
  ```
  $ grep -rn "assertVaultContext" ~/Jarv1s --include="*.ts" | grep -v node_modules
  packages/vault/src/vault-context.ts:14: export function assertVaultContext(...)
  packages/vault/src/index.ts:2:          export { assertVaultContext, ... }
  # No callsites in packages/, apps/, scripts/
  ```
- **Impact:** Dead code that creates false confidence. Developers may believe VaultContext is runtime-validated at boundaries when it is not. If a future route handler incorrectly accepts `unknown` and passes it to a vault op, there is no runtime guard in the call chain.
- **Recommendation:** Either (a) delete `assertVaultContext` and its export if there are no planned dynamic entry points, or (b) add explicit `assertVaultContext` calls at any point where a `VaultContext` arrives from outside the current TypeScript type boundary (e.g., if vault operations are ever exposed via an HTTP handler or job worker). Leaving the function defined-but-unused is the worst outcome.

---

### [MEDIUM] `actorUserId` Used Directly as Filesystem Path Component Without UUID Validation

- **File:** `packages/vault/src/vault-context.ts:31`
- **Category:** Security
- **Finding:** The vault root for a user is `join(vaultsBaseDir, accessContext.actorUserId)`. The `actorUserId` field is typed as `string` in `AccessContext` — there is no UUID format validation in `DataContextRunner.withDataContext` (only a non-empty check), nor in `VaultContextRunner.withVaultContext`. In normal production flows, `actorUserId` originates from `app.resolve_auth_session` which returns a `uuid` column value (safe). But any code that directly constructs an `AccessContext` with a non-UUID value (e.g., in scripts, tests, or future admin tooling) could produce arbitrary path segments.
- **Evidence:**
  ```typescript
  // data-context.ts:26 — only checks non-empty
  if (!accessContext.actorUserId) {
    throw new Error("withDataContext requires an actor user id");
  }

  // vault-context.ts:31 — joins directly without further validation
  const vaultRoot = join(this.vaultsBaseDir, accessContext.actorUserId);
  ```
  Note: `path.join` normalizes `..` components. If `actorUserId` were `"../admin"`, `join("/data/vaults", "../admin")` = `"/data/admin"` — outside the vaults base. The `resolveVaultPath` guard inside each operation would only protect against paths within the resulting (wrong) root, not against the root itself being wrong.
- **Impact:** In the current architecture the risk is low because `actorUserId` always comes from a DB UUID. However, scripts like `ingest-vault.ts` accept `JARVIS_USER_ID` from the environment directly without UUID validation, and the ingest-vault script does not go through auth session resolution. A misconfigured or adversarial `JARVIS_USER_ID=../secrets` would land the vault root outside the intended base.
- **Recommendation:** Add a UUID-format check in `VaultContextRunner.withVaultContext`:
  ```typescript
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(accessContext.actorUserId)) {
    throw new Error(`VaultContext: actorUserId must be a UUID, got: ${JSON.stringify(accessContext.actorUserId)}`);
  }
  ```
  Alternatively add this validation to `DataContextRunner.withDataContext` so it is enforced across all uses.

---

### [MEDIUM] `deleteVaultFile` Does Not Guard Against Deleting Directories — No File-Type Check

- **File:** `packages/vault/src/vault-ops.ts:28-31`
- **Category:** Security / Error Handling
- **Finding:** `deleteVaultFile` calls `rm(fullPath)` without verifying that `fullPath` is a regular file. Node's `fs.rm` without `{ recursive: true }` will throw `EISDIR` for a directory (preventing directory deletion), but it will silently delete a symlink. More importantly, there is no check that the target is actually a file before deletion. If a caller passes a path that resolves to a symlink pointing outside the vault (per the symlink finding above), `rm` will delete the symlink itself — which is at least unexpected and at most harmful if the symlink's deletion breaks external systems.
- **Evidence:**
  ```typescript
  export async function deleteVaultFile(ctx: VaultContext, relativePath: string): Promise<void> {
    const fullPath = resolveVaultPath(ctx.vaultRoot, relativePath);
    await rm(fullPath);   // no stat check, no isFile() guard
  }
  ```
- **Impact:** Low in the current codebase (no production callers of `deleteVaultFile`), but represents an incomplete contract: callers expect to delete a file, not a symlink or other filesystem object.
- **Recommendation:** Add a stat check before deletion:
  ```typescript
  const s = await stat(fullPath);
  if (!s.isFile()) {
    throw new VaultPathError(relativePath);   // or a dedicated VaultTypeError
  }
  await rm(fullPath);
  ```
  `stat` follows symlinks, so it will report the target type — a symlink to a directory would report `isDirectory()`, not `isFile()`, which is correct behavior here.

---

### [MEDIUM] Persona Filesystem in Chat Package Uses Raw `fs` Without VaultContext

- **File:** `packages/chat/src/live/persona.ts:12,57-74`
- **Category:** Architecture
- **Finding:** The `renderPersona` function writes the Jarvis persona context file (e.g., `CLAUDE.md`) into a per-user "neutral directory" (`<chatHome>/<userId>/<CONTEXT_FILENAME>`). This function accepts a `userId: string` and calls `mkdir` + `writeFile` directly — bypassing VaultContext entirely. The CLAUDE.md hard invariant states "VaultContext for all vault I/O — never raw fs calls." While persona files are not "vault files" in the strict note-storage sense, they are per-user filesystem artifacts containing user-specific data (`userName`, provider config), and they share the same threat model.
- **Evidence:**
  ```typescript
  // persona.ts:57 — userId joined directly into path without traversal guard
  const neutralDir = join(resolveBaseDir(input.baseDir), input.userId);
  const personaPath = join(neutralDir, CONTEXT_FILENAME[input.provider]);
  // ...
  await fs.mkdir(neutralDir);    // no mode restriction
  await fs.writeFile(personaPath, content);   // no mode restriction
  ```
  The `createRealPersonaFs` implementation at line 70 passes no `mode` to `mkdir`, so neutral directories are created at the default mode (0o755 after umask — world-readable).
- **Impact:** (a) Persona content files are world-readable by default. They contain the user's display name and agent persona text. (b) `userId` is joined directly into the path without any `resolveVaultPath`-style traversal check. If `userId` contained `..` segments, it would escape the `chatHome` base. (c) This establishes a precedent for bypassing VaultContext in per-user filesystem writes.
- **Recommendation:** (a) Pass `{ recursive: true, mode: 0o700 }` to `mkdir` in `createRealPersonaFs`. (b) Pass `{ mode: 0o600 }` to `writeFile`. (c) Add a UUID-format check on `userId` before constructing the path. (d) Consider whether the `PersonaFs` abstraction should eventually route through VaultContext or a sibling `ChatContext` that provides the same containment guarantees.

---

### [LOW] `listVaultFilesRecursive` Is Untested in the Dedicated Vault Test Suite

- **File:** `tests/integration/vault.test.ts`, `packages/vault/src/vault-ops.ts:63-69`
- **Category:** Tests
- **Finding:** The dedicated `vault.test.ts` integration test suite covers `resolveVaultPath`, `VaultContextRunner`, `readVaultFile`, `writeVaultFile`, `vaultFileExists`, `deleteVaultFile`, `listVaultFiles`, and `makeVaultDir`. However, `listVaultFilesRecursive` — the function used by both the memory ingestion pipeline and the structured-state module — is not tested in `vault.test.ts`. It is exercised indirectly through `tests/integration/memory.test.ts`, but that coverage tests the ingestion pipeline, not the traversal mechanics of `listVaultFilesRecursive` itself (e.g., symlink handling, deeply nested structures, ENOENT on missing root).
- **Evidence:**
  ```
  $ grep -n "listVaultFilesRecursive" tests/integration/vault.test.ts
  (no output)
  ```
- **Impact:** A regression in `listVaultFilesRecursive` (e.g., exposing non-.md files, not respecting vaultRoot, handling missing directory differently) would not be caught until the memory integration tests run, which test a much larger surface area and make diagnosis harder.
- **Recommendation:** Add tests in `vault.test.ts` for `listVaultFilesRecursive`:
  1. Returns empty array for an empty vault.
  2. Returns all files recursively across subdirectories.
  3. Returns relative paths (not absolute).
  4. Throws or returns empty on missing directory root.
  5. Does not recurse into symlinked directories (once the symlink guard is added).

---

### [LOW] `listVaultFiles` Throws Raw `ENOENT` on Missing Directory — No Friendly Error

- **File:** `packages/vault/src/vault-ops.ts:22-26`
- **Category:** Error Handling
- **Finding:** `listVaultFiles` calls `readdir` on the resolved path and propagates the raw Node.js `ENOENT` error if the directory does not exist. This differs from `vaultFileExists`, which explicitly catches the error and returns `false`. Callers that invoke `listVaultFiles` on a directory that hasn't been created yet (e.g., first-time user with no vault files in that subdirectory) receive a cryptic `ENOENT: no such file or directory, scandir '...'` rather than an empty array or a structured `VaultPathError`.
- **Evidence:**
  ```typescript
  export async function listVaultFiles(ctx: VaultContext, relativeDir: string): Promise<string[]> {
    const fullPath = resolveVaultPath(ctx.vaultRoot, relativeDir);
    const entries = await readdir(fullPath, { withFileTypes: true });   // throws ENOENT
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  }
  ```
- **Impact:** Callers must wrap `listVaultFiles` in try/catch and handle `ENOENT` specially, but none of the current callers do so. The ingestion service silently works around this because `VaultContextRunner.withVaultContext` creates the vault root before any operations, but sub-directories can still be missing.
- **Recommendation:** Either (a) document in the JSDoc that `listVaultFiles` throws `ENOENT` for a missing directory (so callers know to handle it), or (b) return an empty array when `code === "ENOENT"`:
  ```typescript
  try {
    const entries = await readdir(fullPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  ```
  Option (b) is more ergonomic and consistent with `vaultFileExists`.

---

### [LOW] Key Derivation Uses Raw SHA-256 Instead of a KDF (Shared with AI/Connector Packages)

- **File:** `packages/db/src/keyring.ts:34,48`
- **Category:** Security (cryptography)
- **Finding:** The `resolveKeyring` function derives the 256-bit AES key by taking `SHA-256(rawSecret)`. SHA-256 is a fast hash with no work factor — it is not a Key Derivation Function. If an attacker obtains the ciphertext blobs (connector secrets, AI credentials), they can brute-force weak or low-entropy secrets at billions of guesses per second. The vault package itself does not encrypt files, so this finding applies to the cryptographic infrastructure shared by vault's sibling packages (`@jarv1s/ai` and `@jarv1s/connectors`). It is noted here because CLAUDE.md designates the vault as the primary secret-storage interface.
- **Evidence:**
  ```typescript
  // keyring.ts:34
  const currentKeyBuffer = createHash("sha256").update(rawCurrentSecret).digest();
  ```
  Appropriate alternatives: `crypto.pbkdf2Sync(secret, salt, 600000, 32, "sha256")` or `crypto.hkdfSync("sha256", ikm, salt, info, 32)`.
- **Impact:** Medium if secrets are high-entropy (e.g., 32-byte random values from a secrets manager). High if secrets are human-chosen passphrases or derived from predictable values.
- **Recommendation:** Use HKDF (for high-entropy input key material) or PBKDF2/Argon2 (for lower-entropy secrets) to derive the AES key. Since this is infrastructure shared across packages, the fix lives in `packages/db/src/keyring.ts`. A migration is not required for stored ciphertext (the key derivation change only affects new encryptions; re-encryption of stored blobs on next write is sufficient).

---

### [INFO] Non-Atomic `writeVaultFile` — In-Flight Crash Leaves Truncated File

- **File:** `packages/vault/src/vault-ops.ts:13-20`
- **Category:** Code Quality / Error Handling
- **Finding:** `writeVaultFile` writes content directly to the destination path. Node's `writeFile` is not atomic: if the process crashes mid-write (OOM kill, power loss, SIGKILL), the file will be left in a partially written state. The `VaultWriteBackService` in `structured-state` reads back the existing body before overwriting, so a truncated file would lose that body.
- **Evidence:**
  ```typescript
  await writeFile(fullPath, content, "utf8");   // direct write, not atomic
  ```
- **Impact:** Low in practice (crashes during writes are rare), but the structured-state write-back pattern of read-modify-write makes the data-loss window meaningful.
- **Recommendation:** Use write-to-temp-then-rename for important writes:
  ```typescript
  import { rename } from "node:fs/promises";
  const tmpPath = fullPath + ".tmp." + randomBytes(4).toString("hex");
  await writeFile(tmpPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, fullPath);
  ```
  `rename` is atomic on POSIX filesystems within the same volume.

---

### [INFO] `getVaultBaseDir` Default is `/data/vaults` — Undocumented in docker-compose / Ops Runbooks

- **File:** `packages/vault/src/vault-config.ts:1`
- **Category:** Architecture / Operations
- **Finding:** The default vault base directory is `/data/vaults`. This path does not appear in `infra/docker-compose.yml`, which does not define a `JARVIS_VAULT_ROOT` environment variable or a corresponding Docker volume for any service. The `api`, `worker`, and `web` services in docker-compose.yml do not expose `JARVIS_VAULT_ROOT`.
- **Evidence:**
  ```typescript
  // vault-config.ts
  const DEFAULT_VAULT_BASE_DIR = "/data/vaults";
  ```
  ```yaml
  # docker-compose.yml api service — no JARVIS_VAULT_ROOT
  environment:
    CI: "true"
    PORT: "3000"
    HOST: 0.0.0.0
    JARVIS_APP_DATABASE_URL: ...
  ```
- **Impact:** In the docker-compose dev/smoke environment, vault writes will attempt `/data/vaults` inside the container, which is not mounted to a persistent volume. Vault files will be lost on container restart. More importantly, operators standing up production deployments have no guidance on where to mount the vault volume.
- **Recommendation:** Add `JARVIS_VAULT_ROOT` to docker-compose.yml services that perform vault I/O (currently: none in compose, but `ingest-vault.ts` is the CLI entry point). Add a `vaults` named volume. Document the expected path in `docs/operations/dev-environment.md`.

---

## VaultContext Interface Completeness Assessment

The current `VaultContext` interface is:
```typescript
interface VaultContext {
  readonly [vaultContextBrand]: true;
  readonly actorUserId: string;
  readonly vaultRoot: string;
}
```

Operations exposed: `readVaultFile`, `writeVaultFile`, `listVaultFiles`, `listVaultFilesRecursive`, `deleteVaultFile`, `vaultFileExists`, `makeVaultDir`.

**Missing operations that should go through VaultContext:**
1. **`renameVaultFile(ctx, fromPath, toPath)`** — not yet needed but will be when structured-state supports entity renames. Without it, callers will implement rename as delete+write, which is not atomic.
2. **`copyVaultFile`** — not needed today, acceptable to omit.
3. **`statVaultFile`** — not exposed; callers use `vaultFileExists`. A `statVaultFile` that returns mtime/size would be useful for change detection without reading full content.

**Operations that bypass VaultContext and should not:**
1. `packages/chat/src/live/persona.ts` — per-user persona files written via raw `fs` (see finding above).
2. `packages/ai/src/adapters/tmux-bridge.ts` — transcript files read/written via raw `readFile`/`writeFile`. These are system files in `~/.claude/` etc., not vault files, so VaultContext is not appropriate here — this is correct.

---

## Encryption Implementation Assessment

The vault package itself has **no encryption** — files are stored as plaintext UTF-8. This is consistent with a "personal filesystem" model where OS-level access control (`0o700` directories) is the primary guard.

The **related** AES-256-GCM implementation in `packages/ai/src/crypto.ts` and `packages/connectors/src/crypto.ts` (used for connector/AI credentials, not vault files) is analyzed here for completeness:

| Property | Status | Notes |
|---|---|---|
| Algorithm | AES-256-GCM | Correct AEAD — provides confidentiality + authenticity |
| IV size | 12 bytes from `randomBytes(12)` | Correct (GCM standard) |
| IV uniqueness | Cryptographically random per operation | Correct — no counter mode or reuse risk |
| Auth tag | 128-bit (GCM default), stored in envelope | Correct — `setAuthTag` called before `final()` |
| Auth tag check | Enforced by Node's decipher — `final()` throws on mismatch | Correct |
| Key derivation | `SHA-256(rawSecret)` | Weak — should be HKDF or PBKDF2 (see finding) |
| Key rotation | Full keyring with `keyId` field, legacy fallback list | Good design |
| Envelope version | Checked (`version !== 1`) | Good — allows future migration |
| Algorithm check | Checked (`algorithm !== "aes-256-gcm"`) | Good |
| Partial decrypt leak | `decryptJson` throws before returning `rawPlaintext` if JSON parse fails | Correct — no partial data returned |

The cipher implementations in AI and connectors packages are near-identical (copy-paste). If a bug were found in one, it would exist in both. A shared `SecretCipher` base class in `@jarv1s/db` would eliminate this duplication — currently both packages independently depend on `Keyring` but re-implement the same `encryptJson`/`decryptJson` logic.

---

## Summary Table

| # | Severity | Title | File |
|---|---|---|---|
| 1 | HIGH | Vault files written without restrictive mode (0o644 not 0o600) | vault-ops.ts:19 |
| 2 | HIGH | No at-rest encryption of vault file contents | vault-ops.ts (all) |
| 3 | MEDIUM | Symlink traversal not prevented by lexical path check | vault-path.ts:15 |
| 4 | MEDIUM | `assertVaultContext` exported but never called in production | vault-context.ts:14 |
| 5 | MEDIUM | `actorUserId` used as path component without UUID validation | vault-context.ts:31 |
| 6 | MEDIUM | `deleteVaultFile` has no file-type check | vault-ops.ts:28-31 |
| 7 | MEDIUM | Persona filesystem bypasses VaultContext (chat package) | chat/persona.ts:57-74 |
| 8 | LOW | `listVaultFilesRecursive` not tested in vault.test.ts | vault.test.ts |
| 9 | LOW | `listVaultFiles` throws raw ENOENT — no friendly empty-array fallback | vault-ops.ts:24 |
| 10 | LOW | Key derivation uses SHA-256 not a KDF (shared with AI/connector packages) | db/keyring.ts:34 |
| 11 | INFO | `writeVaultFile` is not atomic — crash leaves truncated file | vault-ops.ts:19 |
| 12 | INFO | Default `/data/vaults` not documented in docker-compose or ops runbooks | vault-config.ts:1 |
