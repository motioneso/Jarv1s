# Spec — Corrections log (#244)

**Status:** approved (Ben, 2026-06-15, via coordinate grill)
**Epic:** #234 · **Issue:** #244
**Tier:** `sensitive` (memory lifecycle; LLM-driven writes to user beliefs).
**Migration:** the shared corrections store (**same store as #243's suppression** — build once).
Migration-serialized (claim # at merge; next free ≥ 0090).
**Shares store with #243.** Depends on the `chat.extract-facts` job + #242 provenance.

**Current implementation note (2026-06-18):** #243 has landed. The shared store exists as
`packages/memory/sql/0092_inferred_patterns_suppression.sql` and
`app.chat_memory_suppressions`; current migration head is ≥ `0095`. Implement #244 by adding a new
forward migration that extends/reuses that table and repository. Do **not** edit `0092`.

## Problem

The memory pane's "Corrections" row is `coming` ("Times you've put Jarvis right. It learns from
every one."). No corrections surface exists.

## Locked decisions — Option B (LLM-captured, not rejections-only)

1. **NL comprehension is free** — the chat is an LLM and already runs a post-chat extraction job
   (`CHAT_EXTRACT_FACTS_QUEUE` = `chat.extract-facts`, gated by `factsEnabled`). Capturing
   corrections is **wiring into that existing pass**, NOT a from-scratch NL/NLP build.
2. **Corrections come from two sources, one shared store/log:**
   - **#243 rejections** — rejecting an inferred pattern writes a `rejected` correction entry.
   - **In-chat corrections** — the extract-facts pass detects when the user corrects/contradicts an
     existing belief ("no, it's X not Y"), records a `corrected` entry, and **updates or suppresses
     the wrong fact**.
3. **Honest framing.** "Learns from every one" = the real suppression/update that happens (rejected
   inferences don't return; corrected facts get fixed) — not a vague claim. The log is a truthful
   transparency surface.

## Build outline (contract)

- **Shared corrections store** (the #243 store): owner-scoped table — actor, timestamp, kind
  (`rejected` | `corrected`), the affected fact signature/id, before/after (for `corrected`),
  optional source (`chat` | `pattern-reject`). Owner-only RLS. Build once (whichever of #243/#244
  lands first creates it; the other extends).
- **Extract-facts extension:** in the `chat.extract-facts` job, have the LLM extraction also emit
  _corrections_ (a belief the user overrode). For each: write a `corrected` entry + update the fact
  (and/or suppress the old value via the #243 signature mechanism). Keep the job payload
  **metadata-only** (no content/secrets).
- **Read route + UI:** `GET /api/chat/memory/corrections` (owner-scoped, paginated); render the
  "Corrections" section in `settings-memory-pane.tsx` (drop `coming`) — a chronological log of what
  you put right. (Coordinate with #242/#243/#245 on this pane.)

## Invariants / guardrails

- **Owner-only.** Corrections store + route owner-scoped (RLS).
- **Metadata-only job payload.** The extract-facts job carries actor/ids, never conversation
  content or secrets.
- **Truthful.** Only log a correction when something real changed (fact updated/suppressed);
  don't fabricate "learning."
- **Never edit applied migrations.**

## Out of scope / risks

- **Extraction reliability** is a prompt-quality concern (the LLM must reliably catch genuine
  corrections vs noise) — tune in the extract-facts prompt; false positives should be cheap to
  forget (#245). Not new infra.
- Richer correction analytics / feeding corrections back into ranking — future.

## Verification

- Integration: rejecting an inferred pattern (#243) writes a `rejected` correction row; a chat turn
  that corrects a stored belief produces a `corrected` row + the fact reflects the new value (and old
  value suppressed); corrections route is owner-scoped (B can't read A's); job payload carries no
  content.
- Manual: correct Jarvis in chat → the Corrections log shows it and the belief is fixed.
