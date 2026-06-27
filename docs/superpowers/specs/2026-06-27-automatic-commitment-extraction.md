# Automatic commitment extraction from chats, notes, and email (#537)

**Status:** RFA - AGY review passed
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #537
**Depends on:** #527 usefulness feedback signals, #528 Jarvis memory graph substrate, #529 memory
distillation pipeline, #532 confidence-aware memory records, #533 user-editable memory dashboard,
#534 explicit action permission tiers, #535 long-running Jarvis goals, #536 scheduled recurring
briefings, existing Tasks module.
**Related follow-ups:** #538 unified person/contact model, #539 source-backed answers with
provenance, #540 safe automation audit log, #541 data freshness visibility.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-usefulness-feedback-signals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-26-jarvis-memory-graph-substrate.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-memory-distillation-pipeline.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-user-editable-memory-dashboard.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-long-running-jarvis-goals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-scheduled-recurring-jarvis-briefings.md`,
`~/Jarv1s/packages/module-sdk/src/index.ts`, `~/Jarv1s/packages/tasks/src/manifest.ts`,
`~/Jarv1s/packages/email/src/tools.ts`, `~/Jarv1s/packages/jobs/src/pg-boss.ts`.

## 1. Problem

Jarvis can remember facts and track explicit tasks, but it still misses obligations buried in normal
work streams:

- "I'll send Sarah the pricing deck by Friday" in chat;
- a note line saying a contractor follow-up is owed after a decision;
- an email asking for a reply before a meeting;
- an explicit "no need to follow up on this" that should stop repeated nagging.

The risky version of this feature would silently create tasks, reminders, drafts, calendar events,
or goal updates from inferred text. That is not V1. The missing capability is a reviewable queue of
possible commitments, with enough source evidence and confidence metadata for the user to decide
what to do.

## 2. Decision

Add **automatic commitment extraction V1**.

V1 creates owner-scoped **commitment candidates** from chats, notes, and email. A candidate is a
possible obligation, reply, deadline, follow-up, or explicit non-action. It has source links,
bounded evidence snippets, confidence, status, and suggested handling.

V1 does not execute anything by itself:

- no task, reminder, email draft, email send, calendar event, goal update, or memory promotion is
  created without a user action;
- any chosen execution routes through the owning source tool and #534 action permission tiers;
- candidate extraction jobs carry metadata only and reload source text under `DataContextDb`.

This keeps commitments useful without creating a hidden automation engine.

## 3. Current Architecture Anchor

Relevant existing seams:

- #529 already defines source-backed candidate extraction, signatures, confidence, and
  reject/suppress semantics for memory candidates.
- #532 defines confidence/status language that candidates can display without overstating weak
  inference.
- #533 defines the review-dashboard pattern for pending candidates and historical decisions.
- #534 keeps write/destructive actions behind the assistant gateway; task write tools are
  `risk: "write"` and destructive cleanup is `risk: "destructive"`.
- #535 makes goals canonical records, but explicitly leaves commitment extraction to this spec.
- `ModuleAssistantToolManifest` already declares tool `risk`, `executionPolicy`, schemas, and
  external-content boundaries.
- `packages/jobs/src/pg-boss.ts` exposes the metadata-only job payload guard used by scheduled
  work.

#537 should reuse those patterns. It should not query source-owned tables directly from a central
service, and it should not turn candidates into tasks as a side effect.

## 4. Commitment Candidate Model

Add a focused Commitments module package, for example `packages/commitments`.

Core candidate type:

```ts
type CommitmentCandidateKind =
  | "promise"
  | "owed_reply"
  | "deadline"
  | "decision_follow_up"
  | "explicit_non_action";

type CommitmentCandidateStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "suppressed"
  | "resolved"
  | "expired";

type CommitmentSuggestedHandling =
  | "review_only"
  | "create_task"
  | "draft_reply"
  | "link_to_goal"
  | "mark_waiting"
  | "no_action";
```

