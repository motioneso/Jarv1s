# Relay — #1026 UAT Playwright, pass 3 (still pre-code)

Worktree/branch unchanged: this worktree, branch `uat-play-1026`, off `origin/main`.
`node_modules` installed — skip `pnpm install`. Coordinator label `Coordinator` (pane resolves via
`herdr pane list`, session `58a78927-385c-4b1d-8fa0-94db20255d6f` — resolve fresh, don't trust a
pane number). Zero code/commits so far across all 3 passes — pure grounding. **Do not repeat the
grounding reads below — they are done and verified current as of this pass.**

## Coordinator's approval (already received, binding — do not re-ask)
1. APPROVED: add exported `provisionForUat(level: UatSeedLevel, opts?: {excludeChunks?: readonly
   string[]}): Promise<{baseURL: string, teardown: () => Promise<void>}>` to
   `tests/uat/provisioner.ts`; refactor `main()` (line ~371, not exported, guarded by the
   `import.meta.url` check at bottom so importing this file won't auto-run it) to call it,
   preserving `main()`'s exact external behavior (used by `package.json`'s
   `uat:provision:smoke`). Also fix a self-found bug while here: current line ~430 calls
   `composeSeedHook({ projectName, level })` and drops `excludeChunks` — must forward it.
2. APPROVED: add `export` to `UAT_ADMIN_EMAIL`/`UAT_ADMIN_PASSWORD` in `tests/uat/seed/admin.ts`
   (currently lines 8-9, plain `const`, not exported) — no other change.
3. CONFIRMED: relay-pass-1's #868 citation was wrong (unrelated issue, about private-transcript
   purge). Build spec §6 as a **happy-path** install-succeeds proof, real nav only (no
   `page.goto` anywhere, including initial entry — click through `RailUserMenu`). Do NOT write a
   failure-injection test. Why-comments about fail-closed philosophy cite `apps/web/src/app.tsx`'s
   `myModulesEnabled()` + issues #1026/#1000, never #868.

Coordinator's last explicit instruction: **"write the plan doc and send me the pointer for
approval BEFORE writing code."** Not yet done — do this first.

## Exact locators/strings confirmed this pass (all read in full from current source, not memory)
- `playwright.config.ts`: existing mocked config, `testDir: "./tests/e2e"`, fixed `baseURL:
  "http://127.0.0.1:4173"`, has a `webServer` block. New `tests/uat/playwright.uat.config.ts` must
  NOT reuse `webServer` (targets ephemeral Compose stack) and must resolve `baseURL` at runtime —
  decide mechanism in the plan (env var e.g. `JARVIS_UAT_BASE_URL` read in config vs a written
  runtime file); not yet decided, decide when drafting.
- Login (`apps/web/src/auth/auth-screen.tsx`): no name field in sign-in mode. Locators:
  `page.getByLabel("Email")`, `page.getByLabel("Password")`,
  `page.getByRole("button", {name: "Sign in"})`. Default mode is sign-in unless `needsBootstrap`.
- Real nav to Settings (`apps/web/src/shell/app-shell.tsx` `RailUserMenu`, lines ~272-361): click
  `.jds-usermenu__trigger` button (or by accessible name — contains avatar/name/email/chevron),
  then `page.getByRole("button", {name: "Settings & permissions"})`. This is the mandated
  no-`page.goto` path per approval #3 above.
- In-Settings sub-nav (existing precedent, `tests/e2e/settings-modules.spec.ts:44-48`):
  `page.getByRole("button", {name: "Admin / Setup"})` → `page.getByRole("button", {name:
  "Instance modules"})` → assert heading "Instance modules" + text "Available modules".
