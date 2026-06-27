# Unified person/contact model for Jarvis context (#538)

**Status:** RFA - AGY review passed
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #538
**Depends on:** #525 cross-tool reasoning, #528 Jarvis memory graph substrate, #532
confidence-aware memory records, #533 user-editable memory dashboard, #537 automatic commitment
extraction from chats, notes, and email.
**Related follow-ups:** #539 source-backed answers with provenance, #540 safe automation audit log,
#541 data freshness visibility.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-cross-tool-reasoning.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-26-jarvis-memory-graph-substrate.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-user-editable-memory-dashboard.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-automatic-commitment-extraction.md`,
`~/Jarv1s/packages/module-sdk/src/index.ts`, `~/Jarv1s/packages/shared/src/email-api.ts`,
`~/Jarv1s/apps/web/src/tasks/task-details-sections.tsx`.

## 1. Problem

Jarvis sees people through disconnected source labels:

- an email address and display name in Gmail;
- a calendar attendee;
- "Sarah" in chat or notes;
- a task assignee label;
- a commitment counterparty from #537;
- a memory entity or alias from #528.

Without one owner-scoped person context index, Jarvis cannot reliably answer questions like:

- "What do I owe Sarah?"
- "What did I last discuss with the contractor?"
- "Which tasks, notes, and emails mention Mom?"
- "Is this Sarah the designer or Sarah from the school thread?"

The risky version is a CRM: syncing address books, importing social graphs, sharing contacts, and
editing source records. That is not V1. The missing capability is a bounded identity/context layer
that links source evidence without copying source bodies or pretending ambiguous aliases are known.

## 2. Decision

Add a **unified person/contact context model V1**.

V1 creates owner-scoped person context records, source identities, aliases, and artifact links. It
indexes context that already exists in Jarvis sources; it does not become the source of truth for
email, calendar, tasks, notes, memory, or commitments.

V1 supports:

- exact identity linking for email addresses and source-owned participant ids;
- reviewed aliases and relationship/context summaries;
- ambiguous match candidates for names and aliases;
- merge/split operations that preserve history;
- read APIs and assistant tools for "what do I owe Sarah?" style questions.

V1 does not build:

- connector sync;
- an address-book editor;
- contact sharing;
- social graph import;
- source record mutation.

## 3. Current Architecture Anchor

Relevant seams:

- #528 defines memory entities, aliases, facts, episodes, source links, and owner-scoped graph
  recall.
- #532 defines confidence, provenance, stale/superseded/conflicting semantics.
- #533 defines review surfaces for memory candidates and records.
- #537 defines commitment candidates with `counterparty_label` and ambiguity, intentionally waiting
  for this spec before person linking.
- Email DTOs already expose sender, recipients, subject, snippets, summaries, timestamps, and
  owner-scoped ids without requiring the person model to own email bodies.
- Module manifests already support source-owned providers and assistant tools.

#538 should add a small person context package and provider registry. It must not import source
repositories directly from a central service.

## 4. Terminology

**Person context record:** An owner-scoped Jarvis record representing "a person as Ben means them".
It is not a global identity and not a shared contact.

**Source identity:** A concrete identity string or source-owned participant id, such as an email
address, calendar attendee id, chat participant label, or source-specific account id.

**Alias:** A human label that may refer to a person, such as "Sarah", "Mom", "the contractor", or a
nickname. Aliases are weaker than source identities.

**Artifact link:** A bounded link from a person to a source object or Jarvis record, such as an
email message, commitment candidate, task, note, calendar event, goal, memory fact, or chat thread.

**Match candidate:** A reviewable suggestion to create a person, link an identity, merge people, or
split an incorrectly linked identity.

## 5. Storage

Add a focused package, for example `packages/people`.

### 5.1 People

Add `app.person_context_people`.

Fields:

- `id`
- `owner_user_id`
- `display_name`
- `relationship_summary`
- `context_summary`
- `status`: `active | archived | merged`
- `confidence`: `0.00..1.00`
- `memory_entity_id`
- `merged_into_person_id`
- `created_at`, `updated_at`
- `archived_at`, `merged_at`

Rules:

- owner-only FORCE RLS;
- runtime app and worker roles do not bypass RLS;
- `display_name` max 160 characters;
- summaries max 1,000 characters each;
- `memory_entity_id` is optional and owner-scoped. When present, it points to a #528 memory entity
  of kind `person`.
- `merged_into_person_id` is owner-scoped and used only for history/redirects.
- A person record may be archived, but not hard-deleted in V1.

### 5.2 Identities And Aliases

Add `app.person_context_identities`.

Fields:

- `id`
- `owner_user_id`
- `person_id`
- `identity_kind`: `email_address | source_identity | alias | display_name`
- `source_kind`: `email | calendar | chat | note | task | commitment | memory | manual`
- `normalized_value`
- `display_value`
- `source_ref`
- `source_ref_hash`
- `status`: `active | pending | ambiguous | rejected | split`
- `confidence`: `0.00..1.00`
- `provenance`: `source | inferred | user_confirmed | imported`
- `first_seen_at`, `last_seen_at`
- `created_at`, `updated_at`

Rules:

- `person_id` is nullable only for `pending`, `ambiguous`, or `rejected` identities.
- `normalized_value` is the matching key and is never logged.
- `source_ref` is an opaque source-owned reference and is private owner data.
- assistant read tools and REST list responses return `display_value`, `identity_kind`, confidence,
  and source label only; they do not return raw `source_ref`.
- unique active exact identity:
  `(owner_user_id, identity_kind, source_kind, normalized_value)` where `status = 'active'` and
  `identity_kind IN ('email_address', 'source_identity')`.
- aliases and display names are not globally unique. Multiple people may have alias "Sarah"; that
  is an ambiguity, not an error.

Normalization:

- email addresses lower-case the local and domain parts and trim whitespace;
- source identities use source-owned stable normalized values;
- aliases/display names lower-case, trim, collapse whitespace, and strip surrounding punctuation;
- aliases shorter than 2 characters are ignored unless user-confirmed.

### 5.3 Artifact Links

Add `app.person_context_links`.

Fields:

- `id`
- `owner_user_id`
- `person_id`
- `source_kind`: `email | calendar | chat | note | task | commitment | goal | memory | manual`
- `source_ref`
- `source_ref_hash`
- `source_label`
- `link_kind`: `sender | recipient | attendee | mentioned | assigned | counterparty | related`
- `summary`
- `occurred_at`
- `source_updated_at`
- `confidence`: `0.00..1.00`
- `provenance`: `source | inferred | user_confirmed`
- `created_at`

Rules:

- links use owner-scoped composite foreign keys to people;
- `source_ref` is private owner data and omitted from read-tool output;
- `source_label` max 200 characters;
- `summary` max 500 characters and never stores full source bodies, prompt text, connector
  payloads, secrets, tokens, or raw tool output;
- one person can link many artifacts; the link table is an index, not a copy of source records.

Add `app.person_context_link_sources`.

Fields:

- `id`
- `owner_user_id`
- `link_id`
- `identity_id`
- `source_ref_hash`
- `link_kind`
- `confidence`
- `created_at`

Rules:

- every non-manual link records at least one contributing identity or source signal;
- split/merge operations use this table to decide whether a link moves, stays, or is copied;
- rows contain hashes and ids only, never raw source refs or source text.

### 5.4 Match Candidates

Add `app.person_context_match_candidates`.

Fields:

- `id`
- `owner_user_id`
- `candidate_kind`: `create_person | link_identity | merge_people | split_identity`
- `status`: `pending | accepted | rejected | suppressed | resolved`
- `primary_person_id`
- `secondary_person_id`
- `identity_id`
- `suggested_display_name`
- `reason_summary`
- `confidence`: `0.00..1.00`
- `candidate_signature`
- `created_at`, `updated_at`, `resolved_at`