Candidate fields:

- `id`
- `owner_user_id`
- `kind`
- `status`
- `title`
- `summary`
- `counterparty_label`
- `counterparty_status`: `none | bounded_label | ambiguous`
- `due_at`
- `due_precision`: `none | date | datetime | fuzzy`
- `confidence`: `0.00..1.00`
- `confidence_tier`: derived with #532 tier rules
- `suggested_handling`
- `candidate_signature`
- `source_count`
- `first_seen_at`, `last_seen_at`
- `reviewed_at`, `resolved_at`, `expires_at`
- `resolution_kind`
- `resolution_ref`
- `created_at`, `updated_at`

Rules:

- `title` and `summary` are bounded review text, not full source content.
- `counterparty_label` is a bounded display label only until #538 ships.
- `counterparty_status = "ambiguous"` must be shown when a label could refer to more than one
  person/source identity.
- `suggested_handling` is advice only. It is never an executable payload.
- `resolution_ref` may store the id of a task, draft, goal evidence row, or source-owned action
  after the user chooses a handling path. It is metadata about what happened, not a command to run.

## 5. Source Evidence

Add `app.commitment_candidate_sources`.

Fields:

- `id`
- `owner_user_id`
- `candidate_id`
- `source_kind`: `chat | note | email | manual`
- `source_ref`
- `source_ref_hash`
- `source_label`
- `evidence_excerpt`
- `occurred_at`
- `source_updated_at`
- `created_at`

Rules:

- Evidence rows are owner-scoped and use an owner-scoped composite foreign key to candidates.
- `source_ref` is an opaque source-owned reference used only for owner-scoped deep links or
  verifier lookups.
- `source_ref_hash` is used for signatures, logs, and dedupe when the raw ref should not surface.
- `source_label` is a short display label such as `Chat: House planning`,
  `Email: Sarah / Pricing follow-up`, or `Note: Remodel.md:42-48`.
- `evidence_excerpt` is bounded to 500 characters and may contain private owner data, but never full
  source bodies, prompts, credentials, tokens, hidden connector metadata, or raw tool payloads.
- A candidate can have at most 5 evidence rows in V1. Additional matching sources update
  `source_count` and `last_seen_at` but do not store unbounded snippets. The API must also return
  `storedEvidenceCount`; when `source_count > storedEvidenceCount`, the UI shows a compact "N more
  sources not shown" indicator so confidence/provenance stays bounded but honest.

Commitment candidates are not memory records. They may link to memory episodes or source records,
but they do not copy raw memory facts, email bodies, note bodies, or chat transcripts into a new
commitment store.

## 6. Storage

Add `app.commitment_candidates`.

Required constraints:

- owner-only FORCE RLS;
- runtime app and worker roles do not bypass RLS;
- `UNIQUE (owner_user_id, candidate_signature)` across all statuses;
- `confidence` check `0 <= confidence <= 1`;
- database checks for enum fields;
- max lengths:
  - `title`: 160;
  - `summary`: 1,000;
  - `counterparty_label`: 160;
  - `source_label`: 200;
  - `evidence_excerpt`: 500.

Export/delete includes both commitment tables.

Rejected and suppressed rows stay in the table. They are how Jarvis remembers not to resurface the
same noisy candidate.

Add `app.commitment_candidate_events` as a metadata-only event ledger for #540 to consume later.

Fields:

- `id`
- `owner_user_id`
- `candidate_id`
- `event_kind`: `created | updated | accepted | rejected | suppressed | resolved | expired`
- `old_status`
- `new_status`
- `suggested_handling`
- `resolution_kind`
- `target_kind`
- `target_ref_hash`
- `caused_by_candidate_id`
- `created_at`

Rules:

- owner-only FORCE RLS;
- no source text, candidate summaries, action inputs, prompts, secrets, or raw refs;
- status-changing routes write one event in the same transaction as the candidate update;
- #540 may build audit-log UX from these rows, but #537 does not build that UX.

