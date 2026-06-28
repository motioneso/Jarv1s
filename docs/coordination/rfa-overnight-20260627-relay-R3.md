# Coordinator Relay R3 — rfa-overnight-20260627

**Run:** rfa-overnight-20260627
**Relay time:** 2026-06-28 (coordinator R2 at 70% context — compaction tripwire)
**Predecessor session:** fa1a543f-55a4-46a3-9c52-36b642aa0c62 (Coordinator, w1:p50)
**Run manifest:** docs/coordination/rfa-overnight-20260627.md

---

## RUN STATUS: ALL 6 ISSUES MERGED ✅

| Issue | PR | Merge SHA | Slot |
|-------|-----|-----------|------|
| #557 (calendar delete tool) | #569 | 020f36af | — |
| #537 (commitment extraction) | #570 | 6835a9d0 | — |
| #539 (source-backed provenance) | #571 | f6ebaf4d | — |
| #541 (data freshness visibility) | #572 | 002a3171 | — |
| #540 (safe automation audit log) | #573 | 1bf909d8 | 0127 |
| #538 (unified person/contact model) | #574 | db4c8cf4 | 0128 |

---

## Your first actions (ordered)

1. **Rename yourself:** `herdr pane rename "$HERDR_PANE_ID" "Coordinator"`
2. **Verify uniqueness:** `herdr pane list` — exactly one `Coordinator`. Stand down if duplicate.
3. **Reap stale panes:**
   - `w1:p6F` — RFA-538-R5 (session f8299ef5) — reap: `herdr pane close w1:p6F`
   - `w1:p6N` — QA-538-GLM — reap: `herdr pane close w1:p6N`
   - Verify pane IDs by label before closing (pane IDs reflow).
4. **Remove rfa-538 worktree:**
   ```bash
   git worktree remove --force /home/ben/Jarv1s/.claude/worktrees/rfa-538-person-contact-model
   ```
5. **File the capabilities doc issue** (post-run task Ben requested):
   ```bash
   gh issue create \
     --title "Capabilities doc: what's new in Jarvis (overnight build 2026-06-28)" \
     --body "$(cat <<'EOF'
   Six features shipped in the rfa-overnight-20260627 build run. A capabilities/what's-new doc should cover:

   ## Features shipped 2026-06-28

   - **#557** — Calendar delete tool: assistant can delete calendar events via `calendar.deleteEvent`
   - **#537** — Commitment extraction: automatically extracts commitments from emails/calendar/notes
   - **#539** — Source-backed provenance: AI answers include citations to the source data that informed them
   - **#541** — Data freshness visibility: chat footer shows how fresh the data behind each answer is
   - **#540** — Safe automation audit log: all automated actions (tool calls, job runs) are logged to `app.jarvis_action_audit_log` for review and accountability
   - **#538** — Unified person/contact model: new `people` module builds a per-user knowledge graph of people (identities, links to emails/calendar/notes, match candidates, 7 assistant tools)

   ## Advisory follow-up
   - `packages/people/src/service.ts` has 2 direct Kysely queries outside the repository layer (RLS-safe but violates layering invariant) — track as tech debt.

   ## Suggested doc format
   - One paragraph per feature with the "so what" framing for a non-technical user
   - Link each to the merged PR
   - Publish as `docs/WHATS_NEW.md` or inline in the README
   EOF
   )"
   ```
6. **Update manifest** to record cleanup complete + capabilities issue filed.
7. **Commit and push** the coordinator worktree branch.
8. **Wrap up**: message Ben that the run is complete with the capabilities issue link.

---

## Security advisory (non-blocking, for follow-up)

`packages/people/src/service.ts` — `resolve()` (L28-33) and `splitIdentity()` (L148-153, L166-171) issue raw Kysely queries directly instead of going through `PeopleRepository`. RLS is still enforced (both call `assertDataContextDb` first). Violates the layering invariant; recommend a follow-up PR to move these into the repository.

---

## No active build agents

All 6 issues merged. Fleet is clear. This is a pure cleanup + wrap-up relay.
