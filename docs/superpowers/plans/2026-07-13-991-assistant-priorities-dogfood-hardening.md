# Assistant and Priorities Dogfood Hardening (#991) — Implementation Plan

> **Approval gate:** Do not start product work until the Coordinator approves this plan and its
> paired spec. Builders must work test-first and stage explicit paths only.

**Spec:**
`docs/superpowers/specs/2026-07-13-991-assistant-priorities-dogfood-hardening.md`

**Grounded against:** `origin/main` at `96d22ba0` on 2026-07-13

**Goal:** Make persona/model/YOLO and Priorities settings truthful and reversible, repair persona
preview transport selection, and prove the saved priority model affects real chat ordering without
changing the existing persistence, policy, or scoring contracts.

**Architecture:** Keep persona text and `priority.model.v1` as the only persisted truths. Add local
draft behavior at the current React owners. Route persona preview through the existing effective
model selection and either the existing CLI structured adapter or HTTP adapter. Preserve the
existing model, approval-policy, priority API, scorer, RLS, and consumer boundaries.

## Ownership and Collision Locks

| Area | Owned files for this issue | Must not absorb |
| --- | --- | --- |
| Assistant UX | `apps/web/src/settings/settings-ai-pane.tsx`, `settings-persona-preview.ts` | #874 audio Voice/STT, #869 model API changes, #985 approval policy |
| Preview service | `packages/module-registry/src/built-in-module-helpers.ts`, `index.ts` | New model router, new CLI runtime, durable preview chat |
| Priorities UX | `packages/settings-ui/src/priority/index.tsx` | Priority schema/scorer/route/RLS changes or new sources |
| Verification | Focused unit/integration/E2E files outside UAT | Any edit under `tests/uat/**` |

`docs/coordination/**` is also out of bounds. If a task requires a locked file or contract, pause
and return the collision to the Coordinator.

## Task 1 — Lock Persona Draft Semantics in Tests

**Files:**

- `tests/integration/settings-persona.test.ts`
- `tests/unit/settings-persona-preview.test.ts`
- `apps/web/src/settings/settings-ai-pane.tsx`

- [ ] **Step 1 (red):** Add focused component/integration assertions for one saved `personaText`
      snapshot and one local draft: typing does not persist, applying guided dials updates the draft
      only, an edited draft cannot be silently replaced, Save persists the displayed text, and
      Discard restores the last server snapshot.
- [ ] **Step 2 (red):** Assert dirty, saving, saved, validation, and failure feedback remain visible;
      mode switches preserve the current draft.
- [ ] **Step 3 (green):** Refactor `Persona` to make authored/guided modes explicit. Keep dial state
      ephemeral and funnel both modes into the existing `personaText` mutation. Use the existing
      Settings primitives and feedback patterns; do not create a second persistence API.
- [ ] **Step 4 (green):** Rename “Preview voice” to “Preview response” and make the surrounding copy
      unambiguously about generated text.
- [ ] **Step 5 (verify):** Run the focused persona tests and typecheck the affected workspace.

## Task 2 — Route Preview Through the Effective Transport

**Files:**

- `packages/module-registry/src/built-in-module-helpers.ts`
- `packages/module-registry/src/index.ts`
- `packages/chat/src/live/cli-structured-adapter.ts` (reuse; change only if an uncovered cleanup bug
  requires it)
- `tests/unit/settings-persona-preview.test.ts`
- focused module-registry test beside the existing preview coverage, if separation is clearer

- [ ] **Step 1 (red):** Add service tests covering: no effective model; CLI-backed model success
      without API-key decryption; missing CLI adapter/login; API-backed success; missing API
      credential; provider failure. Assert no error path falsely requests an API key for a CLI
      model and no message leaks credential material.
- [ ] **Step 2 (red):** For the CLI success/failure cases, inject a fake existing one-shot adapter
      and assert the selected provider kind and effective model are passed through. Assert preview
      does not invoke chat-session persistence.
- [ ] **Step 3 (green):** Extend `createDefaultPersonaPreview` dependencies with the smallest
      transport seam needed to receive the existing `createCliStructuredAdapterFactory` output.
      Resolve the effective chat model once, branch on its existing execution transport, and call:
      the CLI structured adapter for CLI models or `HttpApiAdapter` for API-key models.
- [ ] **Step 4 (green):** Wire the already-created engine-backed CLI adapter from
      `packages/module-registry/src/index.ts`; do not instantiate another runner or introduce a
      preview-only transport.
- [ ] **Step 5 (green):** Map dependency failures to the precise UI-safe states defined in the spec.
      Retain the existing one-shot CLI cleanup behavior; do not add a transcript or chat thread.
- [ ] **Step 6 (verify):** Run focused preview/module-registry tests, the existing
      `tests/unit/cli-structured-adapter.test.ts`, and affected workspace typechecks.

## Task 3 — Clarify Model and YOLO Effective State

**Files:**

- `apps/web/src/settings/settings-ai-pane.tsx`
- focused assertions in `tests/integration/settings-persona.test.ts` or the existing Assistant
  settings test owner

- [ ] **Step 1 (red):** Assert model options show **Automatic (admin default)** plus only the
      allowed overrides supplied by the current API. Assert pinned/locked state reads **Managed by
      admin** and cannot be edited locally.
- [ ] **Step 2 (red):** Assert YOLO copy distinguishes effective state and owner without changing
      the submitted approval-policy value or enabling a locked control.
- [ ] **Step 3 (green):** Change labels, descriptions, disabled-state treatment, and feedback only.
      Keep the existing model selection request shape and YOLO mutation/effective-state inputs.
