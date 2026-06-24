# Scheduled, vault-inclusive backups — Design (P1 #56)

**Status:** Approved for build (2026-06-09)
**Date:** 2026-06-09 **Owner:** Ben **Issue:** #56 (Part of epic #46)

---

## Context

`pnpm backup:db` (scripts/backup-database.ts) does a `pg_dump --format=custom` of the Jarv1s
Postgres database, writing to `backups/jarv1s-<timestamp>.dump`. `pnpm restore:db` does the
inverse with `pg_restore`. Both scripts are clean and work correctly today.

What is missing:

1. **No scheduling** — backups only happen when an operator manually runs the script.
2. **No retention** — old dump files accumulate indefinitely (or sit unmanaged).
3. **Vault not included** — the Obsidian vault at `~/obsidian-vault` contains the raw
   note corpus that drives briefings and vault-grounded AI features. It is entirely outside the
   DB backup and has no backup of any kind.
4. **No off-host copy** — a single local backup does not survive disk failure.
5. **No documented restore-test cadence** — `pnpm restore:db` exists, but there is no standing
   practice for verifying that a stored backup is actually restorable.

This is a headless, single-machine, LAN/Tailscale personal deployment. There is no cloud ops
machinery. The solution must run unattended without any cloud account assumptions.

The vault directory is an ops concern (file on disk), not an app concern. Reading it directly
in a backup shell script is fine and does not violate the VaultContext abstraction, which is an
app-layer guard against raw `fs` calls inside module code.

---

## Goals

- Backups run automatically on a schedule without operator intervention.
- Each backup bundles the Postgres dump **and** the Obsidian vault into one timestamped archive.
- Old archives are pruned automatically according to a retention policy.
- A backup can optionally be copied off-host to a destination Ben configures.
- The restore path, including post-restore `pnpm db:migrate`, is tested on a documented cadence.

---

## Non-Goals

- Cloud-native backup services (S3 lifecycle policies, RDS snapshots, etc.).
- Encrypting the local archive at rest — treat the local `backups/` directory as sensitive
  operator storage, same convention as today. Off-host copies should use encrypted transport
  (ssh/rclone with encryption) — that is a destination concern, not a script concern.
- Backing up Docker volumes directly — the Postgres data lives in a container volume, but
  `pg_dump` is the correct and portable snapshot mechanism; volume-level backups are not needed.
- Alerting / notification on backup failure — out of scope for Phase 1; can be added later with
  a systemd `OnFailure=` unit or a webhook.

---

## Resolved Decisions

### Scheduler: systemd-timer (not cron)

**Recommended: systemd-timer.**

This is a headless Linux box already running systemd. Systemd timers provide:

- Persistent timestamps — if the machine is off at the scheduled time, the timer fires on next
  boot (`Persistent=true`).
- Journal integration — `journalctl -u jarv1s-backup.service` gives searchable, structured logs
  with exit codes, no separate logfile management.
- Dependency handling — `Wants=network.target` or a storage mount can be expressed cleanly.
- `systemctl status` / `systemctl list-timers` gives operator visibility at a glance.

Cron works too, but its logs go through syslog (less searchable), missed runs are silently
dropped, and there is no dependency syntax. The repo has no existing cron usage.

The timer files live in `/etc/systemd/system/` (system timer, so it runs as the `ben` user via
`User=REPLACE_WITH_INSTALL_USER` in the service unit, or a dedicated service user). **Two files are added to the repo
at `infra/systemd/`** as reference/install artifacts — operators install them with
`sudo cp infra/systemd/* /etc/systemd/system/ && sudo systemctl daemon-reload`.

### Vault inclusion: bundle DB dump + vault into one tarball

**Recommended: single timestamped `.tar.gz` archive per backup run.**

Contents of `backups/jarv1s-<timestamp>.tar.gz`:

```
jarv1s-<timestamp>/
  db.dump          ← pg_dump --format=custom output
  vault/           ← rsync-style copy of ~/obsidian-vault
```

One file per backup event means:

- Atomic off-host copy (one `rsync`/`rclone` transfer per backup).
- DB dump and vault are always at the same point in time.
- Restore is unambiguous: pick one archive, extract, restore DB, restore vault.

### Retention policy: 7 daily + 4 weekly (default)

**Recommended default.**