Add `app.commitment_extraction_state` for refresh/job dedupe:

- `owner_user_id`
- `source`
- `source_ref_hash`
- `last_extracted_at`
- `last_source_version`
- `pending_source_version`
- `last_enqueued_at`
- `last_started_at`
- `last_finished_at`
- `failure_count`
- `updated_at`

Primary key: `(owner_user_id, source, source_ref_hash)`.

## 7. Source Provider Contract

Source modules own source reads. The Commitments module owns extraction, dedupe, candidate storage,
API, and review actions.

Extend module manifests with an optional provider:

```ts
type CommitmentExtractionSource = "chat" | "note" | "email";

interface CommitmentExtractionProvider {
  readonly source: CommitmentExtractionSource;
  collectCommitmentInputs(
    scopedDb: unknown,
    input: CommitmentExtractionInput
  ): Promise<CommitmentExtractionBatch>;
}

interface CommitmentExtractionInput {
  readonly ownerUserId: string;
  readonly sourceRef: string;
  readonly sourceVersion?: string;
  readonly reason: "source-updated" | "manual-refresh";
  readonly maxItems: number;
}

interface CommitmentExtractionSourceItem {
  readonly sourceKind: CommitmentExtractionSource;
  readonly sourceRef: string;
  readonly sourceRefHash: string;
  readonly sourceLabel: string;
  readonly occurredAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly textForExtraction: string;
  readonly textBoundary: "user_authored" | "external" | "mixed";
}
```

Rules:

- Providers run under `DataContextDb`.
- The central Commitments service never imports chat, notes, or email repositories.
- Providers return bounded extraction text, not full source payloads.
- Providers strip or redact obvious secrets before returning extraction input.
- Email provider input is `external`; note input is `user_authored`; chat input is `user_authored`
  in V1 because assistant turns are stripped.
- The extraction prompt treats all source text as evidence, never as instructions.

V1 providers:

| Source | Trigger                                                          | Input                                                  |
| ------ | ---------------------------------------------------------------- | ------------------------------------------------------ |
| Chat   | completed non-incognito turn                                     | bounded latest user-authored message plus thread label |
| Email  | visible message created/updated by source sync or manual refresh | bounded sender/subject/date/snippet/body excerpt       |
| Notes  | note indexed/changed by vault ingestion or manual refresh        | bounded matching note lines around action markers      |

The chat provider strips assistant turns in V1. Assistant text may have influenced the
conversation, but it is not evidence that the owner made a commitment. If dogfood needs pronoun
resolution against assistant context, add a later structured role-segment extractor; do not feed
mixed assistant text as commitment evidence in V1.

No real connector sync is built in #537. Existing source ingestion/sync paths may enqueue
commitment extraction after they write source data.

## 8. Extraction Jobs

Use metadata-only pg-boss payloads:

```ts
interface CommitmentExtractionJobPayload {
  readonly actorUserId: string;
  readonly source: "chat" | "note" | "email";
  readonly sourceRef: string;
  readonly sourceVersion?: string;
  readonly reason: "source-updated" | "manual-refresh";
  readonly idempotencyKey: string;
}
```

Rules:

- Job payloads contain no source text, prompts, snippets, secrets, connector payloads, or email/note
  bodies.
- Enqueue through the existing metadata-only job wrapper and assert scheduled/manual payloads with
  the same guard.
- `sourceRef` must be an opaque id or source-owned stable key. If a source only has a private path
  or external id, enqueue through a source-owned event row or hash rather than putting private text
  in the job payload.
- The worker builds `AccessContext` from `actorUserId` and a generated request id, then calls the
  provider under `DataContextDb`.
- Failures never block chat persistence, email sync, note ingestion, or manual source refresh.

Worker flow:

