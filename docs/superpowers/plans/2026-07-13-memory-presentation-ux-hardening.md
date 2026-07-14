# Memory presentation UX hardening (#992) Implementation Plan

> **For the build agent:** use test-driven development task-by-task. The build is sequential because
> Tasks 2 and 3 share `settings-memory-dashboard.tsx`; do not dispatch parallel writers to that
> file. Checkboxes are the execution ledger.

**Goal:** Make durable-memory extraction selective, present memory records in human language, explain
Review/Memories/History and Pin/Forget, and route Fact Forget to the shipped fact DELETE endpoint.

**Architecture:** Keep the existing memory tables, DTO, routes, repositories, query keys, and exact
candidate signature. Tighten the existing distillation prompt; render a human presentation over the
current `MemoryDashboardItem`; add one missing web-client wrapper; style the existing dashboard with
settings tokens. No backend memory contract or migration changes.

**Tech stack:** TypeScript, React, TanStack Query, existing settings/JDS primitives, Vitest,
Playwright.

## Global constraints

- No changes to memory SQL, repositories, services, routes, shared schemas, module registry, jobs,
  or pg-boss payloads.
- No new dependency, presentation abstraction package, semantic dedupe service, or cleanup job.
- Preserve `DataContextDb`, actor-derived ownership, FORCE RLS, and no-admin-bypass behavior.
- Never render raw source refs, ids, excerpts, prompt text, secrets, tokens, credentials, or private
  data from another owner.
- Keep `apps/web/src/settings/settings-memory-dashboard.tsx` and
  `apps/web/src/styles/settings-panes-3.css` under the 1000-line gate.
- CSS uses existing variables from `tokens.css`; no raw color literals.
- Do not edit `tests/uat/**`; the UX Coordinator owns live-UAT artifacts.
- Stage only the explicit paths in each task. Never use `git add -A` or `git add .`.

## File map

- Modify: `packages/chat/src/memory-distillation.ts`
- Modify: `apps/web/src/api/memory-client.ts`
- Modify: `apps/web/src/settings/memory-provenance.ts`
- Modify: `apps/web/src/settings/settings-memory-dashboard.tsx`
- Modify: `apps/web/src/styles/settings-panes-3.css`
- Modify: `tests/unit/chat-memory-distillation.test.ts`
- Modify: `tests/unit/settings-memory-pane-provenance.test.ts`
- Modify: `tests/unit/settings-memory-dashboard.test.tsx`
- Create: `tests/e2e/settings-memory.spec.ts`

Run, do not modify: `tests/integration/memory-graph.test.ts`,
`tests/integration/memory-dashboard.test.ts`,
`tests/integration/wellness-energy-trend-consent.test.ts`, and
`tests/integration/wellness-phase2.test.ts`.

---

## Task 1 — Define durable extraction quality at the existing prompt seam

**Files:**

- Modify: `tests/unit/chat-memory-distillation.test.ts`
- Modify: `packages/chat/src/memory-distillation.ts`

**Why here:** `handleExtractFactsJob` already routes every extracted candidate through
`buildDistillationPrompt` and the existing parser/signature repository. One prompt contract fixes all
providers without a new classifier or per-caller guards.

- [ ] **Step 1: Add failing prompt-contract assertions**

Extend the existing `buildDistillationPrompt` test to require explicit instructions that:

- durable means useful in future conversations (stable preference/goal/constraint/decision/
  relationship/fact);
- completed one-off events, temporary state, and medication doses taken produce no candidate;
- assistant claims/questions and task/reminder content produce no candidate;
- active-memory restatements or paraphrases produce no candidate;
- when nothing qualifies, the only valid output is `[]`;
- explicit, stable user-requested memory remains eligible.

Do not add a live-provider unit test. The prompt string is the deterministic contract; the final
live pass proves model behavior.

- [ ] **Step 2: Confirm red**

Run:

```bash
pnpm vitest run tests/unit/chat-memory-distillation.test.ts
```

Expected: the new prompt assertions fail.

- [ ] **Step 3: Tighten only `buildDistillationPrompt`**

Add concise extraction rules before the dynamic thread/active-memory/turn blocks. Preserve the
existing JSON-only, secret exclusion, no-task, provenance, and grounded-supersession instructions.
Do not change `shouldDistillTurn`, `parseMemoryCandidates`, candidate types, promotion thresholds,
signatures, repositories, or the job loop.

- [ ] **Step 4: Confirm green and commit**

```bash
pnpm vitest run tests/unit/chat-memory-distillation.test.ts
git add packages/chat/src/memory-distillation.ts tests/unit/chat-memory-distillation.test.ts
git commit -m "fix(memory): define durable extraction quality"
```

---

## Task 2 — Humanize record vocabulary, hierarchy, and empty states

