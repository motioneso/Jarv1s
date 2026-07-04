# Chat priority context ranking (#721)

**Status:** Approved for build via RFA issue #721
**Date:** 2026-07-04
**Tier:** `sensitive`

## Problem

Priority settings are user-facing, but the unified priority model is not fully wired into live chat.
Briefings already read `priority.model.v1` and rank tasks, calendar signals, and email signals.
Chat has `rankChatContext` in `packages/chat/src/priority-consumer.ts`, but it has no production
caller, so user priority settings do not affect live chat context ordering.

The product surface also implies that all muted sources visibly affect Jarvis-wide priority, while
the verified active briefing candidate set is tasks/calendar/email.

## Scope

- Wire the existing priority model into chat cross-tool context ranking where candidates already
  exist.
- Reuse `rankChatContext` / `rankPriorityCandidates`; do not add a second ranking system.
- Keep `@jarv1s/priority` pure: no source reads inside the scorer.
- Confirm which sources actually produce priority candidates in chat and briefings.
- Hide, disable, or explain muted-source controls that have no active consumer.
- Add focused tests proving a user priority model affects chat context ordering and muted-source
  behavior.

## Guardrails

- Do not introduce new source reads to satisfy ranking.
- Do not persist priority candidate snapshots, source bodies, raw tool payloads, secrets, or
  connector metadata.
- Preserve provider-agnostic chat behavior.
- Preserve module isolation: consumers normalize already-loaded source items into candidates.

## Acceptance

- Priority settings affect ordering for already-loaded chat context candidates.
- Muted-source behavior is accurate for the sources that actually have active consumers.
- UI copy/controls do not imply unwired source behavior.
- Tests cover chat ordering and muted-source behavior.

