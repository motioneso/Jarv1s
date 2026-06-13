# Plan Review Log: Portable CLI Chat Adapter (Phase 2, epic #47)

Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.

- **PLAN_FILE:** `docs/superpowers/plans/2026-06-12-p2-portable-cli-chat-adapter.md`
- **Grill-locked decisions:** herdr backend in v1; PreToolUse policy deferred; multiplexer is admin-settings-selectable + auto-detecting (applies on restart; `auto` tie-break = herdr if `HERDR_ENV=1`, else tmux); `JARVIS_MULTIPLEXER` env override retained as escape hatch.
- **Act 2:** Codex (read-only) adversarial review, Claude final arbiter on every REVISE.


## Round 1 — Codex

Grounded on `5c4e0bd` with `pnpm audit:preflight` passing. I did not modify files.

**Findings**

1. **Raw `rootDb` read widens a documented hard-invariant exception.** `packages/module-registry/src/index.ts:66-69` and `packages/settings/src/bootstrap.ts:13` say the raw Kysely handle is the only route-layer/bootstrap exemption, but Task 13 adds another raw `app.instance_settings` read. RLS allows it (`0059_admin_tables_rls.sql:27-30`), but the plan does not update the security contract.
Fix: either add a formal “non-secret pre-auth instance config” exemption in the standards/comments with key allowlisting, or expose a narrow SECURITY DEFINER read helper instead of ad hoc root selects.

2. **503 behavior is under-tested and likely missed on the actual live route.** Task 10 focuses on `packages/chat/src/routes.ts`, but live launches fail through `packages/chat/src/live-routes.ts:164-187`; without an explicit `CliChatUnavailableError` branch there, “no multiplexer” becomes the generic 500 path.
Fix: add the 503 branch in `live-routes.ts` and a route-level test where `engineFactory` throws `CliChatUnavailableError`.

3. **`JARVIS_MULTIPLEXER` bypassing the install probe can produce fake-success launches.** The resolver instantiates tmux/herdr even if the binary is missing, and the proposed `open()` implementations do not check command exit codes before returning a handle.
Fix: either do not bypass a minimal executable/version check, or make every backend command validate `code === 0` and convert launch failure to `CliChatUnavailableError`.

4. **Herdr root-pane selection is unsafe.** The plan defaults to the first `herdr pane list` result; real local output lists existing Codex/Claude panes, so Jarv1s could split from an unrelated operator pane/workspace.
Fix: require `JARVIS_HERDR_ROOT_PANE`/workspace configuration for herdr, or derive a parent from the current `HERDR_PANE_ID`; do not use “first pane” as production default.

5. **Herdr parsing tests do not cover real failure modes.** The happy-path JSON shape is real, but the plan ignores nonzero exit codes, stderr, empty stdout, and send failures after split; unit tests only validate parsing a simplified envelope.
Fix: add command-result validation and tests for nonzero `pane list/split/send-text/send-keys`, using real workspace-prefixed pane IDs.

6. **Locked launch flags are preserved by instruction, not by a strong regression net.** Current tests cover some flags, but not exact command posture; for example Codex `-a never` is not asserted in the shown tests while `cli-chat-engine.ts:207-253` is security-critical.
Fix: add exact launch-line regression tests for Claude with/without MCP, Codex including `--sandbox read-only`, `-a never`, shell/apply_patch disables, and Gemini MCP restrictions.

7. **The plan claims spec coverage while deferring an approved in-scope security item.** The approved spec includes PreToolUse policy as in-scope, but the plan marks it as documentation-only follow-up.
Fix: either update the spec/acceptance criteria to explicitly defer PreToolUse, or implement the policy in this slice.

8. **Type/schema ownership will drift.** `ChatMultiplexerChoice` is introduced separately in `@jarv1s/ai`, `@jarv1s/settings`, and `@jarv1s/shared`.
Fix: define the enum/const once in `@jarv1s/shared` and have ai/settings consume or mechanically derive from it.

Non-finding: the “no `apps/api` change” claim is mechanically plausible because `apps/api` already passes `rootDb`, and Fastify accepts an `onReady` hook added from the existing `server.after()` route-registration callback. The issue is the widened security exception and missing failure tests, not basic availability of `dependencies.rootDb`.

VERDICT: REVISE

### Claude's response (Round 1)

