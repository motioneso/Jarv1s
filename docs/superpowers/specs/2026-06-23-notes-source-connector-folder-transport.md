# Notes Source Connector — Folder Transport (Obsidian vault → memory ingest)

**Status:** Built (2026-06-23) — reconciled by `docs/superpowers/plans/2026-06-23-notes-source-host-folder.md`. The bind-mount layer, 15-min heartbeat, and wired settings card landed. Three architectural decisions were reversed to match the pre-shipped `@jarv1s/notes` module (env-var allowlist over VaultContext resolver, preferences over connector record, direct MemoryRepository over ingestVault); see the plan's "Spec reconciliation" table.
**Date:** 2026-06-23
**Owner:** Ben
**Grounded on:** `origin/main` @ `bc703a89` (tree fresh, HEAD == origin/main).
**Builds on:** M-A1 memory ingestion (`packages/memory/src/ingestion-service.ts`), `@jarv1s/vault`
(`VaultContext` read/write + per-user root resolver), the connectors module
(`packages/connectors/*`), and install.sh's env-var-driven compose wiring.

---

## Goal

Let a user bring their existing markdown notes (Obsidian first) into Jarvis as long-term context. v1
ships a **folder transport**: the user's vault is a directory of `.md` files present on the
deployment host; a Docker **bind mount** exposes it to the api/worker; Jarvis ingests it into the
owner-scoped memory index on a manual trigger and a 15-minute heartbeat. Read-only — Jarvis never
writes the vault in v1.

Success = on the headless box, with Ben's vault bind-mounted: a "Sync now" button (and a 15-min
scheduled pass) ingests the vault's `.md` files into the memory index, the notes surface as recall
context in chat, re-running is idempotent, the user's files are never modified or deleted, and
`pnpm verify:foundation` + `pnpm audit:release-hardening` stay green.

---

## Locked decisions (from the design interview)

1. **One core, many feeders.** The permanent engine is "a folder of `.md` files Jarvis ingests."
   Every transport (folder now; git, WebDAV, headless-Obsidian later) only differs in _how the
   folder gets populated_. The folder layer is the shared substrate — not throwaway.
2. **v1 transport = folder (bind mount).** Filesystem access only. **No CLI, no MCP, no REST
   plugin, no new container.** Obsidian need not be installed or running on the host — the vault is
   just files on disk.
3. **v1 scope = ingest only (read).** Write-back (chat sessions + memory as `.md`) is the next
   slice, not v1. Reading is zero-risk; write-back into a real vault is where clobber/conflict risk
   lives and earns its own spec.
4. **Triggers = manual "Sync now" + 15-min heartbeat.** File-watch is out (inotify is unreliable
   across bind mounts).
5. **Settings UX = source-agnostic "Bring in your notes?" card**, Obsidian first. Other sources
   (OneNote, Apple Notes) are separate future slices — they aren't markdown, so each is real work.