- [ ] **Step 4 (verify):** Run the focused settings tests and check narrow rendering with the same
      viewport harness used by adjacent settings panes.

## Task 4 — Lock the Priority Draft Adapter

**Files:**

- `tests/unit/priority-settings-ui.test.tsx`
- `packages/settings-ui/src/priority/index.tsx`

- [ ] **Step 1 (red):** Add tests proving initial server data is copied into one local draft;
      editing, Add, remove, weight, aliases, and source toggles make the draft dirty without any
      PATCH; Save emits one valid existing-contract payload; Discard restores the last successful
      server snapshot.
- [ ] **Step 2 (red):** Reproduce the Add regression: Add creates a local row and sends no request;
      blank/whitespace labels block Save with an inline error; entering a label permits the one Save
      request.
- [ ] **Step 3 (green):** Replace per-field persistence with the smallest local draft reducer/state
      shape. Reuse the existing DTO type and mutation; do not add a form framework or generic draft
      abstraction.
- [ ] **Step 4 (green):** Preserve unrendered fields when mapping server snapshot → draft → payload,
      including `kind`, unknown sources, and hidden Memory/Wellness values.
- [ ] **Step 5 (verify):** Run `tests/unit/priority-settings-ui.test.tsx` and affected workspace
      typechecks.

## Task 5 — Replace Internal Priority Vocabulary

**Files:**

- `packages/settings-ui/src/priority/index.tsx`
- `tests/unit/priority-settings-ui.test.tsx`

- [ ] **Step 1 (red):** Assert the rendered vocabulary and accessible labels: **What matters right
      now**, **Also match**, and the five ordered importance labels. Assert the internal `kind`
      selector and raw numeric weights are absent.
- [ ] **Step 2 (red):** Assert **Sources Jarvis may prioritize** shows Tasks, Calendar, Email, and
      Notes; checked maps to included and unchecked maps to the existing excluded/muted storage
      semantics. Assert the copy says ranking exclusion does not remove access.
- [ ] **Step 3 (green):** Add a local constant mapping the existing supported numeric values to the
      five labels. Convert checked inclusion to the existing persisted exclusion representation at
      the draft boundary; do not invert storage or consumer logic.
- [ ] **Step 4 (green):** Hide Memory and Wellness while preserving their stored values. Keep
      unknown future source values through round trips rather than filtering the payload to the
      visible list.
- [ ] **Step 5 (green):** Keep all row actions, validation, and Save/Discard controls keyboard
      reachable and usable without horizontal scrolling at the supported narrow width.
- [ ] **Step 6 (verify):** Run the focused UI test and inspect desktop plus narrow layouts.

## Task 6 — Prove Existing Ranking Consumers Are Unchanged

**Files:** tests only unless a regression exposes an issue inside the already-owned UI adapter

- `tests/unit/chat-session-manager-priority.test.ts`
- `tests/unit/chat-priority-consumer.test.ts`
- `tests/unit/priority-settings-ui.test.tsx`

- [ ] **Step 1:** Run the existing scorer/consumer suites unchanged first. Record their baseline.
- [ ] **Step 2:** Add only the smallest regression assertion needed to show that the UI's inclusion
      conversion submits the same `priority.model.v1` shape the consumer already understands.
- [ ] **Step 3:** Do not alter scorer order, route schemas, database tables, RLS, or chat consumers
      to accommodate UI terminology.
- [ ] **Step 4:** Re-run all three focused suites.

## Task 7 — Focused E2E and Live-Path Proof

**Files:**

- a focused existing/new file under `tests/e2e/**` (never `tests/uat/**`)

- [ ] **Step 1 (red/green):** Cover persona draft Save/Discard, guided replacement protection,
      preview success, Priorities local Add validation, one Save, and inclusion semantics at desktop
      and narrow viewports. Stub only external provider output; exercise the real UI/API boundary.
- [ ] **Step 2:** In a configured dogfood environment, prove CLI-backed ordinary chat and persona
      preview both work without an API key. Capture a precise missing-dependency error separately.
- [ ] **Step 3:** Save a distinctive priority phrase and source inclusion choice, submit a real chat
      request that ranks cross-tool results, and record the resulting ordering change.
- [ ] **Step 4:** Put sanitized commands/actions and results in the implementation PR description.
      Do not commit credentials, private messages, transcripts, or screenshots with user data.

## Task 8 — Final Verification and Handoff

- [ ] Run all focused tests named above.
- [ ] Run `pnpm check:file-size` if any touched source file approaches the repository limit.
- [ ] Run `pnpm verify:foundation` and report the real exit code.
- [ ] Review the diff for accidental schema, policy, route, RLS, scorer, or consumer changes.
- [ ] Confirm `git diff -- tests/uat docs/coordination` is empty.
- [ ] Commit coherent slices using explicit paths only; never use `git add -A`.
- [ ] Attach the live-path proof and call out any environment-only limitation honestly.

## Builder Self-Review

- [ ] Is `personaText` still the only persisted persona truth?
- [ ] Can a CLI-backed preview succeed without API credentials and clean up its one-shot transcript?
- [ ] Does model/YOLO copy describe current ownership without adding behavior?
- [ ] Does Add remain local until a valid Save?
- [ ] Does checked source mean ranking inclusion while storage/consumers remain unchanged?
- [ ] Do hidden and unknown priority fields survive round trips?
- [ ] Are all owned changes outside `tests/uat/**` and `docs/coordination/**`?
