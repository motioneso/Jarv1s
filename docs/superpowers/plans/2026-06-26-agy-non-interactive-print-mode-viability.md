# Agy Non-Interactive Print Mode Viability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine whether `agy --print` can preserve the same Jarv1s chat/tool behavior as interactive Agy before any shipping implementation is planned.

**Architecture:** Do not add product toggles or runtime routing first. Capture real Agy print-mode transcripts for representative turns, compare them against Jarv1s' existing `CliChatEngine` and transcript-reader expectations, then write a grounded verdict: viable with a follow-up implementation plan, or blocked with exact missing parity.

**Tech Stack:** Agy CLI, shell probes in a temporary neutral directory, Antigravity/Gemini JSONL transcripts, existing `packages/ai/src/adapters/transcript-reader.ts` semantics, markdown findings under `docs/superpowers/spikes/`.

---

## File Map

- Create: `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md` - evidence, transcript paths, mapped record shapes, verdict.
- Optional create: `docs/superpowers/spikes/artifacts/agy-print-mode/README.md` - artifact index only. Do not commit private transcript contents if they contain prompts, filesystem details, auth state, or user data.
- Optional create: `tests/fixtures/agy-print-mode/*.jsonl` - only sanitized minimal transcript fixtures if viability succeeds and parser work is justified.
- No product code changes in this plan unless the final verdict is viable and the user approves a follow-up implementation plan.

## Task 1: Confirm Agy CLI Availability And Prepare A Clean Probe Directory

**Files:**

- Create: `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md`

- [ ] **Step 1: Create the spike report skeleton**

Create `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md`:

```markdown
# Agy Print Mode Viability Spike

**Date:** 2026-06-26
**GitHub:** #522
**Status:** In progress

## Environment

- `agy --version`:
- Working directory:
- Transcript roots inspected:

## Probe Matrix

| Probe                  | Command shape | Transcript path | Completion parity | Tool parity | Approval/action parity | Verdict |
| ---------------------- | ------------- | --------------- | ----------------- | ----------- | ---------------------- | ------- |
| Text-only turn 1       |               |                 |                   |             |                        |         |
| Text-only continuation |               |                 |                   |             |                        |         |
| Local file read        |               |                 |                   |             |                        |         |
| Stop/timeout behavior  |               |                 |                   |             |                        |         |

## Record Shapes

## Findings

## Verdict
```

- [ ] **Step 2: Check Agy availability**

Run:

```bash
command -v agy
agy --version
agy --help | sed -n '1,120p'
```

Expected: `agy` exists, version/help output is captured in the spike report. If `agy` is missing or unauthenticated, record that as a blocker and stop.

- [ ] **Step 3: Create a clean probe dir outside the repo**

Run:

```bash
probe_dir="$(mktemp -d /tmp/jarv1s-agy-print-XXXXXX)"
printf 'alpha-bravo-charlie\n' > "$probe_dir/word.txt"
printf '%s\n' "$probe_dir"
```

Expected: a temporary path under `/tmp`. Record it in the spike report. Do not use a repo directory as the Agy working directory for the probes.

- [ ] **Step 4: Record pre-probe transcript roots**

Run:

```bash
find ~/.gemini -maxdepth 8 -type f \( -name '*.jsonl' -o -name 'transcript_full.jsonl' \) -print 2>/dev/null | sort > "$probe_dir/before-transcripts.txt"
```

Expected: command succeeds even if no files are found.

## Task 2: Probe Text-Only Continuity

**Files:**

- Modify: `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md`

- [ ] **Step 1: Run first print-mode turn**

Run from the probe dir:

```bash
cd "$probe_dir"
agy --dangerously-skip-permissions --print "Remember the marker phrase maple-17. Reply with exactly: stored."
```

Expected: output is exactly or near-exactly `stored.`. Record stdout/stderr summary and exit code.

- [ ] **Step 2: Run continuation turn**

Run:

```bash
cd "$probe_dir"
agy --dangerously-skip-permissions --continue --print "What marker phrase did I ask you to remember? Reply with only the phrase."
```

