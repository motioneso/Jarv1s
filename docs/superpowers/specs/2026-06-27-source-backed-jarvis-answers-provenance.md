# Source-backed Jarvis answers with provenance (#539)

**Status:** Draft - AGY review addressed
**Date:** 2026-06-27
**Owner:** Ben + Codex
**Issue:** #539
**Depends on:** #525 cross-tool reasoning, #530 passive context retrieval, #532 confidence-aware
memory records, #537 automatic commitment extraction, #538 unified person/contact model.
**Related follow-ups:** #540 safe automation audit log, #541 data freshness visibility.
**Grounded on:** `~/Jarv1s/docs/superpowers/specs/2026-06-27-cross-tool-reasoning.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-passive-context-retrieval.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-confidence-aware-memory-records.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-automatic-commitment-extraction.md`,
`~/Jarv1s/docs/superpowers/specs/2026-06-27-unified-person-contact-model.md`,
`~/Jarv1s/packages/chat/src/live/chat-session-manager.ts`,
`~/Jarv1s/packages/chat/src/repository.ts`, `~/Jarv1s/packages/ai/src/gateway/gateway.ts`,
`~/Jarv1s/packages/ai/src/gateway/types.ts`, `~/Jarv1s/packages/shared/src/briefings-api.ts`.

## 1. Problem

Jarvis can gather context from memory, notes, email, calendar, tasks, commitments, and people
records, but the user still cannot reliably inspect why an answer says what it says.

Examples:

- "Why do you think I owe Sarah a reply?"
- "Which note or email backs that?"
- "Is that a confirmed memory, an inference, or a pending candidate?"
- "Can I open the source without seeing raw connector ids?"

The risky version is a generic citation engine or source browser. That is not V1. The missing
capability is a compact, owner-scoped provenance trail attached to Jarvis answers.

## 2. Decision

Add **answer provenance V1** for generated Jarvis answers.

V1 carries source-backed support items from source-owned reads into answer metadata, then renders a
small source tray under the answer. It supports:

1. source labels and source kind;
2. bounded snippets only when the owning source says they are safe;
3. confidence/provenance state;
4. citation tokens and deep links through source-owned resolvers;
5. explicit labels for confirmed sources, inferred memory, pending candidates, and ambiguous people.

V1 does not create a new global provenance table. Chat messages already have owner-scoped
`tool_metadata`, and briefing runs already have `sourceMetadata`. Store the compact provenance
payload with the answer that used it. Add a dedicated table later only if the product needs
cross-answer querying or retention separate from chat/briefing history.

## 3. Current Architecture Anchor

Relevant seams already exist or are specified by adjacent work:

- `ChatSessionManager.runTurn()` owns the single chat-answer path.
- `app.chat_messages` has `model_metadata` and `tool_metadata`.
- #525 renders hidden `<cross_tool_context>` from source-owned read tools.
- #530 renders hidden `<retrieved_context>` from memory recall.
- #532 gives memory confidence, provenance, stale, conflicting, and pending exclusion rules.
- #537 commitment candidates have bounded evidence, confidence, source labels, and pending/accepted
  state.
- #538 `people.getContext` returns stable citation tokens without raw source refs.
- Briefing runs already persist `sourceMetadata`.

#539 should extend those answer surfaces. It must not import source repositories into chat or
briefings.

## 4. Provenance Support Contract

Define a small shared support item type, likely under `packages/shared`.

```ts
type AnswerProvenanceSourceKind =
  | "memory"
  | "note"
  | "email"
  | "calendar"
  | "task"
  | "commitment"
  | "person"
  | "goal"
  | "briefing";

type AnswerProvenanceState =
  | "confirmed_source"
  | "inferred_memory"
  | "pending_candidate"
  | "ambiguous_identity"
  | "unverified_context";

interface AnswerSourceSupport {
  readonly supportId: string;
  readonly sourceKind: AnswerProvenanceSourceKind;
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly state: AnswerProvenanceState;
  readonly confidence?: number;
  readonly confidenceTier?: "confirmed" | "high" | "medium" | "low";
  readonly provenance?: "volunteered" | "inferred" | "confirmed" | "imported" | "source";
  readonly occurredAt?: string;
  readonly citationToken?: string;
  readonly canDereference: boolean;
}

interface AnswerSourceSupportCard {
  readonly supportId: string;
  readonly sourceKind: AnswerProvenanceSourceKind;
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly state: AnswerProvenanceState;
  readonly confidence?: number;
  readonly confidenceTier?: "confirmed" | "high" | "medium" | "low";
  readonly provenance?: "volunteered" | "inferred" | "confirmed" | "imported" | "source";
  readonly occurredAt?: string;
  readonly canDereference: boolean;
}
```

