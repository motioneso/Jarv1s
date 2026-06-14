# Memory Advisors and Nightly Council Brainstorm

Date: 2026-06-14
Status: Ideation notes, not an approved design spec

## Context

This note captures an early brainstorm after reviewing Galadriel's public repo and comparing its
memory/self-improvement patterns with Jarvis' existing architecture.

The useful Galadriel patterns are memory lifecycle and reflection patterns, not a direct port of
its Python harness or broad self-editing model. Jarvis should keep its Postgres/RLS/module-first
architecture, provider-agnostic AI routing, DataContextDb boundary, metadata-only jobs, and
user-visible/reversible memory model.

## Locked-In Direction So Far

### 1. Memory Injection Must Be Cost-Bounded

Avoid always injecting large memory blocks on every chat turn. That risks hidden context bloat and
unpredictable user cost.

Preferred direction:

- Treat memory injection as a bounded context-budget feature.
- Prefer session-start or relevance-triggered recall over every-turn injection.
- Keep any always-present profile snapshot tiny.
- Add user controls such as off, conservative, standard, and rich memory modes.
- Make memory token usage/cost visible enough that users understand the tradeoff.

### 2. Nightly Council Uses Module Advisors

The nightly council should not be one omniscient process that inspects everything directly.
Instead, each module can expose its own domain-specific advisor.

Examples:

- Tasks Advisor: slipped tasks, stale projects, overload, tomorrow risks.
- Calendar Advisor: conflicts, buffers, heavy days, schedule shape.
- Email Advisor: unanswered threads, commitments, waiting-on items.
- Wellness Advisor: check-in trends, medications, energy patterns.
- Memory Advisor: new durable facts, contradictions, changed preferences.

Each module advisor emits structured advisory packets. The executive assistant consumes those
packets and synthesizes the user-facing briefing.

### 3. Advisor Packets Should Be Structured and Bounded

Advisor output should be compact, source-linked, and structured rather than raw dumps.

Illustrative packet shape:

```ts
{
  module: "tasks",
  severity: "low" | "medium" | "high",
  confidence: 0.82,
  observations: [],
  suggestedActions: [],
  memoryProposals: [],
  briefingItems: [],
  sourceRefs: []
}
```

The executive layer should fetch raw source details only when needed. This keeps cost predictable
and avoids sending full email/chat/calendar dumps into prompts by default.

### 4. Advisor Autonomy Control Plane

Advisors may observe freely inside their module boundary, but action must be budgeted,
explainable, reversible, and tunable.

Each advisor needs user-tunable controls for both output volume and action authority.

Output volume examples:

- Quiet: only high-confidence/high-impact items.
- Balanced: normal mode.
- Proactive: includes weaker signals and optional suggestions.

Action authority examples:

- Brief only: contributes only to executive briefing.
- Suggest: creates reviewable proposals.
- Draft: creates draft tasks/memory updates, not active items.
- Auto-file low-risk: can automatically save low-risk memory or create low-risk tasks within
  configured limits.

Rate limits and backpressure should be per advisor:

- Max task drafts per day/week.
- Max memory proposals per day.
- Snooze advisor/topic for a time window.
- Require confirmation under a confidence threshold.
- Auto-downgrade surfacing behavior when dismissals are high, within user-set bounds.

### 5. Manual Controls Plus Automatic Adaptation

Jarvis should be fully user-tunable, and it should also adapt in all areas.

Principle:

> User settings are the hard boundary. Jarvis adaptation happens inside that boundary.

Hard controls are user-owned and should never be silently raised by Jarvis:

- Advisor enabled/disabled.
- Max items per briefing.
- Max proposals/drafts per day.
- Allowed action level.
- Sensitive categories excluded.
- Confirmation requirements.

Adaptive preferences can be tuned automatically:

- Ranking weights.
- Confidence thresholds within allowed bounds.
- Preferred delivery timing.
- Topic suppression.
- Grouping vs splitting suggestions.
- Repeated reminder suppression.

Jarvis should learn from accepted, dismissed, edited, ignored, completed, deleted, corrected, and
snoozed suggestions.

### 6. Setting Changes Require Recommendations

Jarvis can silently adapt ranking/suppression inside existing user bounds. Explicit setting changes
should be recommendations requiring user confirmation.

Example:

> Email Advisor noticed you dismissed 8 of its last 10 task suggestions. Recommendation: switch
> Email Advisor from Balanced to Quiet for one week.

Illustrative tuning recommendation shape:

```ts
{
  advisorId: "email",
  recommendationType: "mode_change",
  currentValue: "balanced",
  proposedValue: "quiet",
  reason: "80% dismissal rate over 10 suggestions",
  evidenceRefs: [],
  status: "pending" | "accepted" | "dismissed" | "expired",
  expiresAt: "..."
}
```

### 7. Two-Layer Advisor Settings

There should be two settings layers.

Basic module settings:

- Advisor on/off.
- Style: quiet, balanced, proactive.
- Allowed actions: brief only, suggest, draft, auto-file low-risk.
- Daily limits.
- Sensitive areas and confirmation rules.

Advanced advisor console:

- Recent signals detected.
- Surfaced vs suppressed items.
- Accepted, dismissed, and ignored rates.
- Learned preferences.
- Per-topic thresholds.
- Action history.
- Automatic adaptations Jarvis made.
- Reset learning for an advisor.
- Explain a recommendation.

Advanced settings should feel like operational telemetry for a helper, not raw model internals.

### 8. Decision Records Are Required

Every advisor decision should produce a small decision record, even when the decision is to do
nothing.

This gives Jarvis:

- Explainability.
- Tuning feedback.
- Debuggability.
- User trust.
- A way to answer why something was shown or suppressed.

### 9. Single Synthesized Briefing Artifact

The nightly council should produce a single saved executive briefing artifact, backed by stored
advisor packets and decision records.

The artifact is the user-facing history:

- Executive synthesis.
- Tomorrow planning.
- Risks and open loops.
- Recommended actions.
- Memory updates for review.
- Advisor tuning recommendations.
- Source-linked evidence.

Storage direction:

- DB stores briefing status, structured actions, review state, packet links, and interaction
  tracking.
- Vault markdown stores a readable, portable briefing transcript.
- Advisor packets remain stored as provenance/debug material underneath the artifact.

Avoid making the briefing ephemeral UI state. The briefing history becomes a longitudinal record
of what Jarvis thought mattered, what the user accepted, what was noise, and how patterns changed.

### 10. Temporal Facts and Knowledge Graph Are Worth Exploring

Jarvis' current `chat_memory_facts` model is useful but flat. A temporal KG-like model could make
changed facts and relationships first-class.

Potential early edge types:

- `user prefers X`
- `user works_on project`
- `project has_goal goal`
- `person associated_with project`
- `commitment owed_to person/org`
- `fact supersedes fact`

Important properties:

- `valid_from`
- `valid_to`
- source/provenance refs
- confidence/provenance
- user-visible correction/dismiss/delete
- timeline queries

Avoid starting with a giant generic graph. Begin with typed relations that serve real product
queries.

### 11. Full Conversations Should Live in DB and Vault

Full conversations should be durable in both operational and portable forms.

Direction:

- DB stores canonical chat rows, threading, metadata, RLS, indexing status, and source ids.
- Vault stores readable conversation transcripts, likely daily or per-thread markdown.
- Memory index embeds chunks derived from DB and/or vault while preserving provenance.
- Facts/KG edges reference source thread/message IDs and optional vault paths.

Raw provenance should exist before compaction, summarization, deletion, or chat reset.

### 12. Self-Improvement Is Deferred

Do not design self-editing now.

Safer future direction:

- Jarvis notices recurring friction, bugs, or user dismissals.
- Jarvis drafts suggestions, issues, or specs.
- Human confirmation remains required before product/code changes.

## Open Questions For Next Discussion

- What should be the first advisor module to prototype conceptually: Tasks, Memory, Calendar, or
  Email?
- What are the first concrete advisory packet fields Jarvis needs?
- How should the briefing artifact map to existing Briefings vs a new Council feature?
- What is the right minimal temporal fact schema?
- How should vault conversation transcripts be organized: per thread, per day, or both?
- Which actions are safe enough for `auto-file low-risk` in the first version?
- How visible should token/cost accounting be in the UI?

## Deferred Until Later

- Approved implementation spec.
- Database schema design.
- Job queue design.
- UI design.
- Self-improvement/codebase-improvement loop.
- Any unrestricted self-modification behavior.
