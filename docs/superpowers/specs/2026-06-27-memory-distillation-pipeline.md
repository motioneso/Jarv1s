# Memory distillation pipeline (#529)

**Status:** approved
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #529
**Depends on:** #528 Jarvis memory graph substrate.
**Related follow-ups:** #530 passive retrieval, #532 confidence-aware memory, #533 editable memory
dashboard, #537 commitment extraction, #539 source-backed answers.

## 1. Problem

Jarvis currently has a chat `extract-facts` job that tries to pull flat facts from the latest turn
pair and write them directly into `app.chat_memory_facts`.

That is not robust enough for the graph memory substrate:

- raw chats contain noise, jokes, tentative ideas, corrections, and stale context;
- direct writes can create duplicates or overconfident inferred memories;
- graph memory needs entities, aliases, facts/edges, episodes, conflicts, and supersessions;
- some extracted information should become active memory immediately, while some should wait for
  review;
- extraction failure must never block chat.

The goal is not heavier machinery for its own sake. The goal is to keep memory useful: distilled,
source-backed, consolidated, and safe to recall.

## 2. Decision

Replace the flat "extract facts" mental model with a **memory distillation pipeline**:

1. capture a source episode for completed non-incognito chat turns;
2. deterministically decide whether a turn is worth distilling;
3. extract structured memory candidates;
4. consolidate candidates against the existing graph;
5. promote only high-confidence, low-risk candidates to active memory;
6. store the rest as pending candidates for review.

V1 keeps the existing `CHAT_EXTRACT_FACTS_QUEUE = "chat.extract-facts"` queue name to avoid
operational churn. Code comments, worker names, and docs should refer to the product concept as
memory distillation.

## 3. Pipeline

### 3.1 Episode capture

Every completed non-incognito user+assistant turn creates or updates one `memory_episode`:

- `source_kind = "chat"`
- `source_ref = thread id`
- `source_label = chat title`
- `occurred_at = assistant message timestamp`
- `excerpt = bounded user+assistant turn text`

This episode is evidence, not active memory. It is safe to store even when no durable memory is
created, because it remains owner-scoped and bounded.

Incognito turns create no episode and enqueue no distillation job.

### 3.2 Meaningfulness gate

Before spending a model call, run a deterministic prefilter over the latest turn pair.

Evaluation order:

1. If an explicit trigger phrase is present, distill.
2. Else if a named project/person plus concrete state is present, distill.
3. Else if the user text is at least 240 characters and contains an action/date/decision marker,
   distill.
4. Else skip.

Social/status chatter always skips unless rule 1 is true.

Trigger when any are true:

- explicit memory phrase: `remember`, `don't forget`, `note that`, `save this`;
- preference phrase: `I prefer`, `I like`, `I hate`, `I want you to`;
- decision phrase: `we decided`, `decision`, `let's go with`, `approved`;
- goal/priority phrase: `my goal`, `priority`, `focus`, `deadline`;
- correction phrase: `actually`, `no,`, `that's wrong`, `not X, Y`;
- commitment phrase: `I will`, `I need to`, `remind me`, `follow up`;
- named project/person plus concrete state.

V1 ships deterministic heuristics only. A model-based classifier is out of scope unless the
deterministic gate proves too noisy in dogfood.

### 3.3 Candidate extraction

For meaningful turns, the worker calls the configured economy/summarization model and asks for JSON
only.

The model emits `MemoryCandidate[]`:

```ts
interface MemoryCandidate {
  readonly kind: "entity" | "fact" | "alias" | "supersession" | "conflict";
  readonly action: "create" | "update" | "link" | "supersede" | "reject";
  readonly entity?: {
    readonly kind:
      | "person"
      | "project"
      | "preference"
      | "goal"
      | "constraint"
      | "decision"
      | "topic"
      | "place"
      | "organization"
      | "self";
    readonly name: string;
    readonly summary?: string;
  };
  readonly fact?: {
    readonly subject: string;
    readonly predicate:
      | "prefers"
      | "works_on"
      | "has_goal"
      | "has_constraint"
      | "decided"
      | "related_to"
      | "owes"
      | "waiting_on"
      | "mentioned_in"
      | "alias_of";
    readonly objectText?: string;
    readonly objectName?: string;
  };
  readonly alias?: {
    readonly alias: string;
    readonly targetName: string;
  };
  readonly provenance: "volunteered" | "inferred";
  readonly confidence: number;
  readonly importance: number;
  readonly sourceExcerpt: string;
  readonly rationale: string;
  readonly isSensitive: boolean;
  readonly supersedesIds?: readonly string[];
}
```

The prompt receives a bounded list of active memory graph items relevant to the thread and recent
turn. The model may reference only those ids in `supersedesIds`; invented ids are ignored.

### 3.4 Candidate store

Create `app.memory_candidates`.

Fields:

- `id`
- `owner_user_id`
- `episode_id`
- `kind`
- `action`
- `payload_json`
- `candidate_signature`
- `status`: `pending | promoted | rejected | merged | suppressed`
- `confidence`
- `importance`
- `provenance`
- `promotion_reason`
- `created_at`, `updated_at`, `resolved_at`

Owner-scoped unique key:

- `(owner_user_id, candidate_signature)` across all statuses.

`candidate_signature` is `sha256` of a normalized tuple:

```text
kind | action | subject-name | predicate | object-name-or-text | alias | target-name
```

Normalization trims whitespace, lowercases, collapses internal whitespace, and omits absent fields
as empty strings.

Rejected/suppressed candidate signatures prevent the same noisy candidate from resurfacing. Inserts
use `ON CONFLICT (owner_user_id, candidate_signature)` and preserve the existing status rather than
creating a new pending row.

