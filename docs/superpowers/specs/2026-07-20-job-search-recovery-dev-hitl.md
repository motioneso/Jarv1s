# Job Search Recovery: Resume Critique and Dev HITL

**Status:** Approved by Ben on 2026-07-20  
**Date:** 2026-07-20  
**Owner:** Ben + Codex  
**Recovery slice:** Resume upload → critique → resume approval

## 1. Decision

Recover Job Search through one narrow, working vertical slice before continuing the rest of the
module:

1. upload a resume in Job Search onboarding;
2. import it through the assistant gateway;
3. generate a real AI critique in the dev instance;
4. let the user approve the resume;
5. prove the approved state survives a reload.

The slice is not complete when agents or mocks say it works. It is complete only after its automated
checks pass, the exact build is deployed to the dev instance, and Ben completes and explicitly
approves the manual checklist in this spec.

No profile questions, source configuration, monitoring, registry promotion, or production deployment
may proceed before that approval.

## 2. Why This Recovery Slice Exists

The current build can appear successful in isolated tests while failing the first real user journey.
The video review and code inspection, grounded on `origin/main` commit `4a202068`, found four concrete
blockers:

1. the native CLI permission layer asks about raw `mcp__jarvis__...` transport calls before the
   Jarvis gateway applies the real action policy;
2. the external-module AI bridge does not inject the existing CLI structured-AI adapter, so the
   critique returns `needs_config` without contacting the user's configured CLI provider;
3. onboarding advances only after a paired `action_request → action_result`, while trusted/YOLO
   execution can return a successful result without a preceding request;
4. the embedded Assistant Surface textarea does not implement the established Enter-to-send and
   Shift+Enter-to-newline behavior.

The video also exposed three acceptance gaps: the intended right rail/Jarvis identity was absent,
the resume dropzone remained after a successful import, and the failure copy inaccurately implied an
external provider problem.

## 3. Relationship to Existing Job Search Plans

This is a recovery addendum to:

- `docs/superpowers/specs/2026-07-09-intelligent-job-search-module.md`;
- `docs/superpowers/specs/2026-07-10-job-search-module-design.md`;
- `docs/superpowers/plans/2026-07-20-job-search-onboarding-ui.md`.

Those documents still define the full module. For this first slice, this spec changes two execution
assumptions:

- "every write is a confirm-gated assistant proposal" becomes **every write is a gateway-mediated
  assistant action**; the gateway's effective policy decides whether it runs or asks;
- an `action_request` is not required to refresh durable onboarding state after a successful action.

Events are refresh signals only. Fresh worker state remains the authority for whether the phase
actually advanced.

## 4. Goals

- Make the first real Job Search journey work in the dev instance with a real configured AI model.
- Remove raw Jarvis MCP transport permission cards without bypassing Jarvis action policy.
- Support confirm-run, trusted-auto, and YOLO execution without leaving stale onboarding controls.
- Match the app's established composer keyboard behavior.
- Show the intended onboarding shell, including Jarvis identity and the bounded right rail.
- Give truthful, actionable failure messages.
- Introduce an early human acceptance gate that future Job Search phases must follow.

## 5. Non-Goals

- Redesigning the app-wide action-permission tier model or choosing its future default.
- Auto-allowing arbitrary MCP servers, shell commands, file writes, or native CLI tools.
- Bypassing `AssistantToolGateway`, module manifests, action families, RLS, or audit records.
- Building profile intake, job-board sources, schedules, monitoring, or opportunity review.
- Building a new AI router, provider integration, onboarding state machine, or module-specific
  executor.
- A broad visual redesign. The right rail and Jarvis identity are acceptance repairs to the approved
  onboarding design only.
- Publishing to the registry or changing production.

## 6. Required User Journey

### 6.1 Entry

Opening Job Search in a reset/fresh dev account shows the real Jarvis onboarding conversation, not a
placeholder. At desktop width, the approved two-column shell is present with the intended right rail
and visible Jarvis identity. At narrow widths, the rail collapses according to the existing responsive
design.

The active control is the PDF/DOCX resume upload. Existing size and MIME validation remain in force.

### 6.2 Upload and import

After the user chooses a valid file:

1. module web uploads it through the host attachment API;
2. module web submits the import intent and attachment ID through `submitTurn`;
3. the CLI may transport the request to the Jarvis MCP server without a native technical permission
   prompt;
4. `AssistantToolGateway` still validates the session allowlist, schema, actor context, manifest, and
   effective action policy;
5. the gateway either runs the action or presents one human-readable approval for the actual outcome;
6. the worker imports the actor-scoped attachment and persists the resume checkpoint;
7. the onboarding UI performs a fresh durable read and leaves the upload phase only when that read
   proves the checkpoint is complete.

The file body never enters module-web state, assistant tool arguments, or logs through this import
path. Only the worker-controlled critique may send the minimum required resume content to the
configured structured-AI provider under the existing privacy boundary.

The successful import must remove the stale dropzone without a page refresh. A denied or failed
import leaves or re-arms the control and offers the existing paste fallback.

