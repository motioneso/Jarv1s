# User-editable Jarvis memory dashboard (#533)

**Status:** Draft
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #533
**Depends on:** #528 Jarvis memory graph substrate, #529 memory distillation pipeline, #532
confidence-aware memory records, #527 `remember_this` pending-candidate flow.
**Related follow-ups:** #537 commitment extraction, #538 person/contact model, #539 source-backed
answers/provenance, #541 data freshness visibility.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-26-jarvis-memory-graph-substrate.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-memory-distillation-pipeline.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-usefulness-feedback-signals.md`,
`~/Jarv1s/apps/web/src/settings/settings-memory-pane.tsx`,
`~/Jarv1s/apps/web/src/api/memory-client.ts`,
`~/Jarv1s/packages/chat/src/routes.ts`,
`~/Jarv1s/packages/memory/src/facts-repository.ts`.

## 1. Problem

Jarvis is about to have a real memory graph, background memory candidates, and confidence/status
metadata. The user still needs one practical place to control that memory.

Today's settings pane only exposes the legacy flat `chat_memory_facts` path:

- remembered facts can be listed and forgotten;
- inferred facts can be confirmed or rejected;
- provenance is thin;
- pending graph-memory candidates from #529 are not reviewable;
- stale, expired, superseded, rejected, and conflicting memory states from #532 have no user-facing
  workflow.

Without a dashboard, safe memory work stalls. Jarvis can extract uncertain candidates, but the user
cannot efficiently accept, correct, reject, expire, supersede, or forget them.

## 2. Decision

Add a **user-editable memory dashboard V1** inside Settings.

The dashboard is a review and correction surface over the existing memory system:

1. pending `app.memory_candidates` from #529;
2. active and historical graph memory records from #528/#532;
3. legacy `app.chat_memory_facts` only through the #532 compatibility adapter until migration is
   complete.

Do not create a second memory store, a dashboard-specific shadow table, or an ontology editor. V1 is
an owner-only operational UI for records Jarvis already stores.

## 3. Current Architecture Anchor

#528 owns graph records, episodes, sources, search documents, recall, remember, supersede, forget,
link, and pin operations.

#529 owns pending candidate creation, candidate signatures, dedupe, promotion, rejection, merge, and
suppression semantics.

#532 owns confidence tiers, record kind, lifecycle status, stale/expired/superseded/conflicting
semantics, correction and status routes, and answer phrasing.

The existing web anchor is `apps/web/src/settings/settings-memory-pane.tsx`. #533 should replace or
extend that pane rather than introducing a separate top-level app area.

## 4. Dashboard Model

Create a memory-owned dashboard DTO assembled from existing records:

```ts
type MemoryDashboardItemKind = "candidate" | "fact" | "entity";

interface MemoryDashboardItem {
  readonly itemKind: MemoryDashboardItemKind;
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly recordKind?: MemoryRecordKind;
  readonly entityKind?: MemoryEntityKind;
  readonly status: MemoryRecordStatus | MemoryCandidateStatus | MemoryEntityStatus;
  readonly confidence?: number;
  readonly confidenceTier?: MemoryConfidenceTier;
  readonly provenance?: "volunteered" | "inferred" | "confirmed" | "imported";
  readonly sourceSummary: string;
  readonly sourceKind: "chat" | "note" | "task" | "email" | "calendar" | "manual";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly staleAt?: string | null;
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly conflictGroupId?: string | null;
  readonly supersededByFactId?: string | null;
  readonly pinned?: boolean;
  readonly editableFields: readonly MemoryEditableField[];
}

type MemoryEditableField =
  | "summary"
  | "recordKind"
  | "entityName"
  | "entitySummary"
  | "validFrom"
  | "validTo"
  | "staleAt"
  | "pinned";
```

Rules:

- The DTO is not persisted.
- `fact` items represent `app.memory_facts`; `entity` items represent `app.memory_entities`;
  `candidate` items represent `app.memory_candidates`.
