# Relay 24 handoff — #1310 (PR #1276), item 9 PASSED, gate rerun still owed

Read relay-23 first (`docs/superpowers/handoffs/2026-07-27-1264-settings-self-operation-relay-23.md`) for full background. This doc only covers what changed since.

## State as of end of relay 24

- **Item 9: FIXED AND PROVEN.** Root cause found: `packages/chat/src/gateway-notifier.ts`'s `toTranscriptRecord()` silently dropped `affectsQueryKeys` for `action_result` records (the field wasn't even declared on the server-side `TranscriptRecord` type in `packages/chat/src/live/types.ts`). The gateway (`packages/ai/src/gateway/`) correctly produced and emitted the field; `resolveQueryKeyToken` and the manifest's `affectsQueryKeys: ["settings.themes"]` declaration were both already correct (ruled out in relay 23). This is the same "undeclared field silently dropped" signature as the known `fast-json-stringify` trap, but the drop point here is a hand-written object-literal mapper.
- **Fix applied (2 files, ~2 lines):**
  1. `packages/chat/src/live/types.ts` — added `readonly affectsQueryKeys?: readonly string[];` to the `TranscriptRecord` interface.
  2. `packages/chat/src/gateway-notifier.ts` — in `toTranscriptRecord()`'s `action_result` branch, spread `...(record.affectsQueryKeys ? { affectsQueryKeys: record.affectsQueryKeys } : {})` onto the returned record.
- **Verified**: `pnpm --filter @jarv1s/chat --filter @jarv1s/web typecheck` clean. Reran `scratchpad/live-uat-1310.spec.ts` against a live dev instance (real login as ben@ben.com, real chat turn, no mocks, no reload) — `data-color-mode` on `<html>` now flips within ~9s of clicking Approve. **Item 9 (CLAUDE.md Live-Path Gate) is genuinely proven.**
- **#1311 note**: the "granted_at_install tool still required manual confirmation" anomaly from relay 23 is confirmed by the Coordinator to be issue #1311 (missing install-time grant row for the always-on `settings` module), NOT a #1310 defect. Lane #1311 (pane `w1:p14C`) owns that fix — do not duplicate.
- **Gate: NOT YET RERUN on this fix.** An attempted `pnpm verify:foundation` run was killed before completing because `dropdb`/`createdb` aren't on PATH in this shell — need the docker-exec or `JARVIS_PGDATABASE=<fresh-name>` pattern (see `verify-foundation-fresh-gate-db` in agentmemory) to get an isolated gate DB first. The last confirmed-green gate run (`rc=0`) predates this two-file fix.

## Next step (do this first)

1. Get a fresh gate DB (docker exec against `jarv1s-postgres`, or `JARVIS_PGDATABASE=<fresh-name>` — do NOT reuse a DB another lane might be touching), then run `pnpm verify:foundation`, capturing the real exit code to a log file (not piped — filter exit codes mask red per the `gate-db-isolation-mandatory` memory).
2. If green: proceed to **item 10 — `coordinated-wrap-up`**: push these two files, update PR #1276's body (exit criteria status: items 1–4 all pass now, include the affectsQueryKeys/gateway-notifier root cause + fix, the #1311 cross-reference, the news/sports manifest `as const` credential-type heads-up for lane #1265/PR #1273's rebase — commit `1146a76e`), report to Coordinator. **Do not merge** — that's the Coordinator's call.
3. If gate is red: diagnose before touching item 10; the fix itself is narrowly scoped (2 files, additive-only field) so a regression would be surprising but must still be run down for real, not assumed pre-existing.
4. Coordinator is at herdr pane labeled "Coordinator" (re-resolve via `herdr pane list` fresh — don't reuse a remembered pane id; last known session `43e5f5e2-0deb-4ab5-9237-436e8795b611`).