Rules:

- owner-only FORCE RLS;
- unique `(owner_user_id, candidate_signature)` across all statuses;
- rejected/suppressed signatures do not reappear as pending;
- `reason_summary` is bounded review text, not source content;
- accepting a candidate performs the merge/link/split operation in the same transaction and records
  a metadata-only event.
- `rejected` candidates are terminal unless the user manually reopens them.
- `suppressed` candidates do not reappear as a new row. A suppressed row may transition back to
  `pending` only when a new exact-identity signal arrives with confidence at least `0.90` and at
  least `0.20` higher than the suppressed row's confidence, or when the user explicitly reopens it.
  Reopening writes `candidate_reopened`.

### 5.5 Events

Add `app.person_context_events`.

Fields:

- `id`
- `owner_user_id`
- `event_kind`: `created | identity_linked | identity_rejected | merged | split | archived |
candidate_accepted | candidate_rejected | candidate_reopened`
- `person_id`
- `secondary_person_id`
- `identity_id`
- `candidate_id`
- `source_ref_hash`
- `created_at`

Rules:

- metadata only; no source text, summaries, raw identities, raw refs, prompts, secrets, or connector
  payloads;
- #540 may use these rows later for safe automation/audit UX, but #538 does not build that UX.

Export/delete includes all person context tables.

Add `app.person_context_indexing_state` for metadata-only queued indexing:

- `owner_user_id`
- `source`
- `source_ref`
- `source_ref_hash`
- `last_indexed_at`
- `last_source_version`
- `pending_source_version`
- `last_enqueued_at`
- `last_started_at`
- `last_finished_at`
- `failure_count`
- `updated_at`

Primary key: `(owner_user_id, source, source_ref_hash)`.

Rules:

- `source_ref` is private owner data loaded under `DataContextDb`;
- queued jobs carry `source_ref_hash` only, then the worker resolves `source_ref` from this table
  before calling the source provider;
- if the state row is missing or not owned by the actor, the worker exits as a successful no-op.

## 6. Source Provider Contract

Source modules contribute person signals. The People package owns identity matching, storage,
review, merge/split, APIs, and assistant tools.

Extend module manifests with an optional provider:

```ts
type PersonContextSource =
  | "email"
  | "calendar"
  | "chat"
  | "note"
  | "task"
  | "commitment"
  | "memory";

interface PersonContextProvider {
  readonly source: PersonContextSource;
  collectPersonSignals(
    scopedDb: unknown,
    input: PersonContextProviderInput
  ): Promise<PersonContextSignalBatch>;
}

interface PersonContextProviderInput {
  readonly ownerUserId: string;
  readonly sourceRef: string;
  readonly sourceVersion?: string;
  readonly reason: "source-updated" | "manual-refresh";
  readonly maxSignals: number;
}

interface PersonContextSignal {
  readonly sourceKind: PersonContextSource;
  readonly sourceRef: string;
  readonly sourceRefHash: string;
  readonly sourceLabel: string;
  readonly identityKind: "email_address" | "source_identity" | "alias" | "display_name";
  readonly displayValue: string;
  readonly linkKind:
    | "sender"
    | "recipient"
    | "attendee"
    | "mentioned"
    | "assigned"
    | "counterparty"
    | "related";
  readonly occurredAt: string | null;
  readonly sourceUpdatedAt: string | null;
  readonly summary: string;
  readonly confidence: number;
}
```

`sourceRef` in `PersonContextProviderInput` is loaded by the worker from
`app.person_context_indexing_state` under `DataContextDb`. It is never carried in the pg-boss
payload and never logged.

Rules:

- providers run under `DataContextDb`;
- providers may query only their owning module tables;
- providers return bounded identity/link signals, not full source records;
- providers do not return pre-normalized identity values. The People package normalizes
  `displayValue` in memory after validation and must never log raw `PersonContextSignal` objects;
  error logs include counts, source kind, source ref hash, and error class only;
- email/calendar/provider strings are external content and must be rendered as text only;
- no provider may store or return raw source bodies, prompts, secrets, connector payloads, or auth
  tokens.

V1 providers:

| Source      | Signals                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| Email       | sender and recipients from visible messages                                    |
| Calendar    | attendees/organizers from visible events, when available                       |
| Chat        | user-authored person labels from completed non-incognito turns                 |
| Notes       | bounded person/alias mentions around indexed note lines                        |
| Tasks       | assignee/current-user labels and person mentions when task fields support them |
| Commitments | #537 counterparty labels and later resolved person ids                         |
| Memory      | #528 person entities and aliases                                               |

No source connector sync is built in #538.

## 7. Matching Rules

V1 matching is conservative.

Automatic active link:

- exact normalized email address that already belongs to exactly one active person for the owner;
- exact source identity that already belongs to exactly one active person for the owner;
- user-confirmed identity from a candidate accept flow.

Automatic person creation:

- a new exact email address may create a low-friction person record with `confidence = 0.80` and a
  source label, only when no active or ambiguous person has that email identity;
- a new source-owned participant id may create a person record with `confidence = 0.75` when the
  provider marks the id stable;
- alias-only or display-name-only signals never auto-create a person unless the user explicitly
  accepts a `create_person` candidate.

Pending/ambiguous candidate:

- alias or display name matches more than one active person;
- alias or display name matches one person but confidence is below `0.75`;
- a source signal suggests merging two people by co-occurrence or similar name;
- a commitment counterparty label from #537 lacks an exact identity.

Never auto-merge:

- two people with the same display name;
- an alias and an email address;
- a note nickname and a calendar attendee;
- any identity conflict across source kinds.

When in doubt, create a match candidate or leave the source label unresolved.

## 8. Merge And Split

Merge and split are identity-graph operations with high blast radius. They always require an
explicit user confirmation step. Assistant write tools for merge/split are declared
`risk: "destructive"` or an equivalent locked `always_confirm` family, and they cannot be promoted
to trusted auto-run. A model inference in ordinary chat is not enough to merge or split people.

### 8.1 Merge

Merge is explicit user action or accepted `merge_people` candidate.

Rules:

- source person and target person must be owned by the actor;
- both person ids are loaded under the actor's `DataContextDb` scope before any mutation;
- target person remains `active`;
- source person becomes `status = "merged"` and points to `merged_into_person_id`;
- active identities and links move to the target person in one transaction;
- conflicting identities that violate an active unique exact-identity constraint become
  `ambiguous` instead of overwriting target identities;
- history rows and events are preserved;
- memory entity sync is queued after commit.

Merged person ids may redirect in APIs, but read tools should return the target person id and a
`mergedFrom` hint, not both as active people.

### 8.2 Split / Unlink

Split is explicit user action or accepted `split_identity` candidate.

Rules:

- split can unlink one identity from a person, move it to a new person, or move it to another
  existing person;
- split is allowed only from an `active` person. If a stale candidate references a person whose
  status is already `merged`, the route returns 409 and points the caller at the active target
  person when safe;
- linked artifact rows that came only from that identity move with the identity;
- linked artifact rows with multiple contributing identities use `app.person_context_link_sources`:
  - if all contributors move, move the existing link;
  - if some contributors remain and some move, keep the original link for remaining contributors and
    create a copied link for the split identity's new person with the moved contributor rows;
  - if contributor rows are missing or inconsistent, leave the link on the original person and
    create a `split_identity` match candidate instead of guessing;
- manually confirmed relationship/context summaries do not move automatically;
- split writes events for the identity and affected people;
- if the old person loses all active identities and links, it may be archived, but not deleted.