Rules:

- `supportId` is short and local to one answer, such as `S1`.
- `citationToken` is source-owned and opaque. It is not a raw source ref.
- Stored support items may include `citationToken`; API list responses return
  `AnswerSourceSupportCard`, which explicitly omits it.
- `sourceLabel`, `title`, and `snippet` are bounded UI strings.
- `snippet` max length is 240 characters.
- `sourceLabel`, `title`, and `snippet` are plain text only. The provenance finalizer strips control
  characters, rejects markup-shaped fields that cannot be safely plain-text encoded, and the UI
  renders them as text, never HTML.
- An answer stores at most 8 visible support items.
- The serialized answer provenance payload is capped at 16 KB.
- Unknown or malformed support items are dropped before persistence.

Do not store full email bodies, full note contents, raw memory records, prompt text, raw tool output,
connector payloads, secrets, tokens, credentials, or raw source refs in answer provenance metadata.

## 5. Source-Owned Providers

Source modules own verification and dereference.

Extend module manifests with an optional provider:

```ts
interface AnswerProvenanceProvider {
  readonly sourceKind: AnswerProvenanceSourceKind;
  verifySupport(
    scopedDb: unknown,
    input: {
      readonly ownerUserId: string;
      readonly citationToken: string;
    }
  ): Promise<AnswerSourceSupport | null>;
  dereferenceSupport(
    scopedDb: unknown,
    input: {
      readonly ownerUserId: string;
      readonly citationToken: string;
    }
  ): Promise<AnswerProvenanceDereference | null>;
}

interface AnswerProvenanceDereference {
  readonly sourceLabel: string;
  readonly title: string;
  readonly snippet?: string;
  readonly deepLinkPath?: string;
  readonly unavailableReason?: "missing" | "permission" | "source_unavailable";
}
```

Rules:

- Providers run under `DataContextDb`.
- Providers may query only their owning module tables.
- The central answer/provenance layer never queries notes, email, calendar, task, commitment,
  person, goal, or memory tables directly.
- `verifySupport` returns `null` when the token is missing, stale, malformed, or not owned by the
  actor.
- `dereferenceSupport` returns a source-owned deep link only when the source route exists and the
  actor can open it.
- Deep links are internal UI paths, not raw connector URLs or raw source ids. The central
  dereference route validates `deepLinkPath` before returning it: it must start with `/`, must not
  start with `//`, must not contain a URI scheme, and must match an allowlist of app route prefixes
  owned by registered modules.
- Missing providers leave the source card visible with stored label/snippet, but no open-source
  action.

V1 providers should cover memory, notes, email, calendar, tasks, commitments, and people as those
source packages produce support items. A source that cannot safely dereference yet may still emit a
label-only support item.

## 6. Carrying Support Into Answers

Hidden context blocks from #525/#530 are not provenance by themselves. They become provenance only
when their normalized evidence items also produce `AnswerSourceSupport` sidecar items.

Rules:

- #530 memory recall maps recalled memory items into support items using #532 confidence/status
  fields.
- #525 cross-tool evidence maps source-owned read results into support items when the read tool or
  source provider supplies a safe citation token.
- #537 commitment read tools map pending candidates as `pending_candidate` and accepted candidates
  as `confirmed_source` only when their evidence belongs to the actor.
- #538 people context maps unresolved or ambiguous identities as `ambiguous_identity`.
- Source reads with no verifier token may emit label-only `unverified_context`, but those cards
  are visually weaker and cannot be opened.

When rendering hidden context for the model, include the local support id:

```xml
- [support=S1 email relevance=high source="Email: Sarah / Pricing follow-up"] Sarah asked for the
  pricing decision before the review.
```

The answer prompt should ask the model to cite support ids only when it relies on them, using compact
markers such as `[[S1]]`. The UI strips valid markers from visible text and stores the referenced
support ids in answer metadata.

If the model emits no valid markers, the answer may still keep uncited support items as
`contextChecked`, but the default UI hides those items. They may appear only in a future diagnostic
or "context checked" view that clearly says they were checked, not cited proof. This avoids
overstating that every hidden context item was used.

## 7. Persistence

For chat answers, persist provenance on the assistant message:

```ts
interface AnswerProvenanceMetadataV1 {
  readonly version: 1;
  readonly citedSupportIds: readonly string[];
  readonly supportItems: readonly AnswerSourceSupport[];
  readonly contextCheckedCount: number;
  readonly omittedCount: number;
}
```

Store this under:

```text
chat_messages.tool_metadata.answerProvenanceV1
```

For briefing runs, store the same shape under:

```text
briefing_runs.source_metadata.answerProvenanceV1
```

Rules:

- A provenance finalizer validates, sanitizes, deduplicates, sorts, trims, and caps support items
  before persistence. API response shaping repeats the size check before returning cards.
- Persist only after the assistant answer/run is created.
- Persist only bounded support item metadata, not hidden prompt blocks.
- Do not persist the raw `<retrieved_context>` or `<cross_tool_context>` blocks.
- If metadata validation fails, drop provenance and keep the answer.
- Chat history export/delete naturally includes the provenance because it is attached to the message.
- Briefing export/delete naturally includes the provenance because it is attached to the run.

## 8. API

Add answer-owned read routes:

- `GET /api/chat/messages/:messageId/provenance`
- `GET /api/chat/messages/:messageId/provenance/:supportId/dereference`
- `GET /api/briefings/runs/:runId/provenance`
- `GET /api/briefings/runs/:runId/provenance/:supportId/dereference`

Rules:

- Routes run under `DataContextDb`.
- Routes never accept an owner id.
- Missing/non-owned answer returns 404.
- The list routes return `AnswerSourceSupportCard[]` with no raw `citationToken`.
- The dereference routes look up the stored support item, call the source-owned provider with the
  stored token, and return a source-owned deep link or safe unavailable state.
- Dereference routes always pass the authenticated actor id from the request context to
  `verifySupport`/`dereferenceSupport`. They never pass an owner id from stored answer metadata or
  from a client payload.
- If the provider returns a changed label/snippet, prefer the live provider result for the
  dereference response but do not mutate historical answer metadata from a read route.
- If provider verification fails, return 404 or an unavailable state without exposing whether the
  raw source exists for another user.

Do not add a global provenance search API in V1.

## 9. UI

Chat answer UI:

- strip valid `[[S1]]` style markers from assistant text;
- show compact source chips below the assistant answer when at least one valid support id was cited;
- open a small source tray with source label, kind, title, state, confidence tier, timestamp, and
  bounded snippet;
- show an open-source action only when dereference succeeds.

Briefing UI:

- show the same compact source tray on briefing run detail or generated summary sections when
  provenance metadata exists;
- use existing briefing source labels when no item-level support is available.

State labels:

| State                | UI wording       |
| -------------------- | ---------------- |
| `confirmed_source`   | Source           |
| `inferred_memory`    | Inferred memory  |
| `pending_candidate`  | Pending review   |
| `ambiguous_identity` | Ambiguous person |
| `unverified_context` | Context checked  |

UI rules:

- Use existing authored `jds-*` and chat/briefing primitives.
- Keep source cards compact; this is not a document browser.
- Do not show raw source refs, citation tokens, connector ids, prompt text, or hidden context.
- Do not add freshness badges or stale-source warnings here. #541 owns that language.
- Do not show action audit details here. #540 owns action/audit explanation.

## 10. Privacy, Safety, And Auditability

- Provenance metadata is owner-scoped because it is attached to owner-scoped chat messages and
  briefing runs.
- No admin private-data bypass.
- All dereference calls go through source-owned providers under `DataContextDb`.
- Source cards may include private owner data, but only bounded labels/snippets approved by the
  source provider.
- Prompt text, hidden context blocks, raw tool payloads, source bodies, raw memory records, raw
  source refs, secrets, tokens, and connector credentials never enter provenance metadata.
- Logs include metadata only: actor id, answer kind (`chat_message` or `briefing_run`), answer id,
  source kind, support count, cited count, duration, and error class. Never log snippets, labels,
  tokens, prompts, or source text.
- Source links do not grant source permissions. Opening a source still uses that source's normal
  authorization.

## 11. Freshness Boundary

V1 may show source timestamps already present on support items:

- email received time;
- calendar event start;
- task due/do time;
- note line/update label;
- memory occurred/confirmed time;
- commitment first/last seen time.

Do not add stale warnings, sync-health badges, or "last synced" explanations in this spec. #541 owns
data freshness visibility.

## 12. Action Audit Boundary

Provenance explains answer evidence. It does not explain action execution.

Rules:

- Do not show approval, denial, trusted-auto, destructive-confirmation, or tool execution history in
  provenance cards.
- If an answer mentions a proposed or completed action, its supporting source card may link to the
  relevant source record, but the "what did Jarvis do and why" trail belongs to #540.
- Provenance metadata must not store action inputs or raw tool outputs.

## 13. Error Handling

