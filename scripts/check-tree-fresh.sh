#!/usr/bin/env bash
#
# check-tree-fresh.sh — grounding preflight for audits & analysis.
#
# The stale-checkout trap (2026-06-10) cost a full re-audit: four security audits
# were grounded on a local `main` that was 8 commits BEHIND `origin/main` (missing
# 8 merged PRs / ~9,500 insertions), so most HIGH/MED findings re-validated wrong.
#
# Run this BEFORE grounding any audit, security review, or architectural analysis.
# It fetches origin and FAILS if the working tree is missing merged commits, i.e.
# the code under review is stale. Being *ahead* (local-only doc/coordination
# commits) is fine and does not fail — only being *behind* the baseline does.
#
# Exit 0: tree is current (or exactly at the baseline). Safe to ground.
# Exit 1: tree is stale (behind the baseline) — do NOT audit until resolved.
# Exit 2: environment problem (no remote, baseline unfetchable, not a repo).
#
# Escape hatch: set JARVIS_ALLOW_STALE=1 to intentionally audit an older ref
# (e.g. reproducing a past finding). Prints a loud warning and exits 0.
#
# Baseline override: BASE=origin/<branch> (default: origin/main).

set -euo pipefail

BASE="${BASE:-origin/main}"
REMOTE="${BASE%%/*}"

fail()  { printf '\n\033[1;31m✗ GROUNDING: %s\033[0m\n' "$1" >&2; }
ok()    { printf '\033[1;32m✓ GROUNDING: %s\033[0m\n' "$1"; }
note()  { printf '  %s\n' "$1"; }

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  fail "not inside a git repository"
  exit 2
fi

note "fetching ${REMOTE} ..."
if ! git fetch "${REMOTE}" --quiet 2>/dev/null; then
  fail "could not fetch '${REMOTE}' — check the remote / network before grounding"
  exit 2
fi

if ! git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  fail "baseline '${BASE}' does not exist after fetch — set BASE=origin/<branch>"
  exit 2
fi

head_sha="$(git rev-parse --short HEAD)"
base_sha="$(git rev-parse --short "${BASE}")"
behind="$(git rev-list --count "HEAD..${BASE}")"
ahead="$(git rev-list --count "${BASE}..HEAD")"
dirty=""
if ! git diff --quiet || ! git diff --cached --quiet; then
  dirty=" (working tree has uncommitted changes)"
fi

printf 'grounding: HEAD=%s base=%s@%s behind=%s ahead=%s%s\n' \
  "${head_sha}" "${BASE}" "${base_sha}" "${behind}" "${ahead}" "${dirty}"

if [ "${behind}" -gt 0 ]; then
  if [ "${JARVIS_ALLOW_STALE:-}" = "1" ]; then
    printf '\n\033[1;33m⚠ GROUNDING: tree is %s commit(s) BEHIND %s but JARVIS_ALLOW_STALE=1 — proceeding on a STALE tree by explicit override.\033[0m\n' "${behind}" "${BASE}"
    note "Record in the audit report that findings were grounded on a stale ref (${head_sha})."
    exit 0
  fi
  fail "tree is ${behind} commit(s) BEHIND ${BASE} — the code under review is STALE."
  note "Missing merged work re-validates findings wrong (this is the trap that cost a re-audit)."
  note ""
  note "To ground safely WITHOUT disturbing a shared working tree (another session may be"
  note "mid-build — never pull/checkout/reset the shared tree), use a detached worktree:"
  note ""
  note "    git worktree add /tmp/audit-ground ${BASE}"
  note "    cd /tmp/audit-ground   # read-only w.r.t. the shared tree; never 'git pull' it"
  note ""
  note "Or, if this tree is yours to move and clean: git fetch && git checkout ${BASE##*/} && git pull --ff-only"
  note "Intentionally auditing an old ref? Re-run with JARVIS_ALLOW_STALE=1."
  exit 1
fi

if [ "${ahead}" -gt 0 ]; then
  ok "tree is current with ${BASE} (${base_sha}); ${ahead} local-only commit(s) ahead — safe to ground${dirty}."
else
  ok "tree is exactly at ${BASE} (${base_sha}) — safe to ground${dirty}."
fi