Sandbox note: Codex's read-only sandbox could not initialize on this host (`bwrap: loopback: Failed RTM_NEWADDR` — kernel blocks the netns setup). With the user's approval, rounds run with `--dangerously-bypass-approvals-and-sandbox` and a git before/after check each round proves Codex wrote nothing. Round 1 verified CLEAN.

**Accepted all 8 findings.** Changes made to the plan:

1. **Raw `rootDb` exemption widening** — ACCEPTED. The boot read is restricted to an allowlist of non-secret keys, documented as the same sanctioned class as the existing auth `readBooleanSetting` gate, and recorded in `DEVELOPMENT_STANDARDS.md` (new Task 13 Step 1b). Admin GET/PUT still go through DataContextDb + `assertAdminUser`.
2. **503 missed on the live route** — ACCEPTED. Grounded the real path: `handleLiveRouteError` in `live-routes.ts:~164` (generic-500 fallback). Task 10 now adds the `CliChatUnavailableError → 503` branch there (and in REST `handleRouteError`) plus a route-level 503 test.
3. **Env override → fake-success launches** — ACCEPTED. Both backends' `open()`/`submit()` now check every command's exit code and throw on non-zero (a `runChecked` helper). A misconfigured override fails loudly. `kill()` stays idempotent.
4. **herdr "first pane" root is unsafe** — ACCEPTED. Grounded `HERDR_PANE_ID=p_51` exists. Root resolution is now `opts.rootPane` → `JARVIS_HERDR_ROOT_PANE` → `HERDR_PANE_ID` → hard error. Dropped the `pane list` fallback entirely.
5. **herdr failure-mode tests missing** — ACCEPTED. Added nonzero-exit tests for split/send-text/send-keys, a no-root-pane test, and realistic `p_NN` pane IDs.
6. **Launch flags by instruction, not regression net** — ACCEPTED. Existing tests already cover most flags; added the three unasserted ones: Claude `--permission-mode default` + `--strict-mcp-config`, Codex `-a never` (Task 9 Step 3), with a "do not weaken to pass" guard.
7. **Spec claims coverage while deferring PreToolUse** — ACCEPTED. Task 16 now updates the spec §6 + acceptance criteria to mark PreToolUse Deferred (not just the README); Self-Review §6 reworded.
8. **Type ownership drift** — ACCEPTED. `ChatMultiplexerChoice` is defined once in `@jarv1s/shared` (Task 6 Step 0); ai/settings/module-registry import it. Removed the duplicate declarations.

None rejected — this was a high-signal review.

## Round 2 — Codex

Grounded again on `HEAD=5c4e0bd`, `origin/main@5759b90`, preflight passing. No files modified.

**Findings**

1. **Herdr root-pane fix is incomplete at the resolver/composition layer.** Task 4 correctly removes “first pane” fallback, but Task 6 still decides `herdr` from only binary presence / `HERDR_ENV`, and Task 13 still treats that as a usable factory. If herdr is installed but no `JARVIS_HERDR_ROOT_PANE`/`HERDR_PANE_ID` is available, the app boots with a herdr backend that fails only at launch; the plan’s claim that “auto falls back to tmux” is not implemented by `decideMultiplexer`.
Fix: make herdr usability part of resolution: `herdrUsable = herdr binary && (JARVIS_HERDR_ROOT_PANE || HERDR_PANE_ID)`, use that for auto/configured availability, and return `unavailableEngineFactory` or tmux fallback at boot.

2. **Launch-time multiplexer failures still become generic live-route failures.** Exit-code checking prevents fake success, but missing binary via `JARVIS_MULTIPLEXER`, herdr socket failure, or no root pane throws plain `Error` from `mux.open`; `live-routes.ts` only maps `CliChatUnavailableError` to 503. That means several “host cannot launch multiplexer” cases still hit the generic 500 path.
Fix: introduce a chat-layer unavailable/launch error boundary around `engine.launch()` or `mux.open()` and map those failures to 503 with a sanitized message.

3. **The raw `rootDb` exception is documented globally but stale local comments remain.** The revised plan adds `docs/DEVELOPMENT_STANDARDS.md`, but does not update the existing “ONLY root-handle escape hatch” comment in `packages/module-registry/src/index.ts:66-69` or the “SOLE documented exemption” comment in `packages/settings/src/bootstrap.ts:13`.
Fix: update those comments in the same task so future reviewers do not see contradictory invariants.

