# Relay: #1217 UAT vault ownership — pre-implementation handoff

Branch: `fix/1217-uat-vault-ownership` · worktree: this one (`fix-1217-uat-vault`)
Coordinator: Herdr label `Coordinator`, session `019f7da3-2d14-7ee2-a42d-c0618a7d821e`
(re-resolve pane_id fresh via `herdr pane list` — never reuse a baked number)

**State: zero code written yet.** Diagnosis + plan fully approved by Coordinator
(twice — root cause, then revised plan — plus an explicit "approval already granted,
proceed" confirmation). Go straight to implementation, no further plan approval needed.

## Approved plan (two-file max, do not exceed)

1. `infra/docker-compose.prod.yml` — add to the `seed` service block ONLY (not `jarv1s`):
   ```yaml
   user: "${JARVIS_HOST_UID:-1000}:${JARVIS_HOST_GID:-1000}"
   ```
   Same vars/defaults `jarv1s` service already exposes in its `environment:` block
   (lines ~137-138). Place it near `command:`/before `environment:` in the seed block
   (currently lines 78-108).
   - If `tests/unit/prod-deploy-config.test.ts` (existing fast static text-guard test,
     reads compose file content directly) can take a one-assertion addition trivially,
     add it there (TDD: write the failing assertion first, confirm RED, then edit the
     compose file, confirm GREEN). Do NOT build a new test framework/harness for this.
2. New (or extended) UAT spec: seed at **admin+data** level (NOT solo-admin — see root
   cause below), sign in as the seeded actor, upload an attachment, assert **HTTP 201**.
   `tests/uat/specs/1133-chat-attachments.uat.spec.ts` is the closest existing pattern
   (signIn helper, FILE_BODY/UUID_RE constants, POST to `/api/chat/attachments`) but is
   pinned to `solo-admin` for unrelated reasons — do not change its level; add a new
   spec file or a new `test(...)` block at `admin+data` level instead.

**Explicitly out of scope** (do not touch): `scripts/start-jarv1s.ts` (`prepareRuntimeDirs`
stays unchanged, non-recursive, as-is), any chmod broadening, any fallback chown/wrapper
logic, any product code in `packages/chat/attachments-*`, API running as root.

## Root cause (confirmed, do not re-derive)

`seed` compose service has no `user:`/uid-drop — Dockerfile has no `USER` directive, so
it runs fully as root. `tests/uat/seed/chunks/notes.ts` is the only vault-touching seed
chunk; it calls `VaultContextRunner.withVaultContext` (`packages/vault/src/vault-context.ts:42`,
`mkdir(vaultRoot, {mode:0o700})`) as root, creating the actor's vault dir root-owned.
`scripts/start-jarv1s.ts`'s `prepareRuntimeDirs` (unchanged, correctly) chowns only the
top-level `/data/vaults` **before** `jarv1s` even starts, which is **before** the seed
step ever runs (confirmed ordering: `tests/uat/provisioner.ts` line 256/480 starts
`jarv1s` before line 487's `composeSeedHook`) — so a chown-at-startup can never reach
content the seed step creates afterward. That's why the fix is "never create root-owned
content in the first place" (seed runs AS the runtime uid from the start), not "reclaim
ownership after the fact." Checked: seed's only fs op anywhere is that one vault mkdir
(grepped `tests/uat/seed/`) — DB seeding is a plain postgres client, uid-independent — so
running the whole seed container as uid/gid 1000 is safe and sufficient.

**Bonus finding**: `1133-chat-attachments.uat.spec.ts` uses `solo-admin` level, which
(`tests/uat/seed/levels.ts:73`) returns before any data chunks run — so it never seeds
vault content and never hit this bug (that actor's vault dir gets created lazily by the
API itself, already correctly owned). Only `admin+data`/`multi-user` run `seedNotesChunk`.
This is why the new regression test must target `admin+data`, not reuse `1133`'s level.

## Red / green evidence (already captured — scripts may not survive session boundary,
recreate from the embedded content below if the scratchpad path is gone)

RED (current code, confirmed just now, exit 1, "Permission denied"):
recreate as `repro-1217.sh` if missing:
```bash
#!/usr/bin/env bash
set -euo pipefail
VOL=$(mktemp -d); trap 'rm -rf "$VOL"' EXIT
IMG=alpine:3.20; RUNTIME_UID=1000; RUNTIME_GID=1000
docker run --rm -v "$VOL:/data/vaults" --user 0:0 "$IMG" \
  sh -c 'mkdir -p /data/vaults/actor123 && chmod 700 /data/vaults/actor123'
docker run --rm -v "$VOL:/data/vaults" --user 0:0 "$IMG" \
  sh -c "chown ${RUNTIME_UID}:${RUNTIME_GID} /data/vaults"
docker run --rm -v "$VOL:/data/vaults" --user "${RUNTIME_UID}:${RUNTIME_GID}" "$IMG" \
  sh -c 'mkdir -p /data/vaults/actor123/attachments/some-uuid'
```

GREEN (option-A simulation: seed runs as runtime uid from the start, confirmed exit 0):
```bash
#!/usr/bin/env bash
set -euo pipefail
VOL=$(mktemp -d); trap 'rm -rf "$VOL"' EXIT
IMG=alpine:3.20; RUNTIME_UID=1000; RUNTIME_GID=1000
docker run --rm -v "$VOL:/data/vaults" --user "${RUNTIME_UID}:${RUNTIME_GID}" "$IMG" \
  sh -c 'mkdir -p /data/vaults/actor123 && chmod 700 /data/vaults/actor123'
docker run --rm -v "$VOL:/data/vaults" --user 0:0 "$IMG" \
  sh -c "chown ${RUNTIME_UID}:${RUNTIME_GID} /data/vaults"
docker run --rm -v "$VOL:/data/vaults" --user "${RUNTIME_UID}:${RUNTIME_GID}" "$IMG" \
  sh -c 'mkdir -p /data/vaults/actor123/attachments/some-uuid'
```
(step 2 = existing unchanged `prepareRuntimeDirs` chown, proven harmless/no-op once
ownership is already correct — not required for the fix, kept only to prove it's inert)

## Next steps for successor

1. `[ -d node_modules ] || pnpm install` (should already exist, don't reinstall blindly).
2. TDD task 1: compose seed `user:` field + config test (see plan §1 above).
3. TDD task 2: admin+data seeded-actor attachment-upload 201 UAT spec (plan §2).
4. `pnpm format:check && pnpm lint && pnpm typecheck`; `git fetch origin main && git rebase origin/main`.
5. Push, open PR via `coordinated-wrap-up`. Report PR + evidence to Coordinator (label
   `Coordinator`, session id above — resolve pane fresh). No merge/board/coord-doc edits.
6. After confirming this doc is committed and successor is driving, message Coordinator
   "safe to reap Build 1217 UAT Vault" per the `relay` skill.
