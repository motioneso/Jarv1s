# Spec: Admin "YOLO" auto-approval mode

- **Issue:** #510 (`enhancement`, `needs-spec`)
- **Status:** approved
- **Author:** Stanley (spec agent)
- **Date:** 2026-06-29

## Problem

Every non-read tool call in Jarvis chat blocks on a human Approve/Deny prompt
(`AssistantToolGateway.callTool` → `resolvePolicy`). Writes confirm unless their
action-family is promoted to `trusted_auto`; **destructive tools always confirm** with
no escape hatch. A power user who fully trusts Jarvis is interrupted on every action.

#510 asks for a **"YOLO" mode**: an admin-controlled, blanket auto-approval that runs
tool calls without asking. The admin can enable it for their own account, allow
individual accounts to use it, and govern it instance-wide.

## What YOLO is (and is not)

YOLO removes the **human-in-the-loop confirm only**. Selecting YOLO is an explicit
absolution of blame: the user accepts that Jarvis will act — including permanent
deletions — without asking.

YOLO does **not** weaken any hard invariant:

- RLS, `AccessContext`, private-by-default, and the `DataContextDb` scoping are
  untouched. YOLO auto-runs only the actor's **own already-authorized** tool calls; it
  never grants cross-user access or admin private-data bypass.
- Secrets, metadata-only payloads, module isolation — all unchanged.

It is purely an override of the confirm gate.

## Decisions (locked with Ben, 2026-06-29)

- **D1 — Blanket auto-approve.** YOLO auto-runs every chat tool call that would
  otherwise confirm, skipping the Approve/Deny step.
- **D2 — Lifts the destructive floor.** YOLO auto-runs **write AND destructive** tools
  alike. This is the point of the feature; safety comes from it being explicit,
  off-by-default, admin-gated, fully audited, and instantly revocable — not from
  carving out destructive.
- **D3 — Three-bit state model:**
  - `yolo.instance_enabled` — admin **master**. Gates everything below. Enabling it
    **auto-flips the enabling admin's own `enabled` on**.
  - `yolo.allowed[userId]` — per-account **eligibility**, admin-controlled. Whether a
    given user may self-enable. Does **not** auto-enable the user.
  - `yolo.enabled[userId]` — the individual's **own on/off**. Self-set by the admin and
    by any allowed user. Never auto-flipped for non-admins.
- **D4 — Authority = `is_admin`.** Any admin (not bootstrap-owner-only) controls the
  instance master and the per-account allowlist. Deliberate exception to the
  `assertBootstrapOwnerAdminUser` gate used by other instance settings — the owner
  promotes admins knowing it conveys these powers, and most instances have a single
  admin anyway.
- **D5 — Blast radius = interactive chat only.** YOLO short-circuits the
  `AssistantToolGateway.callTool` confirm gate and nothing else. Background, scheduled
  (briefings), and agency/non-interactive execution keep their existing policy
  unchanged. A future autonomous milestone may read the same flag.