- Module registry (`apps/web/src/settings/settings-module-registry-section.tsx`): section
  `aria-label="Module registry"`. STATE_LABELS incl. `"not-installed": "Not installed"`,
  `"pending-restart": "Downloaded — restart to apply"`, `"installed-enabled": "Installed"`,
  `"install-failed": "Install failed"`. Install button text = `"Install"` when not-installed.
  Confirm dialog (`onInstall`, lines ~126-136): title = `` `Install ${row.name}?` `` →
  **"Install Job Search?"** (module name confirmed from
  `external-modules/job-search/jarvis.module.json`: `"name": "Job Search"`), confirmLabel =
  **"Download"**. Dialog itself (`settings-feedback.tsx`): `role="dialog" aria-modal="true"
  aria-label={dialog.title}` — so `page.getByRole("dialog", {name: "Install Job Search?"})`, then
  click `page.getByRole("button", {name: "Download"})` inside it (dialog title element is a plain
  div `.jds-dialog__title`, not a heading — don't use `getByRole("heading")` for it).
  `<Note>` shown when any row `pending-restart`/`update-pending-restart`. `row.lastInstallError`
  only rendered when state is `install-failed`. `Switch` (installed-enabled/disabled only):
  `ariaLabel={`Enable ${row.name}`}` → **"Enable Job Search"**; renders as `role="checkbox"`
  (NOT `role="switch"`) inside a clickable `label.jds-switch` wrapper — click the label, assert
  the checkbox (see `settings-modules.spec.ts:53-59` for exact pattern to mirror with
  `/enable job search/i`).
- `tests/uat/seed/admin.ts` current state (pre-edit, re-verified this pass): lines 8-9 `const
  UAT_ADMIN_EMAIL = "uat-admin@jarv1s.local"` / `const UAT_ADMIN_PASSWORD =
  "uat-admin-password-1025"`, NOT exported yet. `hashPassword` imported from `"@jarv1s/auth"`
  (not `better-auth/crypto"` — an earlier draft guessed wrong). `seedSoloAdmin(migrationDb)`
  returns `{userId, email, password}`.
- `package.json`: no `"test:uat"` script yet — add `"test:uat": "tsx tests/uat/run-uat.ts"`.
  `"uat:provision:smoke": "tsx tests/uat/provisioner.ts"` already exists and must keep working
  after the `main()` refactor.

## Spec §6 — the 10-step blueprint to implement (already fully extracted in relay-pass-1 doc,
`docs/superpowers/handoffs/2026-07-13-uat-1026-playwright-relay.md` — read THAT doc's "Spec §6
blueprint" section once, it's still accurate; don't re-read the full spec file).

## Next concrete steps (do these, in order)
1. `superpowers:writing-plans` → save `docs/superpowers/plans/2026-07-13-uat-1026-playwright.md`
   covering: `tests/uat/playwright.uat.config.ts`, `provisioner.ts`'s `provisionForUat` refactor
   (incl. the `excludeChunks` forwarding fix), `admin.ts`'s 2-line export, `tests/uat/run-uat.ts`
   wrapper, `tests/uat/specs/job-search-install.uat.spec.ts` (§6, using the exact locators above),
   `package.json`'s `test:uat` script. Run the Self-Review yourself (not a subagent).
2. Message Coordinator: "plan ready for uat-1026-playwright: <path>. Approve, or flag a fork."
   STOP, wait for explicit approval — do not write code before it lands.
3. Build via `superpowers:test-driven-development`, one task per commit, explicit `git add
   <files>` (never `-A`, shared tree), `Co-Authored-By: Claude` trailer.
4. Pre-push every push: `pnpm format:check && pnpm lint && pnpm typecheck`, then `git fetch
   origin main && git rebase origin/main`.
5. `pnpm verify:foundation` green (record exit codes) → `coordinated-wrap-up` → PR (`Part of
   #1000`, `Closes #1026`, base `main`, "What's new: Internal — adds the Playwright UAT spec that
   drives the real UI to prove job-search install completes end-to-end.") → report PR # to
   Coordinator. Never merge/board/close.
6. Relay again at next 70% meter warning or compaction-summary sighting.

## Guardrails (still binding)
No `git add -A`. Don't touch `docs/coordination/`. Don't run repo-wide `pnpm format`. No new
migration. Caveman mode to Coordinator.
