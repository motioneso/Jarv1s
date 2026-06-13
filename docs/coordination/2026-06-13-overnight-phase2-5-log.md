# Overnight Autonomous Run — Phases 2–5 (2026-06-13)

**Mandate (Ben):** Implement Phases 2–5 to completion. ~9h budget, speed not a driver, full autonomy, no stopping. Per-slice: Codex adversarial **plan-review** → arbiter-revise → **build** (TDD, agents resolve blockers) → Codex adversarial **code-review** → fix → next. Measure-twice-cut-once. **UI = basic/functional only** (Ben does a dedicated UI session; the Phase-3 design-direction slice + polished feelings-wheel are deferred). Do **not** pause for design forks — note them here, proceed with best judgment.

Branch: `phase2-portable-deploy` (main untouched). All commits land here for morning review-before-merge.

---

## ⚑ Design forks & decisions deferred for Ben's review
_(autonomous calls I made that you may want to revisit; nothing here blocked the build)_

- **[deploy] tmux CLIENT bundled in the production image.** ADR 0008 forbids bundling the AI CLIs and the multiplexer *server*; but the containerized api/worker must exec `tmux` verbs against the **host** tmux socket, so the thin tmux **client** binary is installed in the image. I read this as consistent with ADR 0008's intent (portability = don't bake the *engine*/subscription), and reworded the invariant note to distinguish client-vs-server. Flagging in case you'd rather the container reach tmux a different way (e.g. herdr-only, or a host-side exec shim).
- **[deploy] runtime image = `FROM build` (full deps incl. tsx), migrate runs as `tsx scripts/migrate.ts` (not bundled).** Codex caught that esbuild-bundling migrate collapses every module's `new URL('../sql', import.meta.url)` to one path → chosen a larger but correct single image over a broken pruned one. Revisit if image size matters for your deploy target.
- **[wellness] active-prioritization will add ONE generic "readiness-signal" contribution point to module-sdk** (any module can provide it) — the single justified core change for Phase 5, designed generically to preserve module isolation (Wellness never imports Tasks). Confirm you're happy with that being a core seam vs. keeping wellness fully leaf.
- **[wellness/briefings] per-user module-disable does NOT yet cover the briefings WORKER path.** Codex (P5 review) flagged: the briefings worker + `/api/modules` + frontend use the FULL manifest set (`listModuleManifests`), not the actor-filtered async `resolveActiveModules`. So a user who disables Wellness would still have its read tools run inside a SCHEDULED briefing. Module-seam (just built) covers the request-time route guard + MCP gateway; the briefings-worker reconciliation is the gap. Plan: address it during the P5 wellness build (make the briefings worker honor per-user enablement), else ship as a documented v1 limitation. Flagging for your call.
- **[onboarding] Codex caught a pre-existing RLS issue** (P4 review): migration 0052's admin SELECT on app.users could surface a new per-user `onboarding_completed_at` column cross-user via the admin-list helper — the P4 plan now keeps the column OUT of the SECURITY DEFINER helpers so it can't leak. (Fixed in-plan, not a fork — noted because it's a real prior-art RLS subtlety.)

---

## ✅ Slice status

| Slice | Plan-review | Build | Code-review |
|---|---|---|---|
| P2 · CLI chat adapter | ✅ APPROVED (4 rounds, pre-run) | ✅ 17 tasks, green | ✅ APPROVED (2 rounds; fixed orphan-session cleanup + admin HTTP tests; e7cec29) |
| P2 · Module-enablement seam | ✅ 15 findings applied | ✅ 13 commits, green | ⏳ code-review (wma7gjikf) |
| P2 · Deployable stack | ⏳ in review | — | — |
| P2 · Primary onboarding | ⏳ in review | — | — |
| P3 · Connector sync | ✅ APPROVED (r3) | queued | — |
| P3 · Real briefings | ✅ APPROVED (r4) | queued | — |
| P3 · Task verticals | ✅ APPROVED (r3) | queued | — |
| P3 · Focus-time agency | ✅ APPROVED (r4) | queued | — |
| P3 · Design direction | ⏸️ DEFERRED to UI session (spec only) | — | — |
| P4 · Secondary onboarding | ✅ all findings applied (r3; "deadlock"=1 mock nit) | queued | — |
| P5 · Wellness module | ✅ findings applied (r3; 1 cross-slice fork ↓) | queued | — |

---

## 📋 Event log
_(appended as the run proceeds)_

- **start** — specs+plans authored for P2 (done) + P3/P4/P5 (in progress); CLI-adapter build pilot launched; P2 plan-review launched.
- **P3 authoring complete** — 5 specs + 5 plans written: connector-sync (27 tasks), real-briefings (23), task-verticals (27), focus-time (21), design-direction (19, DEFERRED). Connector-sync spec flagged 2 load-bearing additions handled in-spec: (1) worker role (jarvis_worker_runtime) lacks grants/RLS on calendar_events/email_messages/connector_accounts → additive worker-grant+RLS migrations mirroring M-A3 precedent; (2) the M-B1 provider_type='google' vs cache-INSERT RLS blocker → relaxed INSERT WITH CHECK to provider_type IN ('calendar','email','google') + scope guard. Both RLS diffs flagged for independent security review at build. Next free migration number 0065 (re-derive at build).
- **PILOT BUILD VALIDATED** — CLI-adapter build workflow autonomously committed ~13/17 tasks cleanly (multiplexer seam + both backends + probe + resolver + engine refactor + tests + factory + settings + admin route + boot resolution). The delegated TDD-build mechanism works.
- **Sequencing note** — holding P3 plan-review until the P2 plan-review pilot returns (validate the delegated-Codex-review mechanism before scaling to 4 more slices; avoid excessive concurrent Codex on the shared tree).
- **ALL AUTHORING COMPLETE** — 10 buildable plans (~198 tasks): P2 CLI-adapter(17)/module-seam(14)/deploy(19)/primary-onboarding(15); P3 connector-sync(27)/real-briefings(23)/task-verticals(27)/focus-time(21); P4 secondary-onboarding(14); P5 wellness(21). Design-direction(19) DEFERRED. P4 spec made a clean call: per-user onboarding state = a nullable app.users.onboarding_completed_at column (rides existing self-row RLS, kept OUT of the SECURITY DEFINER admin-list helpers so it can't leak cross-user) rather than a new table.
- **REVIEW MECHANISM VALIDATED** — P2 plan-review agents successfully ran Codex adversarially (verdict files produced for all 3 plans; revise loops executing). Both delegated mechanisms (build + review) confirmed working → safe to scale to all phases.
- **CLI ADAPTER BUILD ✅ COMPLETE** — all 17 tasks committed (e945100..244dc42), typecheck green (root+web). Build agents autonomously reconciled 2 plan defects without faking: (1) herdr error-string backticks vs the literal test regex were mutually unsatisfiable → removed backticks to match the sibling tmux style; (2) a test helper tripped noUncheckedIndexedAccess → guarded local. These are exactly the kind of plan-vs-code nits the post-build code-review + the measure-twice bar should also catch. **CLI Codex CODE-REVIEW launched** (w8qp869t3, sole committer).
- **CONCURRENCY RULE in effect** — at most ONE committing workflow (build OR code-review) at a time on the branch; non-committing workflows (plan-review, authoring) may overlap. Doc commits (specs/plans/this log) batched into committer-free windows.
- **P2 PLAN-REVIEW COMPLETE** (high value — caught real issues): **deployable-stack → APPROVED** after deleting Tasks 1-2 (they re-authored env/cwd+homeBase seams the CLI adapter ALREADY shipped — cross-slice staleness), fixing the migrate esbuild/`new URL('../sql')` hazard (→ tsx one-shot), making the runtime image self-consistent, bundling the tmux client, copying SQL assets, adding an in-image migrate smoke. **module-seam → 15 findings applied** (async ripple missing `mcp-transport.ts`; admin-authz ordering leaking module existence → 403-before-404; HEAD→GET guard folding; connector OAuth routes added to manifest; atomic 23505 upsert; fail-closed guard/gateway/REST tests; DB-level RLS tests), 1 Codex finding **rejected as a verified false positive** (claimed duplicate registerAiRoutes — only one exists). **primary-onboarding → reviewed** (verdict in full output). All 3 build-ready. Codex wrote nothing (git-verified by agents).
- **P3/P4/P5 PLAN-REVIEW launched** (wdpthbtn9, 6 agents, non-committers) in parallel with the CLI code-review.
- **CLI ADAPTER ✅ FULLY DONE** — code-review APPROVED (2 rounds, e7cec29): added orphan-session cleanup on partial-launch failure + admin-route HTTP tests; rejected a module-isolation-breaking suggestion for a lighter in-module allowlist guard. Slice 1/10 complete.
- **MODULE-SEAM BUILD ✅** — 13 commits (215891c..338605a), 0 blocked, typecheck green. Recurring plan-defect the build auto-fixed (measure-twice working): the plan-authoring used per-package `test/` dirs but root vitest only collects `tests/` → agents relocated unit tests to `tests/unit/` consistently. (Other plans likely share this; build agents fix per-task.) Module-seam **code-review launched** (wma7gjikf). Slice 2/10 building→review.