- `sourceSummary` is a short source label such as `Chat: House planning`, `Manual`, or
  `Email: sender / subject`.
- Entity rows do not invent confidence or lifecycle fields from facts. They use #528 entity status
  (`active | archived | merged`) and expose only entity name/summary/kind plus source summaries
  derived from linked facts, aliases, and episodes.
- Do not expose raw private source ids in the DTO.
- Do not include full email bodies, full note contents, prompt text, secrets, tokens, connector
  credentials, or raw tool payloads.
- Confidence is displayed; users do not edit numeric confidence directly in V1. Confirm/correct
  flows update confidence deterministically through #532.

## 5. API

Add memory-owned self routes:

- `GET /api/memory/dashboard`
- `POST /api/memory/candidates/:id/accept`
- `POST /api/memory/candidates/:id/reject`
- `POST /api/memory/candidates/:id/suppress`
- `PATCH /api/memory/graph/facts/:id`
- `POST /api/memory/graph/facts/:id/correct`
- `POST /api/memory/graph/facts/:id/confirm`
- `POST /api/memory/graph/facts/:id/status`
- `POST /api/memory/graph/facts/:id/mark-stale`
- `POST /api/memory/graph/facts/:id/pin`
- `DELETE /api/memory/graph/facts/:id`
- `PATCH /api/memory/graph/entities/:id`
- `DELETE /api/memory/graph/entities/:id`

`GET /api/memory/dashboard` accepts:

```ts
interface MemoryDashboardQuery {
  readonly status?:
    | "pending"
    | "promoted"
    | "merged"
    | "active"
    | "archived"
    | "stale"
    | "expired"
    | "superseded"
    | "rejected"
    | "suppressed"
    | "conflicting"
    | "history"
    | "inactive"
    | "all";
  readonly recordKind?: MemoryRecordKind;
  readonly sourceKind?: "chat" | "note" | "task" | "email" | "calendar" | "manual";
  readonly q?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
```

Defaults:

- `status = "pending"` for the review queue tab;
- `status = "active"` for the memory records tab, where dashboard `active` means active usable
  memory plus `stale` and `conflicting` records that need user attention;
- `limit = 50`;
- hard maximum limit: 100.

The route returns counts by status plus one page of items:

```ts
interface MemoryDashboardResponse {
  readonly counts: Record<string, number>;
  readonly items: readonly MemoryDashboardItem[];
  readonly nextCursor?: string;
}
```

All routes run under `DataContextDb` with `AccessContext.actorUserId`. No route accepts an owner id
from the client.

Route alignment:

- Fact correction, confirmation, stale/status, pin, and forget reuse the #528/#532 graph fact route
  family.
- Dashboard-specific fact edits use `PATCH /api/memory/graph/facts/:id` only for bounded lifecycle
  metadata:

```ts
interface PatchMemoryFactDashboardRequest {
  readonly validFrom?: string | null;
  readonly validTo?: string | null;
  readonly staleAt?: string | null;
  readonly pinned?: boolean;
}
```

- Summary or `recordKind` changes are corrections, not in-place edits. They call
  `POST /api/memory/graph/facts/:id/correct` and create a replacement fact as #532 requires.
- If a lifecycle patch changes whether the fact is active, stale, or expired, the handler updates
  the associated `app.memory_search_documents` row in the same transaction.
- Entity edits use `PATCH /api/memory/graph/entities/:id`:

```ts
interface PatchMemoryEntityDashboardRequest {
  readonly name?: string;
  readonly summary?: string | null;
  readonly status?: "active" | "archived";
}
```

- Entity merge is out of scope for V1.
- Entity forget uses `DELETE /api/memory/graph/entities/:id`, backed by the #528 memory forget
  target. If any fact, active or inactive, still references the entity, the route returns 409 with a
  safe summary so the user can handle those facts first.
- Entity archive returns 409 when active facts still reference the entity.
- The singleton `self` entity cannot be archived or forgotten. Entity PATCH/DELETE routes reject
  those operations with 403.

