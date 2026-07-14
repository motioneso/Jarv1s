# Assistant and Priorities Dogfood Hardening (#991)

**Status:** approval-ready

**Issue:** #991

**Tier:** UX hardening; existing-contract repair

**Grounded against:** `origin/main` at `96d22ba0` on 2026-07-13

**Implementation plan:**
`docs/superpowers/plans/2026-07-13-991-assistant-priorities-dogfood-hardening.md`

## 1. Problem

The Assistant and Priorities settings expose the right underlying capabilities, but dogfooding
reveals several places where the UI misstates or prematurely persists them:

- Persona editing does not make the relationship between authored text and guided dials clear.
- “Preview voice” sounds like audio/TTS and the preview falsely requires an API key even when the
  selected chat model works through an authenticated CLI transport.
- Model and YOLO copy can imply controls that are actually inherited or admin-managed.
- Priorities exposes internal vocabulary and numeric storage details instead of user intent.
- Adding an anchor immediately sends an invalid blank record, so the visible Add action fails.
- Source controls read like access permissions even though they only affect ranking.

This slice makes those settings truthful, reversible, and demonstrably connected to the existing
runtime. It does not redesign the model-selection, approval-policy, or priority contracts.

## 2. Product Decisions

### 2.1 Persona has one persisted source of truth

`personaText` remains the only persisted persona value. The authored-text and guided-dial surfaces
are two ways to produce one local draft, not two saved representations:

- **Write it yourself** edits the draft directly.
- **Guide with dials** generates/replaces the local draft and shows the generated text before save.
- Switching modes never writes to the server and never silently discards the current draft.
- If applying dials would replace edited draft text, the UI asks for confirmation or presents an
  equally explicit replace/cancel choice.
- Save persists the draft through the existing persona API. Discard restores the last saved text.
- Dirty, saving, saved, and error states remain visible.

No dial positions are persisted. Reopening the pane starts from the saved persona text; the UI must
not claim it can reconstruct historical dial choices from that text.

### 2.2 Preview means a text response through the effective chat transport

Rename **Preview voice** to **Preview response**. This is a short generated text response, not the
Voice/STT capability owned by #874.

The preview uses the user's effective selected chat model and the same transport family that makes
that model usable in chat:

- CLI-backed provider: use the existing one-shot CLI structured adapter and engine factory.
- API-key provider: use the existing `HttpApiAdapter` credential path.
- No effective model: explain that a chat model must be selected or made available.
- Missing CLI adapter/login: identify the CLI dependency; do not ask for an API key.
- Missing API credential: identify the credential required by that API-backed model.
- Provider failure: surface a concise provider/transport failure without exposing secrets.

The preview does not create a chat thread or durable transcript. Temporary CLI transcript material
must be purged by the existing one-shot adapter behavior.

### 2.3 Model and YOLO presentation report effective ownership

Keep #869's model API, allowed-model list, effective-selection resolution, and admin constraints.
The user-facing choices are:

- **Automatic (admin default)**; and
- meaningful allowed overrides already supplied by the API.

A pinned or locked selection is labeled **Managed by admin** and is not presented as locally
editable. Do not add routing controls, provider setup, or model-policy state.

Approval-policy behavior belongs to #985. This issue may only make the existing effective YOLO
state and ownership clear. It must not implement, broaden, or bypass approval policy.

### 2.4 Priorities use user language and save as one draft

Keep `priority.model.v1`, its scorer, routes, RLS, and downstream consumers unchanged. Present the
same values in task-oriented language:

| Stored concept | UI language/behavior |
| --- | --- |
| anchors | **What matters right now** |
| anchor aliases | **Also match** |
| anchor kind | Hidden while only the default is meaningful; preserve stored/default value |
| numeric weight | Ordered labels: **Much lower**, **Lower**, **Neutral**, **Higher**, **Much higher** |
| muted/excluded sources | **Sources Jarvis may prioritize**; checked means included |

The pane owns one local draft with explicit **Save** and **Discard** actions. Field changes and Add
do not PATCH immediately. **Add priority** creates a local row, focuses its required label, and the
draft cannot save until required labels are nonblank.

Source controls affect ranking only, not connector access or data visibility. The explanatory copy
must say so. The currently wired sources are Tasks, Calendar, Email, and Notes. Hide Memory and
Wellness until they have consumers, while preserving any stored values during round trips.

## 3. Existing-Contract Reconciliation