1. load the source provider for `source`;
2. collect bounded source input under `DataContextDb`;
3. run deterministic prefilter;
4. call the configured economy/summarization model only for likely commitment text;
5. parse JSON candidates;
6. normalize, dedupe, and store/update candidates and bounded evidence;
7. preserve existing rejected/suppressed statuses on signature conflict.

No provider configured, no credential, timeout, or invalid model JSON degrades to no candidates and
logs metadata only.

## 9. Extraction Semantics

The model emits only candidate facts:

```ts
interface ExtractedCommitmentCandidate {
  readonly kind: CommitmentCandidateKind;
  readonly title: string;
  readonly summary: string;
  readonly counterpartyLabel?: string;
  readonly counterpartyAmbiguous?: boolean;
  readonly dueAt?: string;
  readonly duePrecision?: "date" | "datetime" | "fuzzy";
  readonly confidence: number;
  readonly suggestedHandling: CommitmentSuggestedHandling;
  readonly evidenceExcerpt: string;
  readonly rationale: string;
}
```

Detection rules:

- `promise`: the owner appears to have committed to do something.
- `owed_reply`: the owner likely owes a response.
- `deadline`: the text contains a due date, deadline, or time-bound expectation.
- `decision_follow_up`: a decision implies a next check, confirmation, update, or communication.
- `explicit_non_action`: the text explicitly says not to act, reply, follow up, or track.

The extractor must distinguish:

- a commitment from someone else to the owner;
- a request directed at the owner;
- a vague idea or wish;
- a completed action;
- an explicit non-action.

Only owner obligations become commitment candidates. Other-party obligations may appear in the
summary only when they explain context, and `suggested_handling` should usually be `review_only` or
`mark_waiting`.

## 10. Deterministic Prefilter

Before a model call, run a cheap source-text prefilter.

Trigger phrases include:

- promise markers: `I will`, `I'll`, `I can`, `I need to`, `I'll send`, `I'll follow up`;
- reply markers: `can you reply`, `please respond`, `waiting for your response`, `thoughts?`;
- deadline markers: `by Friday`, `due`, `before`, `deadline`, `tomorrow`, dates;
- decision follow-up markers: `we decided`, `next step`, `follow up`, `circle back`;
- non-action markers: `no need to`, `don't follow up`, `ignore`, `not going to`.

Skip:

- greetings and social chatter;
- source text shorter than 12 characters with no marker;
- content already resolved by clear completion language;
- low-information notification noise;
- emails or notes whose source behavior settings disallow this source for assistant analysis.

The prefilter is intentionally broad. Dedupe, confidence, and review status are the noise controls.

## 11. Dedupe And Suppression

Candidate signature:

```text
kind | normalized-counterparty-label | normalized-title | normalized-due-local-date | source-kind | source-ref-hash
```

Rules:

- Normalize by lowercasing, trimming, collapsing whitespace, and stripping punctuation.
- V1 dedupe is source-local only. It dedupes repeated detections of the same obligation from the
  same source item and preserves rejections/suppression for that source item.
- V1 does not auto-merge candidates across chat/email/note sources. Without #538 person identity
  and #539 source-backed provenance UX, cross-source auto-merge would hide ambiguity.
- Insert uses `ON CONFLICT (owner_user_id, candidate_signature)`.
- Existing `pending` or `accepted` rows update `last_seen_at`, confidence if higher, source count,
  and bounded evidence if under cap.
- Existing `rejected` or `suppressed` rows do not become pending again.
- Existing `resolved` rows do not reopen unless the new source text has a later due date or a
  materially different normalized title.
- `explicit_non_action` accepted or suppressed rows can suppress exact matching `promise`,
  `owed_reply`, or `decision_follow_up` candidates for the same source item only.
- When an `explicit_non_action` row is accepted or suppressed, the API looks at that row's evidence
  `source_ref_hash` values, finds `pending` candidates with the same `(owner_user_id,
source_ref_hash)`, `kind IN ("promise", "owed_reply", "decision_follow_up")`, and matching
  normalized counterparty/title tokens, then transitions those candidates to `suppressed`.
  Future worker inserts apply the same lookup before creating a new pending row. Each suppressed
  candidate gets its own `app.commitment_candidate_events` row with
  `caused_by_candidate_id = <explicit_non_action candidate id>`.
