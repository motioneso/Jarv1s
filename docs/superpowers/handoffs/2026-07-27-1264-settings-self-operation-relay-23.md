# Relay 23 handoff — #1310 (PR #1276), item 9 live-path proof

Read relay-22 first if needed. Full narrative: `memory_smart_search("1310 live-path uat theme mode confirmation")`, project `jarv1s`.

## State as of end of relay 23

- **Gate: GREEN**, unchanged from relay 21/22.
- **Item 9: REAL BUG CONFIRMED, not yet fixed.** The earlier "DOM never flips" was a red herring — my Playwright script never clicked the chat drawer's "Approve" button (theme writes are confirmation-gated, `packages/ai/src/gateway/gateway.ts:574`, 150s timeout). Fixed the script (click `role=button name="Approve"` after sending the message — see `apps/web/src/chat/action-request-card.tsx:84-92`) and reran against a live instance (real login, real chat turn, no mocks).
  - **DB write DID land**: `app.preferences` key=`themes.color-mode` went `"dark"`/rev=1 → `"light"`/rev=2, timestamp matches the approval click.
  - **DOM did NOT flip** (`data-color-mode` on `<html>`) within 30s of the confirmed write. This is now a real, reproduced #1310 regression — not a timeout artifact.
- **Ruled out**: `resolveQueryKeyToken("settings.themes")` resolves correctly (`apps/web/src/api/query-keys.ts:24`). The manifest correctly declares `affectsQueryKeys: ["settings.themes"]` on the tool (`packages/settings/src/manifest.ts:461-472`). Both emitter and resolver look correct by inspection — the break is elsewhere in the chain.
- **Anomaly, not yet investigated**: `packages/settings/src/manifest.ts:465-467` declares `selfOperationGrant: "granted_at_install"` and `executionPolicy: "auto"` for `settings.themeMode.set` — reads like it should skip confirmation entirely, yet the live run demonstrably went through the Approve-gated flow. Never found why. There are two `awaitResolution` call sites in `gateway.ts` (lines ~329 and ~524) — didn't locate the branch point that's supposed to route "auto"/"granted_at_install" tools around confirmation before context ran out.
- **Env-leak side finding, already reported to Coordinator**: `AGENTMEMORY_SECRET` (real 64-char credential) leaks into any dev server launched via `nohup` from inside an agent's own Claude Code shell — same mechanism as the already-known `CLAUDECODE`/`ANTHROPIC_BASE_URL` leak, but I missed stripping this one in the relay-22 "clean" relaunch. Verified zero occurrences of the literal secret value in either api log file. No exfil surface existed (nested `claude -p` children run `--strict-mcp-config`, no bash/file tool), but flagged to Coordinator as their call, not just hygiene. Also flagged: any prior agent-run UAT that nohup's the dev server from its own shell inherits that agent's `ANTHROPIC_BASE_URL` too — prior UAT runs across lanes may be non-representative of a clean environment.

## Next step (do this first)

1. Instrument the actual SSE wire payload for a `themeMode.set` turn — temporarily `console.log` in `apps/web/src/chat/use-chat-stream.ts`'s `action_result` case (~line 70, ~206-209), or intercept via Playwright, to see whether `affectsQueryKeys` arrives non-empty over the wire for this specific tool.
   - If it arrives empty/missing → bug is server-side between `gateway.ts`'s `action_result` emit (line ~583-589) and the SSE serialization — check `record.outcome === "executed"` condition actually matches, and whether `found.tool.affectsQueryKeys` is even reaching that emit call for this tool instance.
   - If it arrives non-empty → bug is downstream of the query-key layer: check what `apps/web/src/shell/app-shell.tsx`'s invalidation `useEffect` (lines ~196-214) actually does when it fires — is `invalidateQueries` triggering a refetch, and does whatever sets `data-color-mode` on `<html>` actually subscribe to the `["settings","themes"]` query, or is that DOM attribute driven by something else entirely (a separate theme context/effect that doesn't re-read on invalidation)?
2. Live instance for retesting: api pid `1337883` on :3000 (clean env, log `/tmp/dev-api-relay23-clean.log`), web on :5173 (unchanged). Reusable script: `/tmp/claude-1000/.../scratchpad/live-uat-1310.spec.ts` + `live-uat.config.ts` (already fixed with the Approve-click step, timeouts: 150s for the card, 30s for the DOM flip post-approval).
3. Once the DOM-flip bug is actually fixed, rerun the same script to prove item 9, then move to item 10.
4. Separately (lower priority, can be a follow-up issue rather than blocking #1310): resolve the `granted_at_install`/`executionPolicy:auto` vs. actual-confirmation-required anomaly in `gateway.ts` — worth a quick look since it may indicate the confirmation-skip logic itself is broken more broadly, not just for this tool.
5. Coordinator is at herdr pane labeled "Coordinator" (re-resolve via `herdr pane list`, don't reuse a remembered pane id). They already have the root-cause-so-far + env-leak report from relay 22/23; they're expecting the pass/fail result of the DOM-flip rerun, which is: **fail, real bug, still open**.

## Coordinator corrections (accepted, binding — carry verbatim)

- Root cause = an undriven confirmation gate (user_promotable = ask by default) = **expected product behavior, not a #1310 defect**. Coordinator retracts `resolveQueryKeyToken` as prime suspect based on the evidence above. Fail-closed `resolveQueryKeyToken` STAYS and must not be widened — that ruling is unaffected.
- The corrected script shape **is** the live-path proof: send chat message → wait up to 150s for the card → click `role=button name="Approve"` → assert DOM flip within 30s, with NO manual refresh. **The DOM-flip-after-approval assertion is the actual claim under test** — that's what's still failing (see above: DB updates, DOM doesn't flip in 30s post-approval).
- A `/api/mcp` response near 150012ms is the **DENIAL** (`NATIVE_CONFIRM_TIMEOUT_MS=150000`), never a slow success — don't reinterpret a ~150s response as "it's just slow."
- Env scrub must be an **ALLOWLIST** (`env -i` + explicit vars), never `env -u` (denylist). The `-u` denylist used in relay 22 missed `AGENTMEMORY_SECRET`. Coordinator is surfacing that to Ben separately — successor does not need to act on it.
- Successor: same worktree/branch (`1264-settings-self-operation`), `--model sonnet`, `--tab w1:agents`. Report to Coordinator (session `43e5f5e2-0deb-4ab5-9237-436e8795b611`, pane label "Coordinator", re-resolve via `herdr pane list`). Items 9 then 10 remain, in that order.

## Task #4 (item 10, still pending, unchanged)

`coordinated-wrap-up`: push, update PR #1276 body (exit criteria status, mocked-SSE-e2e gap statement, external-module `affectsQueryKeys` validation limitation, live-proof link once item 9 actually passes, the news/sports manifest `as const` credential-type heads-up for lane #1265/PR #1273's rebase — commit `1146a76e`), report to Coordinator. **Do not merge.**
