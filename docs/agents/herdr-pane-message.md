---
name: herdr-pane-message
description: Use when you (Codex, running in a Herdr pane in the Jarv1s workspace) need to send a message, instruction, question, or finding to another agent session — e.g. a Claude Code pane labeled "Coordinator" or "Jarvis design" — in the same Herdr workspace, or to read its reply. Herdr is the terminal multiplexer (alternative to tmux); panes/agents carry human labels.
---

# Send a Message to Another Herdr Pane (Codex)

Herdr is a terminal workspace manager with a JSON CLI. Each pane can host an agent
carrying a human **label** (e.g. "Coordinator", "Jarvis design"). You (Codex) are one
of those panes. To coordinate, find the target by label, type a message into it, and
verify it submitted — anything you send lands as that agent's user input.

`herdr` lives at `~/.local/bin/herdr` (usually on PATH). If `herdr` is not found, call it
by that absolute path. Run any subcommand with `--help` for exact flags.

## Steps

**1. List panes and find the target by `label`.**

```bash
herdr pane list        # JSON: each pane has pane_id, label, agent, agent_status,
                       #       focused, cwd, foreground_cwd
```

- Identify the target by its `label` (e.g. `"Coordinator"`) and note its `pane_id`
  (e.g. `w653f42bef3ac02-2`).
- **The pane with `"focused": true` and `agent: "codex"` is YOU** — never message yourself.
- **Skip unlabeled panes whose `cwd`/`foreground_cwd` is under `~/.jarvis/chat/*`** — those
  are live Jarvis chat-engine sessions, not coordinating agents.

**2. Send the message.** Prefer `herdr pane run` — it types the text _and_ submits Enter in
one call:

```bash
herdr pane run <pane_id> "<your message>"
```

`herdr agent send "<label>" "<text>"` writes literal text **without** submitting, so it
always needs a follow-up Enter (step 3). Prefer `pane run`.

**3. Long messages may not auto-submit.** A long message types into the input box but the
Enter can be absorbed (treated as a paste). If so, send a **separate** Enter:

```bash
herdr pane send-keys <pane_id> Enter
```

**4. A BUSY agent QUEUES your message — that is success.** If a later read shows your text
under `❯ Press up to edit queued messages`, the agent received it and will process it when
it goes idle. **Do not resend** or send another Enter — that injects stray input.

**5. Verify it landed:**

```bash
herdr pane read <pane_id> --source visible --lines 12
```

Input box empty (agent processing) or showing "queued" = submitted. Still showing your raw
text with a cursor = the Enter didn't land; send one `send-keys <pane_id> Enter` and re-read.

## Getting a reply back (two-way)

The target receives only your raw text — it does not know who sent it. To get an answer,
name yourself and how to route the reply. Find your own pane (`focused: true`,
`agent: "codex"`) in `herdr pane list`, then end your message with, e.g.:

> "…your question… — reply via the herdr-pane-message skill to the Codex pane
> `<your pane_id>` (or label `<your label>`)."

Then poll for the reply:

```bash
herdr pane read <their_pane_id> --source recent --lines 30
```

## Quick reference (verified `herdr` CLI)

| Need                                             | Command                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| List panes (JSON: pane_id, label, agent, status) | `herdr pane list`                                                                  |
| Get one pane                                     | `herdr pane get <pane_id>`                                                         |
| List / get agents                                | `herdr agent list` · `herdr agent get <label>`                                     |
| Send by pane + Enter (preferred)                 | `herdr pane run <pane_id> "<text>"`                                                |
| Send by label (no Enter — needs step 3)          | `herdr agent send "<label>" "<text>"`                                              |
| Literal text, no Enter                           | `herdr pane send-text <pane_id> "<text>"`                                          |
| Submit / send a key                              | `herdr pane send-keys <pane_id> Enter`                                             |
| Read output                                      | `herdr pane read <pane_id> --source visible\|recent\|recent-unwrapped [--lines N]` |
| Rename a pane label                              | `herdr pane rename <pane_id> "<label>"`                                            |

## Common mistakes

- **Resending because it "looked unsent."** A busy agent shows the message **queued**
  (`Press up to edit queued messages`) — that's delivered, not failed. Read first; don't resend.
- **Appending Enter to a long send and assuming it submitted.** Long text pastes and absorbs
  the Enter — send a separate `send-keys <pane_id> Enter`, then verify with `read`.
- **Messaging the wrong pane.** Confirm by `label` (and `foreground_cwd`), not screen position.
  The `focused: true` / `agent: "codex"` pane is you; unlabeled `~/.jarvis/chat/*` panes are
  live chat engines, not agents.

> Scope: spawning a _new_ agent into a fresh pane (rather than messaging an existing one) is a
> separate capability (`herdr agent start … -- claude …` with an isolated git worktree). This
> skill covers messaging/reading existing panes only.