- If the driving `explicit_non_action` candidate is later rejected, the API reopens candidates whose
  latest suppression event was caused by that non-action by moving them back to `pending`, unless
  the candidate has a later explicit user `rejected`, `suppressed`, `resolved`, or `expired` event.
  Each reopened candidate gets its own event row.

Do not use fuzzy global person matching until #538 exists. Ambiguous labels stay ambiguous. The UI
may visually group possible duplicates by normalized title and due date, but each source-local
candidate remains separate and reviewable.

## 12. Review API

Add Commitments routes:

- `GET /api/commitments/candidates`
- `GET /api/commitments/candidates/:id`
- `POST /api/commitments/candidates/:id/accept`
- `POST /api/commitments/candidates/:id/reject`
- `POST /api/commitments/candidates/:id/suppress`
- `POST /api/commitments/candidates/:id/resolve`
- `POST /api/commitments/extraction/refresh`

List query:

```ts
interface CommitmentCandidateQuery {
  readonly status?: CommitmentCandidateStatus | "open" | "history" | "all";
  readonly kind?: CommitmentCandidateKind;
  readonly sourceKind?: "chat" | "note" | "email";
  readonly q?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
```

Rules:

- Default status is `open`, meaning `pending` plus `accepted`.
- `history` returns `rejected`, `suppressed`, `resolved`, and `expired`.
- Hard max page size is 100.
- All routes use `DataContextDb`; no route accepts an owner id.
- Unknown top-level keys are rejected.
- `refresh` enqueues metadata-only extraction jobs for eligible sources and returns `202 Accepted`.
  It does not read sources inline.

Refresh eligibility:

- global per-owner refresh cooldown: 15 minutes;
- per-source refresh cooldown: 15 minutes;
- per-source-ref cooldown: 15 minutes, recorded in
  `app.commitment_extraction_state.last_enqueued_at`;
- max 50 jobs enqueued per refresh request;
- max 100 pending/running commitment extraction jobs per owner; above that, refresh returns `202`
  with no new jobs and a capped flag;
- source providers return only source refs whose `sourceVersion` changed since
  `app.commitment_extraction_state.last_source_version`, or whose last extraction is older than 24
  hours;
- idempotency key is `commitments:<owner>:<source>:<sourceRefHash>`;
- if more than 50 refs are eligible, enqueue the first 50 by newest `sourceUpdatedAt` and return a
  response flag showing the refresh was capped.
- if a new `sourceVersion` arrives while a job for the same `(owner, source, sourceRefHash)` is
  pending or running, update `pending_source_version` in extraction state but do not enqueue a
  second job. The worker reloads the latest source data when it runs and writes the extracted
  version to `last_source_version` on success.

Actions:

- `accept`: marks a candidate as real enough to track, but does not create a task or message.
- `reject`: marks this exact candidate wrong; same signature should not reappear.
- `suppress`: marks this candidate/signature noisy; same signature should not reappear as pending.
- `resolve`: records that the user handled or intentionally closed the commitment.

Resolution payload:

```ts
interface ResolveCommitmentCandidateRequest {
  readonly resolutionKind:
    | "completed_elsewhere"
    | "created_task"
    | "drafted_reply"
    | "linked_goal"
    | "not_needed";
  readonly resolutionRef?: string;
}
```

The route validates any `resolutionRef` through the owning source verifier. It does not mutate the
referenced source object.

Resolution verifier contract:

```ts
interface CommitmentResolutionVerifier {
  readonly targetKind: "task" | "email_draft" | "goal_evidence" | "source";
  verifyResolutionRef(
    scopedDb: unknown,
    input: {
      readonly ownerUserId: string;
      readonly resolutionKind: ResolveCommitmentCandidateRequest["resolutionKind"];
      readonly resolutionRef: string;
    }
  ): Promise<{ readonly targetRefHash: string; readonly targetLabel: string } | null>;
}
```

