# Phase 2-5 Branch Review — Pre-Merge Triage (2026-06-13)

Grounded on phase2-portable-deploy @ 4306f0b (main...HEAD, 285 files). Thorough adversarial review: 12 finders (RLS/secrets/write-agency cross-model via Codex) + per-finding adversarial verification. 37 findings -> 14 confirmed material (2 HIGH, 9 MED, 3 LOW) + 23 LOW.

## Verdict

**Merge-after-fixes — blockers present.** Two HIGH confirmed defects (silent sync data-loss + calendar double-booking) must be fixed before merge; the MED cluster should be cleared too. No CRIT, no security/RLS breach.

## Must-fix before merge

**[HIGH] Whole sync runs in ONE transaction with per-item try/catch — silent rollback + false success** (`packages/connectors/src/sync-jobs.ts:132-309`) — The entire sync handler runs in a single Postgres transaction (`registerDataContextWorker` → one `rootDb.transaction()`), with no SAVEPOINTs. One DB-level error (e.g. the `ends_at >= starts_at` CHECK violation from a 1970-epoch event, or any unique/NOT NULL/serialization error) aborts the whole transaction; every later upsert fails 25P02 and is swallowed by the per-item catch. The handler returns normally → COMMIT-on-aborted becomes ROLLBACK → all calendar **and** email upserts are discarded, yet the job reports success with non-zero `calendarUpserted`/`emailUpserted` counts. Silent total-sync data loss with fabricated success under exactly the messy real-data this branch ships to handle. **Fix:** wrap each upsert (and the token-refresh UPDATE) in its own SAVEPOINT (nested `scopedDb.db.transaction()`), or split calendar/email into separate jobs; at minimum detect 25P02 and fail the result instead of reporting fabricated counts.

**[HIGH] freeBusy() treats a per-calendar error (or missing key) as "fully free", double-booking the focus block** (`packages/connectors/src/google-api-client.ts:158`) — `freeBusy` returns `{ busy: json.calendars?.[calendarId]?.busy ?? [] }`. A Google freeBusy **200** can carry a per-calendar `errors[]` (e.g. `notFound`, `rateLimitExceeded`) with empty `busy`; the response type models only `busy`, so the failure is invisible and `?? []` yields an empty busy list. `chooseSlot` then reports the window clear (`conflict: "none"`) and `insertEvent` writes a focus block at the window start — directly over a real meeting, defeating the slice's no-double-booking guarantee. The test mock never models `errors`, so the suite stays green. (The secondary "primary-email key" claim is overstated/not load-bearing; the `errors[]` leg alone confirms.) **Fix:** model `calendars[id].errors` in the response type; in `freeBusy()`, if the requested key is absent OR has non-empty `errors`, throw `GoogleApiError` so `proposeAndInsert`'s try/catch returns `created:false` ("couldn't check availability") instead of inserting into an unverified slot (fail-closed).

## Should-fix (MED)

**Privacy / secrets (defense-in-depth):**

