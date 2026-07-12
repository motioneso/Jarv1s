# JS-06 — module surface and assistant handoff

**Status:** Draft — issue #935; pending Ben's final approval

**Grounding:** grounded on `eafa22dd`

**Depends on:** #931, #932, #918, and #916

## Goal

Deliver the dedicated external-module UI under `/m/jarv1s.job-search/*`, including one-click handoff
to the existing assistant. The external `Root` owns its internal routing and imports no core module
internals.

## Surface

- Overview: onboarding completion, approved resume/profile status, monitor health, last success,
  next due time, and run-now.
- Onboarding: checkpoint progress and “Continue with Jarv1s,” invoking #916 with an editable starter
  draft.
- Profile/resume: compact approved revision metadata and explicit return-to-assistant actions; full
  editing remains conversational in JS-03.
- Monitors: supported adapter configuration, enabled state, local due time, safe error state.
- Opportunities shell: new/saved/passed/stale routes ready for JS-08.

The Root uses host React, module-scoped query keys, and the browser-safe shared request helper. It
calls declared assistant tools and generic host routes only. External strings render as text, never
raw HTML.

## States and accessibility

Every route has authored loading, empty, error, disabled, and degraded states using existing JDS
tokens/primitives. Run-now prevents duplicate activation and reports queued state without polling
private job output. Keyboard order, focus, labels, status announcements, and reduced-motion behavior
meet existing accessibility conventions.

Disable removes the route/root and starter action without deleting data. Re-enable reloads stored
state. A stale browser session fails closed when server-side enablement changes.

## Verification

- Runtime web-contract/version and shared-React tests.
- No Node/server import in the browser bundle.
- Loading/empty/degraded/disabled screenshots and interaction tests.
- #916 exact editable-draft/focus behavior; no auto-submit.
- Tool/API calls are actor-authenticated and module-gated.
- Disable/re-enable and external-text rendering tests.
- Design-token and accessibility checks.

## Non-goals

- No Today widget, Briefings, embedded chat, bespoke core REST route, or application CRM.

## Review question

Route hierarchy, icon, and final copy can be approved in the normal screenshot review; no additional
architecture choice is required.
