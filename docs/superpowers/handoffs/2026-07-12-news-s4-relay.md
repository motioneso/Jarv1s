# Relay continuation — News Slice 4 (#975, epic #954)

**You are the relay successor (Fable) for the News S4 build agent.** Predecessor relayed at the
70% context-meter trigger after completing ALL grounding — zero re-exploration needed. Your first
deliverable is the PLAN. Do not re-read the files below unless a specific detail is missing;
every integration surface is already mapped here with file:line pointers.

## Pointers

- **Handoff (READ FULL, short):** `docs/coordination/handoff-news-s4.md` — never `git add` it.
- **Spec:** `docs/superpowers/specs/2026-07-11-personalized-news-sources-topics.md` → section
  "Slice 4 — Chat actions, revalidation, and notifications" ONLY (by-section reads; never full).
- **Issue:** #975 (Part of epic #954). **Branch/worktree:** `news-s4`, this directory.
- **Coordinator:** Herdr label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f`
  (authority; resolve pane fresh by label, verify session id). Risk tier **security** — named
  unanimous council (Opus + Codex + Gemini) gates merge, NO fallback; you never merge.
- **Relay rule:** meter 70% warning or compaction summary → relay; successor MUST be Fable
  (`claude --model fable`).
- Skills: `coordinated-build` (lifecycle), `superpowers:writing-plans` (plan format),
  `superpowers:test-driven-development` (build), `coordinated-wrap-up` (closeout),
  `herdr-pane-message` (coordinator comms — caveman-terse), `relay`.

## Status at relay

- Preflight green: HEAD `58638ed7` = handoff commit, 1 ahead of `origin/main@ba4ed180`, 0 behind.
- Spec-vs-branch verification (coordinated-build step ½) **complete: no stale premises.** S1–S3
  deliberately scaffolded the status columns S4 consumes. Real gaps confirmed: no chat write
  tools (only `news.topHeadlinesToday` read tool); no revalidation job/trigger; no Retry UI;
  News emits no notifications.
- No plan file, no code. Working tree clean apart from this doc.
- Coordinator was messaged at relay time with the two escalation flags (migration + no
  provider-change event). **Not yet approved** — the plan message is still owed.

## Your task sequence (coordinated-build order)

1. `[ -d node_modules ] || pnpm install` (node_modules exists — skip).
2. Write plan via `superpowers:writing-plans` →
   `docs/superpowers/plans/2026-07-12-news-s4-chat-actions-revalidation-notifications.md`
   (bite-sized TDD tasks, exact files, green per commit) from the design decisions below.
3. Message coordinator: "plan ready: <path>. Approve, or flag a fork." Include the migration
   escalation (decision D2) and the notification-scope discrepancy (D4) explicitly. **STOP and
   wait for approval — no code before it.**
4. After approval: Fable adversarial self-review of the Slice-4 spec section (confirm-gating
   gaps, revalidation idempotency, notification privacy).
5. TDD build, commit per task (explicit-path `git add`, `Co-Authored-By: Claude` trailer).
   Pre-push trio + rebase before every push.
6. `coordinated-wrap-up` — PR states sentinel/privacy-test approach in body; report; do NOT merge.

## Design decisions for the plan (formed from grounding; escalations flagged)

**D1 — Revalidation trigger: per-owner fingerprint drift, not a provider-change event.**
No provider-change event/hook/bus exists anywhere (whole-tree grep). Hooking AI mutation sites
can't enumerate affected owners under RLS (admin bypass forbidden). Instead: (a) during the
existing owner-scoped refresh worker run, compare each source/topic's stored
`validation_fingerprint` vs current `ai.fingerprint` → mark `needs_revalidation` and enqueue an
owner-scoped revalidation job; (b) per-owner recurring cron via the briefings reconcile pattern
(`boss.schedule` keyed per owner; schedule on source/topic create, unschedule when none left,
self-heal reconcile on personalization reads) for scheduled reachability re-checks.
Fingerprint = sha256(`provider_kind\0model.id`) from `resolveModelForService(scopedDb,
"module.news", {capability:"json", tierHint:"economy"})` — per-owner, provider-agnostic
(`packages/module-registry/src/index.ts:525`).

**D2 — New migration REQUIRED (escalated to coordinator; needs explicit approval).**
Revalidation worker must UPDATE `validation_status`/`validation_fingerprint`/`validated_at` on
`news_custom_sources` AND `news_custom_topics`. Current worker grants (0160 lines 68-88):
sources = SELECT + `UPDATE (health_status)` column-only; topics + exclusions = SELECT only.
→ narrow column-grant migration in `packages/news/sql/`, added to manifest `database.migrations`
AND to foundation.test.ts's FULL migration list (toEqual trap — run full test:integration).
**Never assume the migration number — coordinator assigns it.** Handoff bans unspec'd migrations;
this one is required by the spec's revalidation semantics, but confirm in the plan-approval
message before writing it.

**D3 — Chat tools (6), reusing S2 machinery:**
- `news.previewSource` (risk `read`, `externalContent: true`): runs existing
  resolution+policy path, stores candidates in a preview store, returns candidates for the
  assistant to present.
- `news.confirmSource` (risk `write` → gateway always confirm-gates; no actionFamilyId): input
  `{confirmationId, candidateId}` + display-only label/domain that execute cross-checks against
  the stored candidate — NEVER trusts client/LLM-resubmitted URLs (spec §API shape: short-lived
  opaque confirmation IDs / server-side state).
- `news.removeSource`, `news.addTopic`, `news.removeTopic`, `news.addExclusion` (+
  `news.removeExclusion` optional — handoff scope says add/remove source or topic + add
  exclusion; keep to handoff scope, note edit variants intentionally out — REST/Settings covers).
- Card text via `summarize` (free-form string); do NOT widen `ActionRequestPreview` ({to,
  subject,body}, email-shaped, module-sdk:97-101) — heavier cross-cutting change, avoid.
- **Preview-store sharing problem:** `registerNewsPersonalizationRoutes` creates a route-local
  store (`personalization-routes.ts:156-161`); the two chat tools need a SHARED instance with
  the tool execute path. Options: News-owned `configure*` late-binding (precedent
  `briefing-tool.ts:27-54` — manifest is import-time static, composition root injects at
  registerRoutes) vs `requiresServices` + extend `buildChatToolServices`
  (`packages/chat/src/routes.ts:611-653`, wired as gateway toolServices :723; module-registry
  builds collaborators inline :1118-1150). Late-binding is lighter and News-local — lean that
  way; a module-level shared store instance passed to both routes and tools.
- Repository calls: `NewsPersonalizationRepository` create/delete methods + count caps
  (NEWS_MAX_CUSTOM_SOURCES/TOPICS=10) + `normalizePublisherDomain` reject-by-default.
- Availability capability booleans (hasJsonModel/hasWebSearch) must gate preview tool like the
  REST preview route does.

**D4 — Notification: ONE summary via Notifications public boundary (spec) — flag discrepancy.**
Spec: at most one summary notification when user action required ("2 news sources need
attention"); never per-source/transient. Handoff ALSO mentions "new matching items appear" —
NOT in the spec proper. **Build to spec; flag the discrepancy in the plan-approval message.**
Mechanics: `NotificationsRepository.create(scopedDb, input)` from the revalidation worker
(worker INSERT+SELECT grant exists — notifications sql/0071; recipient forced to current actor
:207-211; returns null when module disabled). Metadata counts only (≤16 keys, primitives,
≤256-char strings, ≤4096 bytes), no private content, no publisher free-text beyond what owner
sees. Dedupe = transition detection (emit only when a status transitioned to action-required in
this run; run-twice → no transition → no duplicate) + optional `listVisible` pre-check
(upgrade-notify pattern, `packages/jobs/src/upgrade-notify.ts:29-44`).

**D5 — Retry affordance + error states.**
New route (e.g. `POST /api/news/revalidation`) enqueuing the owner revalidation job; Settings
Retry button on broken sources (`settings/index.tsx:373-376` badges exist, no Retry). Statuses
are already live in compile filtering (`compilation/candidates.ts:239-240,291,317`). Every new
response field declared in `packages/shared/src/news-api.ts` (fast-json-stringify strips
undeclared — test via `app.inject`).

**D6 — Revalidation queue conventions.**
`news.revalidate` queue following `news.refresh` (`jobs.ts:22-34`): metadata-only payload,
singletonKey per owner, idempotencyKey; any NEW payload key must be added to
`ALLOWED_PAYLOAD_KEYS` (`packages/jobs/src/pg-boss.ts:76-106`). `boss.schedule` bypasses
sendJob's guard — call `assertMetadataOnlyPayload` manually (briefings precedent
`packages/briefings/src/schedule.ts`). Cron engine runs worker-side only ({schedule:true});
schedule-row writes from API routes are fine (briefings does it). No new tables.

## Grounding map (file:line — verified on this branch; trust these, don't re-explore)

- `packages/news/src/manifest.ts` — migrations [0151,0159,0160]; 7 ownedTables; routes incl.
  sources/preview+confirm, topics CRUD, source-exclusions, refresh, personalization; ONE
  assistantTool `news.topHeadlinesToday` (read); NO assistantActionFamilies; dataLifecycle set.
- `packages/news/src/jobs.ts` — NEWS_REFRESH_QUEUE pattern to copy (full file quoted above).
- `packages/news/src/personalization-repository.ts` — methods: list/count/create/replace/delete
  CustomSource, updateSourceHealth(available|unavailable), list/count/create/update/delete
  CustomTopic, list/create/removeExclusion, readRefreshState, bumpRefreshRequest,
  beginRefreshRun, publishSnapshotIfCurrent, failRefreshRunIfCurrent, pruneSnapshotDomain,
  read/upsertPolicyVerdict, readLatestSnapshot, replaceLatestSnapshot. `validation_status`:
  approved|needs_revalidation|rejected; `health_status`: available|unavailable;
  `validation_fingerprint` intentionally never selected into DTOs (~:84 comment — reserved for
  revalidation, i.e. THIS slice).
- `packages/news/src/discovery/preview-store.ts` — in-memory, TTL 10min, maxPerOwner 10,
  owner-checked single-use take(). `VerifiedSourceCandidate{candidateId,label,canonicalDomain,
  homepageUrl,feedUrl,retrievalMethod,sampleCount,validationFingerprint}`.
- `packages/news/src/discovery/policy-validation.ts` — `decideSourcePolicy` :53 (verdict
  approved|rejected+fingerprint | unavailable; cached per (domain,fingerprint) via policy
  verdicts); topic variant :91.
- `packages/news/src/personalization-routes.ts:156-161` — route-local preview store (see D3).
- `packages/news/sql/0160_news_discovery.sql:68-88` — worker grants (see D2). 0159:138 — no
  worker grants on personalization tables, app_runtime full CRUD owner-policies.
- `packages/module-sdk/src/index.ts` — :18 risk union; :441-480 ModuleAssistantToolManifest
  (name, description, permissionId, actionFamilyId?, risk, executionPolicy?, inputSchema?,
  outputSchema?, execute?, summarize?, requiresConfirmation?, preview?, requiresServices?,
  externalContent?); :97-101 ActionRequestPreview email-shaped.
- `packages/ai/src/gateway/gateway.ts` — callTool :99; confirmAndRun :355-444 (pending row w/
  key-names-only inputSummary → notifier → confirmed → run → audit); executableTools :479-519
  fail-closed (read tools w/ requiresServices hidden :492-494); recordAudit :521-559
  best-effort; output capped :339-347; handler throws → {ok:false,"Tool X failed"} :349-352
  (return {data:{error}} for soft failures); confirm-after-timeout no-op :288-290. Policy
  `gateway/policy.ts:29-57` — read→run; write/destructive→confirm (write skips only via
  trusted_auto family promotion — we declare NO family → always confirm. This satisfies the
  handoff's "no write fires without confirmation").
- `packages/ai/src/repository.ts:197-210` — audit input shape; :1874-1893 insert into
  app.jarvis_action_audit_log; pending rows app.ai_assistant_action_requests :1651,:1680.
- Write-tool examples: `packages/email/src/manifest.ts:218-271` + `email/src/tools.ts:201-260`;
  simplest: `packages/tasks/src/manifest.ts:633-643` + `tasks/src/tools.ts:188-196`.
- `packages/notifications/src/repository.ts` — create :175-222; CreateNotificationInput :29-35
  {moduleId,title,body?,metadata?,urgency?}; recipient = current actor :207-211; metadata bounds
  in `notifications/src/metadata.ts`; NotificationDto has NO link field (deep-link via metadata;
  `packages/shared/src/notifications-api.ts:18-28`).
- `packages/briefings/src/schedule.ts` — per-owner cron reconcile pattern (see D1/D6); wired
  briefings/routes.ts:80 (self-heal on reads), :121/:148 (reconcile on mutation,
  failure-isolated).
- `packages/briefings/src/jobs.ts:171-181` — notification-from-worker precedent (try/catch,
  never fails the run).
- `packages/jobs/src/pg-boss.ts` — :76-106 ALLOWED_PAYLOAD_KEYS; :268-297
  registerDataContextWorker (assertUuid actorUserId, requestId "pgboss:<id>").
- `packages/module-registry/src/index.ts` — buildNewsDiscoveryPorts :479 (ai.fingerprint :525);
  News registerRoutes/registerWorkers wiring quoted in relay context; NotificationsRepository
  constructed :1058 (routes), :1223 (workers); registerChatRoutes collaborators :1118-1150.
- `packages/chat/src/routes.ts:611-653` — buildChatToolServices; :723 gateway toolServices.
- `packages/news/src/settings/index.tsx:373-376,413` — status badges exist; NO Retry affordance.
- `packages/news/src/compilation/candidates.ts:239-240,291,317` — compile already filters on
  validation/health status (statuses live).
- `packages/news/src/briefing-tool.ts:27-54` — configure* late-binding precedent.
- `packages/notifications/sql/0071_notifications_worker_insert_grant.sql` — worker
  INSERT+SELECT grant + recipient-check policy (SELECT needed for INSERT…RETURNING).

## Traps (from memory + grounding — verify in tests)

- fast-json-stringify strips undeclared response fields silently → declare in
  `packages/shared/src/news-api.ts`, test via `app.inject`.
- foundation.test.ts asserts FULL migration list with `toEqual` → add the new migration row +
  run full `test:integration` (focused module test won't catch).
- RLS positive controls: cross-owner AND admin read → 0 rows/42501, EACH paired with
  owner-positive control.
- Metadata-only payloads everywhere; `boss.schedule` bypasses the sendJob guard.
- No secrets/article bodies/free-text in logs, payloads, prompts, notifications.
- agentmemory `memory_smart_search` returns empty in this environment — rely on MEMORY.md.
- Never `git add -A`; never touch `docs/coordination/`; caveman-terse to coordinator,
  conventional in commits/PR/code comments (generous why-comments citing issue IDs).
