# CLAUDE.md

This file contains only project rules that are not reliably discoverable from source code.

## Orientation

Before starting roadmap or release work, get current state from GitHub; the project board and
milestones are the source of truth for status. Read `docs/DEVELOPMENT_STANDARDS.md` before broad
feature work or reviews.

Use `package.json` scripts as the command reference. Default full local gate: `pnpm verify:foundation`.
If CI is unavailable, record the local commands and exit codes used instead.

## Hard Invariants (never weaken these)

These are decisions, not code descriptions. Violating any of these is a blocker.

- **No admin private-data bypass.** Admin/owner power is configuration power only. RLS applies to
  all actors including admins. No `BYPASSRLS` on runtime app or worker roles.
- **Private by default.** Data is owner-only unless explicitly shared. Cross-user access requires
  explicit grants.
- **DataContextDb only.** Repositories accept only a branded `DataContextDb` handle, never a root
  Kysely instance. `VaultContext` for all vault I/O — never raw `fs` calls.
- **AccessContext shape.** `AccessContext` carries only `actorUserId` and `requestId`. Do not add
  fields (workspaceId was permanently removed in Slice 1f).
- **Secrets never escape.** Connector/AI credentials, auth tokens, password hashes, and session
  tokens never reach frontend responses, logs, pg-boss job payloads, user exports, or AI prompts.
  Connector/AI secrets are AES-256-GCM encrypted at rest.
- **Metadata-only job payloads.** pg-boss payloads contain actor/resource IDs, job kind,
  idempotency key, and small command params only. Never private content, prompts, or secrets.
- **Provider-agnostic AI.** No feature may hardcode a provider or model. Features request
  capabilities; the router selects the user's configured model.
- **Spec before build.** No new feature or module without an approved design spec in
  `docs/superpowers/specs/`. This is a hard process gate, not a suggestion.
- **Module isolation.** Modules collaborate only through declared public APIs/events. No module
  imports another module's internals or queries its tables directly.
- **pgvector image.** Docker Compose must use a pgvector-enabled Postgres image. Do not replace it
  with plain Postgres.
- **Never edit applied migrations.** The migration runner hash-checks applied files. Add a new
  migration file; never modify an existing one. All module SQL lives in the owning module's `sql/`
  directory, never in `infra/postgres/migrations/`.

## GitHub Tracking

The roadmap is tracked in GitHub. Keep the project board, milestones, and parent/child issue links
current when doing roadmap work. Do not preserve status snapshots in this file.

Every meaningful commit and PR must include a short user-facing summary of what changed, written in
release-note language rather than implementation jargon. These summaries should be suitable for
rolling up into "What's new"; if the change is not user-visible, say that plainly.

## Agent Knowledge Tools

**CodeGraph** — use `codegraph_context` / `codegraph_trace` / `codegraph_explore` before
architectural claims or refactors. The index lives under `.codegraph/` (git-ignored); run
`codegraph sync .` after pulling or making meaningful edits.

**agentmemory** — durable lessons and non-obvious invariants that must survive across sessions.
Never store secrets or private data.

**Required recalls** — before starting any of these activities call `memory_smart_search`:

| Activity                           | Query                                  |
| ---------------------------------- | -------------------------------------- |
| Session start / orientation        | `"jarv1s current project state"`       |
| RLS policy or security work        | `"jarv1s RLS shareability policy"`     |
| Migration authoring or debugging   | `"jarv1s migration hash placement"`    |
| AccessContext or DataContextDb     | `"jarv1s accesscontext datacontext"`   |
| Integration-test setup or failures | `"jarv1s integration test trap"`       |
| Frontend/React Query changes       | `"jarv1s frontend workspace querykey"` |

**Required saves** — call `memory_save` immediately (not end-of-session) after any of these:

- A non-obvious architectural decision (why X over Y)
- A confirmed or discovered invariant (ordering constraint, security rule)
- A trap or gotcha that caused a real error
- RLS classification for a resource (owner-only / owner-or-share / recipient-only)
- A shift in current project state (milestone reached, known-good migration/test counts)

