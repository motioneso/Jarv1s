# Spec — Per-user chat-model override (admin-gated) (#241)

**Status:** approved (Ben, 2026-06-15, via coordinate grill)
**Epic:** #234 · **Issue:** #241
**Tier:** `sensitive` (changes chat routing + adds admin governance surface).
**Migration:** **likely required** — a per-model `allow_user_override` flag on the AI model-config
table (`packages/ai`). → this task is **migration-serialized** (claim number at merge; next free
≥ 0090, wellness at 0089), NOT a no-migration quick task.

## Problem

The Assistant & AI pane (`settings-ai-pane.tsx` `ChatModel`) lets a user pick which model powers
their chat, layered on the admin-configured instance routing. Today it's localStorage-only with a
`NotWired` banner and no effect on routing. There is no per-user override machinery in `packages/ai`
yet.

## Locked decisions — admin-gated, global + per-model combo

1. **Global admin toggle** "Allow users to override their chat model" — instance-level, **default
   OFF**. OFF ⇒ the user pane shows a **read-only** line (the instance default model), no picker.
2. **Per-model allow flag** — only relevant when the global toggle is ON. **Default: every
   chat-capable model is available for override.** The admin can toggle _individual_ models OFF to
   exclude them (e.g. a costly subscription model). Rationale: one switch to enable; per-model
   exclusions are opt-in so the admin never has to micromanage.
3. **User override** — when allowed, the user picks from the allowed set (the instance default is
   always present). Stored per-user in `app.preferences` (key e.g. `chat.modelOverride`), **no
   migration** for the user side.
4. **Resolution / fallback** — the chat capability resolves to the user's override **only if**:
   global-toggle ON **and** the chosen model is allow-flagged **and** the model/provider still
   exists. Otherwise fall back to the instance default. A dangling override (model removed or later
   disallowed) silently degrades to default — never errors, never blocks chat.

## Build outline (contract)

- **AI package (`packages/ai`):**
  - Add `allow_user_override` (bool, default true) to the model-config table → **new migration**.
  - Extend model-config read/write (repo + admin route) to carry the flag.
  - Add an instance-level "allow chat-model override" setting (global toggle) — store in
    `app.preferences` (instance scope) or the existing instance-settings surface; no migration if
    using preferences/instance-settings.
  - Override resolution: at chat capability resolution for a user, apply the locked fallback logic.
- **Admin pane (`settings-ai-admin-pane.tsx`):** the global toggle + a per-model "available for user
  override" control on each model row. (Coordinate with #252/#253 — same admin AI pane; avoid file
  collision / serialize.)
- **User pane (`settings-ai-pane.tsx` `ChatModel`):** gate the picker on the global toggle +
  allowed-model set; persist the override via a new self route → `app.preferences`; remove
  `NotWired` + the `BACKEND-TODO`. When gated off, render the read-only instance-default line.
- **Shared contract (`packages/shared`):** types/route-schemas for the user override + the admin
  flag. (Collides with other settings tasks editing `platform-api.ts` — serialize / new sections.)

## Invariants / guardrails

- **Provider-agnostic.** The user only ever selects among admin-configured, chat-capable models —
  a preference layered on the router, never a hardcoded provider/model.
- **Per-user, owner-only.** Override pref is owner-scoped (preferences RLS). Admin global toggle +
  per-model flags are admin-only writes.
- **Secrets never escape.** Model-config responses already must not leak credentials — preserve.
- **No chat breakage.** Resolution must always yield a usable model (fallback to instance default).

## Out of scope

- The persona bundle (#240 — separate, same pane: coordinate file edits in `settings-ai-pane.tsx`).
- Admin provider test-connection / auto-detect / routing persistence (#252/#253) — separate, but
  **same admin pane + same `packages/ai` surface → must be serialized with this task.**

## Verification

- Unit: override resolution truth table (global off → default; global on + allowed + present →
  override; global on + disallowed → default; global on + allowed + removed → default).
- Integration: admin sets global on + allows model X; user A overrides to X and chat resolves to X;
  user B (no override) resolves to default; global off → user override ignored (read-only); RLS —
  user cannot read/set another user's override, non-admin cannot flip the global toggle or per-model
  flags.
- Manual: flip the admin toggle, exclude one model, confirm the user picker reflects the allowed set
  and chat actually uses the chosen model.