Rules:

- `completed_elsewhere` and `not_needed` must not include `resolutionRef`.
- Any non-null `resolutionRef` requires a registered verifier for that `resolutionKind`; missing
  verifier returns 503 and leaves the candidate unchanged.
- A verifier returning `null` means 404.
- The Commitments module stores the raw ref only after verification and stores `target_ref_hash` in
  the event ledger.
- Any future dereference of `resolutionRef` must go back through the same owning source verifier.
- `resolution_ref` is private owner data included in export/delete. Read assistant tools do not
  return the raw value; they return only `resolution_kind` and whether a verified ref exists.
- REST list and detail responses also omit the raw value; they return only `resolution_kind` and a
  `hasResolutionRef` flag.
- UI/API surfaces that need to open or dereference `resolution_ref` must use a separate
  verifier-backed dereference path that returns source-owned display/deep-link data, not the raw ref
  directly.

## 13. Assistant Tools And Suggested Handling

Add read-only assistant tools:

| Tool                   | Risk   | Purpose                                                     |
| ---------------------- | ------ | ----------------------------------------------------------- |
| `commitments.listOpen` | `read` | list accepted and pending candidates with confidence labels |
| `commitments.get`      | `read` | show one candidate with bounded source evidence             |

Optional write tools may be added only for review-state transitions:

| Tool                  | Risk    | Policy                                          |
| --------------------- | ------- | ----------------------------------------------- |
| `commitments.accept`  | `write` | governed by a `commitment_review` action family |
| `commitments.reject`  | `write` | governed by a `commitment_review` action family |
| `commitments.resolve` | `write` | governed by a `commitment_review` action family |

These tools mutate only the commitment candidate ledger. They do not create tasks, send mail, draft
mail, modify goals, or write calendar events.

Suggested handling maps to source-owned action flows:

| Suggested handling | User action path                                                      |
| ------------------ | --------------------------------------------------------------------- |
| `create_task`      | prefill or propose `tasks.create`; #534 decides confirm/auto-run      |
| `draft_reply`      | future `email.draft`; `email.send` remains destructive/always-confirm |
| `link_to_goal`     | `goals.addEvidence`; #534 decides confirm/auto-run                    |
| `mark_waiting`     | review-state change or future source-owned waiting marker             |
| `no_action`        | accept/reject/suppress explicit non-action                            |
| `review_only`      | no source action                                                      |

The commitment row never stores executable tool input. A surface may build a proposal from the
current candidate at click time, then hand it to the owning source tool/gateway.

## 14. UI

Add a compact commitment review surface.

Likely homes:

- Today surface: "Commitments" section for open candidates, capped;
- Tasks surface: review queue link or tab;
- future person/contact pages from #538.

V1 row fields:

- kind;
- title and summary;
- counterparty label, including ambiguity;
- due date or fuzzy deadline;
- confidence tier and numeric confidence;
- source label and evidence snippet;
- suggested handling;
- status and last seen time.

Actions:

- accept;
- reject;
- suppress similar;
- resolve/not needed;
- create task;
- draft reply when available;
- link to goal when #535 tools are available;
- open source.

UI rules:

- Use existing authored `jds-*` and local primitives.
- Do not nest cards.
- Do not show full source bodies.
- Do not present suggested handling as already done.
- When counterparties are ambiguous, say so in the row and avoid person-specific grouping until
  #538 links a reviewed person identity.
- When an `explicit_non_action` is source-local, label it as source-local so the user knows it does
  not suppress similar obligations found in other sources.

## 15. Chat, Briefing, And Goal Behavior

Chat:

- Jarvis may call `commitments.listOpen` for questions like "what do I owe?", "do I need to reply
  to anyone?", or "what follow-ups are open?"
