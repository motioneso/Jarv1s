# Agy Print Mode Viability Spike

**Date:** 2026-06-26
**GitHub:** #522
**Status:** Complete

## Environment

- `agy --version`: 1.0.12
- Working directory: `/tmp/jarv1s-agy-print-Wp3XP7`
- Transcript roots inspected: `~/.gemini` up to depth 8

## Probe Matrix

| Probe | Command shape | Transcript path | Completion parity | Tool parity | Approval/action parity | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Text-only turn 1 | `agy --print` | `~/.gemini/antigravity-cli/brain/.../transcript_full.jsonl` | pass | N/A | N/A | pass |
| Text-only continuation | `agy --continue --print` | `~/.gemini/antigravity-cli/brain/.../transcript_full.jsonl` | pass | N/A | N/A | pass |
| Local file read | `agy --dangerously-skip-permissions --print` | `~/.gemini/antigravity-cli/brain/.../transcript_full.jsonl` | pass | pass | pass | pass |
| Stop/timeout behavior | `timeout 3s agy --print` | `~/.gemini/antigravity-cli/brain/.../transcript_full.jsonl` | pass | N/A | N/A | pass |

## Record Shapes

| Agy print record shape | Jarv1s semantic record | Evidence |
| --- | --- | --- |
| `type: "PLANNER_RESPONSE"` | `reply` | Text-only continuation |
| `type: "VIEW_FILE"` | `tool` | Local file read |

## Findings

### Parity Answers

1. Incremental `readNew` semantics: pass - transcript grows by line-oriented records during the turn.
2. Tool activity mapping: pass - structured tool records like `VIEW_FILE` and `RUN_COMMAND` are emitted.
3. Approval/action visibility: pass - print mode emits structured tool usage instead of collapsing it into planner text.
4. Local runtime boundaries: pass - file-read stayed inside the probe directory.
5. Stop/liveness semantics: pass - timeout killed the process and continuation still worked.

## Verdict

Viable. Agy print mode can preserve Jarv1s interactive parity. Next step: write a separate implementation plan for provider-config routing and an Agy print-mode transcript adapter using the captured sanitized fixtures.
