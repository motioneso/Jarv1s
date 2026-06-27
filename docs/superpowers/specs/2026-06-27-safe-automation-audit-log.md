# Safe automation audit log for Jarvis actions (#540)

**Status:** RFA - AGY review passed
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #540
**Depends on:** #527 usefulness feedback signals, #531 restrained proactive monitoring, #534
explicit action permission tiers, #535 long-running Jarvis goals, #536 scheduled recurring
briefings, #537 automatic commitment extraction, #538 unified person/contact model.
**Related follow-ups:** #539 source-backed answer provenance, #541 data freshness visibility.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-usefulness-feedback-signals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-restrained-proactive-monitoring.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-explicit-action-permission-tiers.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-long-running-jarvis-goals.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-scheduled-recurring-jarvis-briefings.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-automatic-commitment-extraction.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-person-contact-model.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-source-backed-jarvis-answers-provenance.md`,
`~/Jarv1s/packages/ai/src/gateway/gateway.ts`, `~/Jarv1s/packages/ai/src/repository.ts`,
`~/Jarv1s/packages/ai/sql/0016_ai_assistant_actions.sql`.

## 1. Problem

Jarvis can already propose or run some actions through the assistant gateway, and adjacent specs add
proactive cards, scheduled briefings, commitment candidates, person match candidates, and goals.
Those events need a safe owner-facing trail.

The user should be able to ask or inspect:

- "What did Jarvis do today?"
- "What did it suggest and what did I reject?"
- "Which actions ran automatically because I trusted that family?"
- "Why is this commitment/person/goal item here?"

The risky version is a raw application log viewer. That would expose payloads, prompts, connector
data, and source bodies. V1 should be a bounded product audit log: enough metadata to explain
Jarvis decisions, never enough to become a second source store or action executor.

## 2. Decision

Add a **safe automation audit log V1**.

V1 is one append-only owner-scoped event ledger plus a read UI/API/tool. It records metadata-only
events for:

- assistant tool proposals;
- approvals, denials, cancellations, and stale expirations;
- trusted auto-runs;
- destructive confirmations;
- proactive suggestion/card creation and dismissal;
- scheduled briefing suggestion/run creation;
- commitment candidate and person match status transitions;
- goal suggestion/review transitions when #535 emits them;
- feedback-driven decisions from #527 when they affect future surfacing.

V1 does not execute actions, grant permissions, or replace `app.ai_assistant_action_requests`.
Existing gateway/action-request tables remain the source of truth for confirmation state.

## 3. Current Architecture Anchor

Relevant seams:

- `AssistantToolGateway.callTool()` already routes tools through `resolvePolicy()`.
- `AssistantToolGateway.confirmAndRun()` creates `app.ai_assistant_action_requests` for approval
  cards.
- `app.ai_assistant_action_requests` is owner-scoped and stores tool module/name, risk, status,
  input summary, request id, requested/resolved timestamps.
- #534 defines action permission tiers and keeps destructive/external-send actions on an
  always-confirm floor.
- #531 proactive cards are suggestions only.
- #536 scheduled briefings may suggest actions but do not execute them.
- #537 commitment candidates write metadata-only candidate events.
- #538 person context writes metadata-only person events.

#540 should make those events inspectable through one product surface. It must not add another
executor or let modules bypass the assistant gateway.

## 4. Audit Event Model

Add `app.jarvis_automation_audit_events`.

Core fields:

- `id uuid primary key`
- `owner_user_id uuid not null`
- `event_kind text not null`
- `surface text not null`
- `actor_kind text not null`
- `status text not null`
- `tool_module_id text null`
- `tool_name text null`
- `action_family_id text null`
- `permission_tier text null`
- `risk text null`
- `source_kind text null`
- `target_kind text null`
- `target_ref_hash text null`
- `target_label text null`
- `reference_key text null`
- `reference_key_redaction_pending boolean not null default false`
- `related_action_request_id uuid null`
- `related_event_id uuid null`
- `source_event_kind text null`
- `source_event_ref_hash text null`
- `reason_code text null`
- `confidence_tier text null`
- `occurred_at timestamptz not null`
- `metadata_json jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

Allowed event kinds:

```ts
type AutomationAuditEventKind =
  | "tool_proposed"
  | "tool_approved"
  | "tool_denied"
  | "tool_cancelled"
  | "tool_expired"
  | "trusted_auto_ran"
  | "tool_run_failed"
  | "destructive_confirmed"
  | "suggestion_created"
  | "suggestion_dismissed"
  | "candidate_created"
  | "candidate_status_changed"
  | "scheduled_run_created"
  | "feedback_recorded";