## 6. Candidate Review

Pending candidates appear in a "Review queue" section.

Actions:

- **Accept:** promote the candidate through the #529/#528 memory service.
- **Edit and accept:** promote corrected user-provided fields while preserving the original
  candidate as evidence.
- **Reject:** mark the candidate `rejected`; the same candidate signature should not reappear as
  pending.
- **Suppress similar:** mark the candidate `suppressed`; use this only when the user indicates this
  class of inference should stop resurfacing.

Candidate action payloads:

```ts
interface AcceptMemoryCandidateRequest {
  readonly edited?: {
    readonly summary?: string;
    readonly recordKind?: MemoryRecordKind;
    readonly validFrom?: string | null;
    readonly validTo?: string | null;
    readonly staleAt?: string | null;
    readonly pinned?: boolean;
    readonly entityName?: string;
    readonly entitySummary?: string | null;
  };
  readonly resolveConflictWithFactId?: string | null;
  readonly supersedeFactIds?: readonly string[];
}

interface RejectMemoryCandidateRequest {
  readonly reason?: string;
}

interface SuppressMemoryCandidateRequest {
  readonly reason?: string;
}
```

Accept rules:

- Accept promotes exactly one owner-scoped candidate.
- Accept is a user confirmation. The promoted active fact uses `provenance = "confirmed"`,
  `last_confirmed_at = now()`, and `confidence >= 0.90` whether or not the user edited fields.
- Structured #529 candidates promote through the normal candidate promotion service.
- Manual/unstructured candidates from #527 `remember_this` do **not** call structured promotion
  directly. They use a memory-owned manual remember helper that creates a valid graph fact with:
  - subject: the owner's `self` entity;
  - predicate mapped from selected `recordKind` (`preference -> prefers`, `goal -> has_goal`,
    `constraint -> has_constraint`, `decision -> decided`, everything else -> related_to);
  - object text: the reviewed memory statement;
  - confirmed provenance/confidence from the Accept action;
  - source links to the original candidate episode when present;
  - a lazily created `manual` dashboard-review episode when the original candidate has
    `episode_id = null` or when the user edits before accepting.
- If a manual candidate cannot produce non-empty object text after review, Accept is disabled and
  the route returns 400.
- If the candidate conflicts with active memory, accepting it must call the #532 correction/conflict
  path instead of silently creating another active fact.
- If the candidate action is `supersede`, the referenced `supersedeFactIds` must resolve to
  owner-scoped active records or the route returns 409.
- Acceptance updates graph search documents in the same transaction as promotion.

Edit-and-accept rules:

- Editable fields are bounded to `summary`, `recordKind`, `validFrom`, `validTo`, `staleAt`, and
  `pinned` for fact candidates, and `entityName`/`entitySummary` for entity candidates.
- The user edits natural-language memory text and lifecycle fields, not graph predicates, entity
  ids, raw source ids, or candidate signatures.
- The promoted fact links to the original episode/source when present and a `manual` episode noting
  that the user edited the candidate in the dashboard.
- The active memory text stores the edited version; the candidate record keeps its original payload
  and is marked `promoted` with `promotion_reason = "user-edited"`.
- Unknown top-level edit fields are rejected.

Repository addition:

```ts
class MemoryCandidatesRepository {
  markSuppressed(scopedDb, ownerUserId, id, reason): Promise<boolean>;
}
```

This extends #529's candidate repository contract; it does not introduce a new store.

Reject/suppress rules:

- Reject and suppress are terminal for that candidate row.
- Reject/suppress never deletes source episodes.
- Reject/suppress do not delete active memory records; conflicts with active memory must use record
  correction flows.

## 7. Active Memory Review

Active and historical graph records appear in a "Memory records" section.

Actions:

- **Confirm:** call #532 confirm; set provenance/last-confirmed metadata and raise confidence
  deterministically.