**Files:**

- Modify: `tests/unit/settings-memory-pane-provenance.test.ts`
- Modify: `tests/unit/settings-memory-dashboard.test.tsx`
- Modify: `apps/web/src/settings/memory-provenance.ts`
- Modify: `apps/web/src/settings/settings-memory-dashboard.tsx`
- Modify: `apps/web/src/styles/settings-panes-3.css`

- [ ] **Step 1: Add failing provenance and dashboard assertions**

In `settings-memory-pane-provenance.test.ts`, cover all four provenance values and require human
phrases (`You said this`, `You confirmed this`, `Jarvis inferred this`, `Imported from a source`).

In `settings-memory-dashboard.test.tsx`, seed the existing QueryClient harness with representative
pending, active, and history responses and assert:

- tabs render as Review, Memories, History;
- a fact with title `has_constraint: Keep replies short` and summary `Keep replies short` renders
  the statement once and never renders `has_constraint`, `fact`, or a raw status enum;
- a candidate whose payload has `objectName` but empty `objectText` (therefore a graph-shaped
  summary/title such as `self related_to Casey`) and no mapped record kind falls back to `Memory`,
  never `related_to` or another raw predicate;
- an entity-object fact with empty `objectText` and a predicate-only title falls back to
  `Relationship memory`, never the raw predicate;
- useful kind/provenance/confidence labels use sentence-case human copy;
- Review, Memories, and History each render their distinct description/empty state;
- imported provenance is supported;
- action copy uses Remember, Not true, and Don’t suggest this again.

Because this repo's unit harness uses server rendering and cannot click tabs, keep two small pure
helpers in `settings-memory-dashboard.tsx` and export them for the test:

- `memoryItemPresentation(item)` returns the headline and bounded human labels consumed by the row;
- `memoryTabCopy(tab)` returns the tab description and empty-state copy consumed by the list.

Test those helpers directly for all tabs/items, then use the existing SSR/query test to prove the
default Review render. Playwright in Task 3 proves real tab switching. Do not add jsdom or Testing
Library.

- [ ] **Step 2: Confirm red**

```bash
pnpm vitest run tests/unit/settings-memory-pane-provenance.test.ts \
  tests/unit/settings-memory-dashboard.test.tsx
```

- [ ] **Step 3: Extend the existing provenance helper**

Update `memory-provenance.ts` rather than creating a second helper module:

- include `imported` in `MemoryFactProvenance`;
- return the four user-facing phrases;
- keep tone/class selection exhaustive and map imported to an existing neutral/source tone.

- [ ] **Step 4: Render one human statement and bounded labels**

In `settings-memory-dashboard.tsx`:

- candidate/fact summary is usable only when non-empty and different from title after trimming and
  case folding; equality signals the service's graph-title fallback and must be rejected;
- an entity row may use its title/name; candidate and fact rows with no usable summary must instead
  use the mapped human record-kind phrase (for example, `Relationship memory`) or `Memory` when no
  useful kind exists;
- never use candidate/fact title as the final fallback: the current candidate `objectName` and
  entity-object fact paths can put raw predicates there when `objectText` is empty;
- omit duplicate title/summary and never expose the raw predicate;
- hide generic item-kind badges;
- map useful record kinds, statuses, provenance, and confidence tiers to human labels;
- replace raw conflict/supersession metadata with plain-language phrases and no ids;
- rename tabs/group copy and pass the active tab into the list so each collection owns its
  description and empty state;
- humanize candidate actions without changing their mutations.

Keep `memoryItemPresentation` and `memoryTabCopy` plus their mapping constants in this file. They
serve the component and its existing SSR-limited test harness; they do not justify a new module.

- [ ] **Step 5: Add the minimum dashboard CSS**

Add `memdash-*` layout rules to `settings-panes-3.css` for row spacing, headline/meta hierarchy,
drawer separation, action wrapping, focus-visible state, and narrow-width stacking. Reuse token
variables and existing JDS button/badge styles; do not restyle the Settings shell.

- [ ] **Step 6: Confirm green, token/file-size safety, and commit**

```bash
pnpm vitest run tests/unit/settings-memory-pane-provenance.test.ts \
  tests/unit/settings-memory-dashboard.test.tsx
pnpm check:design-tokens
pnpm check:file-size
git add apps/web/src/settings/memory-provenance.ts \
  apps/web/src/settings/settings-memory-dashboard.tsx \
  apps/web/src/styles/settings-panes-3.css \
  tests/unit/settings-memory-pane-provenance.test.ts \
  tests/unit/settings-memory-dashboard.test.tsx
git commit -m "fix(memory): present records in human language"
```

---

## Task 3 — Explain Pin/Forget and wire Fact Forget to the fact route

**Files:**

