# JS-07 — freshness, deduplication, and AI fit bands

**Status:** Draft — issue #936; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #932, #934, and #919 `ctx.ai`

## Goal

Produce fresh, non-duplicated, explainable opportunity recommendations through deterministic hard
gates followed by bounded provider-agnostic AI fit bands.

## Identity and freshness

Primary identity is `(adapterId, externalJobId)`; fallback is normalized canonical-URL hash. Similar
titles/companies never merge distinct roles. Description hash detects material changes. Store
published time when supplied, first/last seen, last successful liveness check, and
`active | uncertain | stale`. Fetch failure never implies stale.

## Deterministic gate

Reject or flag only from explicit structured facts: excluded company/industry, incompatible
employment/work arrangement, confirmed geographic/sponsorship impossibility, reliable compensation
below a confirmed minimum, authoritative closure, or user hard dealbreaker. Missing data is unknown,
not failure.

## AI evaluation

At most 25 new/materially changed survivors per user per local day are processed oldest-pending
first. The module explicitly requests the `interactive` tier—the balanced everyday-quality tier—for
the `json` capability. Admin model/service bindings still control the actual provider/model. Input is
the approved profile/resume revisions plus bounded normalized job facts/text framed as untrusted
data. No tools are available during evaluation.

The fixed output schema contains:

- fit band `strong | possible | low` and recommendation `review | watch | pass`;
- requirement-to-candidate evidence pairs with source references;
- blocker/gap/unknown items and reasons;
- preference matches/conflicts;
- posting confidence and overall confidence;
- summary and exact input revision/content hashes.

Schema validation and bounded repair happen in the parent. AI/provider failure leaves deterministic
survivors visible with evaluation pending. Old evaluations are immutable and marked outdated after
input changes. No opaque numeric match score exists.

## Ordering

Feed ordering is eligibility, fit band, confidence, freshness, then posted/first-seen time. Pending
deterministic survivors sort below completed strong/possible evaluations but remain visible.

## Verification

- Identity/canonicalization and distinct-similar-role cases.
- Authoritative/stale/uncertain transitions and source failure.
- Every deterministic gate plus unknown handling.
- Exact daily cap, local-day reset, and oldest-first backlog.
- Schema/evidence requirements, invalid output repair/failure, input hash staleness.
- Prompt-injection job text cannot alter state or invoke tools.
- At least two provider adapter shapes; no provider/model identity in module code/output.