6. **Files-onto-host is the user's job, orthogonal to Jarvis.** On the MacBook Air, Obsidian's
   already there. On the server, Syncthing/rsync lands the files. Git transport (#2) removes that
   step later.
7. **Multi-user = a sync transport, not more mounts.** The single fixed mount is deliberately a
   single-operator / "my vault" shape. Per-user self-service is the git/WebDAV transport (#2),
   keyed by the user's own encrypted credential. Documented as the multi-user path; not built here.

---

## Architecture

### The folder core (permanent, transport-agnostic)

Ingest already exists and is **safe to point at a real vault**:

- `IngestionService.ingestVault(accessCtx, vaultCtx, options)` walks a `VaultContext`, filters
  `.md`, chunks + embeds (LocalEmbeddingProvider, nomic-embed-text-v1.5, 768 dims) into the
  owner-scoped memory index. Re-runnable; idempotent on content.
- `purgeDeletedFiles` is **index-only** — `DELETE FROM app.memory_file_index WHERE owner_user_id =
…`. It never touches files. Pointing ingest at the user's live vault cannot delete their notes.

So v1 is overwhelmingly **wiring**, not new ingest logic: get a `VaultContext` whose root is the
bind-mounted vault, then call the existing `ingestVault`.

### Infra — how the container reaches the host folder

A Docker bind mount maps the host vault dir to a fixed neutral container path, live (no copy):

```yaml
# infra/docker-compose.notes.yml  (override, -f'd in only when a vault is configured)
services:
  api:
    volumes:
      - ${JARVIS_NOTES_VAULT_HOST_PATH}:/data/external-notes:rw
  worker:
    volumes:
      - ${JARVIS_NOTES_VAULT_HOST_PATH}:/data/external-notes:rw
```

- **Override file, not base compose.** `:/data/external-notes` with an unset var is a hard compose
  parse error, so the mount lives in `docker-compose.notes.yml` and is `-f`'d in **only** when
  `JARVIS_NOTES_VAULT_HOST_PATH` is set. No vault → file never loads → no mount.
- **`:rw`** even though v1 is read-only — so write-back (slice #2) needs no mount change.
- **install.sh** gains `JARVIS_NOTES_VAULT_HOST_PATH` (env-var driven, matching the rest of the
  script): writes it to `env.production.local`, and when set, appends `-f
infra/docker-compose.notes.yml` to the compose invocation. New users answer "do you have notes?"
  here; existing users (Ben) add the var + the `-f` flag and `docker compose up -d` (recreate, no
  rebuild, ~10s downtime).
- **Permissions (the gotcha).** A bind mount preserves _host_ ownership. The container runs as
  `JARVIS_HOST_UID` / `JARVIS_HOST_GID` (already captured by install.sh); the vault files must be
  readable by that UID. For Ben's own box this is automatic (his vault, his UID).

### App — mapping the user's vault root to the mount

`VaultContext` derives its root as `join(vaultsBaseDir, actorUserId)` → `/data/vaults/<uid>`. For
the mounted vault, the **composition root** supplies a per-user resolver override on
`VaultContextRunner` that maps the configured user's vault root to `/data/external-notes` instead of
the default. `@jarv1s/vault` stays generic (the override is injected, not hardcoded) — module
isolation holds.

The **UUID-at-install wrinkle** (the user account doesn't exist until onboarding, so install.sh
can't mount per-UUID) is why the mount is a fixed neutral path and the user→path mapping is resolved
_in the app_ after onboarding, not in compose.

### Connector record + trigger spine

Follows the established **route → metadata-only pg-boss job → DataContext worker → repository**
spine (same as the Google sync engine).

- A **Notes Source connector** record (owner-only) holds the connection config: source kind
  (`obsidian`), transport (`folder`), and — for folder — _no secret_ (the path is operator/compose
  config, not a user credential). _Open build question below: extend the connectors module's
  `connector_provider_type` enum + relax the `encrypted_secret NOT NULL` for a no-secret transport,
  vs. a small dedicated `notes` module. Lean: dedicated lightweight module to avoid bending the
  Google-shaped connector schema (NOT-NULL secret, calendar/email enum) around a no-secret folder
  source._
- **Manual trigger:** `POST /api/notes/sync` enqueues one metadata-only job (`actorUserId` + `kind`
  - `idempotencyKey`) on a new queue via allowlisted `sendJob`.
- **Scheduled trigger:** a 15-min pg-boss schedule enqueues the _same_ job. Identical handler.
- **Worker handler** runs inside `withDataContext` (RLS scopes to the actor), builds the
  resolver-overridden `VaultContext`, calls `ingestVault`, returns `IngestStats`.

### Web UI

A "Bring in your notes?" card in settings/data-sources: source picker (Obsidian first), connection
status, a **Sync now** button, and last-sync stats (`processed / skipped / failed`). No vault
viewer/editor in the shell (existing invariant — search shows provenance + backend deep link only).

---

## Scope boundaries

- **In v1:** folder transport, bind-mount wiring (compose override + install.sh var), per-user root
  resolver override, Notes Source connector record + RLS (owner-only), manual + 15-min ingest
  triggers, settings card with Sync-now + stats.
- **Not v1 (named, not built):**
  - **Write-back** (chat sessions + memory as `.md` into a namespaced `Jarvis/` subfolder) — slice
    #2. The `:rw` mount and resolver seam are in place for it.
  - **Git transport (#2)** — per-user encrypted credential (repo + token), worker clone/pull into
    the per-user volume. The self-service, multi-user, no-host-files path.
  - **Headless Obsidian Live (#3)** — real Obsidian Sync via a headless Obsidian container.
    Explicitly the heavy path: a new container, stores the full Obsidian _account_ password,
    paid-Sync-only, fragile (Electron/Xvfb). Only if wanted after living with #1/#2.
  - **CLI / MCP / REST** — a _future Obsidian-semantic-actions_ feature (wikilink resolution, live
    "open this note", plugin commands), **not** a transport. The brain needs none of it.
  - **Non-Obsidian sources** (OneNote, Apple Notes) — separate slices; not markdown.

---

## Invariants honored

- **VaultContext for all vault I/O** — never raw `fs`. Ingest reads through the resolver-built
  `VaultContext`.
- **Owner-only / private by default** — the Notes Source connector and the ingested index rows are
  owner-scoped; RLS applies to all actors. No cross-user reach.
- **Metadata-only job payloads** — `actorUserId` + kind + idempotency key only. No note content,
  no paths-as-secrets, in the payload.
- **Module isolation** — `@jarv1s/vault` stays generic; the per-user mapping is injected by the
  composition root. The notes trigger calls public memory-ingest APIs, not another module's tables.
- **No new container** (honors Ben's standing constraint). Code rides in the existing api + worker;
  infra adds only a bind mount.
- **No file mutation in v1** — ingest + index-only purge; the user's vault is read, never written.

---

## Open questions for build (resolve before/at implementation)

1. **Module placement:** new lightweight `notes` module vs. extend `connectors`. (Lean: dedicated
   module — the connectors schema is Google-shaped: NOT-NULL `encrypted_secret`, calendar/email
   enum. A no-secret folder source fits a clean small module better than bending that schema.)
2. **Connector record shape** for a no-secret transport (how "configured" is represented without an
   `encrypted_secret`).
3. **Resolver override wiring** in `VaultContextRunner` — exact composition-root seam + how the
   "which user owns the mounted vault" mapping is configured (single-user assumption for v1).
4. **Migration list** — any new SQL must be added to `foundation.test.ts`'s `toEqual` migration
   assertion (test-trap: a focused module test won't catch the omission).
5. **15-min schedule mechanism** — confirm the pg-boss scheduling primitive to reuse (briefings /
   focus-time scheduler seam) rather than introduce a new one.

---

## Verification

- Bind-mounted vault on the box: Sync-now ingests `.md` files; recall surfaces them in chat.
- Re-run is idempotent (no duplicate index rows); deleting a note removes only its index row, never
  a file.
- 15-min heartbeat enqueues + runs the identical job.
- Vault files are byte-identical before/after ingest (read-only proof).
- `pnpm verify:foundation` + `pnpm audit:release-hardening` green.