- Modify: `tests/unit/settings-memory-dashboard.test.tsx`
- Create: `tests/e2e/settings-memory.spec.ts`
- Modify: `apps/web/src/api/memory-client.ts`
- Modify: `apps/web/src/settings/settings-memory-dashboard.tsx`

- [ ] **Step 1: Add failing action-contract coverage**

Add a small exported `memoryActionCopy(action)` helper in
`settings-memory-dashboard.tsx`, consume it in the visible help/confirmation UI, and unit-test:

- Pin prefers the memory during recall, is reversible, and does not imply sharing/permanence.
- Forget permanently removes the memory from Jarvis memory/search while leaving the source chat or
  source record unchanged.

Create `tests/e2e/settings-memory.spec.ts` using a small stateful route mock:

- enter the real Settings memory pane at `/settings?section=memory`;
- return one fact from the dashboard mock state;
- expand the fact and assert Pin/Forget help is keyboard reachable/readable;
- accept the Forget confirmation and assert exactly one
  `DELETE /api/memory/graph/facts/:factId` request, then render the empty Memories state;
- assert no `DELETE /api/memory/graph/entities/*` request was made;
- assert the narrow viewport has no horizontal overflow and actions remain reachable.

Keep all mocks local to this spec. Do not edit the broad Settings shell or `tests/uat/**` harness.

- [ ] **Step 2: Confirm red**

```bash
pnpm vitest run tests/unit/settings-memory-dashboard.test.tsx
pnpm playwright test tests/e2e/settings-memory.spec.ts --workers=1
```

Expected: missing Fact DELETE wrapper/copy and/or wrong entity endpoint assertion.

- [ ] **Step 3: Add the one missing client wrapper**

In `memory-client.ts`, add:

```ts
export async function deleteMemoryFact(id: string): Promise<void>;
```

It issues `DELETE /api/memory/graph/facts/${encodeURIComponent(id)}` through `requestJson`, matching
the existing `deleteMemoryEntity` wrapper. Do not add a route, schema, query key, or generic delete
abstraction.

- [ ] **Step 4: Use the correct operation and explain it**

In `FactActions`, replace `deleteMemoryEntity(item.id)` with `deleteMemoryFact(item.id)`. Keep
`EntityActions` unchanged. Add visible/accessible Pin and Forget explanation, and make the existing
confirmation state the irreversible fact/source distinction. Preserve current query invalidation,
feedback, and error handling.

- [ ] **Step 5: Confirm green and commit**

```bash
pnpm vitest run tests/unit/settings-memory-dashboard.test.tsx
pnpm playwright test tests/e2e/settings-memory.spec.ts --workers=1
git add apps/web/src/api/memory-client.ts \
  apps/web/src/settings/settings-memory-dashboard.tsx \
  tests/unit/settings-memory-dashboard.test.tsx \
  tests/e2e/settings-memory.spec.ts
git commit -m "fix(memory): explain and correctly route memory actions"
```

---

## Task 4 — Owner/privacy regression and final proof

**Files:** none expected.

- [ ] **Step 1: Run targeted owner and route checks**

```bash
pnpm exec tsx scripts/test-integration.ts tests/integration/memory-graph.test.ts
pnpm exec tsx scripts/test-integration.ts tests/integration/memory-dashboard.test.ts
```

Do not modify these tests unless an actual product regression is found and the Coordinator expands
scope.

- [ ] **Step 2: Re-run Wellness consent checks unchanged**

```bash
pnpm exec tsx scripts/test-integration.ts tests/integration/wellness-energy-trend-consent.test.ts
pnpm exec tsx scripts/test-integration.ts tests/integration/wellness-phase2.test.ts
```

This is regression evidence only: #992 must not change Wellness consent code or tests.

- [ ] **Step 3: Run focused frontend/extraction checks together**

```bash
pnpm vitest run tests/unit/chat-memory-distillation.test.ts \
  tests/unit/settings-memory-pane-provenance.test.ts \
  tests/unit/settings-memory-dashboard.test.tsx
pnpm playwright test tests/e2e/settings-memory.spec.ts --workers=1
```

- [ ] **Step 4: Run project gates**

```bash
pnpm check:design-tokens
pnpm verify:foundation
git diff --check
git status --short
```

- [ ] **Step 5: Coordinator-owned live acceptance**

Send the UX Coordinator the built PR SHA and the six live-path steps from the spec. The Coordinator
owns `tests/uat/**`, two-account validation, deployed Settings verification, and the final narrated
dogfood pass. Do not claim semantic-model acceptance from prompt unit tests alone.

## Planned commit sequence

1. `fix(memory): define durable extraction quality`
2. `fix(memory): present records in human language`
3. `fix(memory): explain and correctly route memory actions`

No fourth commit is expected unless verification reveals an in-scope defect.
