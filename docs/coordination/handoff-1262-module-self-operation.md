# Handoff — Epic #1262: module self-operation (Jarvis can operate Jarvis)

You are the **dev coordinator** for this epic. Run `/coordinate`. You orchestrate build agents; you
do not build.

## What this is

Jarvis can already describe every setting, screen and remediation in the app (the app map,
`packages/settings/src/manifest.ts:410`) and cannot change a single one. Someone built the map and
never built the hands. This epic gives the assistant real write tools over Jarvis's own configuration
and its modules' content, so "turn on dark mode", "add a news topic for local climate policy" and
"follow the Yankees" are things Ben says once and walks away from.

Both specs are **approved** and committed (`6c8325c8`):

- `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` (spec 1)
- `docs/superpowers/specs/2026-07-26-module-self-operation-content-commands.md` (spec 2)

Design history, including two rounds of adversarial cross-model review that killed the first design
outright: `docs/superpowers/plans/2026-07-26-module-self-operation.md` and its `-REVIEW-LOG.md`.
**Read the specs in full before spawning anything. Do not re-derive the review findings.**

## Issues

| Issue     | Scope                                                                | Depends on |
| --------- | -------------------------------------------------------------------- | ---------- |
| **#1262** | Epic                                                                 | —          |
| **#1263** | Chassis: declarations, exclusion denylist, build assertion, gateway ordering | — (lands first) |
| **#1264** | Spec 1 — settings tools + preferences CAS migration + undo seam      | #1263      |
| **#1265** | Spec 2 — news retrofit + sports follow/unfollow                      | #1263      |

**#1263 is a hard serial gate.** It changes `ModuleAssistantToolManifest` and the gateway; both
siblings build on that shape. Do not spawn #1264 or #1265 until #1263 is merged — a parallel start
guarantees a rebase collision on the same SDK type. Once it merges, #1264 and #1265 run in parallel
in separate worktrees.

## The rulings that govern every decision (Ben, 2026-07-26)

Chat is where Jarvis's power comes from. The failure being eliminated is Jarvis not doing — or not
knowing how to do — what a user asks. Guardrails, not permission prompts: _"You can't just talk to
Jarvis, tell it to do something, and then step away."_

1. **Permissions are a declaration list, not an allowlist.** Default is yes. Every write tool declares
   `granted_at_install` or `confirm_always`; **declaring nothing fails the build.** That build failure
   is the safety property — not which value a given tool picks.
2. **`confirm_always` means durable unrecoverable loss and nothing else.** Third-party disclosure,
   scheduled work and externally observable writes are explicitly _not_ grounds for a prompt. An
   earlier draft used them as bars and over-classified; Ben rejected it twice.
3. **Nothing in round one is `confirm_always`.** A build agent that proposes one is wrong about the
   tool, not right about the risk. Push back and cite this line.
4. **A confirmation card appearing anywhere in either acceptance run is a failure.** That is the exit
   criterion, not a nice-to-have.
5. **YOLO keeps bypassing everything**, including `risk: "destructive"` and per-call
   `requiresConfirmation`. The only gateway change is hoisting the **exclusion** check above the YOLO
   branch. If an agent proposes moving `resolvePolicy` ahead of YOLO, reject it — that exact proposal
   was rejected by Ben.
6. **The exclusion set is not negotiable and no tool author opts out of it.** Enumerated in spec 1.
7. **Do not build a parallel command registry.** `ModuleAssistantToolManifest`
   (`packages/module-sdk/src/index.ts:499`) already owns everything a registry would; the only new
   central artifact in the whole epic is the denylist. An agent that starts writing a registry has
   misread the spec.

## Traps an agent will hit if you don't warn it

- **The auto-run trap.** `defaultTier` is typed `"ask_each_time" | "always_confirm"`, so
  `trusted_auto` can never be a _declared_ default. No SDK widening is needed: `policy.ts:47` reads
  `(await lookup.getFamilyTier(...)) ?? manifest.defaultTier`, so the **stored** tier wins. Install
  persists `trusted_auto` as data.
- **The silent-prompt combination.** `policy.ts:49` requires tier **and** `executionPolicy: "auto"`
  **and** family `allowedTiers` — all three. `granted_at_install` without `executionPolicy: "auto"`
  keeps prompting forever and no test catches it unless the build assertion does.
- **The no-family trap.** `policy.ts:40` returns `confirm` for any write tool with no
  `actionFamilyId`. That is why all five existing news write tools prompt on every call today.
- **No service layer to call.** Locale, chat style, quiet hours, notification prefs and sports
  follows all write repositories directly from route handlers. Extraction is in scope; the spec says
  so; agents will assume a service exists and be wrong.
- **CAS needs a migration.** `app.preferences` has no version column and `updated_at` is unsafe.
  Integer revision + conditional update/delete + `ON CONFLICT DO NOTHING`. **New migration file —
  never edit an applied one** (hash-checked).
- **No tool may accept a preference key as an argument.** `yolo.enabled`, `yolo.allowed`,
  `persona.bundle` and wellness consent share `app.preferences` behind the same port. A generic
  set-preference tool is self-promotion to YOLO.

## Standing project rules that apply to this run

- **Build agents: Sonnet 5 or `gpt-5.6-luna` xhigh. `sol` xhigh is banned for build.** Verify the
  model line after each spawn. Security QA on Opus.
- Every agent gets its **own worktree**. `/home/ben/Jarv1s` is the shared main checkout and other
  sessions use it — never `git add -A`, never `git pull`/`checkout`/`reset` it mid-run.
- Each spec's UAT is **mandatory and is the exit criterion**: a real dev-instance Playwright run on
  the #1000 harness. Full `pnpm verify:foundation` green with a real exit code — never `| tail`, which
  masks a failing gate as exit 0.
- Prettier handoff/coordination docs before committing them into a build worktree.
- Park anything needing Ben in `docs/coordination/AWAITING-BEN.md`, not buried in a digest.

## Start

1. `pnpm install` (fresh worktree).
2. Run `/coordinate`. Read both specs in full, then #1263, #1264, #1265.
3. Open the run manifest at `docs/coordination/<run-id>.md`.
4. Spawn **#1263 only**. Gate #1264 and #1265 behind its merge, then run them in parallel.
5. Relay before your own context fills — do not try to carry the whole epic in one session.