Expected: output contains only:

```text
maple-17
```

If continuity fails, record `Multi-turn parity: blocked` and continue to Task 5 for the verdict.

- [ ] **Step 3: Locate new transcript files**

Run:

```bash
find ~/.gemini -maxdepth 8 -type f \( -name '*.jsonl' -o -name 'transcript_full.jsonl' \) -print 2>/dev/null | sort > "$probe_dir/after-text-transcripts.txt"
comm -13 "$probe_dir/before-transcripts.txt" "$probe_dir/after-text-transcripts.txt"
```

Expected: one or more new transcript/log files. Record paths using `~/` in the report, not absolute local home paths.

- [ ] **Step 4: Summarize record types without copying private transcript bodies**

For each new candidate transcript, run:

```bash
node -e '
const fs=require("fs");
for (const file of process.argv.slice(1)) {
  const counts={};
  for (const line of fs.readFileSync(file,"utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec=JSON.parse(line);
      const key=rec.type || rec.event_type || rec.kind || rec.name || "unknown";
      counts[key]=(counts[key]||0)+1;
    } catch {
      counts["invalid"]=(counts["invalid"]||0)+1;
    }
  }
  console.log(file, counts);
}
' "$probe_dir"/path-to-new-transcript.jsonl
```

Expected: record-type counts are added to the spike report.

## Task 3: Probe Local Tool Behavior

**Files:**

- Modify: `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md`

- [ ] **Step 1: Run local file-read probe**

Run:

```bash
cd "$probe_dir"
timeout 45s agy --dangerously-skip-permissions --print "Read ./word.txt from the current directory. Reply with only its contents."
```

Expected for parity:

```text
alpha-bravo-charlie
```

Record exit code, elapsed time, and whether the output wandered outside the probe directory.

- [ ] **Step 2: Capture transcript deltas**

Run:

```bash
find ~/.gemini -maxdepth 8 -type f \( -name '*.jsonl' -o -name 'transcript_full.jsonl' \) -print 2>/dev/null | sort > "$probe_dir/after-tool-transcripts.txt"
comm -13 "$probe_dir/after-text-transcripts.txt" "$probe_dir/after-tool-transcripts.txt"
```

Expected: new or changed transcript/log files are identified.

- [ ] **Step 3: Summarize tool-related records**

For likely transcript files, run:

```bash
node -e '
const fs=require("fs");
for (const file of process.argv.slice(1)) {
  console.log("FILE", file);
  for (const line of fs.readFileSync(file,"utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec=JSON.parse(line);
      const raw=JSON.stringify(rec);
      if (/tool|LIST|READ|DIRECTORY|FILE|CALL|RESULT/i.test(raw)) {
        console.log(raw.slice(0, 500));
      }
    } catch {}
  }
}
' "$probe_dir"/path-to-tool-transcript.jsonl
```

Expected: enough sanitized shape information to identify tool invocation and result records. Do not paste raw private paths or secrets into the report.

- [ ] **Step 4: Decide local tool parity**

Record one of:

```markdown
Local tool parity: pass
```

```markdown
Local tool parity: blocked - print mode timed out before returning ./word.txt
```

Examples of blocker reasons:

- print mode cannot read the current working directory reliably
- print mode emits no structured tool invocation/result records
- print mode explores unrelated paths before answering
- print mode times out on a simple file read

## Task 4: Probe Completion, Liveness, And Stop Behavior

**Files:**

- Modify: `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md`

- [ ] **Step 1: Test completion signal shape**

Run a bounded slow-ish prompt:

```bash
cd "$probe_dir"
timeout 60s agy --dangerously-skip-permissions --print "Count from 1 to 5, one number per line, then write DONE."
```

Expected: command exits 0 and transcript has a clear final-response record that can map to Jarv1s `complete=true`.

- [ ] **Step 2: Test interruption behavior**

Run:

```bash
cd "$probe_dir"
timeout 3s agy --dangerously-skip-permissions --print "Think for 30 seconds before answering with done."
echo "exit=$?"
```

