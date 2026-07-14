# ⏳ Awaiting Ben — decision parking lot

Coordinator holding pen for decisions that need Ben's call. **Rule:** anything that needs Ben goes
here the moment it arises (not buried in a digest), stays until he rules, and the Coordinator
**leads every status report with this list while it's non-empty.** Cleared items drop to the log
at the bottom.

Lock: Coordinator session `09cda409-186a-49a4-87dc-4471aeb2eca7`.

## Open

- **#1050 external live-proof BLOCKED** — see full item below. **2026-07-14 chat update:** Ben's
  lean is **Option A** (wire real CLI auth into the UAT container), using **his own personal CLI
  credentials** (he is the builder — no separate service/test account). Ben explicitly asked to
  **keep this open and revisit in more detail when he has time** — no build authorized yet. Do NOT
  spawn a build lane on this until Ben re-opens the conversation. Draft mechanism discussed
  (unwritten, not yet spec'd): opt-in `UAT_CLI_LIVE=1` flag (never default), read-only bind-mount of
  Ben's CLI auth state (nothing baked into the image, nothing surviving `down -v`), `extra_hosts`
  network path to the host headroom proxy `:8787`, sandbox-bypass flag for the in-container CLI
  call (per `codex-sandbox-workaround`), redact auth material from `run.log`. Still needs: a written
  spec (CLAUDE.md "spec before build" gate — this is credential-handling infra) + a decision on
  whether it's harness-level standing capability (any future CLI-dependent UAT run can opt in) vs.
  scoped strictly to unblocking #1050.

## Cleared (log)

- **#1040 / PR #1051** dev/UAT seed logs owner/admin creds — **CLEARED 2026-07-14.** Ben signed off
  ("i sign off on 1040") + clarified the standing sign-off model: **Opus adversarial security QA →
  Fable cross-model review, both GREEN = the sign-off** (per #982/#984 precedent) — coordinator
  merges on council-green + digests Ben; no separate manual gate unless the council splits/flags.
  MERGED squash `313c194c`; #1040 closed; worktree/lane reaped; monitor stopped. Test-placement
  follow-up (move `admin.test.ts` DB-free fence describe to `tests/unit`) filed on #1034.
  **Epic #1000 NOT auto-closed** — 4 children still open (#1030 multi-user seed tier [task], #1034
  non-blocking QA follow-ups, #1042 install-noop bug [UX], #1047 harness spec-filter gap); left for
  Ben's roadmap call on whether to close core-complete or hold.

- **#984 / PR #1015** private-history — Raised 2026-07-13 (resume-vs-defer + merge sign-off).
  Ben ruled **resume** ("do those things yes please") and then **delegated the merge decision to
  Opus** (2026-07-13): Opus's adversarial security re-QA verdict IS the sign-off — auto-merge on
  Opus APPROVE, back to the lane on any blocker. No Ben gate for this PR.

---
## #1050 external live-proof BLOCKED — needs box-infra/credential decision (owner: Ben)
**Filed:** 2026-07-14 by primary Coordinator (routed from UX Coordinator session 019f5fc7).
**Status:** PR #1050 draft/unmerged. NO product edit or retry authorized.

**What passed** (head `8a976ecd`, image `:live-1050-8a976ecd`): Assistant authored/guided mode +
the corrected **Discard** assertion PASS (typed unsaved persona draft → exact `Discard` restored the
saved server snapshot). The app/UI leg is proven.

**What's blocked:** `POST /api/me/persona/preview` → HTTP **503 in 13.2 ms** (`req-x0`, fast-fail).
Root cause is NOT product code: the persona-preview port (`packages/settings/src/persona-routes.ts:99`)
routes to the per-user **CLI engine**, which inside the ephemeral prod-shaped UAT container has **no
authenticated external-CLI (Codex) path**. Harness has ZERO CLI-cred wiring (no `auth.json`/proxy/
sandbox plumbing in `tests/uat` or compose). A copied `auth.json` + provider row are insufficient
because Codex CLI needs: (1) the CLI binary present, (2) real account-auth state — not just auth.json,
(3) sandbox bypass (bwrap loopback `RTM_NEWADDR` fails in-container — see codex-sandbox-workaround),
(4) network path to the model (host headroom proxy :8787 is Ben's box infra, not reachable/wired
into the container).

**Why this is a Ben gate (not autonomous):** improvising host-CLI account credentials into an
ephemeral container is credential-handling (CLAUDE.md "Secrets never escape", security-tier) + box
infra (headroom proxy) + a harness-design call. Outside my build-lane autonomy.

**Decision needed — pick the plumbing model for external-CLI live-proof:**
  A. **Wire real CLI auth into the UAT container** — mount/inject Codex account auth + reach the
     host headroom proxy :8787 + sandbox-bypass the in-container CLI. Highest fidelity; credential-
     handling risk; needs Ben to authorize how creds cross the boundary.
  B. **Split the proof boundary** — container proves the app/UI leg (already PASS); the CLI-transport
     leg is proven separately host-side (where Codex CLI is already authed) as a documented exit
     criterion. Cheapest; accepts a seam.
  C. **Stub the provider boundary in UAT** — a fake persona-preview port returning a canned reply so
     the container proves wiring end-to-end without real external auth. Loses "real authenticated"
     fidelity the #1050 exit criterion asked for.
**Coordinator lean:** B (host-side CLI leg + container app leg) unless Ben wants full in-container
fidelity — A is real box-infra + credential work, not an overnight build task.
