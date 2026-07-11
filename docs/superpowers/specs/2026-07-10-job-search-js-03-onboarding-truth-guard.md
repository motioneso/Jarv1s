# JS-03 — profile, resume truth guard, and onboarding tools

**Status:** Draft — issue #932; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #931, #919 gateway/`ctx.ai`, and #916

## Goal

Deliver the full six-checkpoint conversational onboarding flow and an approved, truthful master
resume plus durable search profile. The existing Jarv1s assistant drives the conversation; the
module contributes tools and durable state, not another chat engine.

## State machine

1. `resume_intake`: validate/cap the paste and persist immutable `revision/0`.
2. `resume_critique`: structured critique of clarity, evidence, structure, and ATS readability.
3. `resume_approval`: show diff/evidence, revise as needed, explicitly approve one Markdown revision.
4. `profile`: collect and confirm the complete search profile.
5. `sources_schedule`: configure approved adapters, local due time, and ranking budget disclosure.
6. `review_enable`: show exact stored resume/profile/monitors, then explicitly enable monitoring.

Progress can move backward without deleting approved history. Monitoring remains disabled until an
approved resume, approved profile, and enabled monitor all exist.

## Tools

- onboarding state: read;
- profile get: read; profile draft/approve: write + confirm;
- resume get/diff: read; resume draft/approve: write + confirm;
- monitor list: read; monitor draft/save: write + confirm.

Inputs/outputs are schema-projected and capped. Writes pass through `AssistantToolGateway` and bind
the actor/module in the parent.

## Truth guard

Material changes are employers, roles, dates, skills, credentials, metrics, or outcomes. Each must
reference exact source text from `revision/0`/an approved revision or a separately recorded explicit
user confirmation. Unsupported content is returned as a question, never draft resume text. In JS-03,
approvable AI output is limited to reordering and verbatim whole-line selection of true/confirmed
source segments; shortened or paraphrased lines are non-approvable and are returned as a question
(scope verdict B, issue #932 — no pure syntactic rule can distinguish safe shortening from
meaning-changing truncation). Full paraphrase support is deferred to truth-guard-v2. The approval
view shows a diff and evidence status for every material addition.

Structured critique/rewrite uses `ctx.ai`, fixed schemas, bounded prompts/results, and no tools. The
resume/profile and source material are user data; only the user's configured AI capability receives
them after the onboarding disclosure.

## Verification

- Resume size, revision, provenance, diff, and approval transitions.
- Unsupported-claim adversarial cases cannot become approved.
- Inferred profile values remain inactive until confirmed.
- Resume/profile writes confirm and audit; reads do not leak full documents in list responses.
- Resume/profile edits never occur from monitor jobs.
- Leaving chat/restarting resumes at the durable checkpoint.
- Provider/model names never appear in package code or RPC results.

## Non-goals

- No PDF/DOCX parsing, job-specific resume, cover letter, or application workflow.

## Review question

Starter-prompt and checkpoint copy can be finalized during UI review; no architecture decision is
needed unless Ben wants prescribed wording in the spec.