### 6.3 Real critique

The critique uses the existing provider-agnostic structured-AI router and the user's configured dev
model. The external-module bridge must provide the existing CLI structured-adapter factory to that
router; it must not hardcode Anthropic, a model ID, or a new provider path.

A dev build is not ready for Ben if no configured model can satisfy the structured JSON capability.
The readiness check must exercise the same bridge used by the Job Search worker. A stubbed AI result,
unit fixture, or direct provider call is not acceptable for the manual gate.

While critique is running, the UI shows an authored progress state. On success it renders only the
approved critique summary/evidence fields, never the raw resume body. The critique must be specific
enough for Ben to recognize that it used the uploaded resume.

### 6.4 Resume approval

The user can approve the resume from the critique/approval phase. The action again goes through the
gateway. If effective policy requires confirmation, the card describes the outcome in product
language (for example, approving this resume for Job Search) and never exposes an MCP/tool identifier.
There is at most one approval card for one action attempt.

After execution, a fresh durable read must prove the resume is approved before the UI advances. A
reload must restore the approved checkpoint and must not show the upload control again.

The recovery build may reveal that the next phase is locked/pending, but must not implement or invite
the user into profile intake until this slice is accepted.

## 7. Permission Boundary

Raw CLI permission prompts and Jarvis action approvals are different layers and must not be conflated.

### 7.1 Native transport behavior

The native permission hook may automatically allow only tool names that are recognized as calls to
the first-party Jarvis MCP transport. The match must be exact and covered against near-match/spoofed
names. Other MCP servers and other native tools retain their current behavior.

This auto-allow means only: "allow this request to reach Jarvis's own gateway." It does not mean:
"allow the requested action to execute."

No native action-request row or raw permission card should be created for the Jarvis MCP transport
hop.

### 7.2 Gateway behavior

Once the request reaches `AssistantToolGateway`, all existing controls remain authoritative:

- actor and session-token validation;
- per-session tool allowlist;
- module/tool availability and input-schema validation;
- manifest risk and execution policy;
- action-family preference and YOLO policy;
- confirmation for actions whose effective policy requires it;
- audit behavior for trusted, YOLO, confirmed, denied, and failed outcomes.

This slice does not settle the broader concern that `ask_each_time` is the current default for writes.
That app-wide policy will be reviewed after the first Job Search dev pass. The immediate invariant is
that users never approve a raw transport name and never receive duplicate permission requests for a
single action.

## 8. Durable Advancement Contract

The gateway and onboarding UI must support all three mutating-action paths:

| Execution path | Expected event shape                                              | UI response                                                                  |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Confirmed      | matching `action_request`, then terminal `action_result`          | Refresh durable state after `executed`; retain/re-arm on `denied` or `error` |
| YOLO           | standalone terminal `action_result` with request ID and tool name | Refresh durable state after `executed`; retain/re-arm on `error`             |
| Trusted auto   | standalone terminal `action_result` with request ID and tool name | Refresh durable state after `executed`; retain/re-arm on `error`             |

Requirements:

- successful and failed non-read executions emit a terminal result record regardless of execution
  mode;
- the result identifies the logical Job Search tool and a stable request ID;
- onboarding accepts either a paired confirmation result or a standalone result for a tool expected
  by the active phase;
- a result can trigger a read but cannot directly advance the phase;
- the fresh snapshot must prove the new checkpoint before the control changes;
- processed terminal results are deduplicated, and overlapping refreshes are serialized;
- stale, unmatched, `allowed`-only, denied, and failed events cannot advance the phase;
- the confirm path continues to correlate a result to its action request.

The native transport's `allowed` result, if one exists during compatibility rollout, is never treated
as Job Search completion.

## 9. Composer Contract

The embedded module composer follows the same keyboard contract as the shared chat composer:

- Enter sends a non-empty message;
- Shift+Enter inserts a newline;
- IME composition does not submit prematurely;
- the Send button remains available and equivalent;
- empty/whitespace-only input does not submit;
- handled module input retains its current control context.

The behavior should reuse or share the existing composer key semantics rather than define a divergent
Job Search-only rule.

## 10. Failure Language

User copy must describe what Jarvis knows, not speculate about blame.

| Condition                           | Required message intent                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| No structured-AI model configured   | AI is not configured for this dev instance; configure it before retrying                                                        |
| Configured provider/CLI unavailable | Jarvis could not complete the critique; retry, with diagnostics kept in server logs                                             |
| Upload rejected                     | Name the accepted formats/size rule                                                                                             |
| Attachment extraction/import failed | Jarvis could not read/import the file; retry or paste the resume                                                                |
| Action denied                       | Nothing changed; the user may retry                                                                                             |
| Durable refresh failed              | The action may have completed, but Jarvis could not verify the saved state; retry the check without repeating the write blindly |

The UI must not say "their end," assert a provider outage without evidence, or expose stack traces,
provider secrets, raw tool names, or private resume text.

## 11. Automated Verification Before Dev Handoff

