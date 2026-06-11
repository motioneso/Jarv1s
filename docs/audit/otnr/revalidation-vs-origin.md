# OTNR Audit — Revalidation vs `origin/main`

**Date:** 2026-06-10
**Reason:** The original OTNR audit ran against a stale local `main` (HEAD `1601240`)
that was **34 ahead / 8 behind** `origin/main`. The 8 missing commits (PRs #93, #90,
#91, #89, #88, #87, #86, #85 — ~9,500 insertions) rewrote several audited areas,
including the #1 and #2 risk areas (settings module, users RLS). This revalidation
re-judged every affected finding against current `origin/main` (`240de7e`).

## Method

- Read-only `git worktree` pinned to `origin/main @ 240de7e` at `/tmp/jarv1s-origin`.
- 19 Opus agents (one per phase whose files changed). The 8 untouched phases
  (P7 vault, P12 memory, P13 calendar, P14 email, P16 notifications, P17
  structured-state, P19 jobs, P25 worker) had **zero** changed files between the
  audited HEAD and origin — their findings stand verbatim by file identity.
- Each finding judged FIXED / PARTIAL / MOVED / STILL_PRESENT against origin code,
  with concrete `file:line` evidence.

## Headline result

| Verdict | Count |
| --- | --- |
| **CLOSE** (fixed) | **0** |
| **UPDATE** (partial mitigation or line-number shift) | **32** |
| **STAND** (holds verbatim) | **90** |
| Total verdicts | 122 |

**No filed issue can be closed. All 59 OTNR issues (#113–#171) remain valid.**

## What the 8 commits actually changed (mitigations that did NOT eliminate a finding)

- **#113 (bearer token):** origin now adds a downstream account-status check
  (`pending`/`deactivated` rejected) — but the path is still an untyped
  session-id-as-API-key with no scope/hashing/per-key revocation/audit/rate-limit.
  → PARTIAL.
- **#119 (MCP allowlist):** gateway now bounds calls to the actor's active-module
  executable tools — but there's still no per-session capability allowlist. → PARTIAL.
- **#123 (tool-result verbatim):** raw `JSON.stringify(res.data)` replaced by
  `renderToolResult` — but still no size cap and no gateway-side `outputSchema`
  filtering; redaction stays a per-module convention. → PARTIAL.
- **#133 (model selection):** `selectModelForCapability` now walks an
  economy/interactive/reasoning tier ladder — but still no per-user pinned default;
  newest-created still wins within a tier. → PARTIAL.
- **#143 (connectors requireAdmin):** raw `app.users` table read replaced by the
  `app.get_user_by_id()` SECURITY-DEFINER helper — but the authz decision still runs
  on the **root `appDb` handle outside `withDataContext`**. → PARTIAL.

## New posture change introduced by the 8 commits (worth recording)

- **app.users now has a live admin cross-user RLS policy.** Migrations `0050`
  (`users_app_runtime_admin_update`) and `0052` (`users_app_runtime_admin_select`)
  grant `jarvis_app_runtime` full cross-user read+write on `app.users` whenever the
  actor GUC resolves to an active admin (`app.current_actor_is_admin()`, SECURITY
  DEFINER, fail-closes when the GUC is unset). `app.users` holds no secrets (auth
  secrets remain FORCE-RLS'd and revoked), so this is a **posture to document, not a
  secret-exposure hole** — but it extends the prior "ENABLE-not-FORCE" exception into
  a live cross-user write policy. (Original audit never saw this; it's a MOVED/expanded
  INFO item, not a regression per se.)

## Confirmed-still-present highlights (the audit's top risks all hold)

- **#155** `/api/me` still reads other users' workspace/membership rows through the
  unguarded raw-Kysely repo (correctness rests on a hand-written `WHERE` only).
- **#153** resource-grants admin surface still wired and still no-ops on access.
- **#120 / #128** dead workspaces subsystem still wired through bootstrap + settings
  routes + repository + shared DTOs.
- **#115 / #116 / #117** `resource_grants` / `workspace_memberships` / `instance_settings`
  still have app-runtime DML and **no RLS**. (0050 even *adds* writes to the RLS-less
  `instance_settings`.)
- **#118 / #121** AI/chat/MCP routes still unthrottled; MCP token-verify failures
  still unlogged.
- **#132** REST tool-invoke route still bypasses `AssistantToolGateway`.
- **#134 / #135** dead `chat_messages` UPDATE grant; `incognito` immutability still
  trigger-less.

## Bottom line

The original audit and all filed issues stand. The 8 commits the audit missed added
incremental, convention-level mitigations and one new admin RLS policy, but eliminated
**zero** findings. Line numbers in ~26 issues have shifted; the substance has not.

_Full machine-readable verdicts: workflow run `wf_85a5cf90-2d2`
(`docs/audit/otnr/revalidate-workflow.js`)._
