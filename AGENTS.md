# AGENTS.md — Jarv1s

Project-scoped guidance for Codex (and other non-Claude agents) working in **this repo only**.
Full project rules, invariants, commands, and GitHub-tracking conventions live in
**`CLAUDE.md`** — read it for anything about the codebase itself (architecture, migrations,
RLS, testing, scope guardrails). This file adds agent-coordination capabilities.

## Skill map

Capabilities available while working in this repo. When a request matches a row, read the
linked doc **in full** and follow it.

| When you need to…                                                                                           | Skill                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Message or read **another Herdr pane / agent** in this workspace (e.g. the Coordinator or a Claude session) | [`docs/agents/herdr-pane-message.md`](docs/agents/herdr-pane-message.md) |

## Documentation Standards

- Always use `~/Jarv1s` instead of absolute paths (like `/home/<user>/Jarv1s`) in all documentation, specs, and handoff files to prevent exposing local usernames and system architecture.

## Grounding gate

Before giving the user an actionable instruction:

1. Verify it against current code, live DOM, command output, or official documentation.
2. Cite the evidence: file/line, visible UI label, endpoint response, or command result.
3. Never invent or infer buttons, routes, commands, state, or workflow steps.
4. If verification is unavailable, say `unverified` and investigate before instructing.
5. Distinguish observed facts from hypotheses explicitly.
6. For UI instructions, confirm the exact control exists in the current running build.