```

Allowed surfaces:

```ts
type AutomationAuditSurface =
  | "chat"
  | "today"
  | "briefing"
  | "proactive"
  | "commitments"
  | "people"
  | "goals"
  | "settings"
  | "worker";
```

Allowed actor kinds:

```ts
type AutomationAuditActorKind = "jarvis" | "user" | "system";
```

Allowed status values:

```ts
type AutomationAuditStatus =
  | "proposed"
  | "approved"
  | "denied"
  | "cancelled"
  | "expired"
  | "ran"
  | "failed"
  | "created"
  | "dismissed"
  | "changed"
  | "recorded";
```

Rules:

- RLS is owner-only with FORCE RLS.
- Runtime app and worker roles do not bypass RLS.
- Audit rows are append-only. No route updates or deletes individual rows in V1.
- `related_action_request_id` may point to `app.ai_assistant_action_requests(id)` when the event is
  about a confirmation request.
- `reference_key` is an opaque source-owned verifier key for later dereference. It is not an auth
  token, not a bearer capability, and not returned by list/detail APIs. A leaked key is not
  sufficient to open a source because providers must re-check ownership under the authenticated
  actor's `DataContextDb`.
- `target_ref_hash` and `source_event_ref_hash` are hashes only, never raw source ids.
- `target_label` is a bounded display label, max 200 characters.
- `metadata_json` is metadata only, max 2 KB serialized, with string values capped at 200
  characters.
- Store no raw action inputs, prompts, source bodies, connector payloads, secrets, auth tokens, full
  summaries, raw tool outputs, or raw source refs.
- Export/delete includes audit rows.

Allowed `metadata_json` top-level keys:

```ts
type AutomationAuditMetadataKey =
  | "eventKey"
  | "inputHash"
  | "targetHash"
  | "signalType"
  | "briefingType"
  | "runKind"
  | "sourceCount"
  | "gapCount"
  | "candidateKind"
  | "oldStatus"
  | "newStatus"
  | "suggestedHandling"
  | "resolutionKind"
  | "personEventKind"
  | "goalStatusFrom"
  | "goalStatusTo"
  | "feedbackKind"
  | "suppressionReason"
  | "sourceEventCount"
  | "errorClass";
