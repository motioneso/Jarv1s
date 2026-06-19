# Build Handoff — phase2-218-chat-thread-review

**Spec (approved):** GitHub issue #218 (RFA) + parent chat specs `docs/superpowers/specs/2026-06-08-jarvis-chat-design.md` and `docs/superpowers/specs/2026-06-12-p2-portable-cli-chat-adapter-design.md`
**GitHub issue:** #218
**Risk tier:** `security` (private chat history read endpoint / cross-user data boundary)
**Worktree:** `~/Jarv1s/.claude/worktrees/phase2-218-chat-thread-review` **Branch:** `phase2-218-chat-thread-review`
**Build skill path (absolute):** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019eded5-78ca-7251-adad-3e587178792c`
**Relay threshold:** observable, not felt — `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5` on your OWN pane and relay when its context/usage indicator shows ~2/3-3/4 consumed, OR after plan-approval + ~5-8 committed tasks, OR immediately on a compaction summary.

## Locked Scope

Phase A only: make historical chat sessions reviewable in the drawer.

- Wire a history/session row click to select a past thread.
- Load that thread's stored messages into the drawer using the existing chat persistence model.
- Add or expose `GET /api/chat/threads/:id/messages` only if it is not currently registered, returning the existing `ChatMessageDto` shape.
- Keep access owner-scoped through `DataContextDb`/RLS; another user must not be able to read the thread or messages.
- Render stored user/assistant messages in the existing `chatd-*` drawer skin, including stored activity/tool metadata where available.
- Make historical review clearly read-only. Sending stays on the current/new live chat path; do not imply the live CLI transcript has resumed.

## Non-Goals

- True send/resume on an old session.
- Summary generation, context seeding, CLI-adapter injection, or provider replay.
- New chat UI styling beyond the minimum state needed to distinguish historical review from live chat.

## Acceptance

- Clicking a past session shows that thread's stored messages in the drawer.
- The selected historical thread is visually distinct from the live/current chat state and cannot accidentally accept a send as if the CLI transcript were resumed.
- API coverage proves owner scoping for thread messages.
- Frontend coverage proves clicking a history row renders stored messages.
- Relevant gates pass for the touched slice.

## Start

1. `[ -d node_modules ] || pnpm install`
2. Read this handoff, issue #218, and the parent chat specs listed above.
3. Invoke `coordinated-build`; write a plan and send it to `Coordinator` for approval before coding.
4. Build only after plan approval. Commit by explicit paths only.
5. On done, invoke `coordinated-wrap-up`: open PR, post evidence, then report to `Coordinator`.

## Collision Notes

- Main is complete deploy-readiness at `ccc65e7` with migrations through `0100`.
- Do not touch `docs/coordination/` except this handoff unless the coordinator asks.
- Security-tier overnight consensus applies after PR: builder is Codex; reviewers must be two other available models where possible (GLM 5.2 and Gemini Pro preferred).