Expected for parity: timeout terminates the process cleanly and leaves transcript state that will not poison the next turn. Record what happened.

- [ ] **Step 3: Test continuation after interruption**

Run:

```bash
cd "$probe_dir"
agy --dangerously-skip-permissions --continue --print "Reply with exactly: after-timeout-ok"
```

Expected:

```text
after-timeout-ok
```

If continuation is corrupted by the interrupted turn, record `Stop/liveness parity: blocked`.

## Task 5: Map Agy Print Records To Jarv1s Semantics Or Block The Mode

**Files:**

- Modify: `docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md`

- [ ] **Step 1: Fill the record-shape mapping**

Add a mapping table with the observed records. This is the expected shape:

```markdown
| Agy print record shape             | Jarv1s semantic record | Evidence               |
| ---------------------------------- | ---------------------- | ---------------------- |
| `PLANNER_RESPONSE` with final text | `reply`                | Text-only continuation |
| `tool_calls[].name = READ_FILE`    | `tool`                 | Local file read        |
```

- [ ] **Step 2: Answer the parity questions**

Add short answers:

```markdown
### Parity Answers

1. Incremental `readNew` semantics: pass - transcript grows by line-oriented records during the turn.
2. Tool activity mapping: blocked - no structured tool result record was emitted for the file-read probe.
3. Approval/action visibility: blocked - print mode collapsed action-relevant behavior into planner text.
4. Local runtime boundaries: pass - file-read stayed inside the probe directory.
5. Stop/liveness semantics: pass - timeout killed the process and continuation still worked.
```

Replace the example answers with the actual probe results before setting the report status to
`Complete`.

- [ ] **Step 3: Write the final verdict**

Use exactly one of these verdicts:

```markdown
## Verdict

Viable. Agy print mode can preserve Jarv1s interactive parity. Next step: write a separate implementation plan for provider-config routing and an Agy print-mode transcript adapter using the captured sanitized fixtures.
```

```markdown
## Verdict

Blocked. Agy print mode does not currently preserve Jarv1s interactive parity.

Blocking gaps:

- print mode did not emit structured tool-result records
- print mode could not be stopped without corrupting continuation state

Next step: keep Agy interactive-only until these gaps are resolved upstream or by a new adapter design.
```

- [ ] **Step 4: Run a placeholder scan**

Run:

```bash
rg -n "TBD|TODO|angle-bracket placeholder" docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md
```

Expected: no unresolved placeholders remain. If the verdict is complete, set `Status` to `Complete`.

- [ ] **Step 5: Commit the spike report**

```bash
git add docs/superpowers/spikes/2026-06-26-agy-print-mode-viability.md
git commit -m "docs: record agy print mode viability"
```

## Task 6: Optional Follow-Up Only If Viability Passes

**Files:**

- Optional create: `tests/fixtures/agy-print-mode/*.jsonl`
- Optional create: `docs/superpowers/plans/YYYY-MM-DD-agy-non-interactive-execution-mode.md`

- [ ] **Step 1: Sanitize minimal fixtures**

If viability passes, create tiny JSONL fixtures containing only synthetic prompts/paths and the minimum fields required to test parser behavior. Do not commit raw transcript files.

- [ ] **Step 2: Write the implementation plan**

Create a separate plan for:

- provider-config `executionMode` plumbing if not already landed by the Codex plan
- admin UI control reuse
- runtime selection for Agy
- Agy print-mode transcript mapping
- live parity integration tests

- [ ] **Step 3: Stop if viability failed**

If viability failed, do not create product code tasks. The completed blocker report is the deliverable.

## Self-Review Checklist

- [ ] The report names the exact Agy version tested.
- [ ] Transcript paths are documented using `~/`, not absolute local usernames.
- [ ] No raw secrets, auth tokens, private data, or large raw transcript dumps are committed.
- [ ] The verdict is either `Viable` or `Blocked`.
- [ ] Every blocker is tied to observed evidence, not speculation.
