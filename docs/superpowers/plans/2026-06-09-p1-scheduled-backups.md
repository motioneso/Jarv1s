# P1 Scheduled Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scheduled, vault-inclusive backup system that bundles the Postgres DB dump and the Obsidian vault into a single timestamped archive, with retention pruning, optional off-host copy, and systemd-timer scheduling.

**Architecture:** A POSIX bash script (`scripts/backup-full.sh`) handles the full backup cycle — pg_dump → vault rsync → tar bundle → retention pruning → optional off-host copy. Systemd service + timer units in `infra/systemd/` drive scheduling at 02:00 local. Credentials live in `infra/backup.env` (gitignored), templated by `infra/backup.env.example`. An operations doc covers install, restore drill, and the env vars.

**Tech Stack:** Bash, pg_dump (Postgres client tools), rsync, tar, systemd

---

## File Map

| Path                                     | Action | Purpose                                   |
| ---------------------------------------- | ------ | ----------------------------------------- |
| `.gitignore`                             | Modify | Add `infra/backup.env` entry              |
| `infra/backup.env.example`               | Create | Env template (committed, no secrets)      |
| `scripts/backup-full.sh`                 | Create | Main backup wrapper                       |
| `tests/scripts/test-backup-retention.sh` | Create | Retention pruning test harness            |
| `infra/systemd/jarv1s-backup.service`    | Create | Systemd service unit                      |
| `infra/systemd/jarv1s-backup.timer`      | Create | Systemd timer unit                        |
| `docs/operations/backup.md`              | Create | Ops doc: install, env vars, restore drill |

---

### Task 1: Gitignore + env template

**Files:**

- Modify: `.gitignore`
- Create: `infra/backup.env.example`

- [ ] **Step 1: Add `infra/backup.env` to `.gitignore`**

Open `.gitignore`. After the `.env.*` block, add:

```
# Backup operator env (holds PGPASSWORD etc.) — never commit
infra/backup.env
```

- [ ] **Step 2: Create `infra/backup.env.example`**

```bash
# Copy to infra/backup.env and fill in real values before deploying the systemd service.
# This file is committed (no secrets). infra/backup.env is gitignored.

# Required: Postgres bootstrap password
PGPASSWORD=<bootstrap-password>

# Optional: override Postgres connection (defaults match docker-compose.yml dev values)
# JARVIS_PGHOST=localhost
# JARVIS_PGPORT=55433
# JARVIS_PGDATABASE=jarv1s
# JARVIS_BACKUP_PG_USER=postgres

# Optional: override backup archive destination (default: <repo>/backups)
# JARVIS_BACKUP_DIR=/mnt/backup/jarv1s

# Optional: override Obsidian vault location (default: /home/ben/obsidian-vault)
# JARVIS_VAULT_DIR=/home/ben/obsidian-vault

# Optional: retention (defaults: 7 daily, 4 weekly)
# JARVIS_BACKUP_DAILY_KEEP=7
# JARVIS_BACKUP_WEEKLY_KEEP=4

# Optional: off-host copy command. Use {} as a placeholder for the archive path.
# rsync over SSH example:
# JARVIS_BACKUP_OFFHOST_CMD=rsync -az --progress {} <user>@100.76.73.69:/mnt/backup/jarv1s/
```

- [ ] **Step 3: Verify gitignore works**

```bash
cd /home/ben/Jarv1s/.claude/worktrees/p1-scheduled-backups
touch infra/backup.env
git status
# Expected: infra/backup.env does NOT appear in untracked files
rm infra/backup.env
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore infra/backup.env.example
git commit -m "chore(backup): add env template + gitignore for backup.env

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: `backup-full.sh` — core (DB dump + vault + bundle)

**Files:**

- Create: `scripts/backup-full.sh`

- [ ] **Step 1: Create the script with shebang, env defaults, and main function scaffold**

```bash
cat > scripts/backup-full.sh << 'SCRIPT'
#!/usr/bin/env bash
# Jarv1s full backup: Postgres DB dump + Obsidian vault → timestamped tar.gz
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TIMESTAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
ARCHIVE_DIR="${JARVIS_BACKUP_DIR:-$REPO_DIR/backups}"
VAULT_DIR="${JARVIS_VAULT_DIR:-/home/ben/obsidian-vault}"
DAILY_KEEP="${JARVIS_BACKUP_DAILY_KEEP:-7}"
WEEKLY_KEEP="${JARVIS_BACKUP_WEEKLY_KEEP:-4}"
OFFHOST_CMD="${JARVIS_BACKUP_OFFHOST_CMD:-}"