Split does not mutate source email/calendar/task/note records.

## 9. Memory Integration

Person context and memory graph have different jobs.

Rules:

- `app.person_context_people` is canonical for identity matching and ambiguity.
- #528 memory graph remains canonical for general facts, preferences, relationships, decisions, and
  episodes.
- A person may link to one #528 `memory_entities.kind = "person"` row.
- Person aliases may seed #528 memory aliases only after user confirmation or exact-identity
  confidence rules.
- Memory facts about a person link through the memory entity and can also create
  `person_context_links` with `source_kind = "memory"`.
- If memory and person context disagree about identity, person context wins for identity matching;
  memory remains evidence needing review.

Memory sync is async and metadata-only:

```ts
interface SyncPersonMemoryJobPayload {
  readonly actorUserId: string;
  readonly personId: string;
  readonly personUpdatedAt: string;
  readonly reason: "created" | "updated" | "merged" | "split" | "archived";
  readonly idempotencyKey: string;
}
```

The worker reloads current person context under `DataContextDb`, uses a reserved owner-scoped memory
alias `jarvis_person:<personId>`, and writes only bounded display/context summaries to memory. It
does not copy source bodies.

## 10. Commitment Integration

#537 commitment candidates can attach to people after #538 ships.

Rules:

- a commitment candidate may store nullable `person_id` only after exact identity match or user
  confirmation;
- unresolved #537 `counterparty_label` remains label-only by default;
- commitment counterparty labels may create a `link_identity` candidate only when the label is
  non-generic, the commitment is accepted or user-reviewed, and an existing person has a matching
  alias/display name. Generic labels such as "the team", "vendor", "them", "someone", or "client"
  are ignored for person-candidate generation;
- commitment counterparty labels never auto-create `create_person` candidates. The UI may offer a
  user-initiated "create person from counterparty" action, which creates a pending
  `create_person` candidate for review;
- ambiguous counterparties do not auto-link;
- "what do I owe Sarah?" resolves Sarah through person context first, then reads #537 commitment
  candidates linked to the resolved person plus source-local candidates whose label is still
  ambiguous and shown separately.

Commitment resolution still routes through #537 and #534. Person context does not create tasks,
draft replies, or update commitments by itself.

## 11. Query Contract

Create a small person context service.

```ts
interface PersonContextService {
  resolve(scopedDb, ownerUserId, query): Promise<PersonResolutionResult>;
  getPerson(scopedDb, ownerUserId, personId): Promise<PersonContextDetail | null>;
  listLinks(scopedDb, ownerUserId, personId, options): Promise<PersonContextLinksPage>;
  listMatchCandidates(scopedDb, ownerUserId, options): Promise<PersonMatchCandidatePage>;
}
```

Resolution result:

```ts
type PersonResolutionResult =
  | { readonly status: "resolved"; readonly person: PersonContextSummary }
  | { readonly status: "ambiguous"; readonly candidates: readonly PersonContextSummary[] }
  | { readonly status: "unresolved"; readonly label: string };
```

Rules:

- exact active email/source identity resolves to one person;
- alias/display-name lookup can return `ambiguous`;
- unresolved labels are returned as labels, not guessed people;
- assistant answers must ask a clarifying question or show ambiguity when resolution is ambiguous.

## 12. API

Add people-owned self routes:

- `GET /api/people?q=...&status=active&limit=...&cursor=...`
- `GET /api/people/resolve?q=...`
- `GET /api/people/:id`
- `GET /api/people/:id/links?sourceKind=...&limit=...&cursor=...`
- `PATCH /api/people/:id`
- `POST /api/people/:id/archive`
- `GET /api/people/match-candidates`
- `POST /api/people/match-candidates/:id/accept`
- `POST /api/people/match-candidates/:id/reject`
- `POST /api/people/match-candidates/:id/suppress`
- `POST /api/people/:id/merge`
- `POST /api/people/:id/split-identity`
- `POST /api/people/index/refresh`

