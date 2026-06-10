# Backlog #83 — Docs: Prompt-Cache Discipline + Tool-Catalog Deferral Seam

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two documentation notes: (1) prompt-cache discipline rules in the development standards, and (2) a deferred tool-catalog scaling seam note in ADR 0005.

**Architecture:** Pure documentation changes — no code, no migrations, no schema changes. Two files modified and committed separately. Both changes close GitHub issue #83.

**Tech Stack:** Markdown. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`.

---

## File Map

| File                                                           | Action                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `docs/DEVELOPMENT_STANDARDS.md`                                | Add "Prompt-Cache Discipline" section after the "Agent Knowledge Tools" section |
| `docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md` | Add "Deferred: Tool-catalog scaling" section after the "Consequences" section   |

---

### Task 1: Add prompt-cache discipline section to DEVELOPMENT_STANDARDS.md

**Files:**

- Modify: `docs/DEVELOPMENT_STANDARDS.md` (currently 140 lines — add after line 68, the end of the "Agent Knowledge Tools" section)

The new section belongs right after "Agent Knowledge Tools" (line 68) because it is also an agent/AI runtime concern.

- [ ] **Step 1: Open the file and locate the insertion point**

  Run:

  ```bash
  grep -n "## Agent Knowledge Tools\|## Structural Standard" docs/DEVELOPMENT_STANDARDS.md
  ```

  Expected output:

  ```
  35:## Agent Knowledge Tools
  70:## Structural Standard
  ```

  The new section inserts between those two headings (after the blank line at line 69).

- [ ] **Step 2: Add the section**

  In `docs/DEVELOPMENT_STANDARDS.md`, insert the following block between the "Agent Knowledge Tools" section and the "Structural Standard" section (after the blank line that closes "Agent Knowledge Tools"):

  ```markdown
  ## Prompt-Cache Discipline

  Provider-side prefix caching only works when the prompt prefix stays byte-stable. Violating
  this silently invalidates the cache on every request.

  Rules for all AI runtime code and persona files in this repo:

  - **Persona/context files must be byte-stable per user.** Never embed timestamps, monotonic
    counters, session IDs, or any value that changes between launches. A persona file is a
    static prompt prefix; it caches at the provider until the file itself changes.
  - **Dynamic content goes in turns, not the persona.** Memory seeds, replay blocks, injected
    user context, and any data that changes between sessions must be submitted as explicit
    conversation turns _after_ the CLI launches — never prepended into the persona/context file.

  Violating either rule means every session pays full context processing cost instead of a
  cache hit. On long persona files this is a significant per-message cost.
  ```

- [ ] **Step 3: Verify file still passes format check and lint**

  Run:

  ```bash
  pnpm format:check && pnpm lint
  ```

  Expected: both pass with no errors. If `prettier` flags the file, run `pnpm format` to auto-fix, then inspect the diff to confirm nothing was mangled.

- [ ] **Step 4: Commit**

  ```bash
  git add docs/DEVELOPMENT_STANDARDS.md
  git commit -m "$(cat <<'EOF'
  docs: add prompt-cache discipline section to development standards

  Codifies the byte-stability rule for persona/context files: dynamic
  content (memory seeds, replay blocks) must be submitted as turns after
  launch, not embedded in the prefix, to keep provider-side caches valid.

  Closes part of #83.

  Co-Authored-By: Claude <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Add tool-catalog deferral seam note to ADR 0005

**Files:**

- Modify: `docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md`

ADR 0005 currently ends with the `## Consequences` section. The new note is a named future seam — record the design intent and the trigger threshold without building anything.

- [ ] **Step 1: Locate the end of the file**

  Run:

  ```bash
  tail -10 docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md
  ```

  Expected: the file ends with the last bullet of the `## Consequences` section.

- [ ] **Step 2: Append the deferred seam section**

  Append to the end of `docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md`:

  ```markdown
  ## Deferred: Tool-catalog scaling seam

  `mcp-transport.ts` today returns the full tool catalog on every `tools/list` response —
  correct while the catalog is small (< 15 tools). When modules multiply, a full catalog
  on every request wastes tokens; Claude Code's own `ToolSearch` pattern solves this with
  a search primitive and on-demand schema loading (deferred registration).

  **Design intent:** when the total module-registered tool count reaches ~15–20, replace the
  full-catalog response with a two-step contract:

  1. `tools/list` returns a lightweight index (name + one-line description only).
  2. A new `tools/schema` call returns the full JSON Schema for one or more named tools on
     demand, mirroring how ToolSearch loads deferred tool schemas.

  **Do not build this now.** The current catalog is well under the threshold. Record the
  seam here so the next contributor knows where to cut when the count crosses it, and does
  not mistake the full-catalog behavior for a permanent contract.
  ```

- [ ] **Step 3: Verify format and lint**

  Run:

  ```bash
  pnpm format:check && pnpm lint
  ```

  Expected: both pass. Auto-fix with `pnpm format` if prettier flags anything, then re-check the diff.

- [ ] **Step 4: Commit**

  ```bash
  git add docs/architecture/decisions/0005-jarvis-mcp-agentic-tools.md
  git commit -m "$(cat <<'EOF'
  docs(adr-0005): record tool-catalog deferral seam with trigger threshold

  Documents the design intent to switch mcp-transport from a full-catalog
  tools/list to a search-primitive + on-demand schema contract when module
  tool count reaches ~15-20, mirroring Claude Code's ToolSearch pattern.
  No implementation; seam note only.

  Closes #83.

  Co-Authored-By: Claude <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Pre-push verification

- [ ] **Step 1: Run the pre-push trio**

  ```bash
  pnpm format:check && pnpm lint && pnpm typecheck
  ```

  Expected: all three pass. Fix any issues before proceeding.

- [ ] **Step 2: Rebase on latest main**

  ```bash
  git fetch origin main && git rebase origin/main
  ```

  Expected: fast-forward or clean rebase. No code conflicts expected (docs-only branch). Resolve any doc conflicts manually if they appear.

- [ ] **Step 3: Verify two commits on branch**

  ```bash
  git log --oneline origin/main..HEAD
  ```

  Expected output (two commits):

  ```
  <sha> docs(adr-0005): record tool-catalog deferral seam with trigger threshold
  <sha> docs: add prompt-cache discipline section to development standards
  ```

- [ ] **Step 4: Invoke coordinated-wrap-up**

  Invoke the `coordinated-wrap-up` skill to push, open the PR, and report to the coordinator.

---

## Exit Criteria (from issue #83)

- [x] Standards section added for cache-stable prompt prefixes
- [x] Deferral-seam note added to ADR 0005 with the trigger threshold (~15–20 tools)
