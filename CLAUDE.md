# CLAUDE.md

Decisions and gotchas that the source code can't tell you. Anything discoverable — commands, file
layout, naming, conventions — read from the repo instead of trusting this file.

## Orientation

GitHub is the source of truth for status: the project board, milestones, and issue links, not this
file and not a doc. Read `docs/DEVELOPMENT_STANDARDS.md` before broad feature work or reviews.

Full local gate: `pnpm verify:foundation`. Three ways it lies to you:

- It must run against a freshly created gate database that you exported yourself. An unscoped run in
  July 2026 hit the live dev database and took chat down for 90 minutes.
- It does **not** include `test:e2e` — CI runs the browser suite as a separate step, so a green local
  gate can sit on a red CI job.
- Never pipe a gate command through `tail`/`grep`. The pipeline returns the filter's exit code, so
  red reads as green.

## Hard invariants

Deliberate decisions, each with a real failure behind it. Violating one is a blocker.

- **No admin private-data bypass.** Admin power is configuration power only. RLS applies to every
  actor including admins. No `BYPASSRLS` on runtime app or worker roles.
- **Private by default.** Owner-only unless explicitly shared; cross-user access needs an explicit
  grant.
- **Secrets never escape.** Connector/AI credentials, auth tokens, password hashes and session tokens
  never reach frontend responses, logs, pg-boss payloads, user exports, or AI prompts. Connector/AI
  secrets are AES-256-GCM at rest.
- **Metadata-only job payloads.** pg-boss carries actor/resource IDs, job kind, idempotency key and
  small command params. Never private content, prompts, or secrets.
- **Vault I/O goes through `VaultContext`** — never raw `fs`. (The `DataContextDb` brand enforces the
  database half of this at compile time; the filesystem half has no such guard.)
- **Don't re-add fields to `AccessContext`.** It carries `actorUserId` and `requestId`. `workspaceId`
  was removed on purpose in Slice 1f — reintroducing it re-opens a closed design.
- **Provider-agnostic AI.** Features request capabilities; the router picks the user's configured
  model. Never hardcode a provider or model name.
- **Module isolation.** Modules collaborate only through declared public APIs and events — never by
  importing another module's internals or querying its tables.
- **Never edit an applied migration.** The runner hash-checks applied files, so an edit breaks every
  existing install. Add a new file. Module SQL lives in the owning module's `sql/`, never in
  `infra/postgres/migrations/`.
- **pgvector image.** Compose must use a pgvector-enabled Postgres image, not plain Postgres.

## Process gates

- **Spec before build.** No new feature or module without an approved design spec in
  `docs/superpowers/specs/`, and a GitHub `task` issue to build against.
- **Live-path gate.** CI-green plus code review does not make a user-facing feature done. It needs
  live end-to-end proof recorded on the PR — installed and exercised through the real UI on a live
  dev instance. Without that the honest status is _code-complete, unverified_: don't merge, don't
  mark Done. Full rule in `docs/DEVELOPMENT_STANDARDS.md` → Live-Path Gate.
- Every meaningful commit and PR carries a short user-facing summary in release-note language, so it
  can roll up into "What's new". If the change isn't user-visible, say that plainly.

## Working in a shared checkout

Several agent sessions may share this working tree at once. Before any tree-wide action, check
`herdr pane list` and send a heads-up with the `herdr-pane-message` skill.

**Never `git add -A` / `git add .`, and never bare-`git commit`** — both sweep up whatever another
session has staged. Commit with explicit paths instead: `git commit <paths> -m "…"`.

That is necessary but not sufficient, and the gap has bitten repeatedly: `git commit <path>` ignores
the index and commits the **whole current content** of that path, so on a file two sessions are both
editing it carries their unfinished work under your message. There is no git-only safe form. Before
committing a shared file, `git diff` it and read the added lines; afterwards run
`git show --name-only HEAD` and check the list is what you meant. Search agentmemory for the
shared-index commit sweep before doing anything clever here.

Don't `git checkout`/`stash`/`reset` this tree while another session's build is mid-run — use a
separate worktree.

## Scope guardrails

- **Do not casually build:** real OAuth callbacks, real connector sync, full email/calendar clients,
  a module marketplace, a workflow engine. Each needs its own milestone and spec.
- **The design system is authored, not generated.** Match the live `apps/web/src/styles/tokens.css`:
  `--font-display` for headings, `--font-sans` for body. **No mono** (retired 2026-07-08 — use
  `--font-sans` with `tabular-nums` for eyebrows, labels and data) and **no serif** (sports nameplate
  only). Extend the `jds-*` primitives; raw CSS colours belong in `tokens.css` alone. Empty and
  loading states use the existing authored patterns.
- Keep plain Fastify REST plus shared TypeScript contracts (`packages/shared/*-api.ts`) unless a
  milestone explicitly justifies a heavier contract layer.
- Write `~/Jarv1s` rather than absolute local paths in docs, specs and handoffs.

## Judgment on design forks

Verify before you rank. Read the files each option touches — give the one you lean _against_ equal
depth — and grep for existing machinery before calling anything net-new; around here "big change" is
usually already half-built. Steelman the option you'd reject. On milestone-level forks an adversarial
second opinion is valuable but never a gate: `/grill-me-codex`, else an independent critic subagent.

## Memory

Use the `codebase-memory` skill for code structure questions (graph search, call traces, impact
analysis) before making architectural claims.

Nothing in a task will prompt you to write memory down, so treat these as save triggers — call
`memory_save` when they happen, not at end of session:

- a non-obvious architectural decision, with why X over Y
- a confirmed invariant or ordering constraint
- a trap that caused a real error
- an RLS classification (owner-only / owner-or-share / recipient-only)
- a shift in project state (milestone reached, known-good migration or test counts)

Use `project: "jarv1s"` and type `architecture` | `bug` | `fact` | `pattern`. Never store secrets or
private data.