- Pending candidates must be phrased as possible commitments needing review.
- Accepted candidates may be phrased as commitments, still with source/confidence labels.

Briefings:

- #536 scheduled briefings may include open accepted commitments and high-confidence pending
  candidates when the schedule selects the commitments source.
- Briefings may suggest actions, but never execute them.

Goals:

- #535 goals stay canonical for long-running objectives.
- A commitment candidate may be linked as bounded goal evidence only after user action through the
  goals tool/API.
- Commitment extraction does not create, complete, pause, or update goals automatically.

## 16. Person/Contact Boundary

#538 owns unified person/contact identity.

Until #538 ships:

- store only `counterparty_label`, `counterparty_status`, and bounded source references;
- never auto-merge "Sarah", an email address, and a note nickname into one person;
- never use ambiguous labels to dedupe across unrelated sources;
- display ambiguity instead of pretending the identity is known.

After #538 exists, this module may add an optional owner-scoped `person_id` link and a reviewed
merge flow. That is a follow-up migration, not part of #537 V1.

## 17. Privacy, Safety, And Auditability

- Candidate and evidence rows are owner-only with FORCE RLS.
- No admin private-data bypass.
- Runtime app and worker roles do not get `BYPASSRLS`.
- Extraction jobs carry metadata only.
- Logs include actor id, source kind, source ref hash, candidate count, status transition, duration,
  and error class only. Never log source text, candidate summaries, prompts, snippets, secrets,
  connector payloads, or raw tool output.
- Model prompts receive bounded source text only after provider filtering/redaction.
- External content is framed as evidence, not instructions.
- Candidate evidence excerpts and source labels are private owner data and included in export/delete.
- Source links do not grant source permissions. Opening a source uses the source module's normal
  authorization.
- `app.commitment_candidate_events` records status transitions and chosen suggested handling as
  metadata-only rows so #540 has durable audit input.

#540 will own the broader safe automation audit log. V1 records candidate status history and
metadata-only logs, but does not build a separate audit-log UX.

## 18. Freshness

V1 stores basic timestamps:

- candidate `first_seen_at` and `last_seen_at`;
- evidence `occurred_at` and `source_updated_at`;
- extraction run time in worker metadata.

Do not build freshness badges, stale-source warnings, or answer freshness explanations here. #541
owns user-facing data freshness visibility.

## 19. Error Handling

- Missing source provider: skip and log metadata only.
- Source unavailable or disabled: skip.
- Source permission unavailable: skip or return 403 for direct user refresh.
- Provider failure: keep existing candidates unchanged.
- Model unavailable, timeout, or invalid JSON: no candidates; source flow remains successful.
- Candidate parse failure: drop that extraction batch.
- Duplicate candidate: update existing row per dedupe rules.
- Rejected/suppressed duplicate: preserve the old status.
- Source verifier unavailable during resolution: return 503 and leave candidate unchanged.
- Action proposal failure: leave candidate open so the user can retry.

Extraction failure must never block chat, note ingestion, email sync, Today, Tasks, or Briefings.

## 20. Out Of Scope

