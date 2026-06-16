# Spec — Inferred patterns: confirm / reject (#243)

**Status:** approved (Ben, 2026-06-15, via coordinate grill)
**Epic:** #234 · **Issue:** #243
**Tier:** `sensitive` (memory lifecycle — deletion + suppression of user beliefs).
**Migration:** likely — a suppression record store (**shared with #244 corrections log**;
build that store once). Migration-serialized (claim # at merge; next free ≥ 0090).
**Depends on:** #242 (provenance). Shares the suppression/corrections store with **#244**.

## Problem

The memory pane's "Inferred patterns" row is `coming` ("Guesses from your behaviour, awaiting your
yes or no"). Inferred beliefs sit alongside remembered facts with no way to confirm or reject them.

## Locked decisions

1. **Scope: inferred patterns = inferred `chat_memory_facts`** (provenance=`inferred`, from #242),
   gated by the already-real "Learn patterns" toggle (`factsEnabled`). **No new pattern-mining
   engine** — none exists; richer behavioral-pattern derivation ("you always skip Monday standups")
   is a **future milestone**, not this task.
2. **Confirm → `confirmed`.** Sets provenance `inferred`→`confirmed`; the fact graduates from
   "Inferred patterns" to "Remembered facts." No deletion.
3. **Reject → delete + suppress.** Delete the inferred fact AND write a **suppression record** so the
   same inference isn't re-surfaced. The fact-extraction path consults the suppression list before
   creating a new inferred fact (skip if it matches a suppressed signature). **The suppression
   record IS a corrections-log entry** (#244) — one shared store, not two.

## Build outline (contract)

- **Suppression/corrections store** (shared with #244): owner-scoped table keyed by a stable
  **signature** of the rejected inference (e.g. normalized fact content/category hash) + actor +
  timestamp + reason (`rejected`). Owner-only RLS. (If #244 lands first, reuse its table; otherwise
  build it here and #244 extends it.)
- **Routes (self, owner-only):**
  - confirm: `POST /api/chat/memory/facts/:id/confirm` → provenance `confirmed`.
  - reject: `POST /api/chat/memory/facts/:id/reject` → delete fact + insert suppression record.
- **Extraction guard:** before creating an `inferred` fact, the extraction path checks the
  suppression store by signature and skips suppressed ones.
- **UI:** `settings-memory-pane.tsx` — "Inferred patterns" section lists inferred facts with
  yes/no (confirm/reject) actions; confirm moves it to remembered, reject removes it; remove
  `coming`. (Coordinate with #242/#244/#245 on this same pane — serialize or scope to distinct
  sections.)

## Invariants / guardrails

- **Owner-only.** Confirm/reject/suppression all owner-scoped (RLS); a user acts only on their own
  facts.
- **Suppression is content-signature based**, not id-based (a re-inferred fact gets a new id but the
  same signature → stays suppressed).
- **No re-nag.** Once rejected, the same inference must not re-appear (extraction guard).
- **Never edit applied migrations.**

## Out of scope

- Behavioral-pattern mining engine (future milestone).
- The broader corrections log surface (edits/corrections beyond rejections) → **#244** (this spec
  only writes `rejected` entries into the shared store).

## Verification

- Integration: confirm an inferred fact → provenance `confirmed`, appears under remembered; reject →
  fact deleted + suppression row written; re-running extraction on the same content does NOT recreate
  it (suppressed by signature); per-user isolation (A's rejection doesn't affect B); non-owner can't
  confirm/reject.
- Manual: yes/no on an inferred pattern behaves correctly; rejected items don't return.