### 11.1 Native permission tests

- first-party `mcp__jarvis__...` transport calls are allowed without a native action request;
- near-match Jarvis names, other MCP servers, shell/file/native tools, and malformed names are not
  covered by that allow rule;
- gateway policy is still invoked for the logical tool after transport;
- no change weakens destructive or external-action confirmation behavior.

### 11.2 AI bridge tests

- the external-module bridge injects the existing CLI structured-adapter factory;
- the capability router, not Job Search, selects provider/model;
- a configured CLI structured model reaches the adapter rather than returning `needs_config` before
  invocation;
- missing configuration, adapter failure, invalid structured output, and bounds failures return the
  correct opaque worker error and truthful UI state;
- secrets, provider/model identifiers, and token usage do not cross the module boundary.

### 11.3 Worker and UI tests

- PDF/DOCX import remains actor-scoped and delegates to existing resume persistence;
- successful durable state drives `resume_intake → resume_critique → resume_approval`;
- confirmed, YOLO, and trusted-auto result shapes all trigger a serialized fresh read;
- standalone auto/YOLO results do not require a prior `action_request`;
- unmatched, duplicated, stale, denied, error, and `allowed` results cannot advance;
- successful import removes the dropzone; denied/error results keep or re-arm it;
- Enter, Shift+Enter, empty input, and IME composition match the composer contract;
- the right rail, Jarvis identity, loading, retry, and configuration states render as authored UI.

### 11.4 Browser coverage

The real built Job Search web bundle must pass a mocked-boundary browser test for both:

- confirm-run: request → approval → executed result → fresh durable checkpoint;
- auto-run: standalone executed result → fresh durable checkpoint.

The browser test must also prove that an event alone does not advance when the fresh worker fixture
has not changed.

### 11.5 Real dev smoke

Before handing the checklist to Ben, the implementer runs the exact dev artifact through the real API,
gateway, worker, actor-scoped storage, attachment extraction, and configured CLI AI bridge. AI may not
be stubbed. Record the source commit, build/artifact identity, dev deployment time, configured
capability (not credentials), and green commands in the handoff.

## 12. Ben's Dev Acceptance Checklist

The handoff should take roughly five minutes and begin with a reset Job Search onboarding state.

- [ ] Open Job Search and confirm the Jarvis conversation, Jarvis identity, and intended right rail
      are present; the final module tabs are not shown yet.
- [ ] Upload a recognizable PDF or DOCX resume.
- [ ] Confirm that no permission UI contains `mcp__jarvis__`, a raw tool name, JSON, or transport
      language. If a gateway approval appears, confirm it names the actual outcome and appears only
      once for that attempt.
- [ ] Complete the import and confirm the dropzone disappears without refreshing the page.
- [ ] Confirm a real, resume-specific critique appears and no `needs_config`/"their end" message is
      shown.
- [ ] In the composer, confirm Enter sends and Shift+Enter creates a newline.
- [ ] Approve the resume. If policy asks for confirmation, confirm the card describes approving the
      resume and is not duplicated.
- [ ] Refresh the browser and confirm Job Search restores the approved resume checkpoint instead of
      returning to upload.
- [ ] Give an explicit **approve** or **reject with notes** verdict for this recovery slice.

Automated coverage owns malformed files, denial, provider failure, event duplication, and both
execution modes; Ben should not have to manufacture those failure conditions during this short gate.

## 13. Phase-by-Phase Build and Test Plan

Every remaining Job Search phase follows the same loop:

1. agree on the phase's bounded acceptance criteria;
2. implement only that phase on a fresh branch/worktree from current `origin/main`;
3. run focused automated checks and build the exact artifact;
4. deploy that artifact to the dev instance;
5. give Ben a short phase-specific checklist;
6. stop until Ben explicitly approves or rejects it;
7. fix and repeat the same phase if rejected;
8. proceed only after approval.

Planned gates after this recovery slice are:

1. profile intake and profile approval;
2. source selection, required board configuration, and schedule;
3. first monitoring run and opportunity review;
4. complete onboarding regression using the exact distributable artifact;
5. registry promotion and install/upgrade verification;
6. production deployment.

The phase boundaries may be refined in later approved specs, but the early dev HITL gate may not be
removed or deferred to the end.

## 14. Hard Stop and Exit Criteria

This recovery slice passes only when all of the following are true:

- the four confirmed blockers are fixed;
- focused unit, worker, browser, static, and exact-build checks are green;
- the dev smoke uses real storage, gateway execution, attachment extraction, and configured CLI AI;
- the deployed artifact is traceable to the tested commit/build;
- Ben completes the checklist and explicitly approves the slice.

Until then:

- do not start profile/source/monitoring implementation;
- do not claim Job Search onboarding works end to end;
- do not publish or promote a registry artifact;
- do not install the recovery build in production;
- do not change the app-wide default permission model as an incidental Job Search fix.

After approval, the observed permission-card behavior from this dev pass becomes direct evidence for
the separate app-wide permission/HITL design review.