Rules:

- all routes run under `DataContextDb`;
- no route accepts an owner id;
- unknown top-level keys are rejected;
- list/detail responses omit raw `source_ref` values and raw normalized identity values;
- detail responses can show email/display identity values because those are user-visible private
  contact data, but never raw source refs;
- opening a source artifact uses source-owned routes/tools and normal authorization;
- refresh enqueues metadata-only jobs, returns `202 Accepted`, and does not read source tables
  inline.

Merge request:

```ts
interface MergePeopleRequest {
  readonly secondaryPersonId: string;
}
```

Rules:

- `:id` is the target person and `secondaryPersonId` is the source person to merge in;
- both ids are resolved under the authenticated actor's `DataContextDb` scope before the merge
  transaction starts;
- missing or non-owned ids return 404;
- either id with `status = "merged"` returns 409 and the current active target when safe.

Split request:

```ts
interface SplitPersonIdentityRequest {
  readonly identityId: string;
  readonly targetPersonId?: string;
  readonly newPersonDisplayName?: string;
}
```

Rules:

- `:id`, `identityId`, and optional `targetPersonId` are all resolved under the actor's
  `DataContextDb` scope;
- split from a merged person returns 409;
- request must provide either `targetPersonId` or `newPersonDisplayName`, not both.

Refresh caps:

- per-owner refresh cooldown: 15 minutes;
- max 50 source refs enqueued per request;
- max 100 pending/running person-index jobs per owner;
- idempotency key: `people:<owner>:<source>:<sourceRefHash>`;
- if a newer source version appears while an older job is pending, update person indexing state and
  let the worker load latest source data when it runs.
- queued job payloads include only `actorUserId`, `source`, `sourceRefHash`, `sourceVersion`,
  `reason`, and `idempotencyKey`. The worker loads raw `source_ref` from
  `app.person_context_indexing_state` under `DataContextDb` before invoking a provider.

## 13. Assistant Tools

Add read tools:

| Tool                | Risk   | Purpose                                                              |
| ------------------- | ------ | -------------------------------------------------------------------- |
| `people.resolve`    | `read` | resolve a name/email/alias into resolved/ambiguous/unresolved result |
| `people.getContext` | `read` | return bounded person summary and recent links                       |
| `people.listRecent` | `read` | list recently seen active people                                     |

Optional review tools:

| Tool                   | Risk          | Policy                                      |
| ---------------------- | ------------- | ------------------------------------------- |
| `people.acceptMatch`   | `write`       | governed by a `people_review` action family |
| `people.rejectMatch`   | `write`       | governed by a `people_review` action family |
| `people.merge`         | `destructive` | locked `always_confirm`                     |
| `people.splitIdentity` | `destructive` | locked `always_confirm`                     |

Write tools mutate only person context rows. They do not mutate source emails, calendar events,
tasks, notes, goals, commitments, or memory facts directly.

`people.acceptMatch` must inspect `candidate_kind`. Accepting `merge_people` or `split_identity`
candidates uses the same destructive/always-confirm floor as direct `people.merge` and
`people.splitIdentity`; it cannot run through trusted auto.

`people.getContext` link output includes `sourceLabel`, `linkKind`, `occurredAt`, `summary`, and a
stable `citationToken = "<sourceKind>:<sourceRefHash>:<linkId>"`. The token is not a raw source ref;
#539 may use it to request source-backed citation details through a verifier-backed path.

## 14. UI

Add a compact "People & context" surface.

Likely home:

- Settings -> Memory & context, as a person context tab;
- future person detail links from Today, Tasks, Commitments, and Chat.

V1 UI:

- people list with search;
- detail panel showing display name, relationship/context summaries, identities, aliases, recent
  links, and ambiguity state;
- match-candidate review queue;
- merge and split flows with confirmation;
- source links as labels/deep links only when the source route exists.

