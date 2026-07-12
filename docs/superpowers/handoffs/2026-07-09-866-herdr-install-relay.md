# Relay — 866-herdr-install

**Spec:** `docs/superpowers/specs/2026-07-08-herdr-install-and-attach-hint.md`
**Handoff:** `docs/coordination/handoffs/2026-07-09-866-herdr-install.md` (read both IN FULL)
**Branch/worktree:** `build/866-herdr-install`, this worktree. Off `origin/main@33270eef`.
**Coordinator:** label `Coordinator`, session `dd8b3920-6924-4eaf-b2bf-4120f187c7a3` — resolve
fresh via `herdr pane list`, never a cached `…-N`. Relay heads-up already sent.

## State: still in coordinated-build Step ½ (grounding). No code written. No commits. Nothing pushed.

Spec-vs-branch grounding is otherwise DONE and clean — no drift found:
- `multiplexer-resolve.ts` unchanged, keep as-is.
- `chat-multiplexer.ts` has `probeChatMultiplexerAvailability` (boot-time sync) AND an unused
  `makeMultiplexerUsableProbe` (live, bounded 1500ms, per-kind) — the latter is the fix for
  "availability refreshes on next fetch without restart."
- `packages/settings/src/routes.ts` GET/PUT `/api/admin/chat-multiplexer` (~line 620/640) both
  serve the static boot-snapshot `dependencies.chatMultiplexerAvailability` — needs to call the
  live probe instead/in addition.
- `packages/settings/src/host-diagnostics.ts` shares the same boot-snapshot dependency (line 62)
  — undecided whether it should also go live or intentionally stay on restart cadence. Decide in
  plan.
- Composition root: single call site `probeChatMultiplexerAvailability(env)` in
  `packages/module-registry/src/index.ts` `registerBuiltInApiRoutes` (~line 1608), threaded
  statically to both routes (~line 1699).
- `apps/web/src/settings/settings-admin-panes.tsx` `HostPane()` lines 681-838, hardcoded tmux
  attach-hint `<Note>` at lines 753-761 — replace with mux-aware copy.
- `infra/docker-compose.prod.yml`: `JARVIS_MULTIPLEXER: tmux` hardcoded line 78 (the root problem);
  `JARVIS_CLI_TOOLS_PREFIX=/data/cli-tools` line 74 + named volume `jarv1s-cli-tools` line 104
  already persists across container replacement — no compose change anticipated.
- No existing install/exec route (confirmed absent — consistent with spec non-goal, nothing to
  remove).
- `apps/web/src/api/client-admin.ts` has `getChatMultiplexerSettings`/`setChatMultiplexerSettings`
  (NOT `client.ts` — wasted one grep on that miss).

## Two open questions — RESOLVE FIRST before writing the plan

1. **Where are Herdr release binaries/checksums published?** Grepped whole repo for "herdr"
   case-insensitive — extensive usage (tests/adapters/skills) but ZERO hits for a release/download
   URL or existing checksum. This blocks writing real pinned per-arch URL+SHA256 pairs in the new
   install script. If not discoverable from the repo, **this is an escalation**, not a guess — ask
   the Coordinator directly (herdr-pane-message, label `Coordinator`) where Herdr's actual release
   artifacts live before fabricating a URL.
2. **Is `curl` or `wget` present in the runtime image?** `Dockerfile` runtime stage installs
   `tmux git ca-certificates bubblewrap` (confirmed via grep, NOT yet a full read) — curl/wget not
   seen in that line. Read the full Dockerfile to confirm either is present; if neither is, the
   plan needs an `apt-get install` addition (small, low-risk) or the script needs a different
   fetch mechanism. Do not assume — verify by full read.

## Next steps (resume coordinated-build exactly here)

1. Resolve both open questions above (read full Dockerfile; escalate on herdr binary source if repo
   has no answer).
2. `superpowers:writing-plans` → `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md`.
   Cover: (a) live-probe wiring for GET/PUT chat-multiplexer route (+ diagnostics route decision);
   (b) new `scripts/install-herdr.sh` — per-arch pinned URL+SHA256, no `curl|sh`, idempotent,
   installs to `${JARVIS_CLI_TOOLS_PREFIX:-/data/cli-tools}/bin/herdr`; (c) `HostPane()` mux-aware
   attach-hint copy (active tmux / active herdr / env-override present / herdr-installed-but-no-root-pane
   cases); (d) any DTO/schema additions needed in `packages/shared/src/platform-api.ts` to surface
   env-override state to the frontend.
3. Message Coordinator with plan path, **wait for approval before any code**.
4. TDD build task-by-task, commit green, `Co-Authored-By: Claude` trailer, explicit `git add` paths only.
5. Pre-push trio + rebase before every push. `coordinated-wrap-up` at Exit Criteria (PR + report,
   never merge/board).

## Bans still in force

Worktree/branch only, explicit `git add` paths, never touch `docs/coordination/`, no secrets in
any doc/payload/log, elevated QA bar (`/security-review` + `/code-review`), STOP+escalate if the
build seems to need a route the spec's "no web API install route" non-goal forbids.
