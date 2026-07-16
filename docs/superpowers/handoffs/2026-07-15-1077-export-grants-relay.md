# Relay — #1077 export worker grants audit

## Authority and scope

- Approved spec: `docs/superpowers/specs/2026-07-15-1077-export-worker-grants.md`.
- Coordinator: exact label `UX Coordinator`, session
  `019f68a1-899f-7cc1-bba5-2159ae14aaed`.
- Branch/worktree: `ux/1077-export-grants` in
  `~/Jarv1s/.claude/worktrees/ux-1077-export-grants`.
- Security tier. No implementation edits exist yet.

## Audit checkpoint

`export.build` reads roughly 37 owner-scoped tables through `scopedDb.db` as
`jarvis_worker_runtime`. Codebase-memory graph tools were unavailable in the first session, so it
used literal/source fallback.

Confirmed missing worker `SELECT` grant and exact owner-only worker policy:

- `app.notification_reads`
- `app.entities`
- `app.ai_assistant_action_requests`
- `app.jarvis_action_audit_log`

Confirmed already covered: `usefulness_feedback_signals`, `usefulness_feedback_targets`,
`commitments`, and `preferences`.

The remaining export tables still require individual verification; do not infer coverage from
spot checks. The previous agent's compact list was: task activity, notifications, connector
accounts, module credentials/KV, calendar events, email messages, AI provider/configured-model
tables, chat threads/messages, briefing definitions/runs, memory tables, goals/evidence,
chat-memory facts, users, tasks, medications/logs, and any other table actually reached by the
current export code.

## Approved plan direction

Coordinator approved full audit as Task 1 of the plan. Verify every worker-scoped export table,
record existing vs missing access, then add module-local migrations only for confirmed gaps. Do
not stop after the four known gaps.

After the audit:

1. Write the smallest TDD plan covering populated-all-tables export success, worker write denial,
   exact owner-visible policies, and migration inventory/hash expectations.
2. Send the compact plan pointer to the coordinator for final approval before editing.
3. Defer failure-handler transaction hardening and unrelated cleanup.

At 65% context, checkpoint and request a manual relay; never enter compaction.