- Support collection failure: answer continues without provenance.
- Model emits invalid support markers: strip only valid markers, ignore the rest as text or remove
  known malformed marker syntax.
- Support item fails validation: drop that item and keep the answer.
- All cited items dropped: render no source tray.
- Provider missing: show stored label-only card without open-source action.
- Provider unavailable during dereference: return unavailable state.
- Source deleted or no longer owned: return unavailable/404 and do not leak existence.
- Metadata exceeds cap: keep cited items first, then highest-confidence support, then newest/soonest
  support; increment `omittedCount`.
- Provider returns an invalid `deepLinkPath`: omit the open-source action and log metadata only.

Provenance must never block chat, briefing generation, source sync, or action execution.

## 14. Out Of Scope

- A generic citation engine.
- Claim-level natural-language entailment checking.
- Global source browser or document search UI.
- Knowledge-base export.
- Connector sync, OAuth, or source ingestion.
- Data freshness/staleness UI (#541).
- Safe automation audit log (#540).
- Action execution or permission changes.
- Cross-user/shared provenance.
- Storing hidden prompt blocks or full source bodies.

## 15. Acceptance Criteria

- [ ] Chat answers can persist bounded `answerProvenanceV1` metadata on assistant messages.
- [ ] Briefing runs can persist bounded `answerProvenanceV1` metadata in `sourceMetadata`.
- [ ] #525/#530 source items can produce sidecar `AnswerSourceSupport` items with local support ids.
- [ ] Valid answer support markers map to source cards, and invalid markers do not expose metadata.
- [ ] Source cards distinguish confirmed sources, inferred memory, pending candidates, ambiguous
      identities, and unverified context.
- [ ] Source cards show only bounded labels/snippets and never raw source refs, prompts, raw tool
      payloads, source bodies, secrets, or connector credentials.
- [ ] API list routes return sanitized source-card DTOs that omit `citationToken`.
- [ ] Deep links/dereference go through source-owned providers under `DataContextDb`.
- [ ] Dereference passes the authenticated actor id to providers, never an owner id from stored
      metadata.
- [ ] Uncited context-checked support is hidden by default and not presented as cited proof.
- [ ] The central answer/provenance layer never queries source-owned tables directly.
- [ ] Missing or failed providers degrade to label-only or unavailable cards.
- [ ] Provenance UI does not include action audit details or freshness warnings.
- [ ] User A cannot view or dereference user B's answer provenance.

## 16. Verification

Local gate:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:chat
pnpm test:briefings
pnpm test:memory
pnpm test:api
pnpm test:web
```

Targeted tests:

- support item validation drops raw-looking refs and overlong snippets;
- support item validation strips unsafe control characters and preserves snippets as plain text;
- answer marker parser accepts valid `[[S1]]` markers and ignores unknown support ids;
- UI strips valid markers from assistant text and renders source chips;
- metadata cap keeps cited items before uncited context;
- metadata cap increments `omittedCount` and preserves the specified trim order;
- provenance API list responses omit `citationToken`;
- invalid absolute, scheme-based, or non-allowlisted deep links are dropped;
- answers with only uncited context-checked items render no default source chips;
- #530 memory recall support maps confidence/provenance/status correctly;
- #537 pending commitment support renders as pending, not confirmed;
- #538 ambiguous person support renders as ambiguous and does not pick one person;
- chat message provenance route returns cards for the owner only;
- dereference route calls the source provider under `DataContextDb`;
- provider returning `null` does not leak whether a source exists for another user;
- briefing run provenance route returns cards for the owner only;
- no persisted provenance payload includes hidden context blocks, raw tool payloads, prompt text, or
  full source bodies;
- RLS isolation for message/run provenance reads.

## 17. External Review

AGY review requested with `Gemini 3.5 Pro` on 2026-06-27, but that model was unavailable in the
local AGY model list. AGY review then ran with `Claude Sonnet 4.6 (Thinking)` on 2026-06-27.
Blocker and medium findings addressed in this draft:

- added `AnswerSourceSupportCard` so list routes never return stored `citationToken`;
- required dereference routes to pass the authenticated actor id to providers;
- required plain-text snippet/label/title sanitization before persistence and text-only UI
  rendering;
- clarified that uncited context-checked support is stored but hidden by default;
- named the provenance finalizer as the persistence-time cap enforcement point;
- required tests for `omittedCount` and trim priority;
- changed dereference links to validated internal `deepLinkPath` values;
- clarified metadata-only logs with `answerKind` for chat messages versus briefing runs.

Final AGY pass with `Claude Sonnet 4.6 (Thinking)` reported no remaining blocker or medium findings.