- **Summary echo-guard leaks verbatim body prefixes <50%** (`packages/connectors/src/email-extract.ts:430-441`) — a 200–600-char contiguous body prefix below `BODY_RECONSTRUCTION_FRACTION` slips all three echo-guard arms and persists raw email text into `email_messages.summary`. Drop any summary that is a 200+ char normalized-body substring (remove the `>= body.length * 0.5` requirement).
- **Gemini API key in request URL query string** (`packages/ai/src/adapters/http-api.ts:103`) — `?key=${this.apiKey}` leaks to external proxy/APM/access logs; the branch newly drives this from worker paths against real user keys. Send via `x-goog-api-key` header. (Jarv1s's own logs are clean; risk is external-infra-only.)

**Connector sync correctness (same area as the HIGH):**

- **All-day / missing-time event mapping** (`sync-jobs.ts:128-130`) — all-day events map to UTC midnight (wrong day for western tz); absent start/end → 1970 epoch, which is the landmine that trips the CHECK and poisons the transaction. Skip events lacking usable start/end; use an explicit all-day marker / local-midnight.
- **User-data export omits new `summary` + `signals` columns** (`scripts/export-user-data.ts:307-327`) — migration 0067 added LLM-derived personal data not included in `pnpm export:user` (GDPR/portability hole; erasure is fine). Add `summary` + `signals` to `emailMessagesQuery`.

**Module-enablement / cross-origin:**

- **Route-enablement guard 404s OPTIONS preflight** (`packages/module-registry/src/route-guard.ts:198-234`) — `normalizeMethod` folds only HEAD→GET; OPTIONS to `/api/auth/*` (and any module route) isn't allowlisted → guard returns 404 before better-auth answers. No `@fastify/cors` installed. Dormant same-origin, but breaks exactly as Phase 2 adds `--host`/containerized cross-origin topology. Short-circuit `if (request.method === 'OPTIONS') return;` in the onRequest hook.

**Wellness (net-new module, going live with health data):**

- **Create form 400s for 3 of 6 frequency types** (`apps/web/src/wellness/medications-view.tsx:54-60`) — form offers `specific_weekdays`/`every_n_hours`/`cyclical` but never sends `weekdays`/`intervalHours`/`cycleAnchorDate`+`cycleDaysOn`; selecting any → guaranteed HTTP 400. Add conditional inputs per type, or trim the dropdown to the working three.
- **`every_n_hours` meds never produce schedule slots** (`packages/wellness/src/schedule.ts:52-63`) — `computeSchedule` only iterates `schedule_times`; `interval_hours` is stored but consumed nowhere, so these meds are invisible on the daily schedule and can never be logged. Generate civil-day slots from `interval_hours`.

**Concurrency latent (masked at N=1):**

- **Focus-signal aggregation fans providers via `Promise.all` on one shared transaction connection** (`packages/module-sdk/src/index.ts:104` + `apps/api/src/server.ts:233`) — single Kysely transaction = one pg client; concurrent queries serialize (no real concurrency) and any provider error aborts the shared txn (25P02), poisoning the others and breaking fail-soft. Masked today (only wellness declares a provider) but the seam is built for N≥2, and the JSDoc claims per-provider `withDataContext` it doesn't do. Run sequentially (`for...of await`) or give each provider its own `withDataContext`.

**Frontend resource leak:**

- **Wellness page opens a second always-on chat SSE** (`apps/web/src/wellness/feelings-checkin-modal.tsx:28`) — `useChatStream()` is called above the `if (!props.open) return null` guard, and the modal is always mounted, so every `/wellness` visit opens a redundant EventSource/CLI connection on top of the app-shell's. Mirror `OnboardingChatPanel`: an inner `<AssistedChat/>` that mounts only when `assisting`.

## Needs-human decision

No standalone product/design escalations — every confirmed finding has a concrete fix. The two judgment calls Ben may want to weigh in on before the fixes land:

- **Echo-guard tradeoff:** dropping the `0.5` fraction can null a legitimate 200+ char verbatim summary on a very short email (degrades to metadata-only — fail-safe). Confirm that's acceptable.
- **Wellness frequency scope:** decide whether to _build_ the 3 broken frequency types now (form inputs + `every_n_hours` slotting) or _trim_ the UI to the working three for this merge and defer the rest.

## LOW / post-merge (ride to #209 hardening)

- Token-bearing CLI launch line can reach server logs via multiplexer stderr on `open()` failure — redact `Bearer`/`jst_`/`JARVIS_MCP_TOKEN=` before stderr enters Error/log (`herdr-multiplexer.ts:69-77` et al).
- Blocked-tool scheduled run bypasses same-local-day idempotency → orphan blocked rows per fire (headline "Phase 2 module-disable" trigger refuted; real trigger is a future code-release) (`briefings/src/repository.ts:171-198`).
- `module_enablement_instance_select` omits the `current_actor_user_id() IS NOT NULL` guard — cosmetic consistency only, not a security hole (`settings/sql/0065:1008`).
- Codex HIGH on module_enablement admin-write/instance policies — assessed FALSE POSITIVE (admin = config power per invariant; mirrors `instance_settings`); retained for traceability only.
- Google token-endpoint error body logged as `detail` — body is `{error, error_description}` only, no creds; log `statusCode` only (`connectors/src/oauth.ts:121-124`).
- Post-timeout Approve marks action 'confirmed' in DB but never executes (fails closed; drawer/UX divergence) — mark expired no-op (`ai/src/gateway/confirmation-registry.ts:17`).
- `calendar_events` UPDATE policy lacks the connector-scope EXISTS guard the INSERT policy enforces (owner-scoped, no cross-user leak) — mirror it in a NEW migration (`calendar/sql/0066:54`).
- MCP session bearer token inlined into CLI launch line (`ps`/scrollback) — documented/accepted shared-uid household risk (`chat/src/live/cli-chat-engine.ts:253`).
- Live transcript pinned to `<sessionId>.jsonl`; Codex/Gemini write a different file so replies can't be read back — verify against CLI-deferred scope first (`cli-chat-engine.ts:113`).
- Grounded run content readable by share-view recipients via owner-or-share RLS on `briefing_runs` — latent (no share-create route yet); lock to owner-only before sharing is wired (`briefings/src/routes.ts:215-244`).
- No test drives the API-process (`schedule:false`) `boss.schedule`/`unschedule` path against the runtime grant — add one integration test (`tests/integration/briefings.test.ts:456-581`).
- `rollForward` UPDATE has no unique-violation guard (unlike `generateNext`) — latent; a collision would 500 the whole task list. Wrap in the same try/catch (`tasks/src/recurrence.ts:151`).
- `reconcileRecurrenceSchedule` omits the `assertMetadataOnlyPayload` guard the briefings scheduler runs before `boss.schedule` — add it to catch future payload drift at the source (`tasks/src/recurrence-schedule.ts:31`).
- Per-session recurrence schedule established on every `GET /api/tasks/lists` even for non-recurrence users — gate on the actor having ≥1 recurring series (`tasks/src/routes.ts:413`).
- Misconfigured `JARVIS_EMAIL_SYNC_CAP` (NaN) silently syncs zero emails with `truncated=true` — parse with a positive-int guard, fall back to 50 (`sync-jobs.ts:65,219-220`).
- Mid-loop 401 that fails its retry leaves a stale token for all remaining messages (N extra refreshes) — hoist the rotated token to the outer scope (`sync-jobs.ts:232-283`).
- Out-of-range numeric med fields (`intervalHours`/`timesPerDay`/`cycleDays*`) surface as DB-CHECK 500s not friendly 400s — add route-layer range validation (`wellness/src/routes.ts:255-326`).
- Concurrent check-ins can leave two active energy-trend recall facts (duplicate/contradictory AI prompt facts) — partial unique index + ON CONFLICT, or `FOR UPDATE` (`wellness/src/recall-context.ts:38-65`).
- Skip/take of the same scheduled med slot is irreversible (no UPDATE path on the unique index) — allow upsert or add undo affordance for adherence corrections (`wellness/sql/0084:30-32`).
- Member onboarding section tour lists per-user-disabled modules (uses `/api/modules` not `/api/me/modules`) — cosmetic (route guard 404s the link); build `enabledPaths` from `getMyModules()` (`onboarding/section-tour-step.tsx:31-46`).
- Instance module enable/disable writes an admin-audit row even on a no-op — gate `insertAuditEvent` on `numAffectedRows` (`settings/src/repository.ts:152-180`).
- `BuiltInRouteDependencies.focusSignals` JSDoc claims per-provider `withDataContext` but impl shares one txn — fix the doc (or the impl, which also fixes the MED above) (`module-registry/src/index.ts:138-143`).
- AI REST tool-invoke path never passes the `ToolServices` 4th arg (not exploitable today — REST 403s writes, read tools can't `requiresServices`) — narrow the doc or thread the registry through (`ai/src/routes.ts:451`).
- systemd `ExecStart` uses `EnvironmentFile=` (systemd parser) not `docker --env-file` — a `$` in a generated secret needs `$$` for systemd / literal for docker, corrupting auth/crypto only on reboot. Pass `--env-file` in ExecStart (`infra/systemd/jarv1s-stack.service:22-23`).
- `JARVIS_HOST_UID` and `JARVIS_TMUX_SOCKET_DIR` can drift (socket dir is per-uid) → CLI chat silently breaks; surfaced loudly by reboot-survival probe. Derive the socket-dir default from the uid (`infra/docker-compose.prod.yml:72,99`).
- Two independent sources for the Postgres superuser password (`POSTGRES_PASSWORD` vs `JARVIS_BOOTSTRAP_DATABASE_URL`) can diverge → fail-fast migrate auth error after rotation. Add an explicit "must match / only applies on first volume init" callout, optionally a migrate/smoke assertion (`infra/env.production.example:14,64`).

## What looked solid

- **RLS & cross-user isolation:** no confirmed cross-user leak. The only RLS findings are cosmetic (missing-NOT-NULL guard) or an assessed false positive (admin instance-config write is invariant-compliant, mirrors `instance_settings`). The owner-or-share `briefing_runs` exposure is latent only (no share-create route exists yet).
- **Outbound-write agency / gateway:** confirm-and-run fails closed on timeout (no rogue write); per-turn `submit()` token path is safe (tmux load-buffer temp file, no token in user text). The double-booking HIGH is a freeBusy input-trust gap, not a gateway-policy break.
- **Right-to-erasure:** `delete-user-data` correctly removes the new email summary/signals rows — only the _export_ side lags.
- **Secrets in Jarv1s's own logs:** all three new worker callers log only `error.name` + `message.slice(0,200)`; the Gemini/CLI-token exposures are external-infra / shared-uid surfaces, not in-repo leaks. Job payloads remain metadata-only.
- **Deploy fail modes** are loud/fail-fast (migrate auth, reboot-survival `tmux ls` probe) rather than silent — the deploy findings are operator-ergonomics hardening, not latent corruption.
