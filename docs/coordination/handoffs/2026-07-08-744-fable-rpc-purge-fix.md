# Build Handoff addendum — private-chat-mode (#744), Fable 5 takeover

**Read `docs/coordination/handoffs/2026-07-08-744-private-chat-mode.md` FIRST** (spec, tier,
run-specific bans, collision notes — all still in force). This file only covers what changed
since that doc was written: three QA cycles, a scope narrowing, and now a model handoff.

**Worktree:** ~/Jarv1s/.claude/worktrees/744-private-chat-mode **Branch:** `744-private-chat-mode`
(currently at `8210ad7d`, PR #865 open against `main`)
**Coordinator label:** `Coordinator` — verify `herdr pane list` shows exactly one such pane,
resolved fresh, before messaging.
**Coordinator session id:** `dd633e5d-f3b5-4643-8108-5f173028c26d` (current tenure).

## Why you're taking this over

A Codex agent built this PR across 3 QA cycles (all Opus adversarial, security tier). Cycles #1
and #2 found the transcript-purge guarantee broken via different edge paths (stale-session
reconcile, engine-less boot sweep) and were fixed. Ben then had scope narrowed to Claude +
Codex-interactive only, deferring Gemini/non-interactive engines to follow-up issue #868
(Part of #744) — that narrowing is done and correct (confirmed by QA cycle #3).

**Cycle #3's remaining blocking finding is the reason for this handoff:**

`packages/chat/src/live/chat-engine-rpc-client.ts` (`ChatEngineRpcClient`, around lines 773-828)
has **no `purgeTranscripts` RPC verb at all**. `chat-session-manager.ts:894` calls into the engine
client to purge on-disk transcripts when a private session ends — this works against the
in-process `FakeEngine` test double (which implements it) but silently no-ops against the real RPC
client. Prod's deploy topology selects the RPC engine client (`docker-compose.prod.yml:66`), so
**ending a private session through the normal live-engine flow purges nothing on disk in
production** — the exact "private by default" guarantee this feature exists to provide. The
incognito DB row is deleted right after purge is (not) called, so the boot-time orphan sweep can
never retroactively catch this either.

Full verdict history is on PR #865 (`gh pr view 865 --json comments`, or just read the PR on
GitHub) — read cycle #3's comment in particular before starting; it also has two non-blocking
notes (Codex engine-less purge still matches per-user cwd rather than per-session — low severity,
optional to fix here; migration `0146`'s SECURITY DEFINER function is a system-wide read, which is
acceptable but worth a comment).

## Task

1. Add a real `purgeTranscripts` RPC verb: server side (wherever the RPC server dispatches verbs
   for the CLI-runner engine) and client side (`ChatEngineRpcClient`), so the call from
   `chat-session-manager.ts:894` actually reaches and purges the on-disk transcript over RPC, not
   just against the in-process fake. Follow the existing RPC verb pattern in this file/module for
   naming, error handling, and the request/response contract — don't invent a new shape.
2. Add a test that exercises the **real RPC path** (not just `FakeEngine`) for transcript purge on
   session end, so this class of gap can't recur silently. This was explicitly why cycle #3 missed
   it in existing tests — a same-shaped regression test would have caught it.
3. Optional (non-blocking, but the QA agent noted it, cheap to include if time permits): tighten
   the Codex engine-less purge branch in `packages/chat/src/live/private-transcript-cleanup.ts` to
   match per-session cwd rather than per-user/neutralDir.
4. Full local gate green (`pnpm verify:foundation`, `pnpm audit:release-hardening`), commit,
   rebase on `origin/main`, push, report back to the coordinator for QA cycle #4. Use
   `coordinated-wrap-up` conventions for the report format.

Do not touch Gemini/agy-print/codex-exec purge paths — that's #868, explicitly out of scope here.