```

Metadata rules:

- Unknown top-level keys are rejected.
- Nested objects and arrays are rejected.
- Public API metadata responses use the same key allowlist except `eventKey`, `inputHash`,
  `targetHash`, and `sourceEventCount`, which remain internal.
- Hash fields must be irreversible digests formatted as `sha256:<64 lowercase hex chars>`.
- `eventKey` must be a namespaced idempotency key made from non-secret ids/hashes, max 160
  characters. Format:
  `<namespace>:sha256:<64 lowercase hex chars>`, where namespace matches
  `^[a-z][a-z0-9_-]{1,40}$`. Example:
  `gateway:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`.
  The writer enforces this and the SQL migration should add a matching `CHECK` on
  `metadata_json->>'eventKey'` when present.
- `sourceEventCount` must be an integer JSON number from 0 through 10,000; fractional values reject
  the audit event. Out-of-range values reject the audit event; never clamp.
- Enum-like string values must match the event's declared enum vocabulary or a source-specific
  reason-code allowlist.
- Reject strings that look like raw UUID refs, email addresses, absolute URLs, filesystem paths,
  connector ids, JSON blobs, or prompt/source excerpts unless the field is a declared hash field.

SQL checks:

- If `metadata_json ? 'eventKey'`, it must match the `eventKey` format above.
- A row must have at least one idempotency anchor:
  `related_action_request_id IS NOT NULL`, `source_event_ref_hash IS NOT NULL`, or
  `metadata_json ? 'eventKey'`.
- If `metadata_json ? 'sourceEventCount'`, it must be an integer JSON number from 0 through 10,000.

## 5. Event Writer Contract

Create one small audit writer service, likely in the AI package because the assistant gateway owns
the primary action path.

```ts
interface AutomationAuditWriter {
  record(scopedDb: unknown, input: AutomationAuditEventInput): Promise<void>;
  redactReferenceKey(
    scopedDb: unknown,
    input: AutomationAuditReferenceRedactionInput
  ): Promise<void>;
}
```

Rules:

- The writer requires `DataContextDb`.
- The writer derives `owner_user_id` from `app.current_actor_user_id()`.
- Callers pass bounded metadata only.
- The writer validates enum fields, the `metadata_json` key/value rules above, size caps, string
  caps, and absence of raw refs before insert.
- The writer truncates `target_label` to 200 characters before insert. Metadata string values over
  their cap reject the audit event; they are not truncated because those values often encode enums or
  hashes.
- If audit insert fails, the owning operation keeps its existing behavior and logs metadata only.
  Audit failure must not block chat, task mutation, proactive cards, scheduled briefings, or
  candidate review.
- Status-changing operations write audit rows in the same `DataContextDb` transaction as the
  source-of-truth mutation when the source and audit table live in the same database. The writer
  validates before SQL, then performs `INSERT ... ON CONFLICT DO NOTHING` inside an audit savepoint.
  If the insert fails, it rolls back to the savepoint, logs metadata only, and the primary
  transaction continues.
- Audit savepoint names must be unique per writer invocation, such as
  `jarvis_audit_<16 lowercase hex chars>`, using at least 8 random bytes encoded as lowercase hex,
  so nested callers cannot collide without quoted identifiers.
- Operations without an existing transaction call the writer in its own short transaction after the
  primary operation succeeds. Those callers must provide `metadata_json.eventKey` so duplicate
  retries remain idempotent and the SQL idempotency-anchor check is satisfied.

Duplicate prevention:

- For `related_action_request_id` events, enforce at most one audit event per owner/action request
  and event kind.
- Before storing a `related_action_request_id`, load that action request under the actor's
  `DataContextDb`; missing or non-owned requests fail audit insertion without affecting the primary
  operation.
- For source module events, callers provide `source_event_ref_hash`; enforce at most one audit event
  per owner/source event hash/event kind.
- Repeated failed inserts on duplicate keys are treated as success.
- The writer rejects `trusted_auto_ran` when `risk = "destructive"` or when metadata marks the
  action as an external send.
- `redactReferenceKey` is the only V1 mutation path for existing audit rows. Source modules call it
  when they hard-delete the source object located by a stored `reference_key`; it sets
  `reference_key = null` and `reference_key_redaction_pending = false` for matching
  owner/source/target hashes and leaves all other event metadata intact. When the hard delete and
  audit table are in the same database, this runs in the same `DataContextDb` transaction.
- If a source cannot null `reference_key` in the same transaction, it must first set
  `reference_key_redaction_pending = true` before the source hard-delete commits. Dereference treats
  pending rows as unavailable. If the source cannot mark pending, the hard-delete fails closed
  instead of leaving an active locator key: API routes return an error and roll back the source
  deletion; worker jobs fail/retry without deleting the source object.
- Cross-database cleanup jobs carry only actor id, source kind, target/source event hashes, reason,
  and idempotency key. They retry at most 10 times with exponential backoff. After the final failure,
  the row remains `reference_key_redaction_pending = true`, dereference stays unavailable, and the
  failure emits a metadata-only operational alert.

## 6. Gateway Events

The assistant gateway must emit audit events without changing execution policy.

Event mapping:

| Gateway moment                         | Event kind               | Status     |
| -------------------------------------- | ------------------------ | ---------- |
| Confirmation request created           | `tool_proposed`          | `proposed` |
| User approves request                  | `tool_approved`          | `approved` |
| User denies request                    | `tool_denied`            | `denied`   |
| Pending request cancelled/stale        | `tool_cancelled/expired` | matching   |
| Approved destructive request executes  | `destructive_confirmed`  | `ran`      |
| Trusted auto write runs without prompt | `trusted_auto_ran`       | `ran`      |
| Tool handler fails                     | `tool_run_failed`        | `failed`   |

Rules:

- `tool_proposed` links to `app.ai_assistant_action_requests.id`.
- `tool_approved`, `tool_denied`, `tool_cancelled`, and `tool_expired` link to the same action
  request.
- `trusted_auto_ran` is created only for write tools that ran without an approval card because #534
  resolved the family as `trusted_auto`.
- Before any trusted-auto execution, the gateway asserts the tool risk is `write`, not
  `destructive`, and that the tool is not an external-send action. If that assertion fails, the
  gateway routes to confirmation or rejects the policy result before invoking the audit writer.
- Destructive tools always go through confirmation. A destructive run event records
  `permission_tier = "always_confirm"` regardless of stale preferences.
- Gateway events store tool module id, tool name, risk, action family id when present, permission
  tier, status, request id, and timestamps.
- Gateway write/destructive events store an input hash or bounded target hash when available, not
  raw action input and not `input_summary`. Read-tool calls and read-tool failures are not audit
  events in V1.
- Logging an audit event must not make `resolvePolicy()` more permissive.

## 7. Source And Suggestion Events

Modules that create action-like decisions emit audit events through the writer.

### 7.1 Proactive Cards (#531)

Record:

- card created: `suggestion_created`;
- card dismissed through #527 feedback: `suggestion_dismissed`;
- card suppressed by anti-spam or repeated feedback: `candidate_status_changed` or
  `feedback_recorded` with a source-specific reason code.

Rules:

- Store source, signal type in `metadata_json.signalType`, priority/confidence tier, and target hash.
- Do not store card summary text beyond bounded `target_label`.
- Do not execute actions from audit rows.

### 7.2 Scheduled Briefings (#536)

Record:

- scheduled briefing run created: `scheduled_run_created`;
- generated briefing suggestion/action text, if made structured later: `suggestion_created`.

Rules:

- Store definition id hash, run id hash, briefing type, run kind, and source count/gap count.
- Do not store summary text, prompt text, source content, or action inputs.
- Briefing suggestions remain text/proposals. Execution routes through the gateway and #534.

### 7.3 Commitment Candidates (#537)

Record:

- candidate created: `candidate_created`;
- accept/reject/suppress/resolve/expire transitions: `candidate_status_changed`.

Rules:

- Link to #537 `app.commitment_candidate_events` through `source_event_ref_hash`.
- Store candidate kind, old/new status, suggested handling, resolution kind, confidence tier, and
  target hash when present.
- Do not store candidate title, summary, evidence excerpt, resolution ref, or source ref.

### 7.4 Person Context (#538)

Record:

- match candidate created/reopened: `candidate_created`;
- accept/reject/suppress transitions: `candidate_status_changed`;
- merge/split confirmations: `destructive_confirmed` after the existing always-confirm path.

Rules:

- Link to #538 `app.person_context_events` through `source_event_ref_hash`.
- Store event kind, candidate kind, confidence tier, target hashes, and reason code.
- Do not store raw names, emails, aliases, source refs, or relationship summaries.
- Merge/split emits one `destructive_confirmed` audit row per user-confirmed operation, not one per
  affected person event. `source_event_ref_hash` is the hash of the merge/split operation id, and
  `metadata_json.sourceEventCount` may record how many person-context event rows were produced.
  The detailed per-identity/person events remain in #538's event ledger.

### 7.5 Goals (#535)

Record:

- suggested goal action created: `suggestion_created`;
- goal evidence/status suggestion accepted/rejected through a review flow:
  `candidate_status_changed`;
- goal write tool execution through gateway: gateway events, not a second goal-specific execution
  path.

Rules:

- Goal audit rows may store goal id hash, status transition, and action family.
- Do not store goal summaries, blockers, desired outcome, or next-action text in audit metadata.

### 7.6 Feedback (#527)

Record `feedback_recorded` only when feedback changes later surfacing or suppression behavior, such
as dismissing a proactive card or repeated `too_much` reducing a source cap.

Do not record every ordinary "more like this" click in the automation audit unless it changes a
decision. The feedback ledger remains the detailed source of truth for feedback rows.

## 8. Reference Providers

The audit UI may need to open a related source. It does so through source-owned reference providers.

```ts
interface AutomationAuditReferenceProvider {
  readonly sourceKind: string;
  readonly deepLinkPrefixes: readonly string[];
  dereferenceAuditTarget(
    scopedDb: unknown,
    input: {
      readonly ownerUserId: string;
      readonly referenceKey: string;
    }
  ): Promise<AutomationAuditReference | null>;
}