The wrapper script prunes archives older than 7 days, keeping one per week for the previous
4 weeks, then deleting older ones. This gives:

- 7 daily archives (last week, granular).
- 4 weekly archives (last month, coarser).
- Maximum ~11 archives on disk at steady state.

Both thresholds are configurable via environment variables (`JARVIS_BACKUP_DAILY_KEEP`,
`JARVIS_BACKUP_WEEKLY_KEEP`) so Ben can adjust without editing the script.

---

## Resolved Decisions (was open)

### 1. Off-host copy destination → rsync over SSH to the Tailscale Windows host

Off-host copy goes via **rsync over SSH to the off-host backup target `<remote-host>`** (the operator's off-host backup box,
which already has OpenSSH configured). The destination stays **pluggable**: the script reads
`JARVIS_BACKUP_OFFHOST_CMD` (default empty = skip) and runs it with the archive path substituted.
The concrete invocation is an rsync-over-SSH command to that host. The **SSH username and
target path are supplied as environment at deploy time** — no secrets or host-specific credentials
live in this spec or the script. (Documenting "no off-host copy configured" remains a valid interim
state, but the chosen destination is the off-host backup target.)

### 2. Schedule time → 02:00 local, daily

The backup runs **daily at 02:00 local time** (`OnCalendar=*-*-* 02:00:00`, `Persistent=true`),
avoiding collisions with daytime use and the Postgres-heavy integration test runs.

### 3. Run user → `ben`

The backup service runs as the **`ben`** user (not root). `pg_dump` reads the DB over the network
using the bootstrap URL (password via `PGPASSWORD`), so no Unix socket access or superuser is needed;
the vault at `~/obsidian-vault` and `backups/` under `~/Jarv1s/` are both
readable/writable by `ben`.

---

## Approach

### New files

```
infra/systemd/
  jarv1s-backup.service    ← runs the wrapper script as User=REPLACE_WITH_INSTALL_USER
  jarv1s-backup.timer      ← OnCalendar=*-*-* 02:00:00, Persistent=true

scripts/
  backup-full.sh           ← new POSIX shell wrapper (not TypeScript; no Node required at 02:00)
```

`docs/operations/backup.md` — new operations page.

The existing `scripts/backup-database.ts` and `pnpm backup:db` are **unchanged**. The new shell
wrapper calls `pnpm backup:db` (or invokes `pg_dump` directly for offline-friendly operation;
TBD based on Node availability at run time) plus `tar` and optional off-host copy.

### `scripts/backup-full.sh` — outline

```sh
#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
STAGING="$(mktemp -d)"
ARCHIVE_DIR="${JARVIS_BACKUP_DIR:-$REPO_DIR/backups}"
DAILY_KEEP="${JARVIS_BACKUP_DAILY_KEEP:-7}"
WEEKLY_KEEP="${JARVIS_BACKUP_WEEKLY_KEEP:-4}"
VAULT_DIR="${JARVIS_VAULT_DIR:-~/obsidian-vault}"
OFFHOST_CMD="${JARVIS_BACKUP_OFFHOST_CMD:-}"

cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

# 1. DB dump (reuses backup-database.ts logic via pnpm or direct pg_dump)
DB_DUMP="$STAGING/db.dump"
pg_dump \
  --host="${JARVIS_PGHOST:-localhost}" \
  --port="${JARVIS_PGPORT:-55433}" \
  --username="${JARVIS_BACKUP_PG_USER:-postgres}" \
  --dbname="${JARVIS_PGDATABASE:-jarv1s}" \
  --format=custom \
  --no-owner --no-privileges \
  --file="$DB_DUMP"

# 2. Vault snapshot
rsync -a --delete "$VAULT_DIR/" "$STAGING/vault/"

# 3. Bundle
mkdir -p "$ARCHIVE_DIR"
ARCHIVE="$ARCHIVE_DIR/jarv1s-$TIMESTAMP.tar.gz"
tar -czf "$ARCHIVE" -C "$(dirname "$STAGING")" "$(basename "$STAGING")"

# 4. Retention pruning (keep DAILY_KEEP daily + WEEKLY_KEEP weekly)
# ... (find + date arithmetic; keep the last N daily and 1 per week for the last M weeks)

# 5. Optional off-host copy
if [[ -n "$OFFHOST_CMD" ]]; then
  eval "${OFFHOST_CMD/\{\}/$ARCHIVE}"
fi

echo "Backup complete: $ARCHIVE"
```