- `apps/web/src/settings/settings-ai-pane.tsx` remains the Assistant settings owner.
- `apps/web/src/settings/settings-persona-preview.ts` remains the preview client seam.
- `packages/module-registry/src/built-in-module-helpers.ts` remains the default preview service
  factory, but it must route by effective transport instead of unconditionally demanding an API
  credential.
- `packages/chat/src/live/cli-structured-adapter.ts` is reused for CLI one-shot generation and
  transcript cleanup; no second CLI runner is introduced.
- `packages/module-registry/src/index.ts` supplies the existing engine-backed CLI adapter dependency
  to the preview factory.
- `packages/settings-ui/src/priority/index.tsx` remains the Priorities pane owner.
- The persona and priority DTOs, routes, database representation, scoring, RLS, and chat consumers
  remain authoritative and schema-compatible.

## 4. Scope and Ownership Locks

Expected implementation ownership:

- `~/Jarv1s/apps/web/src/settings/settings-ai-pane.tsx`
- `~/Jarv1s/apps/web/src/settings/settings-persona-preview.ts`
- `~/Jarv1s/packages/module-registry/src/built-in-module-helpers.ts`
- `~/Jarv1s/packages/module-registry/src/index.ts`
- `~/Jarv1s/packages/settings-ui/src/priority/index.tsx`
- focused tests named in the implementation plan

Collision boundaries:

- #985 owns approval-policy/YOLO semantics.
- #869 owns chat-model selection and admin constraint contracts.
- #874 owns audio Voice/STT settings.
- Existing priority model/scorer work owns persistence and ranking semantics.
- `tests/uat/**` and `docs/coordination/**` are explicitly out of bounds.

If implementation discovers that one of those contracts must change, stop and return the finding
to the Coordinator rather than expanding this issue.

## 5. Non-Goals

- A second persona schema, persisted dial state, persona history, or AI-authored persona workflow.
- Audio playback, voice selection, speech-to-text, or TTS.
- New provider credentials, model routing, failover, pricing, or admin policy.
- Approval-policy or tool-execution changes.
- A new priority schema, scorer, source, connector permission, or consumer.
- Making Memory or Wellness rankable before their existing consumer wiring is complete.
- Broad Settings redesign or a new component library.

## 6. Acceptance Criteria

### Assistant — desktop and narrow layouts

- The persona pane clearly distinguishes authored text from guided draft generation.
- Users can apply dials, inspect the resulting text, switch modes, save, and discard without an
  implicit server write or silent loss.
- “Preview response” generates against the effective selected model.
- A working CLI-backed chat model previews without an API-key credential.
- Missing-model, missing-CLI, missing-API-credential, and provider-failure states are accurate and
  actionable.
- Preview creates no durable chat thread/transcript.
- Automatic and admin-managed model states are legible without exposing new routing controls.
- YOLO copy reports the effective state without changing policy.
- Controls, validation, feedback, and actions remain usable without horizontal scrolling at the
  app's supported narrow settings width.

### Priorities — desktop and narrow layouts

- The pane says “What matters right now,” “Also match,” and user-facing importance labels; it does
  not expose `anchor`, `kind`, or raw weight terminology as required knowledge.
- Add creates a validatable local row rather than sending a blank PATCH.
- A single Save persists all valid draft changes; Discard restores the server snapshot.
- Blank required labels prevent save with an inline error and do not produce a rejected request.
- Tasks, Calendar, Email, and Notes use inclusion semantics: checked means eligible for ranking.
- Copy distinguishes ranking inclusion from source access.
- Hidden unwired and unknown stored source values survive edits.
- Existing scoring and chat-priority consumer tests remain behaviorally unchanged.
- The local draft, row actions, source choices, and Save/Discard remain usable without horizontal
  scrolling at the supported narrow width.

## 7. Live-Path Proof

The builder records evidence for all three paths:

1. Select/use a CLI-backed chat model, confirm ordinary chat works, then generate a persona preview
   without configuring an API key.
2. Exercise a missing transport dependency and show that the preview names the actual missing CLI
   or API requirement.
3. Save a distinctive high-priority phrase and source inclusion choice, then show a real chat turn
   whose cross-tool ordering changes in accordance with that saved priority model.

Mocks alone do not satisfy this proof. The final PR must identify the environment and exact user
actions used, while keeping credentials and private content out of logs and screenshots.

## 8. Approval Gate

This specification is ready for Coordinator approval. Implementation may begin only after approval
of this spec and its paired plan; no decision above is delegated to the builder.