### 3.5 Consolidation

The consolidation step runs after extraction and before promotion.

It must:

- normalize names and aliases;
- dedupe by candidate signature;
- match entities by alias/name/kind;
- merge duplicate candidates into one pending/promoted record;
- reject candidates suppressed by prior user rejection;
- ground supersessions to real owner-scoped active memory ids;
- mark conflicting candidates as `pending` unless the user explicitly corrected a known memory.
- mark candidates with ambiguous alias resolution as `pending`.

The consolidation step writes through #528 graph repositories/services, not direct SQL, except for
the candidate store itself.

### 3.6 Promotion Rules

Promote automatically only when the candidate is low-risk:

- explicit memory command from the user: promote volunteered candidates if confidence >= `0.70` and
  the candidate does not conflict with active memory;
- explicit user preference/profile/goal/constraint/decision: promote if confidence >= `0.80`;
- correction of a grounded existing memory id: supersede old memory and promote replacement if
  confidence >= `0.85`;
- alias for an existing entity: promote if confidence >= `0.90`.

Leave pending when:

- provenance is `inferred`;
- `isSensitive` is true;
- confidence is below the relevant threshold;
- candidate conflicts with active memory without a grounded correction;
- candidate would create a commitment/task/reminder. #537 owns commitment actioning.

Pending candidates are not included in core memory or normal recall. #533 will surface them for
review. V1 has no "use pending as weak hints" mode.

## 4. API And Repository Contract

Create `packages/memory/src/candidates-repository.ts` for candidate CRUD.

Minimum methods:

```ts
class MemoryCandidatesRepository {
  insertPending(scopedDb, ownerUserId, input): Promise<MemoryCandidateRecord>;
  markPromoted(scopedDb, ownerUserId, id, reason): Promise<boolean>;
  markRejected(scopedDb, ownerUserId, id, reason): Promise<boolean>;
  findBySignature(scopedDb, ownerUserId, signature): Promise<MemoryCandidateRecord | undefined>;
  listPending(scopedDb, ownerUserId, limit): Promise<MemoryCandidateRecord[]>;
}
```

Create `packages/chat/src/memory-distillation.ts` for the chat-side worker logic:

- `shouldDistillTurn(userText, assistantText): boolean`
- `buildDistillationPrompt(input): string`
- `parseMemoryCandidates(text): MemoryCandidate[]`
- `handleDistillMemoryJob(...)`

Keep parsing and heuristic functions unit-testable without a database.

## 5. Worker Integration

Reuse the current completed-turn trigger in `DataContextChatPersistence.recordTurn`:

- non-incognito turn -> enqueue embed job;
- non-incognito turn -> enqueue distillation job.

The job payload remains metadata-only:

```ts
interface DistillMemoryJobPayload extends ActorScopedJobPayload {
  readonly threadId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string;
}
```

The worker loads exactly those stored messages from the thread under `DataContextDb`. It must not
process "latest turn" by thread alone, because queue lag or rapid user messages can otherwise cause
duplicate processing and missed intermediate turns.

Failures degrade to no-op:

- no model;
- no credential;
- model output is invalid JSON;
- candidate parse returns empty;
- graph service write fails.

Failures log structured metadata only: event name, thread id, error class/message prefix.

## 6. Security And Privacy

- Owner-only FORCE RLS on `memory_candidates`.
- No admin private-data bypass.
- Job payloads contain no chat text or private content.
- Candidate payloads are private owner data and must be included in export/delete.
- Excerpts are bounded and source-backed.
- Do not store secrets from chat, notes, email, calendar, or tasks. The extraction prompt must
  explicitly discard credentials, tokens, passwords, OAuth data, and financial account numbers.
- Treat chat text as user-controlled external content when re-injecting into prompts.
- Do not auto-promote memories from emails, webpages, or notes in this spec. This spec is chat-only.

## 7. Out Of Scope

- Passive retrieval before answer generation (#530).
- Memory dashboard/review UI (#533).
- Full confidence/staleness UX (#532).
- Commitment extraction into tasks/reminders (#537).
- Distillation from notes/email/calendar/tasks.
- Notification or proactive behavior.
- External memory engines.

## 8. Acceptance Criteria

- [ ] Completed non-incognito chat turns create bounded chat episodes or link to existing episodes.
- [ ] Social/noise turns skip model distillation.
- [ ] Meaningful turns produce parsed memory candidates from model JSON.
- [ ] Candidates are deduped and stored in `app.memory_candidates`.
- [ ] Clear volunteered facts can auto-promote into #528 graph memory.
- [ ] Inferred/conflicting/low-confidence candidates remain pending and are excluded from recall.
- [ ] Corrections can supersede grounded owner-scoped memory ids only.
- [ ] Rejected/suppressed candidate signatures do not reappear as pending.
- [ ] Extraction failures never block chat turns.
- [ ] Candidate rows, episodes, and promoted graph memory are owner-scoped under RLS.
- [ ] Export/delete includes candidate rows.

## 9. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:memory
pnpm test:chat
```

Targeted tests:

- `shouldDistillTurn` skips greetings and triggers on memory/decision/preference/correction phrases;
- parser rejects non-JSON and invalid candidate shapes;
- candidate signature dedupes repeated outputs;
- volunteered high-confidence candidate promotes to graph memory;
- inferred candidate remains pending;
- grounded correction supersedes only an owner-scoped active memory id;
- user A cannot read, write, promote, reject, or suppress user B's candidates;
- incognito threads enqueue no distillation work.