interface AutomationAuditReference {
  readonly verifiedOwnerUserId: string;
  readonly label: string;
  readonly deepLinkPath?: string;
  readonly unavailableReason?: "missing" | "permission" | "source_unavailable";
}
```

Rules:

- Providers run under `DataContextDb`.
- Providers query only their owning module tables.
- The central audit layer never queries source tables directly.
- API list/detail responses omit `referenceKey`.
- Dereference routes read `reference_key` only from the server-side audit row, never from a client
  payload, and pass the authenticated actor id, never an owner id from stored metadata.
- Providers must treat `referenceKey` as a locator only. They must load the target under the actor's
  `DataContextDb` and verify ownership/permission before returning a link.
- Providers return `verifiedOwnerUserId` from the loaded source row or source-owned reference row.
  The central route suppresses any provider result whose `verifiedOwnerUserId` does not equal the
  authenticated actor id before validating or logging `deepLinkPath`. This field is internal and is
  not returned to the client.
- `deepLinkPath` must be an internal app path validated by the central route: starts with `/`, not
  `//`, no URI scheme, and allowed by a registered route prefix.
- Each source provider owns its `deepLinkPrefixes` in its module manifest. Prefixes are statically
  registered at application boot from active module manifests; changing prefixes requires the normal
  deploy/restart path. Composition validation fails boot on malformed prefixes, duplicate provider
  source kinds, overlapping prefixes between providers, admin-only prefixes, or otherwise
  owner-inaccessible route prefixes. The central audit route validates returned paths against the
  provider's registered prefixes. Prefixes are normalized by removing trailing slashes except `/`;
  prefix A overlaps prefix B when A equals B, A is a path-prefix of B, or B is a path-prefix of A
  after normalization, for example `/goals` overlaps `/goals/archived`.