UI rules:

- use existing authored `jds-*` and local primitives;
- compact rows, badges, tabs, menus, and icon buttons;
- no nested cards;
- no full email/note/chat bodies;
- no address-book editor fields beyond display name and bounded relationship/context summaries;
- ambiguous aliases must be visibly ambiguous and never silently grouped as one person.

## 15. Chat And Cross-Tool Behavior

Chat and #525 cross-tool reasoning may use person context after a question names a person.

Flow:

1. resolve the name/email/alias through `people.resolve`;
2. if resolved, use `people.getContext` and source-owned read tools already selected by the chat
   plan;
3. if ambiguous, ask a clarifying question or present the possible people;
4. if unresolved, answer from source-local labels only and say identity is not linked.

Examples:

- "What do I owe Sarah?" resolves Sarah, then reads linked #537 commitments, tasks, recent email,
  and notes as allowed.
- "What did the contractor say?" may return ambiguous if more than one contractor/source identity
  exists.
- "Merge this Sarah with Sarah Chen" routes through a review action, not an automatic merge.

Do not let a person match trigger new broad source reads by itself. It narrows already-allowed reads
and links already-indexed evidence.

## 16. Privacy, Safety, And Auditability

- All person context tables are owner-only with FORCE RLS.
- No admin private-data bypass.
- Runtime app and worker roles do not get `BYPASSRLS`.
- Email addresses, aliases, source refs, and relationship summaries are private owner data included
  in export/delete.
- Job payloads carry actor id, source kind, source ref hash, source version, reason, and
  idempotency key only.
- Logs include actor id, source kind, source ref hash, person id, event kind, candidate id, duration,
  and error class only. Never log raw identity values, source refs, source summaries, source text,
  prompts, secrets, connector payloads, or tool outputs.
- Source links do not grant source permissions.
- Merge/split events are metadata-only and preserved for audit/history.
- Assistant prompt context must label ambiguous/unconfirmed identities so the model cannot present
  guesses as confirmed.

#540 owns broader audit-log UX. #538 writes metadata-only person events, but does not build that
UX.

## 17. Freshness

V1 stores:

- identity `first_seen_at` and `last_seen_at`;
- link `occurred_at` and `source_updated_at`;
- indexing state per source ref.

Do not build freshness badges or stale-source warnings in this spec. #541 owns user-facing freshness
visibility.

## 18. Error Handling

- Missing source provider: skip and log metadata only.
- Source unavailable or disabled: skip.
- Provider failure: keep existing people/links unchanged.
- Invalid identity shape: drop that signal.
- Exact identity conflict: create an ambiguous candidate, do not overwrite.
- Merge conflict: move non-conflicting identities/links and mark conflicting identities ambiguous.
- Split target missing: 404.
- Source route unavailable for deep link: keep the link and render it as unavailable.
- Memory sync enqueue/worker failure: keep person context write successful and log metadata only.
- Refresh cap exceeded: return `202` with capped flag and enqueue no extra jobs.

Person indexing failure must never block chat, email sync, note ingestion, task updates,
commitment extraction, Today, or Briefings.

## 19. Out Of Scope

