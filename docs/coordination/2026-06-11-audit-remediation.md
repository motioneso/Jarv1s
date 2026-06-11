# Coordination Run — 2026-06-11-audit-remediation

**Date:** 2026-06-11
**Coordinator lock:** label `Coordinator` = pane `w653f42bef3ac02-1` (`$HERDR_PANE_ID=p_30`). Single-coordinator lock — exactly one pane holds this label for the life of the run; agents escalate to the **label** (routing), the coordinator merges only when its own `$HERDR_PANE_ID` resolves to this recorded **pane-id** (authority).
**Finding source:** `docs/audits/2026-06-11-fable5-issue-verification.md` — independent Fable 5 verification @ `origin/main e629f3c`, migration head 0052 (22 stand, 8 severity-downgraded to MED/LOW, 0 refuted, 0 already-fixed).
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off** + posted `gh pr comment` verdict.
**Relay threshold:** ~80–100k tokens OR every 2–3 merges OR a compaction summary seen (flush + relay, merge nothing first).
**Available worker panes (Ben, 2026-06-11):** idle `w653f42bef3ac02-2` (claude) and `w653f42bef3ac02-3` (codex) may be reused as workers. Codex pane = candidate **cross-model security-tier QA** path. Build agents still require an **isolated worktree** + own `JARVIS_PGDATABASE` (the three panes share one working tree — never build in it).

> Coordinator's externalized memory. Keep CURRENT. GitHub is source of truth for spec/issue/board
> status; this file holds only in-flight operational state.

## Phase-0 gate status

- **CI on `main`:** ✅ green @ e629f3c (verified 2026-06-11)
- **Ben manifest approval:** ✅ approved (Slice A first — 2026-06-11)
- **Slice A spec:** ✅ `docs/superpowers/specs/2026-06-11-audit-slice-a-rls-least-priv.md`
- **Slice A plan:** ✅ `docs/superpowers/plans/2026-06-11-audit-slice-a-rls-least-priv.md`
- **Remaining slices B–I:** still blocked on specs (spec-before-build gate)

## Queue (proposed slices — each needs a spec before it can spawn)

Severity post-Fable. Tier by content trigger (most of this backlog is `security`).

| Slice | Issues | Tier | Adds migration? | Spec | Status |
| ----- | ------ | ---- | --------------- | ---- | ------ |
| **A — RLS least-priv migrations** | #97 users-column UPDATE restriction, #98 worker memory RLS policies | security | **yes (×3: 0053+0054+0055)** | `docs/superpowers/specs/2026-06-11-audit-slice-a-rls-least-priv.md` ✅ | **QA in flight** — PR #181, CI ✅ green, VF=0 AUDIT=0 359/359, SliceA-QA pane `w653f42bef3ac02-5` running Opus QA |
| **B — Dead subsystem deletion** | #120 workspaces, #153 resource-grants no-op, #115 + #116 (resolved by deletion), fold #152 manifest-narrowing; advances #155/#127/#101 workspace-halves | sensitive→**security** | **yes (DROP)** | — MISSING | blocked-on-spec |
| **C — Vault containment** | #129 actorUserId validation, #130 symlink real-path containment | security | no (code) | `docs/superpowers/specs/2026-06-11-audit-slice-c-vault-containment.md` ✅ | **QA pending CI** — PR #182, CI ⏳ pending, VF=0 348 tests; awaiting CI green to spawn Opus QA |
| **D — Settings → DataContextDb** | #95 SettingsRepository raw Kysely, #155 /api/me cross-user read | security | maybe (grant) | — MISSING | blocked-on-spec |
| **E — Auth module hardening** | #113 bearer-token bypass (design-gated), #101 module-isolation, #127 bootstrap actor-GUC, #141 OAuth error-body leak | security | no (code) | — MISSING | blocked-on-spec |
| **F — AI tool-path hardening** | #132 REST validateToolInput, #119 server-side allowlist, #148 blank ToolContext, #172 tools/list actor-scope | security | no (code) | — MISSING | blocked-on-spec |
| **G — Data-layer defense-in-depth** | #102 assertDataContextDb, #144 vectorSearch owner predicate, #99 structured-state WITH CHECK | security | maybe (#99) | — MISSING | blocked-on-spec |
| **H — Migration/job infra** | #124 schema_migrations per-dir, #134 worker dead grant REVOKE, #135 incognito trigger, #157 metadata-only payload guard, #174 pgboss RLS | security/sensitive | **yes (×3)** | — MISSING | blocked-on-spec |
| **I — Portability + observability tail** | #170 export omits private, #149 handleRouteError, #140 list ownership, #166 test hygiene (LOW) | sensitive/routine | no (code) | — MISSING | blocked-on-spec |

Not yet sliced: the aggregate `MED/LOW findings —` batch issues (#104–#111, #114, #117, #122–#171 even, #156…) — a later backlog pass after the HIGH/MED individual findings land.

## Dependency / collision map

**Dominant constraint: migration numbers are global, assigned by landing order** — every
migration-adding slice must land in a fixed sequence. No two migration slices spawn in parallel
without a pre-assigned number, and a serialized slice must NOT assume its number until its
predecessor merges.

- **Serialized migration spine (merge order):** **A → B → D(if migration) → G(#99) → H**.
  Each waits for its predecessor to land before its migration number is real.
- **Parallel-safe (code-only, distinct modules) — may run alongside the spine:**
  - **C (vault)** — `packages/vault` only; no overlap with spine.
  - **E (auth)** — `packages/auth/src/index.ts`; #101/#113/#127/#141 all touch this one file ⇒
    **serialize internally** (one agent, one slice), but parallel to spine/C/F.
  - **F (ai)** — `packages/ai` + briefings; parallel to spine/C/E.
- **Cross-slice overlaps to honor:**
  - #155 appears in both **B** (workspace-half) and **D** (raw-Kysely read) → **D after B**.
  - #127/#101 bootstrap touched by both **B** (workspace writes) and **E** (auth isolation) →
    coordinate the bootstrap edit; **B lands the workspace removal first, E rebases**.
  - #98 (A) and #102/#144 (G) both touch memory repos → **G after A**.
- **Recommended first wave (smallest blast radius, highest value):** **Slice A** (two tiny
  security migrations, live-breakage fix for #98) → then **Slice B** (the deletion that collapses
  #120/#153/#115/#116/#152 and de-risks D/E). Author specs A and B first.

## Risk-tier note

8 of 9 slices are **security-tier** ⇒ each gets cross-model (Opus) adversarial QA + a posted
`gh pr comment` verdict + **Ben's explicit merge sign-off** (never auto-merged). The Codex pane
`-3` is the candidate cross-model QA executor. Plan token spend accordingly (security QA is the
budgeted place to spend up; the resident loop runs cheap on Sonnet).

## CI waivers

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| <none> | — | — | — | — |

## Outstanding escalations

- [ ] **Spec authoring strategy** (Ben) — author specs slice-by-slice (A, B first) vs one umbrella
      remediation spec. Recommend slice-by-slice via `superpowers:brainstorming` / `/brief`,
      starting with A then B.
- [ ] **#113 bearer-token** carries a genuine design fork (keep/scope/remove the opaque-token path)
      — needs a design decision in Slice E's spec before build.

## Reaped sessions

- <none yet>