- Silent task creation, reminder creation, email drafting/sending, calendar writes, or goal updates.
- Real connector sync or connector OAuth.
- Full CRM/person identity (#538).
- User-visible answer citation cards (#539).
- Safe automation audit-log UX (#540).
- Freshness/staleness badges (#541).
- A workflow engine or broad automation rules.
- Cross-user/shared commitments.
- Storing full source bodies or raw memory records as commitments.

## 21. Acceptance Criteria

- [ ] Chats, notes, and email can enqueue metadata-only commitment extraction jobs.
- [ ] Source modules provide bounded extraction inputs through source-owned providers under
      `DataContextDb`.
- [ ] Extraction creates owner-scoped commitment candidates with kind, status, confidence, suggested
      handling, due metadata, counterparty label/ambiguity, and source evidence.
- [ ] Evidence stores bounded snippets and source links, never full source bodies or secrets.
- [ ] Candidate API/UI discloses when more sources contributed than can be shown under the evidence
      cap.
- [ ] Candidate signatures dedupe repeated detections and preserve rejected/suppressed decisions.
- [ ] Explicit non-actions can be reviewed and used to suppress exact matching noisy candidates for
      the same source item.
- [ ] Explicit non-action suppression records causal event links and can reopen those candidates if
      the driving non-action is rejected.
- [ ] Cross-source candidates are not auto-merged before #538/#539; possible duplicates remain
      separately reviewable.
- [ ] Open candidates are visible in a review surface with source evidence and confidence.
- [ ] User actions can accept, reject, suppress, and resolve candidates.
- [ ] Non-null resolution refs require source-owned verifier approval before storage.
- [ ] REST and assistant read surfaces do not return raw `resolution_ref` values.
- [ ] Manual refresh is rate-limited/capped, enqueues at most 50 jobs per request, and respects the
      per-owner outstanding-job cap.
- [ ] Candidate status changes write metadata-only event rows for future #540 audit UX.
- [ ] Suggested task/reply/goal handling routes through source-owned tools and #534 action policy.
- [ ] No extraction path silently creates tasks, reminders, drafts, sends, calendar events, memory
      facts, or goal updates.
- [ ] Pending candidates are phrased as possible commitments, not confirmed obligations.
- [ ] Counterparty identity remains label-only/ambiguous until #538 links reviewed person records.
- [ ] User A cannot read, create, update, resolve, or extract candidates for user B.

## 22. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:commitments
pnpm test:chat
pnpm test:notes
pnpm test:email
pnpm test:tasks
pnpm test:api
pnpm test:web
```

Targeted tests:

- prefilter triggers on promises, owed replies, deadlines, decision follow-ups, and explicit
  non-actions;
- prefilter skips greetings, completed/noise text, and source-disabled content;
- extraction job payload passes metadata-only validation;
- provider loads source text under `DataContextDb`, not from job payload;
- chat provider extracts from user-authored messages only, not assistant turns;
- model JSON parser rejects malformed candidate shapes;
- candidate signature dedupes repeated email/chat/note detections;
- rejected and suppressed signatures do not reappear as pending;
- accepted explicit non-action suppresses exact matching future candidates for the same source
  item only;
- rejecting the driving explicit non-action reopens only candidates whose latest suppression event
  was caused by that row;
- evidence excerpt cap prevents full email/note/chat body storage;
- API returns `sourceCount` and `storedEvidenceCount` when hidden sources contributed;
- confidence tier rendering follows #532 thresholds;
- list API defaults to open candidates and paginates;
- accept/reject/suppress/resolve are owner-scoped and idempotent where safe;
- resolve with non-null `resolutionRef` fails without a registered verifier;
- REST list/detail responses omit raw `resolution_ref` and expose only `hasResolutionRef`;
- refresh cooldown, per-source-ref dedupe, and outstanding-job cap prevent job storms;
- a new source version while a job is pending updates extraction state without enqueueing a second
  job;
- status transitions write metadata-only commitment candidate events;
- `create_task` handling calls/proposes `tasks.create` through the gateway path and does not store
  executable tool input in the candidate row;
- ambiguous counterparty labels are not auto-merged across sources;
- RLS isolation for candidates, evidence, APIs, and assistant tools.

## 23. External Review

AGY reviewed this spec with `Claude Sonnet 4.6 (Thinking)` on 2026-06-27 because
`Gemini 3.5 Pro` was unavailable in the local AGY model list and Gemini-family AGY calls were
quota-exhausted. Blocker and medium findings were addressed in this draft, including source-local
dedupe semantics, fail-closed resolution verification, refresh caps, metadata-only event logging,
chat user-turn-only extraction, explicit non-action suppression causality, `resolution_ref`
redaction, and refresh version-race handling. Final verification reported no blocker or medium
findings remaining in scope.
