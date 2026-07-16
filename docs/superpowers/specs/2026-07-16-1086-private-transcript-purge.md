# Spec — #1086: private-transcript purge — 3 open privacy defects

Lane B. Status: APPROVED (Fable, delegated auth 2026-07-16). Build = `gpt-5.6-sol`, QA = Opus (privacy).

## Decisions (locked)

- **F1 (codex path cross-check):** stop trusting a path reconstructed from local-time UUIDv7 components. Locate the real rollout by **globbing `~/.codex/sessions` by session id / content identity** (`codexTranscriptMatchesIdentity` already exists at line 123 — use it as the authority). **Never report purge success on a not-found path** — leave the retry pointer (bookkeeping row) intact so a later sweep retries.
- **F2 (agy-print crash window):** capture agy conversation identity **eagerly at spawn** (not lazily on first `readNew`), and have the boot/crash sweep in `purgePrivateTranscripts` **also scan the on-disk `.jarvis-agy-session.log` path**, not just the marker file. `clearNeutralBase` must not erase the only pointer before the on-disk log is checked.
- **F3 (purge-races-live-CLI) — OWNER CALL, decided:** **keep the retry pointer until a post-exit sweep verifies absence.** Do NOT switch to synchronous await-engine-exit in teardown (that risks hanging teardown on a stuck CLI — the reason the plan-mandated reorder exists). Instead: a purge that runs while the engine process is still alive is **non-authoritative** — it best-effort `rm`s but must **not** delete the bookkeeping row; only a post-exit sweep that confirms the file is gone clears the row. This composes with F1 (never-clear-on-not-found) and F2 (boot sweep scans on-disk logs) into one coherent rule: _the bookkeeping row is the retry pointer and is only cleared once absence is confirmed after the engine has exited._

## Files

- `packages/chat/src/live/private-transcript-cleanup.ts` — F1: rewrite `purgeCodexTranscript` (line 144) to glob-and-verify via `codexTranscriptMatchesIdentity`; return false / retain pointer on not-found. F2: `purgePrivateTranscripts` (line 161) scans the agy on-disk log path.
- `packages/chat/src/live/agy-print-chat-engine.ts` — F2: eager identity capture at spawn (`captureAgyConversationIdentity`).
- `packages/chat/src/live/chat-session-manager.ts` — F3: private teardown treats an alive-process purge as non-authoritative; row cleared only by post-exit verified-absence sweep.

## Tests

- Unit for F1 that builds the codex rollout file with a **name deliberately offset** from the reconstructed local-time path (the existing fixtures can't catch this) → purge must still find + remove it, and must NOT report success if the file is genuinely absent.
- Unit for F2: simulate crash before `readNew` (marker absent, on-disk agy log present) → sweep finds and purges via the log.
- Unit for F3: purge while process "alive" recreates the file after `rm` → bookkeeping row survives; post-exit sweep then confirms absence and clears the row.

## Exit criterion (UAT/runtime — privacy)

Dev-instance runtime proof, not unit-only: run a private codex turn and a private agy-print turn, exercise the kill/crash cases, and confirm with a filesystem check that no transcript remains in `~/.codex/sessions` / the agy log path after purge. Opus privacy sign-off.
