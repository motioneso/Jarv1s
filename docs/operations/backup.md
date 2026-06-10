# Backup Operations

Jarv1s creates daily backups at 02:00 local time. Each backup bundles the Postgres database
and the Obsidian vault into a single timestamped `.tar.gz` archive.

The database is dumped via `docker exec` inside the `jarv1s-postgres` container using the
container's own `POSTGRES_PASSWORD` — no credentials are needed on the host.

## What gets backed up

| Contents       | Location in archive          |
| -------------- | ---------------------------- |
| Postgres DB    | `jarv1s-<timestamp>/db.dump` |
| Obsidian vault | `jarv1s-<timestamp>/vault/`  |

Archive format: `backups/jarv1s-YYYY-MM-DDTHH-MM-SSZ.tar.gz`

## Prerequisites

- Docker must be running and `jarv1s-postgres` container must be up (`pnpm db:up`).
- The `ben` user must have permission to run `docker exec` (member of the `docker` group).
- `rsync` must be installed on the host (`sudo apt install rsync`).

## Deploy the systemd timer

```bash
# 1. Create infra/backup.env from the template (optional — all defaults work for a standard deploy)
cp infra/backup.env.example infra/backup.env
# Edit infra/backup.env to override any defaults (JARVIS_PGDATABASE, JARVIS_BACKUP_DIR, etc.)

# 2. Install the units
sudo cp infra/systemd/jarv1s-backup.service /etc/systemd/system/
sudo cp infra/systemd/jarv1s-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload

# 3. Enable and start the timer
sudo systemctl enable --now jarv1s-backup.timer

# 4. Verify timer is scheduled
systemctl list-timers jarv1s-backup.timer

# 5. Test with an immediate run
sudo systemctl start jarv1s-backup.service
journalctl -u jarv1s-backup.service -e
```

## Environment variables

All variables are optional — the defaults work for a standard local deploy.

| Variable                     | Default                    | Purpose                                       |
| ---------------------------- | -------------------------- | --------------------------------------------- |
| `JARVIS_BACKUP_PG_CONTAINER` | `jarv1s-postgres`          | Docker container name for pg_dump             |
| `JARVIS_PGDATABASE`          | `jarv1s`                   | Database name to dump                         |
| `JARVIS_BACKUP_DIR`          | `<repo>/backups`           | Archive destination directory                 |
| `JARVIS_VAULT_DIR`           | `~/obsidian-vault` | Obsidian vault path                           |
| `JARVIS_BACKUP_DAILY_KEEP`   | `7`                        | Number of daily archives to keep              |
| `JARVIS_BACKUP_WEEKLY_KEEP`  | `4`                        | Weekly archives to keep (beyond daily window) |
| `JARVIS_BACKUP_OFFHOST_CMD`  | (empty = skip)             | Off-host copy command; `{}` → archive path    |

## Off-host copy to Tailscale Windows host

Set `JARVIS_BACKUP_OFFHOST_CMD` in `infra/backup.env`:

```bash
# Replace <user> and <remote-path> with the Windows SSH user and target directory
JARVIS_BACKUP_OFFHOST_CMD=rsync -az --progress {} <user>@<remote-host>:/mnt/backup/jarv1s/
```

The Windows box (<remote-host>) has OpenSSH configured. No credentials live in this repo —
the SSH username and target path are operator-supplied at deploy time. Pre-populate
`~/.ssh/known_hosts` with `ssh-keyscan <remote-host>` if needed.

## Retention policy

Default: 7 daily + 4 weekly archives (maximum ~11 on disk at steady state).

- Archives from the last `DAILY_KEEP` days are all kept.
- For the `WEEKLY_KEEP` ISO-weeks beyond the daily window, the most recent archive per week
  is kept.
- Everything older is deleted after each backup run.

Override via `JARVIS_BACKUP_DAILY_KEEP` and `JARVIS_BACKUP_WEEKLY_KEEP`.

## Monthly restore drill

Run once per month and after any major migration batch. Log the date and result as a comment
on the active Phase epic issue.

```bash
# 1. Identify the most recent archive
ls -lt backups/ | head -5

# 2. Extract to a temp directory
mkdir -p /tmp/jarv1s-restore-test
tar -xzf backups/jarv1s-<timestamp>.tar.gz --strip-components=1 \
    -C /tmp/jarv1s-restore-test

# 3. Create a throw-away database (inside the container)
docker exec jarv1s-postgres \
  bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U postgres jarv1s_restoretest'

# 4. Copy the dump into the container and restore
docker cp /tmp/jarv1s-restore-test/db.dump jarv1s-postgres:/tmp/restore-test.dump
docker exec jarv1s-postgres \
  bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
    --username=postgres --dbname=jarv1s_restoretest \
    --clean --if-exists --no-owner --no-privileges \
    /tmp/restore-test.dump'

# 5. Spot-check
docker exec jarv1s-postgres \
  bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d jarv1s_restoretest \
    -c "SELECT count(*) FROM app.users;"'

# 6. Drop the test database and clean up
docker exec jarv1s-postgres \
  bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb -U postgres jarv1s_restoretest'
docker exec jarv1s-postgres rm -f /tmp/restore-test.dump

# 7. Verify vault completeness
ls /tmp/jarv1s-restore-test/vault/ | head -20

# 8. Clean up
rm -rf /tmp/jarv1s-restore-test
```

After each drill: if migrating to a new schema version, apply `pnpm db:migrate` against the
restored database (with `JARVIS_PGDATABASE=jarv1s_restoretest`).

## Viewing backup logs

```bash
# All backup runs
journalctl -u jarv1s-backup.service

# Last run only
journalctl -u jarv1s-backup.service -e -n 50

# Follow in real time
journalctl -u jarv1s-backup.service -f
```

## Manual backup (without systemd)

```bash
# From repo root:
bash scripts/backup-full.sh

# Or with overrides:
JARVIS_PGDATABASE=jarv1s JARVIS_BACKUP_DIR=/mnt/backup bash scripts/backup-full.sh
```