- **Correct:** replace the memory text with a corrected value, superseding the old fact.
- **Mark stale:** set `status = "stale"` and `stale_at = now()`.
- **Expire:** set `status = "expired"` and `valid_to` when provided.
- **Supersede:** create a replacement fact and mark the old one `superseded`.
- **Forget:** call the #528 memory forget service for the selected record.
- **Pin/unpin:** call the #528 pin operation.

Rules:

- Correct and supersede are the same backend operation with different UI labels. Use one memory
  service path.
- Forget is destructive and shows a confirmation dialog.
- Confirm does not require a dialog.
- Stale/expire/supersede keep history; they do not erase records.
- Generic status changes reject records with an open `conflict_group_id`. Conflicts must be resolved
  by confirm or correct as #532 specifies.
- Historical records (`expired`, `superseded`, `rejected`) are hidden from the default active tab but
  available through filters.
- Forgetting a conflicting fact updates the conflict group in the same transaction. If only one
  sibling fact remains, clear the sibling's `conflict_group_id`, set its status back to `active`,
  mark the group `resolved`, and update sibling search documents.

## 7.1 Entity Review

Entity records appear in the same Memory records section when they are active graph nodes.

Actions:

- **Edit name/summary:** update bounded entity fields only.
- **Archive:** set entity status to `archived` when no active fact requires it for normal recall.
- **Forget:** call the #528 memory forget target for the entity.

Rules:

- V1 does not expose predicate, relationship, or alias graph editing.
- The `self` singleton entity is read-only for archive/forget. It stays visible as context, but the
  dashboard does not offer destructive actions for it.
- Forgetting an entity with any linked facts, active or inactive, returns 409 instead of orphaning
  facts or deleting historical evidence.
- Archiving an entity with active linked facts returns 409.
- Entity aliases may be shown as read-only context. Alias editing belongs to #538 unless a later
  implementation proves the small bounded edit is necessary for this dashboard.
- Entity rows are owner-only and use owner-scoped composite relationships where applicable.

## 8. UI

Use the existing Settings shell and authored design system:

- route: existing Memory & context settings pane;
- typography, colors, radius, focus rings, and empty states use existing `jds-*` and settings
  primitives;
- icon buttons use lucide icons with accessible labels;
- no nested cards inside cards.

V1 layout:

- header: memory controls already present today, plus compact counts;
- tabs: `Review queue`, `Memory records`, `History`;
- filters: status, kind, source, search;
- item rows show statement, kind, confidence tier, status, provenance, source summary, and last
  update;
- detail drawer/modal for edit, source summary, lifecycle timestamps, conflict/supersession details,
  and actions.

Text rules:

- Use #532 status and confidence terms: confirmed, high, medium, low, stale, expired, superseded,
  rejected, conflicting.
- Do not add citation-card UI or answer provenance UI here. The dashboard may show a compact source
  summary for memory review only; #539 owns answer provenance.
- Do not add generic data freshness labels beyond memory lifecycle state; #541 owns freshness
  visibility.

## 9. Search And Filtering

Dashboard search is for memory management, not model recall.

Rules:

- For graph records, `q` uses the existing memory search-document path from #528.
- For pending candidates, `q` uses a bounded case-insensitive filter over memory-owned candidate
  payload fields. Candidates are not added to `app.memory_search_documents` in V1.
- Search remains owner-scoped before ranking.
- Dashboard `status = "active"` is a composite display filter that returns active, stale, and
  conflicting records. Use `status = "all"` or `status = "history"` for exhaustive/history review.
- Default ordering:
  1. pending candidates first in the review queue;
  2. conflicting records;
  3. stale records;
  4. active high-confidence records;
  5. newest updated records.
- Candidate search is review tooling, not hybrid recall ranking; candidate matches sort after
  pending/conflict/stale priority and then by `updatedAt`.
- Search must not query notes, email, calendar, tasks, or source-owned tables directly. Source
  evidence summaries come from memory episodes/source links.

Status shortcuts:

- `history` and `inactive` both return inactive/historical items only: `expired`, `superseded`,
  `rejected`, `suppressed`, `archived`, and `merged`.