- Connector sync or OAuth.
- Address-book import/export UI.
- Social graph import.
- Contact sharing or multi-user shared contacts.
- Editing source emails, calendar attendees, notes, tasks, goals, or commitments.
- Phone/address/birthday/company CRM fields unless a later spec needs one.
- User-visible source citation cards (#539).
- Safe automation audit-log UX (#540).
- Freshness badges (#541).
- Model-based identity merging without user review.

## 20. Acceptance Criteria

- [ ] Owner-scoped person context records can store display names, bounded summaries, status,
      confidence, and optional memory entity links.
- [ ] Source identities and aliases are owner-scoped, confidence-labeled, and never logged raw.
- [ ] Source modules provide bounded person signals through source-owned providers under
      `DataContextDb`.
- [ ] Email/source identity exact matches can link conservatively; alias/display-name matches do
      not auto-merge.
- [ ] Ambiguous aliases create match candidates or ambiguous resolution results.
- [ ] Merge and split preserve history, events, source links, and owner boundaries.
- [ ] Merge/split operations and accepted merge/split candidates always require explicit user
      confirmation and cannot be trusted-auto.
- [ ] Split handles multi-contributor artifact links deterministically through link-source rows.
- [ ] #537 commitment candidates can link to people only through exact identity or user
      confirmation.
- [ ] #537 label-only counterparties do not auto-create people.
- [ ] `people.resolve` returns resolved, ambiguous, or unresolved instead of guessing.
- [ ] Person context narrows/links already-allowed source context; it does not grant source access.
- [ ] REST and assistant read surfaces omit raw source refs and normalized identity keys.
- [ ] `people.getContext` returns stable citation tokens for #539 without raw source refs.
- [ ] Refresh/indexing jobs are metadata-only, capped, and owner-scoped.
- [ ] Person indexing jobs carry source ref hashes only and resolve raw refs from owner-scoped
      indexing state.
- [ ] No source body, prompt, secret, connector payload, or raw tool output is stored in person
      context rows, jobs, logs, or tool output.
- [ ] User A cannot read, create, update, merge, split, or refresh user B's person context.

## 21. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:people
pnpm test:memory
pnpm test:commitments
pnpm test:email
pnpm test:calendar-email
pnpm test:tasks
pnpm test:api
pnpm test:web
```

Targeted tests:

- exact email identity creates or links one owner-scoped person;
- alias-only "Sarah" with two candidate people returns `ambiguous`;
- ambiguous alias does not auto-merge people;
- rejected match candidate signature does not reappear as pending;
- accepting link identity moves it to active and writes an event;
- accepting merge/split candidates always creates an approval request and cannot run trusted-auto;
- merging people moves non-conflicting identities/links and marks source person merged;
- merge route resolves both target and secondary person under the actor's `DataContextDb` scope;
- merge identity conflict becomes ambiguous instead of overwriting;
- splitting an identity moves identity-owned links and preserves manual summaries;
- splitting a multi-contributor link copies only moved contributor rows and keeps remaining
  contributors on the original person;
- split from a merged source person returns 409;
- #537 commitment counterparty label remains unresolved until exact identity or user confirmation;
- #537 generic counterparty labels do not create match candidates;
- `people.resolve` returns unresolved for unknown labels without creating a person;
- REST list/detail omit raw `source_ref` and normalized identity values;
- `people.getContext` emits citation tokens but no raw source refs;
- assistant tools label ambiguous/unconfirmed identity context;
- provider signals do not include `normalizedValue`, and worker logging redacts raw signal objects;
- person indexing jobs resolve raw source refs from `app.person_context_indexing_state`;
- refresh cooldown, per-source-ref dedupe, and outstanding-job cap prevent job storms;
- suppressed match candidate can reopen only for stronger exact-identity evidence or explicit user
  action; rejected candidates do not auto-reopen;
- memory sync failure does not roll back person context writes;
- source provider failure does not block source sync or chat;
- RLS isolation for people, identities, links, candidates, events, APIs, and assistant tools.

## 22. External Review

AGY reviewed this spec with `Claude Sonnet 4.6 (Thinking)` on 2026-06-27 because
`Gemini 3.5 Pro` was unavailable in the local AGY model list and Gemini-family AGY calls were
quota-exhausted. Blocker and medium findings were addressed in this draft, including explicit
merge/split confirmation, multi-contributor split semantics, redacted provider identity payloads,
#537 counterparty-label constraints, hash-only queued jobs, owner-scoped merge checks, #539 citation
tokens, split-from-merged handling, and suppressed candidate reopening rules. Final AGY review
reported no blocker or medium issues.