Always use `project: "jarv1s"`. Types: `"architecture"` for invariants, `"bug"` for
traps/gotchas, `"fact"` for state snapshots, `"pattern"` for coding patterns.

## Coordinating With Other Agent Sessions

More than one Claude Code session may work this repo at once — most commonly a build **Workflow**
running in another Herdr pane while you edit elsewhere. They **share one working tree**, so coordinate
before any tree-wide action.

- **Send a heads-up with the `herdr-pane-message` skill.** Identify panes with `herdr pane list`,
  confirm which is the other Claude session, then message it about what you're touching and what to
  avoid (e.g. "I have uncommitted doc edits under `docs/` — don't `git add -A`"). This is the
  expected channel for cross-session coordination; use it proactively, not only when something breaks.
  To spawn a new agent session, use the **`herdr-handoff`** skill.
- **Stage only your own files.** Never `git add -A` / `git add .` while another session has
  uncommitted work — list explicit paths, or you will sweep their changes into your commit.
- **Don't `git checkout` / `git stash` / `reset` the shared tree** while another session's build is
  mid-run (see the `/start` skill red flags). Wait until it finishes, or use a separate worktree.

## Scope Guardrails

- **Write a spec first.** Every new feature, module, or milestone requires an approved design spec
  before code is written.
- **Do not casually build:** real OAuth callbacks, real connector sync, full email/calendar
  clients, a module marketplace, a workflow engine. Each needs its own milestone + spec.
- **Preserve the authored design system.** Match the live `apps/web/src/styles/tokens.css`:
  `--font-display` (Neue Haas Grotesk, interim Helvetica stack) for headings, `--font-sans` for
  body. **No mono** (retired 2026-07-08 — use `--font-sans` + `tabular-nums` for eyebrows/labels/
  data) and **no serif** (sports nameplate only). Extend `jds-*` and local primitives, and keep
  raw CSS colors in `tokens.css` only. Empty/loading states must use existing authored patterns.
- Preserve plain Fastify REST + shared TypeScript contracts (`packages/shared/*-api.ts`) unless a
  milestone explicitly justifies a heavier contract layer.
- **Documentation paths:** Always use `~/Jarv1s` instead of absolute local paths in documentation,
  specs, and handoff files.

## Design-fork Discipline

When choosing between implementation options, **verify before you rank** — don't estimate cost/
feasibility from memory. Read the files each option touches (give the one you lean _against_ equal
depth), and grep for existing machinery before calling anything net-new ("big changes" are often
already half-built). Steelman the option you'd reject. For milestone-level forks, add an adversarial
second opinion — **preferred, never a gate**: `/codex-review` or `/grill-me-codex` if Codex is
available → else an independent Claude critic subagent → else a structured self-review.

## Grounding Discipline (audits & analysis)

Before grounding **any** audit, security review, or architectural analysis, you MUST confirm the
working tree is current — a stale checkout invalidates the whole run. On 2026-06-10 four security
audits were grounded on a local `main` that was 8 commits behind `origin/main` (8 missing merged
PRs); most HIGH/MED findings re-validated wrong and the work had to be redone.

- **Run the preflight first:** `pnpm audit:preflight` (→ `scripts/check-tree-fresh.sh`). It fetches
  origin and **fails (exit 1) if the tree is behind the baseline**. Being _ahead_ (local-only
  doc/coordination commits) is fine; being _behind_ means the code under review is stale. Do not
  start an audit until it exits 0.
- **Record the verified commit** in every audit report ("grounded on `<sha>`"), and have any audit
  subagent you dispatch run the preflight and report its commit too. An audit that doesn't name its
  commit is not trustworthy.
- **Never disturb a shared working tree to get current.** Another session may be mid-build — do not
  `git pull` / `checkout` / `reset` it. Ground on a detached read-only worktree instead:
  `git worktree add /tmp/audit-ground origin/main` (never `git pull` that worktree).
- **Intentionally auditing an older ref?** That's the only time staleness is acceptable — set
  `JARVIS_ALLOW_STALE=1` so the override is explicit and logged, and note it in the report.