- `all` returns every dashboard item, including pending and active records, and is for debugging or
  exhaustive review only.

## 10. Privacy, Safety, And Auditability

- Owner-only FORCE RLS on memory tables and candidate tables.
- No admin private-data bypass.
- All API routes use `DataContextDb`; no root Kysely in memory dashboard paths.
- Dashboard DTOs never include secrets, credentials, tokens, full source payloads, prompts, or raw
  connector data.
- Logs include actor id, operation, memory id/candidate id, status transition, duration, and error
  class only. Never log memory text or source excerpts.
- Forget/delete operations must update or remove search documents in the same transaction.
- Candidate review and record edits must preserve export/delete coverage from #528/#529/#532.

## 11. Out Of Scope

- Source-backed answer citation UI (#539).
- Data freshness badges for answers or connected-source caches (#541).
- Full ontology/entity relationship editor.
- Cross-user or shared memory.
- Bulk memory import/export UI.
- Model-based truth adjudication.
- Editing source notes, emails, calendar events, or tasks from the memory dashboard.
- A separate mobile-specific memory app.

## 12. Acceptance Criteria

- [ ] Settings exposes one Memory & context dashboard for pending candidates and graph memory
      records.
- [ ] The dashboard lists #529 pending candidates and #528/#532 active graph records without a
      second memory store.
- [ ] Entity records are visible, editable only by bounded name/summary fields, and forgettable only
      without orphaning any linked facts.
- [ ] Items show record kind, status, confidence tier, numeric confidence, provenance, source
      summary, stale/expired/superseded/conflict state, and timestamps.
- [ ] Pending candidates can be accepted, edited-and-accepted, rejected, or suppressed.
- [ ] Accepted candidates promote through memory-owned graph services and preserve source evidence.
- [ ] Manual `remember_this` candidates accept through the manual remember helper and cannot create
      malformed graph facts.
- [ ] Accepted candidates become confirmed memory with confidence at least `0.90`.
- [ ] Manual candidate accept creates a manual episode when the source candidate has no episode.
- [ ] Active records can be confirmed, corrected/superseded, marked stale, expired, forgotten, and
      pinned/unpinned.
- [ ] Conflict records can be resolved only through confirm or correct, not generic status patching.
- [ ] The dashboard defaults to owner-only records and user A cannot view or mutate user B's memory.
- [ ] The UI preserves the authored settings/design-system conventions.
- [ ] No dashboard DTO, log, or job payload contains full source bodies, secrets, prompts, tokens, or
      connector credentials.

## 13. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:memory
pnpm test:chat
pnpm test:web
pnpm test:api
```

Targeted tests:

- dashboard route returns pending candidates and active memory records for the actor only;
- filters by status, kind, source, and search query, including `suppressed` candidate history;
- candidate accept promotes one owner-scoped candidate and marks it promoted;
- manual candidate accept creates a valid `self -> predicate -> object_text` graph fact;
- accepted candidates become confirmed memory with confidence at least `0.90`;
- manual candidate accept creates a manual episode when the source candidate has no episode;
- edit-and-accept promotes edited text and keeps original source evidence;
- candidate reject preserves the rejected signature and does not create active memory;
- suppress prevents the same noisy signature from resurfacing as pending;
- confirm raises confidence and sets `last_confirmed_at`;
- correct/supersede creates a replacement and updates search documents transactionally;
- lifecycle PATCH updates search documents transactionally when timestamps change active/stale/
  expired eligibility;
- mark stale keeps the record searchable for explicit stale/history queries;
- expire excludes the record from normal recall;
- forget removes/deactivates the record and search document for the owner only;
- entity forget returns 409 while any active or inactive fact still references the entity;
- self entity archive/forget is rejected;
- deleting one conflicting fact resolves the conflict group when only one sibling remains;
- generic status route rejects open conflict-group records;
- UI renders empty review queue, active list, history filters, and destructive confirmation states;
- dashboard output never includes raw source ids or full source bodies.
