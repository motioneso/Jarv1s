# Build Handoff — install-sh-posix (#452)

**Spec (approved):** GitHub issue #452
**GitHub issue:** #452
**Risk tier:** `routine`
**Worktree:** ~/Jarv1s/.claude/worktrees/install-sh-posix
**Branch:** install-sh-posix (off origin/main @ 202c638b)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr pane run <pane> "<msg>"`)
**Coordinator session id:** `ses_111f40556ffeVraVZuie2X8ScJ`
**Run manifest:** docs/coordination/2026-06-24-chat-stability-batch.md

## ⚠️ CI STATUS (temporary — read first)

GitHub Actions is **disabled — billing paused**. **Local gate is the source of truth.** Do NOT run `gh pr checks`. Run `pnpm format:check && pnpm lint && pnpm typecheck` before push; record exit codes.

## Your task (#452 — verbatim from issue)

`install.sh` declares `#!/bin/sh` and the header comment claims "POSIX sh (dash/ash/bash-as-sh): no bashisms", but notes-overlay support (#449/#450) introduced **bash arrays**:
- L87: `COMPOSE_FILES=(-f "$COMPOSE_NAME")`
- L113: `COMPOSE_FILES+=(-f "docker-compose.notes.yml")`
- L233/259/304: `"${COMPOSE_FILES[@]}"`

On a host where `/bin/sh` is **dash** (Debian/Ubuntu default), `./install.sh` dies immediately:
```
./install.sh: 87: Syntax error: "(" unexpected
```

**Impact:** Any operator on a dash-`/bin/sh` host cannot run the documented `JARVIS_IMAGE_TAG=... ./install.sh` deploy. This is the hand-off entrypoint.

**Fix (chosen — Option 1 from the issue, lowest-risk):** Change the shebang to `#!/usr/bin/env bash` and drop the POSIX-sh claim in the header comment. Install already requires Docker; bash is ubiquitous. Update the header comment so it matches reality (no false "POSIX sh / no bashisms" claim).

**Files:**
- Modify: `install.sh` ONLY

**Step 1 — Change the shebang (line 1).**
- From: `#!/bin/sh`
- To: `#!/usr/bin/env bash`

**Step 2 — Fix the header comment.** Find the comment block near the top that claims POSIX sh / no bashisms (read the file to locate it — it's in the first ~30 lines). Rewrite it to accurately say it requires bash. Keep the rest of the comment's intent (one-command deploy launcher, hand-this-to-someone-else entrypoint).

**Step 3 — Verify (this is your gate):**
```bash
# Syntax check with bash
bash -n install.sh && echo "bash syntax OK"
# Confirm dash STILL rejects it is fine — we've explicitly chosen bash now.
# Confirm the array lines now parse under bash:
bash -c 'COMPOSE_FILES=(-f "x"); COMPOSE_FILES+=(-f "y"); echo "${COMPOSE_FILES[@]}"' && echo "array OK"
# Format/lint/typecheck (install.sh is covered by prettier if configured for shell; run anyway):
pnpm format:check
pnpm lint
pnpm typecheck
```
Record exit codes. (If prettier reformats install.sh, accept the formatting — re-run `pnpm format` to apply, then verify still green.)

## Build workflow

1. **Orient.** `cd ~/Jarv1s/.claude/worktrees/install-sh-posix`. Confirm branch = `install-sh-posix`. `pnpm install` if node_modules missing.

2. **Read CLAUDE.md** Hard Invariants. None directly apply to install.sh but stay aware.

3. **Plan is pre-approved** (Option 1 above). Execute directly.

4. **Edit** `install.sh`: shebang (L1) + header comment. Leave all array usage (`COMPOSE_FILES=(...)`, `+=`, `"${COMPOSE_FILES[@]}"`) AS-IS — that's the whole point, bash supports them.

5. **Commit:**
   ```
   fix(install): use #!/usr/bin/env bash instead of #!/bin/sh

   Notes-overlay support (#449/#450) introduced bash arrays
   (COMPOSE_FILES=(...), +=, "${COMPOSE_FILES[@]}") which break under
   dash-/bin/sh hosts with "Syntax error: "(" unexpected". install.sh
   already requires Docker (hence a real OS); bash is ubiquitous. Switch
   the shebang and update the header comment to match reality rather than
   the now-false "POSIX sh / no bashisms" claim.

   Closes #452
   ```
   - `git add install.sh` ONLY.

6. **Pre-push trio + rebase.**

7. **Push and open PR:**
   ```bash
   git push -u origin install-sh-posix
   gh pr create --title "fix(install): switch shebang to bash (arrays need it)" \
     --body "Closes #452. install.sh used bash arrays but declared #!/bin/sh — died on dash hosts at the deploy entrypoint. Switch to #!/usr/bin/env bash and fix the header comment." \
     --base main
   ```

8. **Report to coordinator** (caveman-terse): `install-sh-posix PR #<N> open. gate: bash -n ✓, format ✓, lint ✓, typecheck ✓. ready for QA.`

9. **Stop.** Coordinator owns QA/merge/board/close.

## Your compact (non-negotiable)

- Work only in your worktree on `install-sh-posix`.
- CI down — local gate truth; record exit codes.
- Plan pre-approved — execute directly.
- Escalate blockers to `Coordinator` label via `herdr pane run`.
- Never touch board/milestones/issues/merge.
- Caveman for coordinator messages; conventional for commits/PR.
- Pre-push trio before every push.

## Collision notes

- You touch `install.sh` ONLY.
- No other lane touches install.sh or any shell script in this wave.
- Leave the `COMPOSE_FILES` array logic unchanged — only shebang + comment.
