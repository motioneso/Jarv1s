# Coordination Run — 1262-self-operation

**Date:** 2026-07-26
**Epic:** #1262 — module self-operation (Jarvis can operate Jarvis)
**Handoff:** `docs/coordination/handoff-1262-module-self-operation.md`
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id
`43e5f5e2-0deb-4ab5-9237-436e8795b611`** (match `agent_session.value` in `herdr pane list`).
Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this
anchor holds authority for the life of the run. ⚠️ **Pane numbers (`w…-N`) reflow on every
restart/split/reap — do NOT trust any pane number written in this file as an identifier; resolve the
pane fresh by label+session at read time.** Agents escalate to the **label** (routing, re-claimable);
the coordinator merges only when its own pane's **session id** (immutable, NOT the pane number)
matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs
Ben's explicit merge sign-off**. All three items in this run are `security` tier — every merge in
this run is Ben-gated.
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive
`merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge
nothing.
**merges_since_relay:** 0

> This is the coordinator's externalized memory. Keep it CURRENT — it is what lets a fresh
> coordinator adopt this run after a self-handoff. GitHub is the source of truth for
> spec/issue/board status; this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` (chassis half) | #1263 | security | queued (awaiting Ben OK) | — | — | `1263-self-operation-chassis` | — |
| `docs/superpowers/specs/2026-07-26-module-self-operation-settings-commands.md` | #1264 | security | gated on #1263 merge | — | — | `1264-settings-self-operation` | — |
| `docs/superpowers/specs/2026-07-26-module-self-operation-content-commands.md` | #1265 | security | gated on #1263 merge | — | — | `1265-module-content-self-operation` | — |

Risk tier (content triggers, set at Phase 0 — see `coordinate` Risk tiering):

- `routine` — no schema/auth/secret surface → auto-merge after green QA.
- `sensitive` — shared-table migration / cross-module contract / export-delete / job-payload shape → auto-merge + Ben digest.
- `security` — auth/sessions/tokens/RLS/secrets/rate-limit/network-exposed/policy migration → cross-model Opus QA + `gh pr comment` verdict + **Ben merge sign-off**.

**Why all three are `security`:**

- **#1263** rewrites the gateway authorization path (`packages/ai/src/gateway/gateway.ts:160`) and
  introduces the denylist that decides what the model may ever do. Policy-touching by definition.
- **#1264** adds a core-owned migration on the shared `app.preferences` table, a per-tool
  authorization callback, and a hard rule that no tool may take a preference key (a key-taking tool
  is a hole straight through the denylist — self-promotion to YOLO). Spec's own exit line: "Security
  QA on Opus."
- **#1265** flips ~39 existing write tools from confirm-on-every-call to auto-run, and includes an
  SSRF containment check on `news.previewSource` (network-exposed surface, `externalContent: true`).
  Changing what executes without a prompt is an authorization-surface change.

Status vocabulary: `queued` → `building` → `awaiting-plan-approval` → `blocked` →
`pr-open` → `qa` → `qa-failed`/`rework` → `awaiting-ben-signoff` (security) → `merged`
(or `handed-off` when relayed to a fresh session).

## Dependency / merge order

- **Serialized gate:** **#1263 lands alone, first.** It changes `ModuleAssistantToolManifest`
  (`packages/module-sdk/src/index.ts:499`) and the gateway; both siblings build on that exact shape.
  A parallel start guarantees a rebase collision on the same SDK type.
- **Parallel group 1 (only after #1263 merges):** #1264 ∥ #1265.
- **Merge order:** #1263 → then #1264 and #1265 in whichever order goes green (no ordering
  dependency between them once the chassis has landed).

### Verified collision surface between #1264 and #1265

Checked at Phase 0 rather than assumed:

| Surface | #1264 | #1265 | Collision |
| ------- | ----- | ----- | --------- |
| `packages/settings/src/*` | writes | — | no |
| `packages/structured-state/src/preferences-repository.ts` | CAS | — | no |
| New migration file | **yes** (core-owned, `app.preferences` revision column) | none identified (sports follows + news tables already exist) | **no** — only one migration in the run, so no global-number race |
| `packages/news/src/*`, `packages/sports/src/*` | — | writes | no |
| `packages/module-sdk/src/index.ts` | reads the field | reads the field | no (field lands in #1263) |
| Cross-module write-tool classification | see fork A below | see fork A below | **potential** — resolved by fork A |

## Phase-0 findings that need Ben before spawning

Three things the specs do not settle. Each changes what #1263's agent builds, so they are resolved
first, not discovered mid-build.

### Fork A — who classifies the existing write tools, and how many are there

#1263's build assertion is "a write tool that declares nothing fails the build", and #1263's exit
criterion is `pnpm verify:foundation` green. Those two are only simultaneously satisfiable if the
classification of every already-shipped write tool lands **in #1263**. #1265 scope item 7 says the
same thing in words ("it lands with the assertion") but is filed on the wrong issue.

**Coordinator reading: the retrofit classification belongs to #1263, not #1265.** #1265 keeps the
news-specific work (action family, `executionPolicy`, the `guidance` prompt-shaping question, SSRF
check) and the sports build.

Measured count (`risk: "write" | "destructive"` across `packages/*/src`): **39 tools in 11
packages**, not the 29 the specs state.

| Package | Tools | Enumerated in spec 2? |
| ------- | ----- | --------------------- |
| tasks | 13 | yes |
| news | 5 | yes |
| **people** | **4** | **no** |
| notes | 3 | yes |
| goals | 3 | yes |
| commitments | 3 | yes |
| **memory** | **2** | **no** |
| email | 2 | yes |
| calendar | 2 | yes |
| **web-research** | **1** | **no** |
| ai | 1 | yes |

### Fork B — `memory.remember` / `memory.forget` vs exclusion rule 2

Exclusion rule 2 (prompt-shaping) names "memory settings and fact mutation". `memory.remember`
(`packages/memory/src/manifest.ts:234`, `risk: "write"`) and `memory.forget` (`:242`,
`risk: "destructive"`) are **already-shipped assistant tools**. If the denylist captures them,
Jarvis loses two capabilities it has today — a user-visible regression, not groundwork.

`memory.forget` is also the one tool in the whole retrofit that plausibly clears the
unrecoverable-loss bar (it destroys a fact the user already had), which collides with the ruling that
**nothing in round one is `confirm_always`**. That ruling was written about the *new* settings and
content tools; the retrofit drags a pre-existing destructive tool into round one.

Three coherent answers, none of which an agent should pick on its own:

1. Exclude both — Jarvis stops being able to remember/forget on request (regression).
2. `granted_at_install` for both — keeps today's behaviour, and `memory.forget` auto-runs.
3. `granted_at_install` for `remember`, `confirm_always` for `forget` — the only round-one
   `confirm_always`, which contradicts the ruling as written but matches its stated bar.

### Fork C — `people.merge` / `people.splitIdentity`

Both `risk: "destructive"` (`packages/people/src/tools.ts:161,179`), unenumerated. `splitIdentity`
looks like the reverse of `merge`, which would make them auto-safe under the recoverability bar — but
"reverse exists" and "reverse restores exact prior state" are not the same claim, and the spec
requires a **tested** reverse. Flagging rather than assuming; if Ben wants, the #1263 agent verifies
the round-trip and classifies on the evidence.

## CI state on `main`

- Required `CI` workflow: **green** on the last completed run (`30217146891`, 35m10s, success). The
  run for the handoff commit was still in progress at Phase 0 — re-checked before spawn.
- `modules-registry` workflow, `publish` job: **red on `main` since at least 2026-07-20** (runs
  30217146890, 30064884141, 29790862146, 29751128971). Pre-existing, not introduced by this run, and
  not a required check. Recorded here so no agent mistakes it for their own breakage. Waiver entry
  below if it ever blocks.

## CI waivers

A red required check merges ONLY if waived here. Each waiver: check name + the SHA it's proven
failing on `origin/main` at + the proof + **Ben-approved (y/date)**. A check failing twice =
stop-the-line + file an issue (no waiver).

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| `modules-registry / publish` (non-required) | — | red on `main` across 4 consecutive pushes since 2026-07-20 | `gh run list --workflow=modules-registry` | not needed unless it blocks a merge |

## Outstanding escalations

- [ ] **Fork A / B / C above — awaiting Ben.** Blocks the #1263 spawn, because all three change what
      the chassis agent classifies. Coordinator has a recommendation on A; B and C are product calls.
- [ ] **Manifest approval — awaiting Ben** (Phase 0 step 5).

## Reaped sessions

- <none yet>

## Continuation note

**Mid-doing:** Phase 0 complete except Ben's approval. Lock claimed, both specs and all three issues
read, collision surface verified in code, three forks raised. Nothing spawned yet. Next action after
Ben answers: fold his rulings into the #1263 handoff doc, create the worktree
`.claude/worktrees/1263-self-operation-chassis` off `origin/main`, spawn the single build agent with
`--model sonnet`, and hold #1264/#1265 until #1263 merges.
