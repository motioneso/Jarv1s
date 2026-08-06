# Build plan — Moss rename PR1: display strings, assistant-name threading, living docs

- **Issue:** #1441 (Part of epic #1440) · **Spec:** `docs/superpowers/specs/2026-08-05-moss-rename-design.md` §1, §1.2, §6
- **Branch:** `moss/1441-display-strings` · **Worktree:** `.claude/worktrees/moss-1441` · base `d3113a0f2`
- **Risk tier:** low (no infrastructure, no migration, no schema, no env var)

## 0. Gates

| Gate | State |
|---|---|
| Approved design spec in `docs/superpowers/specs/` | ✅ `2026-08-05-moss-rename-design.md` |
| GitHub `task` issue | ✅ #1441, labels `task`, `RFA` |

## 1. Scope correction — resolved before planning

The issue and spec §1.1 both state **"25 hardcoded `"Jarvis` occurrences across 15 files"**. That
census is a **5× undercount**, and the plan is built against the corrected one.

The spec's grep was `"Jarvis` — a double quote *immediately* before the word. It only matches
strings where `Jarvis` is the **first token after the opening quote**. Verified counts on this
branch:

| Population | Count | Files |
|---|---|---|
| `grep '"Jarvis'` (the spec's census) | 25 | 15 |
| All `Jarvis`/`Jarv1s` tokens under `apps/web/src` | 349 | — |
| …minus `@jarv1s/*` imports (155), `data-jarvis-*` (11), code identifiers (27) | 158 | 56 |
| …minus env vars / storage keys / technical (`JARVIS_`, `jarvis[-._]`) | **132** | **47** |

The undercount is not a narrower boundary — it excludes the exact surfaces the issue's **own
acceptance criterion** names ("renders in chat, the chat drawer, calendar copy and briefings"):

| Site | Not in the 25 |
|---|---|
| `chat/composer.tsx:414,431` | `Message Jarvis` aria-label + the main composer placeholder |
| `chat/chat-drawer.tsx:398,404` | `Chat with Jarvis`; `<div className="chatd__name">Jarvis</div>` |
| `chat/assistant-surface/surface.tsx:231,232,276` | `Message Jarvis`, `<span>Jarvis</span>` |
| `calendar/calendar-page.tsx:160,164` | `Jarvis holding`, `Jarvis is holding {heldToday} block…` |
| `calendar/calendar-peek.tsx:24,86` | `Jarvis is holding this` |
| `shell/app-shell.tsx:314,382,385` | brand wordmark, `Chat with Jarvis`, `Ask Jarvis` |

`calendar/calendar-page.tsx` is named in the issue as in-scope and contains **zero** of the 25.
A literal-25 build therefore cannot pass its own acceptance item 3.

**Ruling (Ben, 2026-08-06):** build to **intent** — every user-visible assistant/product name
string under `apps/web/src`. Recorded in §7.

## 2. Seams check — every assumed capability, cited

| Assumed capability | Citation | Verified state |
|---|---|---|
| Hook resolving the configured assistant name | `apps/web/src/api/use-assistant-name.ts:11-18` | Exists; falls back to `"Jarvis"` at `:17` |
| Hook has exactly one consumer | `apps/web/src/today/evening-mode.tsx:14,211` | Confirmed — repo-wide grep returns only these |
| Server-side persona default | `packages/shared/src/persona-api.ts:43,47` | Both literals `"Jarvis"` |
| Persona block already emits the name once | `packages/shared/src/persona-api.ts:67` | `` `Your name is ${assistantName}.` `` — emitted unconditionally |
| Default persona constant with the double identity | `packages/chat/src/live/runtime.ts:59-63` | `DEFAULT_JARVIS_PERSONA`; `:60` assistant identity, `:62,:63` product refs |
| Composition point of both blocks | `packages/chat/src/live/runtime.ts:518` | `[DEFAULT_JARVIS_PERSONA, tzBlock, personaBlock, responseStyleBlock].join("\n\n")` |
| An exported composer to test through | `packages/chat/src/live/runtime.ts:487` | `export async function resolveChatPersona(deps, actorUserId, userName): Promise<string>` |
| Existing test on the constant (must be updated, not duplicated) | `tests/unit/chat-runtime-persona.test.ts:6-22` | 8 assertions referencing `DEFAULT_JARVIS_PERSONA` |
| Product literals | `apps/web/index.html:9`; `apps/web/src/app.tsx:428,437,451,465,474`; `apps/web/src/auth/auth-screen.tsx:46` | All `Jarv1s` |
| Root package identity | `package.json:2,3` | `"jarv1s"`, `"0.1.16"` |

**Open question, no owner assigned — carried, not built.** `resolveChatPersona` requires
`deps.dataContext.withDataContext` plus three preference ports. If stubbing those in a unit test
proves to cost more than the assertion is worth, phase 1's test falls back to asserting the
composition inputs directly and the gap is stated on the PR rather than hidden. Decided at
implementation time against the real type, not now.

## 3. The classification rule

This is the plan's central decision. Every occurrence is classified individually against it.

**Tie-breaker:** substitute *"the app"* into the sentence.

- Reads correctly → **product** → literal `Moss`.
- Needs *"your assistant"* → **assistant** → runtime read of `useAssistantName()`.

Refinement where the tie-breaker is ambiguous:

| Signal | Class |
|---|---|
| Perceives, reads, remembers, speaks, holds, nudges, acts on your behalf | **assistant** |
| Voice, tone, persona, proactivity, quiet hours | **assistant** |
| Installation, version, restart, compatibility, host, shared server | **product** |
| Branding: wordmark, page title, auth eyebrow, loading/error chrome | **product** |
| Navigation and app structure ("parts of Jarvis", "a Jarvis module") | **product** |

### Explicitly out of scope — leave verbatim

Not display strings; they belong to #1442/#1443/#1444 or are frozen (spec §2.1, §2.3, §5):

| Site | Why |
|---|---|
| `settings-admin-panes.tsx:669,670,691,692` | `docker compose exec jarv1s …` — compose **service name**; changing it breaks a live operational command |
| `shell/command-palette.tsx:179,180` | `jarvis:open-command-palette` — DOM event name |
| `shell/command-palette.tsx:370` | `https://motioneso.github.io/Jarv1s/` — external identity, spec §5 |
| `calendar/calendar-model.ts:114` | `dto.isJarvisBlock` — API DTO field |
| `settings-admin-panes.tsx:836` | `compareJarvisVersions` — identifier |
| `chat/page-context.ts:2` | Quotes issue #679/#1109's title — a dated record |
| `api/client.ts`, `vite-env.d.ts`, `theme-storage.ts`, `settings-storage.ts` | `JARVIS_*` env vars, `jarvis.*` storage keys |
| `wellness-insights.tsx`, `task-list-view.tsx:122,186,261,305` | `JarvisMarkIcon`, `isJarvisSource`, `jarvis`/`jarvisCount` locals |
| All `@jarv1s/*` package specifiers (155) | Package scope — #1444 |

## 4. Determinism boundary

Every name rendered in this PR comes **from the record**, never from model output:

- Product name → a compile-time literal.
- Assistant name → `useAssistantName()`, sourced from `persona.assistantName` in the user's
  preferences row via `getPersonaSettings`.
- No model turn is introduced, no prompt guidance is added or extended. The prompt gets one
  sentence **shorter** (`runtime.ts:60` is deleted). Guidance budget: unchanged, well under 150 words.
- No module injects turns into host chat.

## 5. Phases

### Phase 1 — prompt composition (the correctness core) · **kill gate**

Fixes the double-identity bug and lands the acceptance test. Ships and is evaluated alone.

**Files**

| File | Change |
|---|---|
| `packages/chat/src/live/runtime.ts` | Rename `DEFAULT_JARVIS_PERSONA` → `DEFAULT_MOSS_PERSONA`. **Delete** `:60` (`"You are Jarvis, {{userName}}'s personal assistant."`). `:62,:63` → `Moss` literal. Update `:518` reference. |
| `packages/shared/src/persona-api.ts` | `:43`, `:47` — default `"Jarvis"` → `"Moss"`. |
| `tests/unit/chat-runtime-persona.test.ts` | Update the 8 existing assertions to the new constant name; add the acceptance test below. |

Signature unchanged: `export const DEFAULT_MOSS_PERSONA: string`.

**Acceptance test** — `tests/unit/chat-runtime-persona.test.ts`

| Case | Behaviour asserted | Why it fails against a broken implementation |
|---|---|---|
| `composed prompt names the configured assistant exactly once` | With `persona.assistantName = "Alfred"`, the composed prompt's occurrences of `Alfred` === 1 | Today `:60` hardcodes `Jarvis` while `persona-api.ts:67` emits `Your name is Alfred.` — two identities. A naive fix that *substitutes* the name into `:60` instead of deleting it yields 2 and fails. |
| `composed prompt contains no hardcoded assistant name` | Composed prompt does not match `/Jarvis/i`, and does not contain `Moss` in an *identity* position (`You are Moss`, `Your name is Moss`) when the configured name is `Alfred` | Catches a rename-not-remove fix that turns `:60` into `"You are Moss, …"` — which reintroduces the exact bug under the new name. |
| `composed prompt still names the Moss product` | Composed prompt contains `Moss app` (from `:62`/`:63`) | Guards against over-deletion: stripping the product refs while removing the identity line. |
| `default assistant name is Moss` | `normalizePersonaSettings(undefined).assistantName === "Moss"`; `normalizePersonaSettings({}).assistantName === "Moss"` | Covers both `persona-api.ts:43` and `:47`, which are separate literals — fixing one and missing the other passes a single-path test. |

**Verification (unpiped, exit code preserved)**

```bash
pnpm vitest run tests/unit/chat-runtime-persona.test.ts > /tmp/p1.log 2>&1; echo "EXIT=$?"   # expect EXIT=0
pnpm typecheck > /tmp/p1-tc.log 2>&1; echo "EXIT=$?"                                         # expect EXIT=0
```

**Kill gate — owner: Ben.** End the line if, with the identity line deleted, the composed prompt no
longer carries an assistant identity at all for a user who has never opened Settings → i.e. if
`normalizePersonaSettings` does not in practice guarantee a non-empty `assistantName` on the live
path. That would mean the name must be threaded through `resolveChatPersona` rather than deleted,
which is a different design and gets re-planned before phase 2.

### Phase 2 — assistant-name threading across `apps/web/src`

The bulk. ~132 sites, each classified per §3. Adopts the seam the hook was built for.

**Hook default** — `apps/web/src/api/use-assistant-name.ts:7,17`: fallback `"Jarvis"` → `"Moss"`;
the `:6-10` comment updated to record that the rename has now landed.

**Non-component constants** — a hook cannot be called at module scope. Each becomes a function of
the name, with the component caller passing `useAssistantName()`:

| File | Current | New signature |
|---|---|---|
| `settings/settings-types.ts:13,25` | `MODULE_DESCRIPTIONS: Record<string,string>`; `moduleDescription(id: string): string` | `moduleDescriptions(assistantName: string): Record<string, string>`; `moduleDescription(id: string, assistantName: string): string` |
| `settings/settings-sample-data.ts:69,102,140` | module-scope literals | function of `assistantName`, or inlined into the consuming component — decided per call site against the real caller |
| `onboarding/section-tour-model.ts:24,30` | module-scope blurbs | as above |
| `shell/command-palette-model.ts:146` | module-scope description | as above |
| `settings/settings-source-behaviors.ts:30` | module-scope copy | as above |

Callers to update (verified, `wired-not-just-defined`): `settings-instance-modules-pane.tsx:116`,
`settings-personal-data-panes.tsx:721`. Both are React components — the hook is available.

**Classification, by area** (representative; each of the ~132 decided individually):

| Area | Class | Examples |
|---|---|---|
| Chat composer, drawer name, surface identity | assistant | `composer.tsx:414,431`; `chat-drawer.tsx:398,404,502`; `surface.tsx:141,231,232,263,276` |
| Calendar hold copy | assistant | `calendar-page.tsx:160,164`; `calendar-peek.tsx:24,80,86` |
| Settings — data access, memory, people, activity, voice, quiet hours | assistant | `settings-personal-data-panes.tsx` (×8); `settings-memory-pane.tsx:22`; `settings-people-pane.tsx:191,338`; `settings-activity-pane.tsx:108,156`; `settings-ai-pane.tsx` (×8); `settings-personal-panes.tsx:156,177,182,257` |
| Task attribution | assistant | `task-list-view.tsx:162,197,304` |
| Brand wordmarks | product | `app-shell.tsx:314`; `onboarding-wizard.tsx:196,264` |
| Sidebar chat affordance | assistant | `app-shell.tsx:382,385` |
| App structure / modules / version / install | product | `settings-types.ts:26`; `settings-personal-data-panes.tsx:740`; `settings-module-registry-section.tsx:40,115,145`; `member-welcome-step.tsx:27`; `api-key-opt-out-step.tsx:30,39` |
| Onboarding setup chrome | product | `welcome-step.tsx:9,10`; `onboarding-wizard.tsx:142,375,378,410`; `section-tour-step.tsx:48` |
| Onboarding behavioural copy | assistant | `google-connector-step.tsx:197,511,601`; `cli-auth-step.tsx:259,392`; `member-connector-step.tsx:8` |
| Vault / host prose naming the app | product | `settings-vault-chooser.tsx:153`; `settings-people-pane.tsx:416`; `external-modules/host-actions.ts:4` |
| Settings nav group label | product | `settings-page.tsx:148` |
| Persona default/fallback literals | product-default | `settings-ai-pane.tsx:47,231` → `"Moss"` |

**Design system** — invoke the `design-system` skill before touching any `.tsx`. This phase changes
**text nodes and attribute values only**; no new `jds-*` class, no CSS, no markup structure. That
constraint is itself the guard against the invented-class failure.

**Phase 2 e2e test** — `tests/uat/specs/moss-assistant-name.uat.spec.ts`, plus a row in
`.claude/skills/coordinate/uat-trigger-map.tsv`.

| Step | Assertion |
|---|---|
| Sign in, Settings → Assistant & AI, set assistant name to `Alfred`, save | Save acknowledgement renders from the record |
| Open chat drawer | Drawer name element and `Chat with…` aria-label read `Alfred`, not `Jarvis` |
| Focus the composer | Placeholder reads `Message Alfred…` |
| Navigate to Calendar | Hold copy reads `Alfred is holding…` |
| Read the page title and auth chrome | Product name reads `Moss`, **independent** of `Alfred` |
| Full-page text sweep | Zero occurrences of `Jarvis` on any visited route |

Playwright per the dev-instance recipe: import from `@playwright/test`, script inside the worktree,
`waitUntil:"domcontentloaded"` plus a fixed wait — `networkidle` never settles (SSE).

**Verification**

```bash
pnpm typecheck > /tmp/p2-tc.log 2>&1; echo "EXIT=$?"   # expect EXIT=0
pnpm lint > /tmp/p2-lint.log 2>&1; echo "EXIT=$?"      # expect EXIT=0
```

### Phase 3 — product literals, package identity, living docs

| Target | Change |
|---|---|
| `apps/web/index.html:9,12` | `<title>` and `<noscript>` → `Moss` |
| `apps/web/src/app.tsx:428,437,451,465,474` | `Loading Moss`, three `<h1>`, `Unable to load Moss` |
| `apps/web/src/auth/auth-screen.tsx:46` | eyebrow → `Moss` |
| `package.json:2,3` | `"jarv1s"` → `"moss"`; `"0.1.16"` → `"0.2.0"` |

**Living docs (spec §6) — rewritten:** `README.md` (28 lines), `CLAUDE.md` (2),
`docs/DEVELOPMENT_STANDARDS.md` (3), `docs/brand/*` (11), `.github/**` (1), plus deployment and
operations runbooks under `docs/operations/`.

**Left verbatim — dated records.** Confirmed present on this branch (counts differ from the spec's,
which predate recent churn; the rule is unchanged):

| Directory | Spec's count | Actual |
|---|---|---|
| `docs/superpowers/plans` | 264 | 296 |
| `docs/superpowers/specs` | 214 | 248 |
| `docs/coordination` | 115 | 61 |
| `docs/audits` | 56 | 24 |
| `docs/releases` | — | 3 |

**New:** `docs/superpowers/README.md` — a dated note at the head of `docs/superpowers/` recording
the rename, its date (2026-08-06), and that documents below it use the former name throughout.
The rename spec itself keeps both names deliberately (spec §6, final paragraph).

**Verification**

```bash
pnpm format:check > /tmp/p3-fmt.log 2>&1; echo "EXIT=$?"   # expect EXIT=0
```

## 6. Exit criteria

1. Phase 1's four acceptance cases observed green.
2. `pnpm verify:foundation` green **via the `verify-gate` skill**, on a gate DB **not**
   `jarvis_gate_main_d3113a0f2` (in use) — `herdr pane list` checked immediately before starting,
   because concurrent gate runs crash shared Postgres.
3. Live-path proof posted to the PR: custom assistant name set in Settings on a live dev instance
   and observed rendering in chat, the chat drawer, calendar copy and briefings; product name
   observed reading `Moss` independently.
4. PR open against `main`, linked to #1441. **Not merged, nothing marked Done** — Ben's call.

**Known environment ceiling, disclosed not worked around:** chat *turns* 503 on host-dev (no
cli-runner). Rendered names, settings persistence and the drawer are provable; a real model
response is not. If briefings need a model answer to prove, that hop is reported as unexercised
rather than implied.

## 7. Rulings ledger

| # | Ruling | Evidence | Date |
|---|---|---|---|
| R1 | Scope is **intent** (~132 user-visible strings), not the spec's literal 25. The 25-census grep'd `"Jarvis` and structurally cannot match mid-string occurrences. | `calendar/calendar-page.tsx:160,164` — named in-scope by the issue, contains zero of the 25 | 2026-08-06, Ben |
| R2 | Escalation routes to Ben in-session. `herdr pane list` shows **zero** panes carrying a coordinator label; `coordinated-build` forbids guessing an unlabelled pane. | `herdr pane list` — only `w1:p1Q` "Moss 1441 display strings" is labelled | 2026-08-06, Ben |
| R3 | `runtime.ts:60` is **deleted**, not renamed to `Moss`. A rename reintroduces the double identity under the new name. | `persona-api.ts:67` already emits `Your name is ${assistantName}.` unconditionally | 2026-08-06, spec §1.2 |
| R4 | Compose service name `jarv1s` in `settings-admin-panes.tsx` stays — it is an executable operational command, not a display string. | `settings-admin-panes.tsx:669,670,691,692` | 2026-08-06 |
| R5 | Spec's frozen-directory file counts are stale (plans 264→296, specs 214→248, coordination 115→61, audits 56→24). The *rule* is unaffected; counts are not a checksum. | `ls` on this branch | 2026-08-06 |