- Reference keys should be versioned by the source module, for example
  `<source>:v1:<opaque-value>`. If a provider's locator scheme is retired or found too broad, that
  provider rejects the old version and dereference returns unavailable. Audit rows remain as bounded
  event history; source links simply stop opening.

## 9. API And Assistant Tool

Add owner-scoped routes:

- `GET /api/me/jarvis-audit-events`
- `GET /api/me/jarvis-audit-events/:id`
- `GET /api/me/jarvis-audit-events/:id/dereference`

List query:

```ts
interface AutomationAuditQuery {
  readonly eventKind?: AutomationAuditEventKind;
  readonly surface?: AutomationAuditSurface;
  readonly status?: AutomationAuditStatus;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
```

Rules:

- Default `since` is 30 days ago.
- Default `limit` is 50; hard max is 100.
- `since` and `until` filter `occurred_at`; omitted `until` is open-ended through now. Results order
  by `occurred_at desc, created_at desc`.
- List/detail responses omit `referenceKey`, raw source refs, raw hashes that are only useful for
  internal joins, and raw metadata keys not on the public allowlist.
- Detail response can show module id, tool name, risk, action family, permission tier, event kind,
  status, surface, bounded target label, timestamps, and safe reason code.
- No write route exists in V1.

Add a read assistant tool:

| Tool               | Risk   | Purpose                                                |
| ------------------ | ------ | ------------------------------------------------------ |
| `audit.listRecent` | `read` | answer "what did Jarvis do/suggest/decide recently?"   |
| `audit.getEvent`   | `read` | inspect one bounded audit event without raw references |

Tool rules:

- Return bounded metadata only.
- Do not return `referenceKey`, raw hashes, raw action inputs, source text, prompts, or tool
  outputs.
- Assistant answers that cite source evidence use #539 provenance, not audit event internals.

## 10. UI

Add a compact "Jarvis activity" surface, likely under Settings or Activity.

V1 layout:

- timeline grouped by local day;
- filters for tool actions, suggestions, candidates, scheduled runs, feedback, and failures;
- row fields: event label, surface, module/source, status, risk/tier when relevant, target label,
  occurred time;
- detail drawer with safe metadata and an "Open related item" action when dereference succeeds.

UI rules:

- This is not a raw log viewer.
- Do not show raw action inputs, prompts, source bodies, full summaries, connector payloads, raw
  source refs, auth tokens, secrets, or raw tool outputs.
- Do not show answer source cards here. #539 owns answer provenance UI.
- Do not show stale/sync freshness warnings here. #541 owns freshness visibility.
- Destructive/external-send rows must visually show that they required confirmation.
- Trusted-auto rows must show the action family/tier that allowed the run.

## 11. Privacy, Safety, And Auditability

- Audit rows are owner-only with FORCE RLS.
- No admin private-data bypass.
- Runtime roles do not get `BYPASSRLS`.
- Job payloads never carry audit row content; source jobs write audit rows only after loading source
  state under `DataContextDb`.
- Audit rows may store hashes, ids of owner-scoped audit/action rows, tool names, risk, action
  family, permission tier, status, reason codes, and timestamps.
- Audit rows must not store raw action inputs, prompts, source bodies, connector payloads, secrets,
  auth tokens, full summaries, raw tool outputs, or raw source refs.
- Source links do not grant source permissions. Opening a source uses the owning source route/tool.
- Account export/delete includes audit rows.

If a source object is later hard-deleted, the audit row remains as bounded history but the owning
source must call `redactReferenceKey` so `reference_key` is nulled and dereference returns
unavailable. V1 intentionally retains bounded metadata (`event_kind`, status, hashes, reason codes,
timestamps, and `target_label`) until account deletion/export or a later retention policy.

## 12. Permission Boundary

The audit log is read-only.

Rules:

- It never executes actions.
- It never changes #534 action policy.
- It never creates or resolves `app.ai_assistant_action_requests`.
- It never replays a tool call.
- It never turns scheduled/proactive suggestions into execution.
- Destructive and external-send actions always confirm through the gateway, regardless of audit
  logging.

Any UI "Do this again" or "Undo" affordance is out of scope. A future version must route through the
normal assistant tool/gateway path.

## 13. Freshness And Provenance Boundaries

Audit rows can show event timestamps and source-owned target labels.

Do not add:

- answer provenance/source cards (#539);
- data freshness badges, sync-health warnings, or stale-source wording (#541);
- raw source evidence snippets.

If the user asks why an answer made a factual claim, use #539. If the user asks what Jarvis did,
suggested, approved, denied, or skipped, use #540.

## 14. Error Handling

- Audit writer validation failure: drop the event, keep the owning operation, log metadata only.
- Audit insert duplicate: treat as success.
- Audit insert database failure: keep the owning operation, log metadata only.
- Missing reference provider: show event without open-related action.
- Provider unavailable: return unavailable state.
- Source deleted or no longer owned: return unavailable/404 without leaking existence.
- Malformed query filters: 400.
- Invalid cursor: 400.

Audit logging must never block chat, gateway actions, source sync, proactive scanning, scheduled
briefings, candidate review, Today, or settings.

## 15. Out Of Scope

- Raw app log viewer.
- Full action input/output replay.
- Undo/retry/re-run controls.
- Permission policy editing (#534 owns policy).
- Answer provenance UI (#539).
- Freshness/sync health UI (#541).
- External notifications.
- Cross-user or admin audit search.
- Long-term retention/pruning policy beyond account export/delete.

## 16. Acceptance Criteria

- [ ] Owner-scoped `app.jarvis_automation_audit_events` records metadata-only audit events.
- [ ] Gateway creates audit events for proposals, approvals, denials, cancellations/expirations,
      trusted auto-runs, destructive confirmations, and tool failures.
- [ ] Trusted auto-run events identify the action family and permission tier that allowed execution.
- [ ] Destructive events always show `permission_tier = "always_confirm"` and cannot be promoted by
      audit logging.
- [ ] Gateway and audit writer both reject `trusted_auto_ran` for destructive or external-send
      actions.
- [ ] Proactive cards, scheduled briefings, commitment candidates, person match candidates, goals,
      and feedback-driven suppression can emit metadata-only audit events.
- [ ] Audit events store hashes, verifier keys, and bounded labels only and never raw action inputs,
      prompts, source bodies, connector payloads, secrets, auth tokens, full summaries, raw tool
      outputs, or raw refs.
- [ ] Audit rows for individually deleted source objects retain only bounded metadata and return
      unavailable from dereference, with `reference_key` nulled on hard delete.
- [ ] Cross-database hard-delete cleanup marks `reference_key_redaction_pending`, keeps dereference
      unavailable while pending, retries with bounded backoff, and alerts after final failure.
- [ ] Source/detail dereference goes through source-owned reference providers under `DataContextDb`.
- [ ] API and assistant tools omit `referenceKey` and raw internal hashes from public responses.
- [ ] UI shows a bounded Jarvis activity timeline, not a raw log viewer.
- [ ] Audit logging failure never blocks the owning operation.
- [ ] The audit log is read-only and cannot execute, replay, approve, deny, or change permissions.
- [ ] User A cannot read or dereference user B's audit events.

## 17. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:ai
pnpm test:api
pnpm test:web
pnpm test:commitments
pnpm test:notifications
```

Targeted tests:

- creating an action request writes `tool_proposed`;
- approving writes `tool_approved`;
- denying writes `tool_denied`;
- stale cancellation writes `tool_expired` or `tool_cancelled`;
- trusted auto write tool writes `trusted_auto_ran` without creating an action request;
- audit writer rejects `trusted_auto_ran` with destructive risk or external-send metadata;
- destructive tool execution writes `destructive_confirmed` only after confirmation;
- failed tool handler writes `tool_run_failed` without raw output;
- duplicate writer calls for the same action request/event kind produce one row;
- writer rejects overlarge metadata and raw-looking refs;
- writer rejects malformed `eventKey`, out-of-range `sourceEventCount`, and over-cap metadata
  string values before insert;
- writer truncates overlong `target_label` before insert;
- SQL checks reject malformed `eventKey`, standalone rows with no idempotency anchor, and
  out-of-range `sourceEventCount`;
- writer truncates `target_label` but rejects, rather than truncates, over-cap metadata string
  values;
- proactive card creation/dismissal writes safe audit events;
- commitment/person source event hashes dedupe central audit rows;
- list route filters by event kind, surface, status, and time range;
- list/detail responses omit `referenceKey`, raw hashes, raw source refs, and raw metadata;
- dereference route passes authenticated actor id to providers;
- dereference for user A's event returns no result when called with user B's session, even if an
  event id or reference key is guessed;
- provider dereference results with `verifiedOwnerUserId` different from the authenticated actor are
  suppressed;
- retired/version-mismatched `reference_key` values return unavailable instead of opening a source;
- hard-deleting a source object calls `redactReferenceKey`, clears `reference_key`, and keeps the
  rest of the audit row visible as bounded history;
- invalid `deepLinkPath` from a provider is dropped;
- provider `deepLinkPath` outside that provider's declared `deepLinkPrefixes` is dropped;
- boot composition rejects malformed, overlapping, duplicate, or admin-only deep link prefixes;
- audit writer failure does not fail the gateway operation;
- `resolvePolicy()` output is unchanged with audit logging enabled versus disabled;
- audit assistant tools return bounded metadata only;
- RLS isolation for audit event list/detail/dereference.

## 18. External Review

AGY review requested with `Gemini 3.5 Pro` on 2026-06-27, but that model was unavailable in the
local AGY model list. AGY review then ran with `Claude Sonnet 4.6 (Thinking)` on 2026-06-27.
Blocker and medium findings were addressed in this draft, including:

- verifier-backed `reference_key` semantics, actor-owned dereference, and hard-delete redaction;
- `metadata_json` key allowlist, SQL checks, value caps, and public metadata filtering;
- audit writer savepoint isolation and no-throw idempotent insertion;
- `trusted_auto_ran` rejection for destructive or external-send actions;
- source-owned deep-link prefix registration and boot-time validation;
- merge/split dedupe semantics and source event counts;
- cross-user dereference tests and writer validation tests.

Final AGY pass reported no remaining blocker or medium findings.
