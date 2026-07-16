# Spec — #1085: native YOLO auto-grant unreachable + blocklist priv-esc

Lane D. Status: APPROVED (Fable, delegated auth 2026-07-16). Build = `gpt-5.6-sol`, QA = Opus (security). UAT via #1000 harness (mandatory).

## Decisions (locked)

- **F1+F2 are ONE atomic PR, blocklist commit FIRST.** F1 (forward `cwd` from the permission hook so `nativeYoloCanAutoAllow` is reachable) is dead-feature-repair; F2 (blocklist the permission-enforcement files) is the priv-esc guard that MUST exist before F1 makes the branch live. Landing F1 without F2 opens the hole. Commit order inside the PR: F2 then F1.
- **F2 blocklist additions:** add to `NATIVE_CONFIG_FILE_NAMES` (gateway.ts:89) — `.jarvis-claude-permission-hook.mjs`, `.jarvis-claude-settings.json`, `.jarvis-claude-permission-token`, and `.claude.json` (CLI root config / folder-trust, seeded per #342). These live in the CLI cwd with no `.claude` path segment, so the existing segment check misses them.
- **F3 (executable-adjacent writes) — decided: harden now, in the same PR.** The lexical-only check (`resolve` + segment/basename) lets absolute writes to `~/.bashrc`, `.git/hooks/*`, `~/.profile`, crontab drop-ins, and workspace symlinks into `.claude/` through. Add: (a) reject targets that resolve **outside `workingDirectory`** (auto-allow is workspace-scoped — an absolute path escaping the cwd is never a routine edit); (b) `realpath`/symlink resolution before the `.claude` segment check (cf. #1018). This closes F3 and the symlink evasion together.
- **F4 (fire-and-forget audit) — fix in same PR:** `void recordAuditRaw` with swallowed errors and hardcoded `outcome:"success"` (gateway.ts:203-222) is wrong for an auto-grant. Await the audit write (or write a pending-action backup row) before returning `allow`; do not record `success` for a tool Jarvis never observes completing.
- **F5 (migration 0164 privacy) — decided: (a) accept + document, restore the tripwire as an explicit bound test.** Do NOT drop the `input_summary` column: it is woven into both the pending-action and audit paths (`summarizeAssistantToolInput`, gateway.ts:224/237/425) and is **key-names-only** (values excluded, keys capped, `additionalProperties:false` — bounded). A destructive drop is disproportionate and risky. Instead, **re-add the guard test that migration 0164 inverted**, rewritten as an explicit assertion of the bound: `summarizeAssistantToolInput` persists ONLY key names, never values; caps key count/length; drops unknown keys. This converts the silently-inverted invariant into an explicitly-tested tripwire. No migration in this PR.

## Files

- `packages/chat/src/live/claude-permission-hook.ts` (:226 sender) — F1: include `cwd` in the `/internal/permission` POST body.
- `packages/ai/src/gateway/gateway.ts` — F2: extend `NATIVE_CONFIG_FILE_NAMES` (:88-96). F3: `nativeYoloCanAutoAllow` (:652-668) — add outside-cwd rejection + realpath/symlink resolution. F4: audit path (:203-222) — await/back up, correct outcome.
- `tests/integration/action-audit-log.test.ts` (:340-349) — F5: restore + rewrite the guard test as a bound assertion.

## Tests

- Integration proving native Edit/Write with a **real forwarded cwd** auto-grants (existing tests inject synthetic `cwd:"/workspace"` — that is exactly how F1 shipped dead; the new test must NOT inject it synthetically).
- Integration: a Write to `.jarvis-claude-permission-hook.mjs` / `.claude.json` is **denied** (gated, not auto-allowed).
- Integration: absolute write to `~/.bashrc` and a workspace symlink into `.claude/` are denied (F3).
- F5 bound test as above.

## Exit criterion (UAT — #1000 harness, mandatory)

Real native-write YOLO run through the Playwright harness: YOLO on → native Edit auto-grants WITHOUT a confirmation card (F1 proven live at runtime), and a write to a permission-hook file still prompts/denies (F2/F3). Unit+integration green. Opus security sign-off. This is a security lane — merge is manual after VF polls green, never `--auto`.
