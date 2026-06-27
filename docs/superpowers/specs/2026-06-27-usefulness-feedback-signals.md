# Lightweight feedback signals for Jarvis usefulness (#527)

**Status:** RFA - AGY review passed
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #527
**Depends on:** #526 unified priority model for priority-specific feedback. The `remember_this`
path additionally depends on #529 memory candidates/manual intake.
**Related follow-ups:** #532 confidence-aware memory records, #533 user-editable memory dashboard,
#531 restrained proactive monitoring, #540 safe automation audit log.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-priority-model.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-memory-distillation-pipeline.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-25-agency-action-loop.md`,
`~/Jarv1s/packages/ai/src/gateway/gateway.ts`, `~/Jarv1s/packages/chat/src/live/persistence.ts`,
`~/Jarv1s/packages/briefings/src/repository.ts`.

## 1. Problem

Jarvis needs lightweight feedback that is faster than editing settings or writing a long correction:

- "more like this";
- "too much";
- "wrong priority";
- "remember this";
- "not useful";
- "dismiss".

Without a small durable signal, Jarvis has no safe way to learn from repeated user reactions to
briefings, chat answers, and future proactive cards.

## 2. Decision

Add a **usefulness feedback signal ledger** plus a tiny set of feedback actions.

V1 records owner-scoped feedback events and applies only low-risk automatic effects:

- ranking/volume hints can affect future scoring after #526 consumes them;
- dismissals can suppress the same card/item for the same user;
- "remember this" creates a pending memory-review candidate only through a verified memory intake
  path.

V1 does not let feedback silently rewrite memory facts, send messages, create tasks, or change
source permissions.

## 3. Feedback Actions

Lock the V1 actions to:

```ts
type UsefulnessFeedbackKind =
  | "more_like_this"
  | "too_much"
  | "wrong_priority"
  | "not_useful"
  | "remember_this"
  | "dismiss";
```

Semantics:

- `more_like_this`: positive usefulness signal for a target and its source/category.
- `too_much`: volume/noise signal; future consumers may reduce frequency or rank.
- `wrong_priority`: priority correction signal; #526 consumes it as feedback, not as an immediate
  scoring rewrite.
- `not_useful`: negative usefulness signal without saying volume was too high.
- `remember_this`: explicit memory intent; requires memory-safe handling.
- `dismiss`: hide/suppress this exact item/card where the surface supports dismissal.

Do not add free-form custom feedback in V1. It is easy to collect and hard to use safely.

## 4. Data Model

Add `app.usefulness_feedback_signals`.

Fields:

- `id uuid primary key`
- `owner_user_id uuid not null`
- `target_kind text not null`
- `target_ref text not null`
- `surface text not null`
- `kind text not null`
- `source_kind text null`
- `source_label text null`
- `priority_band text null`
- `effect_kind text null`
- `effect_ref text null`
- `metadata_json jsonb not null default '{}'::jsonb`
- `status text not null default 'active'`
- `created_at timestamptz not null default now()`
- `resolved_at timestamptz null`

Allowed values:

```ts
type FeedbackTargetKind = "chat_message" | "briefing_run" | "briefing_item" | "proactive_card";

type FeedbackSurface = "chat" | "briefing" | "today" | "proactive";

type FeedbackStatus = "active" | "undone";
```

Rules:

- RLS: owner-only `SELECT/INSERT/UPDATE`; no admin private-data bypass.
- Runtime roles may not delete feedback rows. Undo marks `status = 'undone'`.
- `resolved_at` is set only when a row transitions to `undone`.
- `target_ref` is an opaque stable reference local to the surface, such as a chat message id or
  briefing run/item id. It must not contain source body text.
- `source_kind`, `source_label`, and `priority_band` are server-derived by the target verifier, not
  trusted from the client.
- `source_label` is a short UI label only, such as `Tasks`, `Calendar`, or `Briefing`.
- `metadata_json` is server-derived metadata only. No email bodies, note excerpts, chat message
  text, prompt text, secrets, connector tokens, or raw tool payloads.
- `effect_kind` / `effect_ref` record a reversible side effect created by feedback, such as a
  pending memory candidate id for `remember_this`.
- Unique active dedupe key: `(owner_user_id, target_kind, target_ref, kind)` where
  `status = 'active'`.

Add `app.usefulness_feedback_targets` as a metadata-only target registry for rendered targets that
do not have a directly queryable stable row, especially briefing items.

Fields:

- `owner_user_id uuid not null`
- `target_kind text not null`
- `target_ref text not null`
- `surface text not null`
- `source_kind text null`
- `source_label text null`
- `priority_band text null`
- `metadata_json jsonb not null default '{}'::jsonb`
- `last_seen_at timestamptz not null default now()`

Primary/unique key:

- `(owner_user_id, target_kind, target_ref, surface)`

Rules:

- owner-only RLS;
- metadata-only, same content restrictions as feedback rows;
- rendered signal type, when present, is stored as `metadata_json.signalType`, not as raw source
  text;
- modules may upsert target rows while rendering owned surfaces;
- feedback verifiers may consult this registry instead of scanning historical JSON blobs.

## 5. API

Add self routes:

- `POST /api/me/usefulness-feedback`
- `GET /api/me/usefulness-feedback?limit=...&status=...&targetKind=...&targetRef=...&surface=...`
- `POST /api/me/usefulness-feedback/:id/undo`

`POST` input:

```ts
interface CreateUsefulnessFeedbackRequest {
  readonly targetKind: FeedbackTargetKind;
  readonly targetRef: string;
  readonly surface: FeedbackSurface;
  readonly kind: UsefulnessFeedbackKind;
}
```

Validation:

- reject unknown enum values;
- `targetRef` max length: 1024;
- reject unknown top-level keys.

Allowed target/action combinations:

| Target kind      | Allowed feedback kinds                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `chat_message`   | `more_like_this`, `not_useful`, `remember_this`                                          |
| `briefing_run`   | `more_like_this`, `too_much`, `not_useful`, `dismiss`                                    |
| `briefing_item`  | `more_like_this`, `too_much`, `wrong_priority`, `not_useful`, `dismiss`, `remember_this` |
| `proactive_card` | `more_like_this`, `too_much`, `wrong_priority`, `not_useful`, `dismiss`, `remember_this` |

The route rejects mismatched target/action pairs before writing a row.

Allowed target/surface combinations:

| Target kind      | Allowed surfaces     |
| ---------------- | -------------------- |
| `chat_message`   | `chat`               |
| `briefing_run`   | `briefing`           |
| `briefing_item`  | `briefing`, `today`  |
| `proactive_card` | `proactive`, `today` |

The route rejects mismatched target/surface pairs before writing a row.

The create route is idempotent for the same active `(targetKind, targetRef, kind)`: return the
existing active row before target verification or memory intake, so repeated requests cannot create
duplicate side effects.

## 5.1 Target Verification Registry

Feedback routes must not directly query module-owned tables. Add a small verifier registry, modeled
after module-contributed providers:

```ts
interface FeedbackTargetVerification {
  readonly ownerUserId: string;
  readonly targetKind: FeedbackTargetKind;
  readonly targetRef: string;
  readonly surface: FeedbackSurface;
  readonly sourceKind?: string;
  readonly sourceLabel?: string;
  readonly priorityBand?: "critical" | "high" | "normal" | "low";
  readonly metadata?: Record<string, unknown>;
  readonly canRemember: boolean;
  readonly rememberExcerpt?: string;
}

type FeedbackTargetVerifier = (
  scopedDb: unknown,
  input: {
    readonly actorUserId: string;
    readonly targetKind: FeedbackTargetKind;
    readonly targetRef: string;
    readonly surface: FeedbackSurface;
  }
) => Promise<FeedbackTargetVerification | null>;
```

Rules:

- The API routes call the verifier through `DataContextDb`.
- The owning module registers the verifier for its target kinds.
- A verifier returns `null` when the target is missing or not owned by the actor; the route returns 404.
- The route stores authoritative `source_kind`, `source_label`, and `priority_band` from the
  verifier, not from client input.
- The route may store verifier-provided `metadata`, capped to 2 KB serialized with string values
  capped at 200 characters.
- `rememberExcerpt` is transient and used only for `remember_this`; it is never stored in the
  feedback row.

V1 verifiers:

- chat verifies `chat_message`;
- briefings verifies `briefing_run` and `briefing_item`;
- #531 later registers `proactive_card`.

## 5.2 Stable Briefing Item Targets

Briefing-derived cards/signals need stable feedback ids before `briefing_item` feedback ships.

Add a server-generated `feedbackItemId` to each rendered briefing item/signal. It should be stable
across briefing runs when the underlying item is materially the same:

```text
<source>:<signalType>:<short hash of source ids + normalized summary>
```