4. **Task 6 modifies `packages/shared/src/platform-api.ts` but does not stage it.** Step 0 adds `ChatMultiplexerChoice` to shared, then the Task 6 commit stages only `packages/ai/src/adapters/multiplexer-resolve.ts` and its test. That leaves the single-source type change uncommitted until later, and the Task 6 commit is not self-contained.
Fix: include `packages/shared/src/platform-api.ts` in the Task 6 `git add`, or move the shared type addition wholly into Task 12 before ai imports it.

5. **`resolveMultiplexer` ignores its injected `env` when constructing `HerdrMultiplexer`.** The decision accepts an `env`, but `new HerdrMultiplexer(input.io)` falls back to `process.env`; tests or callers using injected env for `HERDR_PANE_ID`/`JARVIS_HERDR_ROOT_PANE` will resolve one environment and launch with another.
Fix: instantiate `new HerdrMultiplexer(input.io, { env: input.env })`.

Prior Round 1 status: #2, #5, #6, #7, and #8 are substantially addressed in the plan text. #1 is mostly addressed but has stale local invariant comments. #3 and #4 are improved but still incomplete because backend launch failures/root-pane readiness are not cleanly resolved at boot or mapped to 503.

VERDICT: REVISE

### Claude's response (Round 2)

Git-verified CLEAN (Codex wrote nothing). Accepted all 5 follow-on findings:

1. **herdr usability not in the resolver** — FIXED. `decideMultiplexer` now computes `herdrUsable = herdr binary && (JARVIS_HERDR_ROOT_PANE || HERDR_PANE_ID)`. `auto` genuinely falls back to tmux when herdr has no root pane; `configured: herdr` with no root pane returns a clear unavailable reason. Added tests for both.
2. **Launch failures → generic 500** — FIXED. `CliChatUnavailableError` moved to a dependency-free `errors.ts`; `engine.launch()` wraps `mux.open()` failures into it (with `cause`); live + REST 503 handlers log the cause and send a sanitized fixed message.
3. **Stale local "ONLY exemption" comments** — FIXED. Task 13 now updates the comments in `module-registry/src/index.ts:66-69` and `settings/src/bootstrap.ts:13` to cross-reference the new DEVELOPMENT_STANDARDS subsection.
4. **Task 6 didn't stage `platform-api.ts`** — FIXED. Added to the Task 6 `git add` so the commit is self-contained.
5. **`resolveMultiplexer` ignored injected env** — FIXED. Now `new HerdrMultiplexer(input.io, { env: input.env })`.

None rejected.

## Round 3 — Codex

(See prior turn; one blocking item — errors.ts created in Task 10 but imported by Task 8, an ordering bug — plus a prose nit.)

### Claude's response (Round 3)

Moved errors.ts creation into Task 8 Step 0 (its first consumer) so ordering is correct; Task 8 commit stages it; Task 10 only re-exports. Updated architecture + Key Decision #1 prose to 'installed AND root-pane-usable'.

## Round 4 — Codex

Grounded on `HEAD=5c4e0bd`, preflight passing.

Confirmed the two Round 3 fixes:

- `errors.ts` is now created in Task 8, before `cli-chat-engine.ts` imports it, and Task 8’s commit stages `packages/chat/src/live/errors.ts`.
- Task 10 correctly treats `errors.ts` as pre-existing and only imports/re-exports it.
- The architecture summary and key-decision prose now say herdr must be installed and root-pane-usable.
- The root-pane-aware resolver, injected env passthrough, launch-to-503 wrapping, bounded raw-read exemption docs, and shared type staging remain present.

No material blockers found. Two editorial nits are not implementation blockers: Key decisions has duplicate item `10`, and Task 10’s local **Files** list omits `live-routes.ts` even though the step and `git add` include it.

VERDICT: APPROVED
### Claude's response (Round 4)

APPROVED. Fixed the two non-blocking nits: added live-routes.ts to Task 10's Files list; confirmed Key Decisions are numbered 1-13 with no real duplicate. Plan is final.

---

## RESOLUTION: APPROVED after 4 rounds
Codex raised 12 findings across rounds 1-3 (8 + 5 - overlap), every one accepted and fixed; Round 4 = APPROVED. Codex wrote nothing any round (git-verified each time). Sandbox note: read-only sandbox could not init on this host; ran with --dangerously-bypass-approvals-and-sandbox under git before/after verification, per user approval.