- **D6 — Cascade / kill-switch (per-call resolution → instant):**
  - Master **off** → global revert to confirm for every account (admins included) on
    the next tool call. Per-user `allowed`/`enabled` bits are **preserved but inert**;
    master back on resumes prior states (admin's own re-flips on).
  - Admin revokes a user's `allowed` → that user's `enabled` is **forced off**
    immediately and the self-toggle disappears.
  - User self-disables `enabled` → only them; their `allowed` eligibility stays.
  - An in-flight, already-approved call is unaffected; the very next call re-checks.
- **D7 — Visibility & audit:**
  - No Approve/Deny card. Still emit the **after-the-fact `action_result`** event so
    the chat drawer shows what ran (tool + summary + outcome).
  - Persistent **"YOLO mode" danger indicator** in the chat header so auto-action is
    never silent.
  - Every YOLO auto-run writes an audit row with a **new distinct
    `approval_mode: "yolo"`** (separate from the existing `"auto"` used by
    `trusted_auto` families), so destructive auto-runs are unambiguous in review and
    exports. Requires a migration (see Storage).
- **D8 — UI placement:**
  - **Admin controls** (master enable, per-account allowlist, "allow all") → existing
    **admin settings pane** (`settings-admin-panes.tsx`), in a danger-styled
    "YOLO / auto-approval" section alongside user management.
  - **Personal on/off** → user's **AI / Assistant settings**, visible only when the
    user is allowed.
- **D9 — Resolution seam.** Add `resolveYolo(actorUserId)` evaluated in
  `callTool` **before** `resolvePolicy`. If YOLO active for the actor → treat as
  `"run"` for write and destructive, record `approval_mode: "yolo"`, emit the
  after-the-fact result card. If not active → fall through to today's exact
  `resolvePolicy` path (per-family tiers + destructive-confirm floor), unchanged.
  Read tools always run (unchanged). YOLO ON supersedes per-family `trusted_auto`
  state and **suppresses the tasks first-run notice**. YOLO OFF = all existing
  behavior intact.
- **D10 — "Allow all" = snapshot.** Grants every _current_ non-admin account. **Future
  accounts default off** — an admin must grant each newcomer explicitly. Pure
  per-account grants; no instance-level default-allow flag.
- **D11 — Name & friction.** User-facing label stays **"YOLO"**, subtitle e.g.
  _"Auto-approve every action without asking — including deletes."_ Enabling one's own
  YOLO (and the admin master, which flips the admin's own on) is gated behind a
  **single danger-acknowledgement dialog** ("I understand Jarvis will perform actions,
  including permanent deletions, without asking. I accept responsibility.") — one
  confirm click, not a typed phrase.

## Storage

- **Instance master** (`yolo.instance_enabled`) → `instance_settings` row via
  `SettingsRepository.upsertInstanceSetting`, written behind an `is_admin` check.
- **Per-account `allowed` + per-user `enabled`** → per-user storage, mirroring the
  #608 per-account `featureGrants` pref pattern (`featureGrantsPrefKey`). `allowed` is
  admin-written; `enabled` is self-written. Revoking `allowed` clears `enabled`.
- **Audit `"yolo"` value** → **new migration** in `packages/ai/sql/` (next global
  number) that drops and recreates the `approval_mode` CHECK constraint on
  `jarvis_action_audit_log` to add `'yolo'`. **Never edit applied migration 0127.**
  Extend the `approvalMode` union type in `packages/ai/src/repository.ts` to match.

## Build slices

1. **Core gate + audit.** `resolveYolo()` resolver (reads the three bits), wire it into
   `callTool` before `resolvePolicy`, emit after-the-fact `action_result` on auto-run,
   record `approval_mode: "yolo"`. New migration extending the CHECK constraint +
   `approvalMode` union. Unit tests: write auto-runs, destructive auto-runs, master-off
   reverts, revoke-forces-off, reads unchanged, OFF path identical to today.
2. **Admin controls.** `is_admin`-gated routes + admin-pane section: master toggle,
   per-account allowlist with "allow all" (snapshot) and exclusions, revoke cascade.
3. **Personal toggle + chat surface.** AI/Assistant-settings self-toggle (visible only
   when allowed), danger-acknowledgement dialog on enable, persistent "YOLO mode"
   indicator in the chat header, drawer after-the-fact result cards.

## Non-goals

- Background / scheduled / autonomous execution (separate agency / non-interactive
  milestones).
- Per-tool or per-module YOLO granularity — the existing per-family `trusted_auto`
  system already covers granular trust.
- Any change to RLS, cross-user access, secret handling, or MCP-external client
  behavior.
- Type-to-confirm or multi-step enable friction.

## Process gate

Per the hard rule, before any build: this spec must be **approved** (Status → approved)
**and** a GitHub **task** issue cut (`Part of #510`). Build proceeds through the
model-diverse build/QA gate, not the spec agent.