The hash input may include source ids and summary text in memory, but the stored/exposed
`feedbackItemId` is only the hash. Do not expose raw source ids or source text in `targetRef`.

The briefing renderer must upsert this stable id into `app.usefulness_feedback_targets` with the
owner, source, `metadata_json.signalType`, and priority band. The verifier checks that indexed
registry row rather than scanning historical briefing JSON. That lets `dismiss` suppress materially
identical future briefing items without wildcard queries.

## 6. Automatic Effects

V1 automatic effects are deliberately narrow:

| Feedback         | Automatic effect                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `dismiss`        | Hide the exact target on that surface for that user when the surface supports hiding.                                 |
| `more_like_this` | Store active signal only; #526/#527 consumers may count it later.                                                     |
| `too_much`       | Store active signal only; future #531 monitoring may reduce frequency.                                                |
| `wrong_priority` | Store active signal only; #526 may use it after explicit implementation.                                              |
| `not_useful`     | Store active signal only.                                                                                             |
| `remember_this`  | Create a pending memory-review candidate through the verified memory intake path; never directly write active memory. |

No feedback action may execute assistant write/destructive tools.

## 7. Memory Handling For `remember_this`

`remember_this` is the only action that can feed memory. It always creates a pending review item in
V1; it never promotes active memory directly.

Rules:

- Use the target verifier to confirm ownership and fetch a bounded `rememberExcerpt` transiently.
- Create a pending memory candidate through a memory-owned manual intake helper. Store the returned
  candidate id as `effect_kind = "memory_candidate"` and `effect_ref = <candidate id>`.
- This path is disabled until #529's memory candidate table and the memory-owned manual intake
  helper are available.
- Manual intake creates a valid pending `app.memory_candidates` row without waiting for LLM
  extraction:
  - it uses a memory-owned manual candidate signature namespace:
    `manual:<hash(targetKind + targetRef + normalized rememberExcerpt)>`;
  - `kind = "fact"`;
  - `action = "create"`;
  - `status = "pending"`;
  - `episode_id` is nullable; chat targets should set it when available, and non-chat targets leave
    it null;
  - `provenance = "volunteered"` for user-authored targets, otherwise `"inferred"`;
  - `confidence = 0.5`;
  - `importance = 0.5`;
  - `payload_json.manualRequest = true`;
  - `payload_json.excerpt` is the bounded `rememberExcerpt`;
  - `payload_json.targetKind` and `payload_json.targetRef` link back to the verified target.
- Do not reuse #529's `chat.extract-facts` queue unless #529's payload schema is explicitly
  extended to support user-requested manual memory intake.
- Manual user-requested intake may revive only the same manual candidate signature by resetting it
  to `pending`. It must not reuse #529's extracted-fact signature shape before extraction, because
  empty extracted fields would collapse unrelated manual requests into the same signature. This
  override applies only to explicit `remember_this`; automated extraction must continue preserving
  prior rejected/suppressed statuses as #529 specifies.
- If no memory intake helper exists yet, hide or disable `remember_this`; do not record a feedback
  action that cannot be acted on.
- Assistant text, briefing items, proactive cards, sensitive content, inferred content, conflicts,
  or low-confidence extractions remain pending for user review.
- Incognito chat targets reject `remember_this`.
- The feedback row stores the target reference and action only, not the remembered text.

#532 and #533 can later add confidence display and dashboard editing. #527 only records the signal
and routes it to the safest available memory path.

## 8. UI Surfaces

V1 placements:

- Chat message action menu: `More like this`, `Not useful`, `Remember this` only when the chat
  verifier reports `canRemember: true`.
- Briefing run action menu in the briefing header or footer: `More like this`, `Too much`,
  `Not useful`, and `Dismiss`. Run-level `Dismiss` hides only that rendered briefing run for the
  user; it does not dismiss each constituent briefing item.
- Briefing item/card action menu: `More like this`, `Too much`, `Wrong priority`, `Not useful`,
  `Remember this` when the verifier reports `canRemember: true`, and `Dismiss`.
- Today/proactive card action menu, when #531 creates cards: same as briefing/proactive allowed
  action set, with `Remember this` only when the verifier reports `canRemember: true`.

Use icon buttons or compact menus. Do not add explanatory feature text inside the main surfaces.

Each action gives quiet confirmation and an Undo affordance. Undo calls the feedback undo route.

## 9. Consumer Contract

Feedback is an input, not a command.

