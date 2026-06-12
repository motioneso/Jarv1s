# Spec: Audit Slice C — Vault Containment

**Date:** 2026-06-11
**Audit issues:** #129, #130
**Tier:** `security`
**Run manifest:** `docs/coordination/2026-06-11-audit-remediation.md`
**Migration count:** 0 (code-only)

---

## Context

Two independent containment gaps in `packages/vault/src/`, confirmed by Fable 5 verification
@ `origin/main e629f3c`:

- **#129** — `VaultContextRunner.withVaultContext` constructs the per-user vault root as
  `join(vaultsBaseDir, accessContext.actorUserId)` with no guard on `actorUserId`. An empty
  string collapses to `vaultsBaseDir` itself — the shared base directory — giving the caller
  access to all users' vaults. The DB layer (`data-context.ts`) rejects empty actors, but
  the vault has no independent check. Defense-in-depth requires the vault to guard itself.

- **#130** — `resolveVaultPath` uses `resolve()` + string-prefix check only (lexical). A
  symlink placed inside a user's vault that points outside (e.g., `<vaultRoot>/link ->
/etc/passwd`) passes the containment check because the symlink's own path is within the
  root. Reading or writing through it escapes the vault boundary.

---

## Fix design

### #129 — `actorUserId` validation in `withVaultContext`

**File:** `packages/vault/src/vault-context.ts`

Add a guard at the top of `withVaultContext` before constructing `vaultRoot`:

```typescript
if (!accessContext.actorUserId || !accessContext.actorUserId.trim()) {
  throw new VaultContextError("withVaultContext: actorUserId must be non-empty");
}
```

Export a typed `VaultContextError` from `vault-context.ts` (mirrors the existing
`VaultPathError` in `vault-path.ts`).

**Why not UUID-format validation:** `actorUserId` values come from `AccessContext` which is
already DB-derived. The critical invariant is non-empty (the collapse-to-base-dir attack
requires `""`). Format validation would couple vault to the ID scheme and is not needed to
close the gap.

---

### #130 — Symlink real-path containment

**File:** `packages/vault/src/vault-ops.ts`

Add an async helper:

```typescript
async function assertNoSymlinkEscape(fullPath: string, vaultRoot: string): Promise<void> {
  let checkPath = fullPath;
  let realChecked: string;
  try {
    realChecked = await realpath(checkPath);
  } catch {
    // Path doesn't exist yet (e.g. pre-write) — check the parent directory instead.
    realChecked = await realpath(dirname(checkPath));
  }
  const normalizedRoot = resolve(vaultRoot);
  if (realChecked !== normalizedRoot && !realChecked.startsWith(normalizedRoot + sep)) {
    throw new VaultPathError(relative(vaultRoot, fullPath));
  }
}
```

Call `await assertNoSymlinkEscape(fullPath, ctx.vaultRoot)` after every `resolveVaultPath`
call in all 7 vault-ops functions: `readVaultFile`, `writeVaultFile`, `listVaultFiles`,
`deleteVaultFile`, `vaultFileExists`, `makeVaultDir`, `listVaultFilesRecursive`.

**Why in `vault-ops.ts`, not `vault-path.ts`:**
`vault-path.ts` is a pure lexical utility (sync, no I/O). `realpath` is a filesystem call
and belongs in `vault-ops.ts` where all other I/O already lives. This keeps `vault-path.ts`
sync and its signature unchanged.

**Why check parent on ENOENT:** Write operations target paths that don't exist yet. If we
only checked `realpath(fullPath)` we'd always get ENOENT on writes, making the check useless.
Checking `realpath(dirname(fullPath))` covers the actual risk: a symlink directory that would
redirect the new file outside the vault.

**Coverage — both reads and writes:** Symlinks are a threat on write paths too (writing
through a symlink escapes the vault). All 7 ops are guarded.

---

## Hard invariants

- **Never edit applied migrations** — not applicable (no migrations).
- **`VaultContext` for all vault I/O** — these fixes reinforce, not weaken, this invariant.
- **No new files** — changes are confined to `vault-context.ts` and `vault-ops.ts`.

---

## Tests

Add to `tests/integration/vault.test.ts`:

### #129 — `actorUserId` validation

```typescript
describe("VaultContextRunner actorUserId validation (#129)", () => {
  it("throws VaultContextError on empty actorUserId", async () => {
    const runner = new VaultContextRunner(tmpDir);
    await expect(
      runner.withVaultContext({ actorUserId: "", requestId: "r1" }, async () => {})
    ).rejects.toThrow(VaultContextError);
  });

  it("throws VaultContextError on whitespace-only actorUserId", async () => {
    const runner = new VaultContextRunner(tmpDir);
    await expect(
      runner.withVaultContext({ actorUserId: "   ", requestId: "r1" }, async () => {})
    ).rejects.toThrow(VaultContextError);
  });

  it("accepts a valid actorUserId", async () => {
    const runner = new VaultContextRunner(tmpDir);
    await expect(
      runner.withVaultContext(
        { actorUserId: "00000000-0000-4000-8000-000000000001", requestId: "r1" },
        async (ctx) => ctx.actorUserId
      )
    ).resolves.toBe("00000000-0000-4000-8000-000000000001");
  });
});
```

### #130 — symlink real-path containment

```typescript
describe("symlink escape containment (#130)", () => {
  it("readVaultFile throws VaultPathError when path resolves through a symlink outside the vault", async () => {
    // Create a file outside the vault, then a symlink inside pointing to it.
    const outsideFile = join(tmpDir, "outside.txt");
    await writeFile(outsideFile, "secret");
    const runner = new VaultContextRunner(join(tmpDir, "vaults"));
    await runner.withVaultContext({ actorUserId: "user-a", requestId: "r1" }, async (ctx) => {
      const linkPath = join(ctx.vaultRoot, "escape-link");
      await symlink(outsideFile, linkPath);
      await expect(readVaultFile(ctx, "escape-link")).rejects.toThrow(VaultPathError);
    });
  });

  it("writeVaultFile throws VaultPathError when path resolves through a symlink outside the vault", async () => {
    const outsideDir = join(tmpDir, "outside-dir");
    await mkdir(outsideDir, { recursive: true });
    const runner = new VaultContextRunner(join(tmpDir, "vaults"));
    await runner.withVaultContext({ actorUserId: "user-b", requestId: "r1" }, async (ctx) => {
      const linkPath = join(ctx.vaultRoot, "escape-dir");
      await symlink(outsideDir, linkPath);
      await expect(writeVaultFile(ctx, "escape-dir/evil.txt", "pwned")).rejects.toThrow(
        VaultPathError
      );
    });
  });
});
```

---

## Out of scope

- UUID-format validation on `actorUserId` — the empty-string gap is the only attack vector;
  format coupling is unnecessary.
- `O_NOFOLLOW` flag on individual file ops — the `realpath` check covers the threat with
  less platform complexity.
- `deleteUserVaultDir` (in `vault-ops.ts`) — already has its own containment check and
  takes a raw `userId` string, not a `VaultContext`. #129's guard on `withVaultContext`
  is the right layer; `deleteUserVaultDir` is an operator function, separately reviewed.