`PGPASSWORD` is set from the env file sourced by the systemd service unit.

### `infra/systemd/jarv1s-backup.service`

```ini
[Unit]
Description=Jarv1s scheduled backup (DB + vault)
After=network.target

[Service]
Type=oneshot
User=REPLACE_WITH_INSTALL_USER
WorkingDirectory=~/Jarv1s
EnvironmentFile=~/Jarv1s/infra/backup.env   # ← holds PGPASSWORD + opt offhost cmd
ExecStart=~/Jarv1s/scripts/backup-full.sh
StandardOutput=journal
StandardError=journal
```

### `infra/systemd/jarv1s-backup.timer`

```ini
[Unit]
Description=Run Jarv1s backup daily at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

### `infra/backup.env` (gitignored)

Holds `PGPASSWORD` and optionally `JARVIS_BACKUP_OFFHOST_CMD`. A template
`infra/backup.env.example` is committed (no real secrets).

### Restore-test cadence (documented in `docs/operations/backup.md`)

> **Monthly restore drill:**
>
> 1. Identify the most recent archive: `ls -lt backups/ | head -5`
> 2. Extract the DB dump: `tar -xzf backups/jarv1s-<ts>.tar.gz --strip-components=1 -C /tmp/jarv1s-restore-test`
> 3. Restore to a throw-away database: `createdb jarv1s_restoretest && pg_restore --host=localhost --port=55433 --username=postgres --dbname=jarv1s_restoretest --clean --if-exists --no-owner --no-privileges /tmp/jarv1s-restore-test/db.dump`
> 4. Spot-check: `psql -h localhost -p 55433 -U postgres -d jarv1s_restoretest -c "SELECT count(*) FROM app.users;"`
> 5. Drop the test database: `dropdb -h localhost -p 55433 -U postgres jarv1s_restoretest`
> 6. Verify vault completeness: `ls /tmp/jarv1s-restore-test/vault/ | head -20`
>
> Run this drill once per month and after any major migration batch. Log the date and result in a
> comment on the epic issue.

---

## Collision notes

This is an independent ops task. It adds:

- New shell script (`scripts/backup-full.sh`) — no TypeScript changes.
- New systemd unit files (`infra/systemd/`) — no existing file modifications.
- New env template (`infra/backup.env.example`) — new file.
- New ops doc (`docs/operations/backup.md`) — new file.
- `.gitignore` entry for `infra/backup.env` (the populated file).

No module code, migrations, or existing scripts are touched. Safe to develop in parallel with any
other Phase 1 task.

---

## Exit Criteria

- [ ] `scripts/backup-full.sh` runs manually end-to-end: produces a `.tar.gz` containing both
      `db.dump` and `vault/`, pruning fires correctly, off-host copy fires when
      `JARVIS_BACKUP_OFFHOST_CMD` is set.
- [ ] `infra/systemd/` units are committed and install instructions in
      `docs/operations/backup.md` are complete.
- [ ] `journalctl -u jarv1s-backup.service` shows a clean run after manual
      `sudo systemctl start jarv1s-backup`.
- [ ] `infra/backup.env.example` is committed; `infra/backup.env` is gitignored.
- [ ] Retention pruning verified: with `JARVIS_BACKUP_DAILY_KEEP=2` test mode, old archives
      are pruned correctly.
- [ ] Off-host destination is chosen and documented (or explicitly documented as "not yet
      configured").
- [ ] Restore-test cadence is written in `docs/operations/backup.md` and one successful drill
      is performed against a real archive.
- [ ] `pnpm audit:release-hardening` still passes (no regressions).

---

## Hard Invariants honored

- **Secrets never escape.** `PGPASSWORD` lives only in `infra/backup.env` (gitignored) and the
  systemd environment; it is never passed as a command-line argument (consistent with the
  existing `backup-database.ts` design).
- **No admin private-data bypass.** The backup script uses the bootstrap/operator database URL
  (same as the existing `pnpm backup:db`), which is an operator credential, not a runtime app
  role. This is intentional and consistent with the existing convention.
- **Spec before build.** This document is the spec. No implementation begins until Ben signs off.