Consumers may read active feedback counts by owner, surface, kind, source, target, or priority band.
They must still enforce their own source permissions, source-behavior settings, and action
permission tiers.

Examples:

- #526 can use repeated `wrong_priority` signals as training data for future scorer adjustments.
- #531 can reduce proactive card frequency after repeated `too_much` on similar cards.
- Briefings can avoid resurfacing an active dismissed briefing item.

V1 should not build a general learning engine. Count signals; do not infer broad user preferences
without a follow-up spec.

Feedback about priority candidates must target the concrete rendered item/card that produced the
candidate, not a transient #526 `PriorityCandidate`.

## 10. Privacy, Safety, And Auditability

- Owner-only RLS on feedback rows.
- No admin private-data bypass.
- Feedback records are metadata-only.
- `remember_this` never stores secrets or raw source text in the feedback row.
- Undo is non-destructive and audit-friendly: mark row `undone`.
- Logs include metadata only: actor id, feedback id, target kind, surface, kind, status, duration,
  and error class. Never log `targetRef` if it could contain a source-local private id with meaning
  outside the user account.
- Feedback must not change module permissions or source-behavior policy.

## 11. Error Handling

- Duplicate active feedback: return existing row.
- Unknown target: record feedback only if the target belongs to the actor; otherwise 404.
- Missing optional target verification for future surfaces: fail closed until that surface supplies
  an owner-scoped verifier.
- Memory intake enqueue/create failure for `remember_this`: do not create or keep an active
  feedback row. The route must verify the target and create/enqueue the pending memory-review item
  before committing the active feedback row. If initial memory intake fails, roll back or skip
  feedback creation so the user can retry. Downstream worker failures after a successful enqueue
  degrade in the background and surface through the future memory review path.
- Undo for `remember_this`: if `effect_kind = "memory_candidate"` and the candidate is still
  pending, call a memory-owned cancellation helper to mark the candidate rejected/suppressed before
  marking feedback `undone`. If the candidate has already been resolved by the user, only mark the
  feedback row `undone`; the memory dashboard remains the authority for the resolved memory state.
- Undo of an already-undone row is idempotent.

## 12. Out Of Scope

- Learned ranking-model tuning.
- Automatic priority model mutation.
- Global notification/proactivity tuning.
- Free-form feedback text.
- Memory dashboard UI (#533).
- Confidence-aware memory display (#532).
- Safe automation audit log (#540).
- Deleting feedback rows.

## 13. Acceptance Criteria

- [ ] Chat and briefing surfaces expose the locked V1 feedback actions.
- [ ] Feedback creates owner-scoped rows in `app.usefulness_feedback_signals`.
- [ ] Feedback routes verify targets through module-owned verifier callbacks, not direct
      cross-module SQL.
- [ ] Server derives stored source/priority metadata from the verifier, not the client.
- [ ] Briefing items have stable safe `feedbackItemId` target refs.
- [ ] Duplicate active feedback on the same target/action is idempotent.
- [ ] Undo marks feedback as `undone` and reverses surface-level dismissal.
- [ ] Dismiss can hide the exact target for that user without deleting source data.
- [ ] `remember_this` follows the memory-safe rules and never writes any target directly into
      active memory.
- [ ] Undo of a pending `remember_this` feedback cancels the linked pending memory candidate.
- [ ] Feedback rows store metadata only and never source bodies, prompts, secrets, or raw tool
      payloads.
- [ ] User A cannot read, create, undo, or target-verify feedback for user B.

## 14. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:api
pnpm test:chat
pnpm test:briefings
pnpm test:memory
```

Targeted tests:

- create each V1 feedback kind;
- duplicate create returns the existing active row;
- undo is idempotent;
- dismissed briefing item no longer appears for that owner only;
- briefing item feedback uses safe stable `feedbackItemId`;
- `remember_this` on incognito chat is rejected;
- `remember_this` creates pending memory candidate, not active memory;
- repeated `remember_this` request returns existing active feedback and does not duplicate memory
  candidates;
- undo of pending `remember_this` cancels the linked candidate;
- `remember_this` is hidden/disabled when verifier cannot provide a memory-safe excerpt or memory
  intake helper is unavailable;
- feedback route rejects targets without a registered verifier;
- create validation rejects unknown top-level keys;
- `GET /api/me/usefulness-feedback` filters by target kind/ref/surface without client-side scanning;
- undo sets `resolved_at`;
- RLS isolation for list/create/undo/target verification.