PGHOST="${JARVIS_PGHOST:-localhost}"
PGPORT="${JARVIS_PGPORT:-55433}"
PGUSER="${JARVIS_BACKUP_PG_USER:-postgres}"
PGDATABASE="${JARVIS_PGDATABASE:-jarv1s}"

STAGING="$(mktemp -d)"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

# ── internal functions (also callable by test harness via source) ────────────

_prune_archives() {
  local archive_dir="$1"
  local daily_keep="$2"
  local weekly_keep="$3"

  local archives=()
  while IFS= read -r fname; do
    archives+=("$fname")
  done < <(find "$archive_dir" -maxdepth 1 -name 'jarv1s-*.tar.gz' \
    -printf '%f\n' 2>/dev/null | sort -r)

  [[ ${#archives[@]} -eq 0 ]] && return 0

  local now_epoch
  now_epoch=$(date -u +%s)
  local daily_cutoff=$(( now_epoch - daily_keep * 86400 ))
  local weekly_cutoff=$(( now_epoch - (daily_keep + weekly_keep * 7) * 86400 ))

  declare -A keep_set
  declare -A kept_weeks

  for fname in "${archives[@]}"; do
    local ts_raw="${fname#jarv1s-}"
    ts_raw="${ts_raw%.tar.gz}"
    # YYYY-MM-DDTHH-MM-SSZ → YYYY-MM-DDTHH:MM:SSZ
    local ts_iso="${ts_raw:0:13}:${ts_raw:14:2}:${ts_raw:17:2}Z"
    local file_epoch
    file_epoch=$(date -u -d "$ts_iso" +%s 2>/dev/null) || continue

    if (( file_epoch >= daily_cutoff )); then
      keep_set["$fname"]=1
    elif (( file_epoch >= weekly_cutoff )); then
      local week_key
      week_key=$(date -u -d "@${file_epoch}" +%G-W%V)
      if [[ -z "${kept_weeks[$week_key]+x}" ]]; then
        kept_weeks["$week_key"]=1
        keep_set["$fname"]=1
      fi
    fi
  done

  for fname in "${archives[@]}"; do
    if [[ -z "${keep_set[$fname]+x}" ]]; then
      echo "Pruning old archive: $archive_dir/$fname"
      rm -f "$archive_dir/$fname"
    fi
  done
}

# ── main ─────────────────────────────────────────────────────────────────────

main() {
  echo "=== Jarv1s backup starting: $TIMESTAMP ==="

  # 1. DB dump
  BUNDLE_DIR="$STAGING/jarv1s-$TIMESTAMP"
  mkdir -p "$BUNDLE_DIR"
  echo "Dumping database $PGDATABASE..."
  PGPASSWORD="${PGPASSWORD:-}" pg_dump \
    --host="$PGHOST" \
    --port="$PGPORT" \
    --username="$PGUSER" \
    --dbname="$PGDATABASE" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --file="$BUNDLE_DIR/db.dump"

  # 2. Vault snapshot
  if [[ -d "$VAULT_DIR" ]]; then
    echo "Snapshotting vault: $VAULT_DIR"
    rsync -a --delete "$VAULT_DIR/" "$BUNDLE_DIR/vault/"
  else
    echo "WARNING: vault dir not found: $VAULT_DIR — skipping vault snapshot"
    mkdir -p "$BUNDLE_DIR/vault"
  fi

  # 3. Bundle into archive
  mkdir -p "$ARCHIVE_DIR"
  ARCHIVE="$ARCHIVE_DIR/jarv1s-$TIMESTAMP.tar.gz"
  echo "Bundling archive: $ARCHIVE"
  tar -czf "$ARCHIVE" -C "$STAGING" "jarv1s-$TIMESTAMP"

  # 4. Retention pruning
  echo "Pruning archives (daily_keep=$DAILY_KEEP, weekly_keep=$WEEKLY_KEEP)..."
  _prune_archives "$ARCHIVE_DIR" "$DAILY_KEEP" "$WEEKLY_KEEP"

  # 5. Off-host copy
  if [[ -n "$OFFHOST_CMD" ]]; then
    echo "Running off-host copy..."
    eval "${OFFHOST_CMD/\{\}/$ARCHIVE}"
  fi

  echo "=== Backup complete: $ARCHIVE ==="
}

# Only run main if directly executed (not sourced by test harness)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main
fi
SCRIPT
chmod +x scripts/backup-full.sh
```

- [ ] **Step 2: Verify the script is syntactically valid**

```bash
bash -n scripts/backup-full.sh
# Expected: no output (no syntax errors)
```

- [ ] **Step 3: Smoke test the bundle step with a live DB (requires `pnpm db:up` and `export JARVIS_PGDATABASE=jarvis_p56`)**

```bash
export JARVIS_PGDATABASE=jarvis_p56
export PGPASSWORD=jarvispassword   # from infra/docker-compose.yml dev value

# Dry-run against a temp archive dir to avoid touching backups/
JARVIS_BACKUP_DIR=/tmp/jarv1s-backup-test \
JARVIS_VAULT_DIR=/home/ben/obsidian-vault \
bash scripts/backup-full.sh

# Expected output:
#   === Jarv1s backup starting: <timestamp> ===
#   Dumping database jarvis_p56...
#   Snapshotting vault: /home/ben/obsidian-vault
#   Bundling archive: /tmp/jarv1s-backup-test/jarv1s-<timestamp>.tar.gz
#   Pruning archives (daily_keep=7, weekly_keep=4)...
#   === Backup complete: /tmp/jarv1s-backup-test/jarv1s-<timestamp>.tar.gz ===

# Verify archive structure
tar -tzf /tmp/jarv1s-backup-test/jarv1s-*.tar.gz | head -10
# Expected: jarv1s-<timestamp>/db.dump and jarv1s-<timestamp>/vault/...
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backup-full.sh
git commit -m "feat(backup): add backup-full.sh with DB dump, vault snapshot, and bundling

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Retention pruning — test harness + verification

**Files:**

- Create: `tests/scripts/test-backup-retention.sh`

The `_prune_archives` function is already in `backup-full.sh`. This task adds a self-contained test
harness that sources the function, creates fake archives with specific timestamps, runs pruning,
and asserts the correct files remain.

- [ ] **Step 1: Create the test harness script**

```bash
mkdir -p tests/scripts
cat > tests/scripts/test-backup-retention.sh << 'TEST'
#!/usr/bin/env bash
# Retention pruning test harness
# Sources _prune_archives from backup-full.sh and validates it against fake archives.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
source "$SCRIPT_DIR/scripts/backup-full.sh"

PASS=0
FAIL=0
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

assert_exists() {
  local f="$TMP_DIR/$1"
  if [[ -f "$f" ]]; then
    echo "  PASS: $1 kept"
    (( PASS++ )) || true
  else
    echo "  FAIL: $1 should have been kept"
    (( FAIL++ )) || true
  fi
}

assert_gone() {
  local f="$TMP_DIR/$1"
  if [[ ! -f "$f" ]]; then
    echo "  PASS: $1 pruned"
    (( PASS++ )) || true
  else
    echo "  FAIL: $1 should have been pruned"
    (( FAIL++ )) || true
  fi
}

make_archive() {
  # $1 = date offset in days (0 = today, 5 = 5 days ago, etc.)
  local days_ago="$1"
  local ts
  ts=$(date -u -d "${days_ago} days ago" +%Y-%m-%dT%H-%M-%SZ 2>/dev/null \
    || date -u -v"-${days_ago}d" +%Y-%m-%dT%H-%M-%SZ)
  local name="jarv1s-${ts}.tar.gz"
  touch "$TMP_DIR/$name"
  echo "$name"
}

echo "=== Retention test: DAILY_KEEP=2, WEEKLY_KEEP=2 ==="

# Create archives:
#  0 days ago  → within daily window → keep
#  1 day ago   → within daily window → keep
#  2 days ago  → NOT in daily window (cutoff is > 2 days), border → depends on exact seconds
#  3 days ago  → weekly window, week A → keep (first seen = most recent in that week)
#  4 days ago  → weekly window, week A → prune (already kept one in week A)
#  10 days ago → weekly window, week B → keep (first in week B)
#  35 days ago → beyond weekly_cutoff (2 + 2*7 = 16 days) → prune

A0=$(make_archive 0)
A1=$(make_archive 1)
A3=$(make_archive 3)
A4=$(make_archive 4)
A10=$(make_archive 10)
A35=$(make_archive 35)

_prune_archives "$TMP_DIR" 2 2

echo ""
echo "Expected: day0, day1 kept; 35-days-ago pruned"
assert_exists "$A0"
assert_exists "$A1"
assert_gone "$A35"

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
TEST
chmod +x tests/scripts/test-backup-retention.sh
```

- [ ] **Step 2: Run the test harness**

```bash
bash tests/scripts/test-backup-retention.sh
# Expected:
#   === Retention test: DAILY_KEEP=2, WEEKLY_KEEP=2 ===
#   Pruning old archive: ... (any archives older than the window)
#   PASS: jarv1s-...(day0)... kept
#   PASS: jarv1s-...(day1)... kept
#   PASS: jarv1s-...(35-days-ago)... pruned
#   === Results: 3 passed, 0 failed ===
```

- [ ] **Step 3: Also verify with explicit `JARVIS_BACKUP_DAILY_KEEP=2` env**

```bash
JARVIS_BACKUP_DIR=/tmp/retention-verify-$$ bash -c '
  mkdir -p $JARVIS_BACKUP_DIR

  # create 5 fake archives: today, yesterday, 3 days ago, 10 days ago, 20 days ago
  for n in 0 1 3 10 20; do
    ts=$(date -u -d "${n} days ago" +%Y-%m-%dT%H-%M-%SZ)
    touch "$JARVIS_BACKUP_DIR/jarv1s-${ts}.tar.gz"
  done

  echo "Before pruning:"; ls $JARVIS_BACKUP_DIR

  JARVIS_BACKUP_DAILY_KEEP=2 JARVIS_BACKUP_WEEKLY_KEEP=2 \
    bash scripts/backup-full.sh 2>&1 | grep -E "Prun|complete" || true

  echo "After pruning:"; ls $JARVIS_BACKUP_DIR
  rm -rf $JARVIS_BACKUP_DIR
'
# Expected: 20-days-ago archive gone; today, yesterday, one weekly snapshot kept
```

- [ ] **Step 4: Commit**

```bash
git add tests/scripts/test-backup-retention.sh
git commit -m "test(backup): add retention pruning test harness

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Off-host hook — wire and verify

The `backup-full.sh` already contains the off-host hook. This task verifies it works end-to-end.

**Files:** No new files (hook already in `backup-full.sh` from Task 2)

- [ ] **Step 1: Verify the off-host hook fires with an echo command**

```bash
# Create a fake archive in a temp dir to skip the DB/vault steps for this test
TMP=$(mktemp -d)
FAKE_ARCHIVE="$TMP/jarv1s-2026-01-01T00-00-00Z.tar.gz"
touch "$FAKE_ARCHIVE"

OFFHOST_LOG="$TMP/offhost.log"

# Simulate: OFFHOST_CMD with {} placeholder
OFFHOST_CMD="echo 'offhost-copy: {}' >> $OFFHOST_LOG"
eval "${OFFHOST_CMD/\{\}/$FAKE_ARCHIVE}"

cat "$OFFHOST_LOG"
# Expected: offhost-copy: /tmp/.../jarv1s-2026-01-01T00-00-00Z.tar.gz

rm -rf "$TMP"
```

- [ ] **Step 2: Verify off-host fires during a full run with JARVIS_BACKUP_OFFHOST_CMD set**

```bash
export JARVIS_PGDATABASE=jarvis_p56
export PGPASSWORD=jarvispassword

OFFHOST_OUT=/tmp/offhost-test-$$.log
JARVIS_BACKUP_DIR=/tmp/jarv1s-offhost-test \
JARVIS_VAULT_DIR=/home/ben/obsidian-vault \
JARVIS_BACKUP_OFFHOST_CMD="echo offhost: {} >> $OFFHOST_OUT" \
bash scripts/backup-full.sh

cat "$OFFHOST_OUT"
# Expected: offhost: /tmp/jarv1s-offhost-test/jarv1s-<timestamp>.tar.gz

rm -rf /tmp/jarv1s-offhost-test "$OFFHOST_OUT"
```

- [ ] **Step 3: No commit needed** — hook verified, no file changes from Task 2.

---

### Task 5: systemd unit files

**Files:**

- Create: `infra/systemd/jarv1s-backup.service`
- Create: `infra/systemd/jarv1s-backup.timer`

- [ ] **Step 1: Create the service unit**

```bash
mkdir -p infra/systemd
cat > infra/systemd/jarv1s-backup.service << 'UNIT'
[Unit]
Description=Jarv1s scheduled backup (DB + vault)
After=network.target

[Service]
Type=oneshot
User=ben
WorkingDirectory=/home/ben/Jarv1s
EnvironmentFile=/home/ben/Jarv1s/infra/backup.env
ExecStart=/home/ben/Jarv1s/scripts/backup-full.sh
StandardOutput=journal
StandardError=journal
UNIT
```

- [ ] **Step 2: Create the timer unit**

```bash
cat > infra/systemd/jarv1s-backup.timer << 'UNIT'
[Unit]
Description=Run Jarv1s backup daily at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
```

- [ ] **Step 3: Verify units parse cleanly (requires systemd-analyze on the host)**

```bash
systemd-analyze verify infra/systemd/jarv1s-backup.service 2>&1 || echo "note: verify may warn about missing EnvironmentFile — expected pre-deploy"
systemd-analyze verify infra/systemd/jarv1s-backup.timer 2>&1 || echo "note: analyze may not be available"
# Acceptable: warnings about EnvironmentFile not found (it's deploy-time config)
# Not acceptable: syntax errors
```

- [ ] **Step 4: Commit**

```bash
git add infra/systemd/
git commit -m "feat(backup): add systemd service and timer units

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Operations documentation

**Files:**

- Create: `docs/operations/backup.md`

- [ ] **Step 1: Create the operations doc**

````bash
cat > docs/operations/backup.md << 'DOC'
# Backup Operations

Jarv1s creates daily backups at 02:00 local time. Each backup bundles the Postgres database
and the Obsidian vault into a single timestamped `.tar.gz` archive.

## What gets backed up

| Contents | Location in archive |
|----------|-------------------|
| Postgres DB dump | `jarv1s-<timestamp>/db.dump` |
| Obsidian vault | `jarv1s-<timestamp>/vault/` |

Archive format: `backups/jarv1s-YYYY-MM-DDTHH-MM-SSZ.tar.gz`

## Deploy the systemd timer

```bash
# 1. Create infra/backup.env from the template
cp infra/backup.env.example infra/backup.env
# Edit infra/backup.env: set PGPASSWORD and any optional overrides

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
````

## Environment variables

| Variable                    | Default                    | Purpose                                                       |
| --------------------------- | -------------------------- | ------------------------------------------------------------- |
| `PGPASSWORD`                | (required)                 | Postgres bootstrap password                                   |
| `JARVIS_PGHOST`             | `localhost`                | Postgres host                                                 |
| `JARVIS_PGPORT`             | `55433`                    | Postgres port                                                 |
| `JARVIS_PGDATABASE`         | `jarv1s`                   | Database name                                                 |
| `JARVIS_BACKUP_PG_USER`     | `postgres`                 | Postgres user                                                 |
| `JARVIS_BACKUP_DIR`         | `<repo>/backups`           | Archive destination                                           |
| `JARVIS_VAULT_DIR`          | `/home/ben/obsidian-vault` | Obsidian vault path                                           |
| `JARVIS_BACKUP_DAILY_KEEP`  | `7`                        | Daily archives to keep                                        |
| `JARVIS_BACKUP_WEEKLY_KEEP` | `4`                        | Weekly archives to keep (beyond daily window)                 |
| `JARVIS_BACKUP_OFFHOST_CMD` | (empty = skip)             | Off-host copy command; `{}` is replaced with the archive path |

## Off-host copy to Tailscale Windows host

Set `JARVIS_BACKUP_OFFHOST_CMD` in `infra/backup.env`:

```bash
# Replace <user> and <remote-path> with your Windows SSH user and target directory
JARVIS_BACKUP_OFFHOST_CMD=rsync -az --progress {} <user>@100.76.73.69:<remote-path>/
```

The Windows box (100.76.73.69) has OpenSSH configured. No credentials live in this repo — the
SSH username and target path are operator-supplied at deploy time. Use `ssh-keyscan 100.76.73.69`
to pre-populate `~/.ssh/known_hosts` if needed.

## Retention policy

Default: 7 daily + 4 weekly archives (maximum ~11 on disk at steady state).

- Archives from the last `DAILY_KEEP` days are all kept.
- For the `WEEKLY_KEEP` weeks beyond the daily window, one archive per ISO week is kept (the most recent in that week).
- Everything older is deleted after each backup run.

Override via `JARVIS_BACKUP_DAILY_KEEP` and `JARVIS_BACKUP_WEEKLY_KEEP` in `infra/backup.env`.

## Monthly restore drill

Run once per month and after any major migration batch. Log the date and result as a comment on
the active Phase epic issue.

```bash
# 1. Identify the most recent archive
ls -lt backups/ | head -5

# 2. Extract to a temp directory
mkdir -p /tmp/jarv1s-restore-test
tar -xzf backups/jarv1s-<timestamp>.tar.gz --strip-components=1 \
    -C /tmp/jarv1s-restore-test

# 3. Create a throw-away database
createdb -h localhost -p 55433 -U postgres jarv1s_restoretest

# 4. Restore
pg_restore \
  --host=localhost --port=55433 --username=postgres \
  --dbname=jarv1s_restoretest \
  --clean --if-exists --no-owner --no-privileges \
  /tmp/jarv1s-restore-test/db.dump

# 5. Spot-check
psql -h localhost -p 55433 -U postgres -d jarv1s_restoretest \
  -c "SELECT count(*) FROM app.users;"

# 6. Drop the test database
dropdb -h localhost -p 55433 -U postgres jarv1s_restoretest

# 7. Verify vault completeness
ls /tmp/jarv1s-restore-test/vault/ | head -20

# 8. Clean up
rm -rf /tmp/jarv1s-restore-test
```

After each drill: `pnpm db:migrate` on the restored database is required if migrating to a new
schema version.

## Viewing backup logs

```bash
# All backup runs
journalctl -u jarv1s-backup.service

# Last run only
journalctl -u jarv1s-backup.service -e -n 50

# Follow in real time
journalctl -u jarv1s-backup.service -f
```

## Manual backup

Run outside the timer at any time:

```bash
sudo systemctl start jarv1s-backup.service
# or, without systemd:
bash scripts/backup-full.sh
```

DOC

````

- [ ] **Step 2: Verify the doc renders clean markdown**

```bash
cat docs/operations/backup.md | head -20
# Expected: reads cleanly, no truncation
````

- [ ] **Step 3: Commit**

```bash
git add docs/operations/backup.md
git commit -m "docs(backup): add backup operations guide with install and restore drill

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Verify gate + restore drill

This is the final validation task. No new files; runs checks and the restore drill.

- [ ] **Step 1: Run pre-push local checks (no DB needed)**

```bash
pnpm lint && pnpm format:check && pnpm typecheck
# Expected: all pass (we only added shell/config/doc files; no TS changes)
```

- [ ] **Step 2: Run `pnpm audit:release-hardening` (requires live DB)**

```bash
export JARVIS_PGDATABASE=jarvis_p56
pnpm audit:release-hardening
# Expected: passes (no RLS/role changes made)
```

- [ ] **Step 3: Perform the restore drill against a real archive**

```bash
# Create a fresh backup archive
export JARVIS_PGDATABASE=jarvis_p56
export PGPASSWORD=jarvispassword

JARVIS_BACKUP_DIR=/tmp/jarv1s-restore-drill \
JARVIS_VAULT_DIR=/home/ben/obsidian-vault \
bash scripts/backup-full.sh

ARCHIVE=$(ls -t /tmp/jarv1s-restore-drill/jarv1s-*.tar.gz | head -1)
echo "Archive: $ARCHIVE"

# Extract
mkdir -p /tmp/jarv1s-restore-test
tar -xzf "$ARCHIVE" --strip-components=1 -C /tmp/jarv1s-restore-test

# Create throw-away DB
PGPASSWORD=jarvispassword createdb -h localhost -p 55433 -U postgres jarvis_p56_restoretest

# Restore
PGPASSWORD=jarvispassword pg_restore \
  --host=localhost --port=55433 --username=postgres \
  --dbname=jarvis_p56_restoretest \
  --clean --if-exists --no-owner --no-privileges \
  /tmp/jarv1s-restore-test/db.dump

# Spot-check
PGPASSWORD=jarvispassword psql -h localhost -p 55433 -U postgres \
  -d jarvis_p56_restoretest \
  -c "SELECT count(*) FROM app.users;"

# Drop test DB
PGPASSWORD=jarvispassword dropdb -h localhost -p 55433 -U postgres jarvis_p56_restoretest

# Verify vault present
ls /tmp/jarv1s-restore-test/vault/ | head -5

# Clean up
rm -rf /tmp/jarv1s-restore-drill /tmp/jarv1s-restore-test
```

- [ ] **Step 4: Verify exit criteria checklist**

| Criterion                                                     | Check                 |
| ------------------------------------------------------------- | --------------------- |
| `backup-full.sh` produces `.tar.gz` with `db.dump` + `vault/` | ✓ Task 2              |
| Pruning fires correctly                                       | ✓ Task 3 test harness |
| Off-host copy fires with OFFHOST_CMD set                      | ✓ Task 4              |
| systemd units committed                                       | ✓ Task 5              |
| Install instructions in `docs/operations/backup.md`           | ✓ Task 6              |
| `infra/backup.env.example` committed; `backup.env` gitignored | ✓ Task 1              |
| Restore-test cadence documented                               | ✓ Task 6              |
| Restore drill performed                                       | ✓ Task 7 Step 3       |
| `pnpm audit:release-hardening` passes                         | ✓ Task 7 Step 2       |

- [ ] **Step 5: Run `pnpm prettier --write` on plan doc, then format check**

```bash
# The plan doc is markdown; prettier will clean it
pnpm prettier --write docs/superpowers/plans/2026-06-09-p1-scheduled-backups.md
pnpm format:check
```

- [ ] **Step 6: Commit verification artifacts (if any new files were created)**

```bash
git status
# If all clean already, no commit needed.
# If any lingering test files were accidentally staged, unstage them.
```

---

## Self-Review against spec

**Spec coverage:**

| Spec requirement                                               | Task                  |
| -------------------------------------------------------------- | --------------------- |
| Shell wrapper script                                           | Task 2                |
| Bundle pg_dump + vault into one tar.gz                         | Task 2                |
| Retention 7 daily / 4 weekly (env-configurable)                | Task 2 + 3            |
| systemd timer + service in `infra/systemd/`                    | Task 5                |
| Daily 02:00 local, run as user `ben`                           | Task 5                |
| Off-host push via `JARVIS_BACKUP_OFFHOST_CMD`                  | Task 2 + 4            |
| rsync-over-SSH to Tailscale 100.76.73.69 as documented default | Task 6                |
| No credentials in repo                                         | Task 1 (env template) |
| Restore-test cadence documented                                | Task 6                |
| `infra/backup.env` gitignored                                  | Task 1                |
| `infra/backup.env.example` committed                           | Task 1                |
| `pnpm audit:release-hardening` still passes                    | Task 7                |

**No gaps found.**
