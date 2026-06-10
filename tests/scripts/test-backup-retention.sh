#!/usr/bin/env bash
# Retention pruning test harness — sources _prune_archives from backup-full.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# Source the backup script (only defines functions; main is guarded by BASH_SOURCE check)
source "$SCRIPT_DIR/scripts/backup-full.sh"

PASS=0
FAIL=0
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

assert_exists() {
  local f="$TMP_DIR/$1"
  if [[ -f "$f" ]]; then
    echo "  PASS: kept   $1"
    (( PASS++ )) || true
  else
    echo "  FAIL: should be kept: $1"
    (( FAIL++ )) || true
  fi
}

assert_gone() {
  local f="$TMP_DIR/$1"
  if [[ ! -f "$f" ]]; then
    echo "  PASS: pruned $1"
    (( PASS++ )) || true
  else
    echo "  FAIL: should be pruned: $1"
    (( FAIL++ )) || true
  fi
}

make_archive() {
  # $1 = days_ago (0 = today)
  local ts
  ts=$(date -u -d "$1 days ago" +%Y-%m-%dT%H-%M-%SZ)
  local name="jarv1s-${ts}.tar.gz"
  touch "$TMP_DIR/$name"
  echo "$name"
}

echo "=== Retention test: DAILY_KEEP=2, WEEKLY_KEEP=2 ==="
echo "    Keep: archives from last 2 days + 1 per week for the 2 weeks beyond that"
echo ""

# Archives by age:
#  0 days → in daily window → KEEP
#  1 day  → in daily window → KEEP
#  3 days → beyond daily (2), in weekly window (2*7=14 days), first seen for its week → KEEP
#  4 days → same ISO week as 3-days-ago → PRUNE (already have one for that week)
#  10 days → in weekly window, different week → KEEP
#  30 days → beyond weekly_cutoff (2+2*7=16 days total) → PRUNE

A0=$(make_archive 0)
A1=$(make_archive 1)
A3=$(make_archive 3)
A4=$(make_archive 4)
A10=$(make_archive 10)
A30=$(make_archive 30)

_prune_archives "$TMP_DIR" 2 2

assert_exists "$A0"
assert_exists "$A1"
assert_exists "$A3"
assert_gone   "$A4"
assert_exists "$A10"
assert_gone   "$A30"

echo ""
echo "=== Results: ${PASS} passed, ${FAIL} failed ==="
[[ $FAIL -eq 0 ]] || exit 1
