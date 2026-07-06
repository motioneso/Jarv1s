# Live-First Source Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make email/calendar live-first: a connector-owned provider-neutral SourceContextService feeds briefings/chat/Today with live reads (cache only as transient-failure fallback), triages email into an actionability taxonomy, stages/creates email-derived tasks under user-configurable modes with accept/reject feedback learning, runs proactive monitors, and removes manual "Sync now" from the UI.

**Architecture:** New `packages/connectors/src/source-context/` service exposed structurally via ToolServices (`services.sourceContext`); email/calendar read tools narrow it at runtime and fail closed. Triage extends `extractEmailSignals` (one triage path everywhere). Monitors are pg-boss cron jobs per account reusing the same service. Tasks gain a `suggested` status; feedback is a connectors-owned RLS table wired into tasks accept/reject via a structural port composed in module-registry.

**Tech Stack:** TypeScript, Kysely/Postgres (RLS), pg-boss, Fastify, React + React Query, Vitest, Playwright.

**Tracking:** GitHub issue #729. Spec: `docs/superpowers/specs/2026-07-04-live-first-source-context.md` (branch `docs/729-live-first-source-context-spec`). Worktree `~/Jarv1s-wt/729-live-first-source-context`, branch `feat/729-live-first-source-context`, grounded on afd897b2 (origin/main).

## Global Constraints

- DataContextDb only; AccessContext = `{ actorUserId, requestId }`; RLS applies to all actors; no admin bypass.
- Full email bodies NEVER in: briefing prompts, task descriptions, job payloads, logs, source metadata, persisted learning records, user-visible cards. Bounded summaries only (`MAX_SUMMARY_CHARS = 600`), body-echo guarded.
- Metadata-only pg-boss payloads (ALLOWED_PAYLOAD_KEYS, `packages/jobs/src/pg-boss.ts:67`). Monitor payloads: `{ actorUserId, connectorAccountId, kind }` — all already allowed.
- Cache fallback ONLY on transient failures (network, provider 5xx, 429, timeout, internal). Auth broken / revoked / grant disabled / unsupported provider → actionable gap, NEVER silent cache.
- Every result item carries `source: "live" | "cache"`; degraded results carry `degradedReason`.
- Module isolation: email/calendar/briefings/tasks never import `@jarv1s/connectors`; structural interfaces only. Connectors never imports `@jarv1s/tasks`; task creation via injected port.
- Provider-agnostic AI: triage via `selectModelForCapability(scopedDb, "summarization", "economy")` only (economy-tier-only invariant in email-extract stays).
- Migrations: next numbers **0140** (tasks) and **0141** (connectors). Append both to `tests/integration/foundation.test.ts` migration list (ends 0139). Never edit applied migrations. Module SQL in owning module's `sql/`.
- Design system: `jds-*` primitives, no curved accent left-borders on cards, raw colors only in `tokens.css`.
- File-size gate: 1000 lines max per source file. Full local gate: `pnpm verify:foundation`.
- Out of scope: email reply flow rewrite (email.draftReply/sendReply/emailReplyPreview stay as-is), removing cached tables/sync jobs, multi-account UX redesign, cross-user learning, webhooks.

## Grounded facts (verified in worktree — do not re-derive)

- `EmailReadProvider<TCredential>` seam: `packages/connectors/src/email-read-provider.ts` (`GoogleEmailReadProvider(client, query)`, `GMAIL_READ_FOLDER`); IMAP impl `imap-email-read-provider.ts` (`ImapEmailReadProvider`, `IMAP_DEFAULT_FOLDER`, fixed 30-day window, NO sinceKey).
- Credentials: `ConnectorsRepository.getActiveGoogleAccountSecret(scopedDb)` / `getActiveImapAccountSecret(scopedDb, accountId)`; `decryptGoogleConnectionSecret` / `decryptImapConnectionSecret(cipher, envelope)`; Google tokens via `GoogleConnectionService.getFreshAccessToken(scopedDb, { force? })`.
- Accounts: `ConnectorsRepository.listAccounts(scopedDb): ConnectorAccountSafeRow[]` — has `id, provider_id, provider_type ("calendar"|"email"|"google"|"imap"), provider_display_name, scopes, status ("active"|"error"|"revoked"), last_sync_*`.
- Grants: `resolveEffectiveGrants(scopes, stored)`, `featureGrantsPrefKey(accountId)`, `buildFeatureGrantService` in `feature-grant-service.ts`.
- Triage base: `extractEmailSignals(parsed, deps, options)` in `email-extract.ts`; `EmailSignals { billsDue?, actionItems?, deadlines?, mayGetLostInShuffle?, importance?, confidence?, truncated? }`; guards are module-private → extend INSIDE email-extract.ts.
- Tasks: enum `app.task_status` currently `('todo','in_progress','done','archived')` (0003); TS `TaskStatus = "todo"|"done"|"archived"`; dedupe in `TasksRepository.create` on `(source, external_key)` + unique partial index (0039:80). REST create/update do NOT accept source/externalKey (internal-only) — keep it that way.
- Gateway: `registerAiRoutes(..., readToolServices: { featureGrants })` at `module-registry/src/index.ts:568-591`; briefings `composeDeps` at :637-698; `gatherToolSection` builds toolServices at `briefings/src/compose-shared.ts:262-264`.
- Source behaviors are boolean-only (`packages/source-behaviors`); `email.capture-tasks` currently `"coming-soon"` in `packages/email/src/manifest.ts`.
- Sync-now UI: personal `apps/web/src/settings/settings-personal-data-panes.tsx` AccountCard :196-208 + ConnectedPane mutation :299-321; admin `settings-admin-panes.tsx` OversightPane :746-755 + mutation :701-709. No e2e asserts the literal "Sync now" (connector sync route mocked in `tests/e2e/mock-calendar-email-api.ts`).
- Monitors keep existing 15-min sync crons (`google-schedule.ts`, `imap-schedule.ts`) as fallback-cache maintenance.
- Briefings live-read at compose time via the rewired tools → "near-term refresh before briefings" is inherent; document in PR.

---

### Task 1: Source-context types + failure classification (`packages/connectors/src/source-context/types.ts`)

**Files:** Create `packages/connectors/src/source-context/types.ts`; Test `tests/unit/source-context-classify.test.ts`.

**Produces (later tasks consume verbatim):**

```ts
export type SourceMode = "live" | "cache";
export type SourceContextGapReason =
  | "auth_error"
  | "connector_revoked"
  | "feature_grant_disabled"
  | "unsupported_provider"
  | "service_unavailable";
export type DegradedReason =
  | "network_error"
  | "provider_error"
  | "rate_limited"
  | "timeout"
  | "internal_error";
export type EmailActionability =
  | "needs_reply"
  | "needs_action"
  | "time_sensitive_info"
  | "waiting_on_someone"
  | "fyi"
  | "noise"
  | "unknown";
export interface SourceAccountMeta {
  readonly connectorAccountId: string;
  readonly providerId: string;
  readonly providerLabel: string;
}
export interface EmailSuggestedTaskCandidate {
  readonly title: string;
  readonly dueDate: string | null;
}
export interface EmailContextItem {
  readonly messageKey: string; // provider-stable external id
  readonly account: SourceAccountMeta;
  readonly sender: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly receivedAt: string;
  readonly threadId: string | null;
  readonly snippet: string | null;
  readonly summary: string | null; // bounded, body-echo guarded
  readonly actionability: EmailActionability;
  readonly importance: "low" | "normal" | "high";
  readonly confidence: number;
  readonly reason: string | null;
  readonly dueDate: string | null;
  readonly suggestedTasks: readonly EmailSuggestedTaskCandidate[];
  readonly source: SourceMode;
  readonly degradedReason: DegradedReason | null;
  readonly cacheMessageId: string | null; // reply flows need the cached row id when present
}
export type CalendarContextFlag = "conflict" | "early" | "late" | "has_location" | "prep_attendees";
export interface CalendarContextItem {
  readonly eventKey: string;
  readonly account: SourceAccountMeta;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly allDay: boolean;
  readonly location: string | null;
  readonly attendeeCount: number;
  readonly flags: readonly CalendarContextFlag[];
  readonly source: SourceMode;
  readonly degradedReason: DegradedReason | null;
}
export interface SourceContextAccountResult {
  readonly account: SourceAccountMeta;
  readonly source: SourceMode;
  readonly degradedReason: DegradedReason | null;
}
export interface SourceContextGap {
  readonly account: SourceAccountMeta | null;
  readonly reason: SourceContextGapReason;
}
export interface EmailContextResult {
  readonly items: readonly EmailContextItem[];
  readonly accounts: readonly SourceContextAccountResult[];
  readonly gaps: readonly SourceContextGap[];
}
export interface CalendarContextResult {
  readonly items: readonly CalendarContextItem[];
  readonly accounts: readonly SourceContextAccountResult[];
  readonly gaps: readonly SourceContextGap[];
}
export interface ListEmailContextInput {
  readonly limitPerAccount?: number;
}
export interface ListCalendarContextInput {
  readonly windowStart?: string;
  readonly windowEnd?: string;
  readonly limit?: number;
}
export interface SourceContextService {
  listEmailContext(
    scopedDb: DataContextDb,
    input: ListEmailContextInput
  ): Promise<EmailContextResult>;
  listCalendarContext(
    scopedDb: DataContextDb,
    input: ListCalendarContextInput
  ): Promise<CalendarContextResult>;
}
export type LiveReadFailure =
  | { readonly kind: "transient"; readonly degradedReason: DegradedReason }
  | { readonly kind: "auth" };
export function classifyLiveReadFailure(error: unknown): LiveReadFailure;
```

`classifyLiveReadFailure` rules (spec §4): `statusCode` 401/403 → `{kind:"auth"}`; 429 → transient `rate_limited`; >=500 → transient `provider_error`; name `AbortError`/message contains `timeout`/`ETIMEDOUT` → `timeout`; `TypeError` fetch failures / `ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN` in message → `network_error`; anything else → transient `internal_error`.

- [ ] Write failing test `tests/unit/source-context-classify.test.ts` covering all branches above (construct errors with `statusCode`, names, messages)
- [ ] Implement types.ts; run test; commit `feat(connectors): source-context types + live-read failure classification (#729)`

### Task 2: Actionability triage inside email-extract

**Files:** Modify `packages/connectors/src/email-extract.ts`; Test `tests/unit/email-extract-actionability.test.ts`.

**Produces:** `EmailSignals` gains `readonly actionability?: EmailActionabilitySignal`:

```ts
export interface EmailActionabilitySignal {
  readonly category:
    | "needs_reply"
    | "needs_action"
    | "time_sensitive_info"
    | "waiting_on_someone"
    | "fyi"
    | "noise"
    | "unknown";
  readonly reason?: string; // bounded MAX_SIGNAL_STR_CHARS
  readonly dueDate?: string;
  readonly suggestedTasks?: EmailActionItem[]; // reuse {text, dueDate?}
}
```

Prompt additions: request `actionability` JSON with the 7-category taxonomy; explicit rules — marketing/newsletters/receipts → `noise`/`fyi`, never `needs_reply` from subject heuristics; real human request → `needs_reply`; bill/hard deadline → `needs_action` + suggestedTasks. Sanitization: extend the private `sanitizeSignals` path — category coerced to the union (else `unknown`), `reason` through `safeSignalStr`, `suggestedTasks` through the `safeActionItems` guard (bounded count/length + body-echo drop). Cached rows persist this via existing sync upserts (`signals` jsonb) with no schema change — cache fallback then serves triage for free.

- [ ] Failing tests: fake `runChat` returning (a) real request → `needs_reply`; (b) bill due → `needs_action` + suggested task with dueDate; (c) marketing blast → `noise`, no suggestedTasks; (d) receipt-only → `fyi`, no suggestedTasks; (e) body-echo in reason/suggested title gets dropped; (f) garbage category → `unknown`
- [ ] Implement prompt + sanitize; keep economy-only invariant untouched; tests pass; commit `feat(connectors): actionability taxonomy in email triage (#729)`

### Task 3: Email source context (`source-context/email.ts`)

**Files:** Create `packages/connectors/src/source-context/email.ts`; Test `tests/unit/source-context-email.test.ts`.

**Consumes:** Task 1 types; `EmailReadProvider`, providers, secrets, `extractEmailSignals`, `EmailRepository`, `resolveEffectiveGrants`.

**Produces:**

```ts
export const LIVE_EMAIL_CAP = 30; // newest keys listed live per account
export const LIVE_TRIAGE_CAP = 8; // max fresh LLM triages per account per read
export interface EmailSourceContextDeps {
  readonly connectorsRepository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly preferencesRepository: {
    get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  };
  readonly googleService: {
    getFreshAccessToken(scopedDb: DataContextDb, opts?: { force?: boolean }): Promise<string>;
  };
  readonly googleClient: GmailReadClient;
  readonly emailRepository: EmailRepository;
  readonly makeEmailExtractDeps: (scopedDb: DataContextDb) => EmailExtractDeps;
  readonly imapProvider?: EmailReadProvider<ImapConnectionSecret>;
  readonly now?: () => Date;
  readonly logger?: SyncLogger;
}
export async function listEmailContext(
  scopedDb: DataContextDb,
  deps: EmailSourceContextDeps,
  input: ListEmailContextInput
): Promise<EmailContextResult>;
```

Behavior per account from `listAccounts` (email-capable = effective grant `email` true):

1. `status === "revoked"` → gap `connector_revoked`. Grant off → gap `feature_grant_disabled`. `provider_type` not google/imap-email-capable → gap `unsupported_provider`. Zero email accounts → gap `no accounts` is NOT a gap reason in types — return empty result with gap `service_unavailable`? NO: zero accounts returns empty `items/accounts/gaps` (nothing to report; briefings' existing `empty` gap covers it).
2. Credential resolution failure (missing secret, decrypt throw, `getFreshAccessToken` throw) → gap `auth_error`, NO cache.
3. Live read: list newest keys (cap `LIVE_EMAIL_CAP`), fetch messages. Triage economy: load cached rows via `emailRepository.listVisibleForBriefing` once, index by `external_id` — cached `summary`/`signals` (incl. actionability) reused when present; otherwise run `extractEmailSignals` on the fetched message for up to `LIVE_TRIAGE_CAP` messages; beyond cap without cache → `actionability: "unknown"`, `confidence: 0`, `summary: null`. Items get `source: "live"`, `cacheMessageId` from the matched cached row (else null). Live path persists NOTHING.
4. Any thrown live-read error → `classifyLiveReadFailure`: `auth` → single forced token refresh retry (Google only), then gap `auth_error`; `transient` → cache fallback: cached rows for that account mapped to `EmailContextItem` with `source: "cache"`, `degradedReason` set, triage from persisted `signals`.
5. Per-message fetch failures: skip the message; if >half fail, treat the account read as transient `provider_error` fallback.

- [ ] Failing tests with fake providers/repos: (a) Google+IMAP both live → items from both, `source:"live"`, account results live; (b) IMAP listMessageKeys throws ECONNRESET → that account falls back to cache items `source:"cache"` `degradedReason:"network_error"`, Google unaffected; (c) Google 401 on both attempts → gap `auth_error` and ZERO cache items for it; (d) grant disabled → gap `feature_grant_disabled`, no read attempted; (e) revoked → `connector_revoked`; (f) cached-triage reuse: message with cached signals gets category without calling runChat; uncached beyond LIVE_TRIAGE_CAP → `unknown`; (g) no full body on any item (assert no `body` key and summary ≤ 600 chars)
- [ ] Implement; tests pass; commit `feat(connectors): live-first email source context with transient-only cache fallback (#729)`

### Task 4: Calendar source context (`source-context/calendar.ts`)

**Files:** Create `packages/connectors/src/source-context/calendar.ts`; Test `tests/unit/source-context-calendar.test.ts`.

**Produces:**

```ts
export interface CalendarSourceContextDeps {
  readonly connectorsRepository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly preferencesRepository: {
    get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  };
  readonly googleService: {
    getFreshAccessToken(scopedDb: DataContextDb, opts?: { force?: boolean }): Promise<string>;
  };
  readonly googleClient: {
    listCalendarEvents(input: {
      accessToken: string;
      calendarId?: string;
      timeMin: string;
      timeMax: string;
    }): Promise<GoogleCalendarEvent[]>;
  };
  readonly calendarRepository: CalendarRepository;
  readonly now?: () => Date;
  readonly timeZone?: string; // default process.env.JARVIS_DEFAULT_TZ ?? "America/New_York"
  readonly logger?: SyncLogger;
}
export const CALENDAR_DEFAULT_LOOKAHEAD_MS = 48 * 60 * 60 * 1000;
export function classifyCalendarFlags(
  items: readonly {
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    location: string | null;
    attendeeCount: number;
  }[],
  timeZone: string
): CalendarContextFlag[][];
export async function listCalendarContext(
  scopedDb: DataContextDb,
  deps: CalendarSourceContextDeps,
  input: ListCalendarContextInput
): Promise<CalendarContextResult>;
```

Window: `windowStart` default now, `windowEnd` default now+48h. Exclude past events (`ends_at < now`). Exclude all-day events spanning the whole window with no location/attendees (routine noise, spec §3). Flags: `conflict` (time overlap with another non-all-day item), `early` (starts before 09:00 local), `late` (starts after 18:00 local), `has_location`, `prep_attendees` (attendeeCount ≥ 2). Same account/grant/gap/fallback rules as Task 3 (calendar grant; Google live via `listCalendarEvents`, event-time mapping copied from `mapEventInstants` rules in sync-jobs.ts — skip unusable, all-day = date-only both sides). IMAP accounts are not calendar-capable → skipped silently (not a gap). Cache fallback via `calendarRepository.listVisible({ startsAfter, startsBefore })` filtered to the account.

- [ ] Failing tests: window filtering (past excluded, future-in-window included), each flag, conflict detection, transient fallback with `source:"cache"`, auth gap no-cache, grant-disabled gap, routine all-day excluded
- [ ] Implement; tests pass; commit `feat(connectors): live-first calendar source context (#729)`

### Task 5: Service assembly + package export

**Files:** Create `packages/connectors/src/source-context/service.ts`; Modify `packages/connectors/src/index.ts` (add exports); Test covered by Tasks 3–4 (service is thin composition).

```ts
export interface SourceContextServiceDeps
  extends EmailSourceContextDeps, CalendarSourceContextDeps {}
export function buildSourceContextService(deps: SourceContextServiceDeps): SourceContextService {
  return {
    listEmailContext: (scopedDb, input) => listEmailContext(scopedDb, deps, input),
    listCalendarContext: (scopedDb, input) => listCalendarContext(scopedDb, deps, input)
  };
}
```

- [ ] Implement + export `buildSourceContextService`, all types, from `@jarv1s/connectors`; typecheck; commit `feat(connectors): buildSourceContextService (#729)`

### Task 6: Rewire email + calendar read tools to sourceContext

**Files:** Modify `packages/email/src/tools.ts`, `packages/calendar/src/tools.ts`, `packages/email/src/manifest.ts` + `packages/calendar/src/manifest.ts` (output schemas only — do NOT add `requiresServices` to read tools; the gateway hides read tools that declare it); Tests `tests/unit/email-tools-source-context.test.ts`, `tests/unit/calendar-tools-source-context.test.ts`.

Each tool re-declares a local structural `SourceContextService` interface (module isolation — copy the two method signatures; item types as `Record<string, unknown>`-tolerant local interfaces or duplicated literal unions). Narrow pattern (mirrors `narrowFeatureGrants`):

```ts
function narrowSourceContext(services: ToolServices | undefined): SourceContextService {
  const svc = (services ?? {}).sourceContext as SourceContextService | undefined;
  if (!svc || typeof svc.listEmailContext !== "function") {
    throw new Error("sourceContext service is not available"); // fail closed — never stale direct cache reads
  }
  return svc;
}
```

`emailListVisibleMessagesExecute` → `narrowSourceContext(services).listEmailContext(scopedDb, {})`; return `{ data: { messages: items.map(serialize), accounts, gaps } }`. Serialized message: `{ id: messageKey, cacheMessageId, connectorAccountId, providerLabel, sender, recipients, subject, receivedAt, threadId, snippet, summary, actionability, importance, confidence, reason, dueDate, suggestedTasks, source, degradedReason }` — no body field exists to leak. `calendarListVisibleEventsExecute` → `listCalendarContext(scopedDb, { windowStart: startsAfter, windowEnd: startsBefore, limit })`; events serialized from `CalendarContextItem` + `accounts`/`gaps`. Delete the now-dead `narrowFeatureGrants`/repository-read paths from both tools (grants enforced inside the service; No Stale Concepts). Update manifests' tool output JSON schemas to the new shapes. Write tools untouched.

- [ ] Failing tests: services absent → throws "sourceContext service is not available"; fake service → serialized output matches shape incl. `source`/`degradedReason`/`gaps`; no `body`/`bodyExcerpt` key on messages
- [ ] Implement; update the existing tests that fed these tools cached rows (`tests/unit/calendar-list-visible.test.ts`, `tests/integration/email-briefing-tool.test.ts`, `tests/integration/calendar-email.test.ts` — swap to fake sourceContext); commit `feat(email,calendar): read tools consume sourceContext, fail closed (#729)`

### Task 7: Composition-root + briefings + chat wiring

**Files:** Modify `packages/module-registry/src/index.ts` (:568-591 readToolServices, :592-624 chat, :637-698 composeDeps), `packages/briefings/src/compose-shared.ts` (ComposeDeps + gatherToolSection toolServices), `packages/chat/src/routes.ts` (accept + pass `sourceContextService` into its read-tool services — locate its tool-services assembly by grepping `featureGrants` in packages/chat).

Composition root builds ONE service:

```ts
const sourceContextService = deps.connectorsRepository
  ? buildSourceContextService({
      connectorsRepository: deps.connectorsRepository,
      cipher: createConnectorSecretCipher(),
      preferencesRepository: new PreferencesRepository(),
      googleService: deps.googleConnectionService,
      googleClient: deps.googleApiClient,
      emailRepository: new EmailRepository(),
      calendarRepository: new CalendarRepository(),
      makeEmailExtractDeps: (scopedDb) => ({
        /* same selectModel/runChat block as registerConnectorsJobWorkers, hoisted into an exported helper `buildEmailExtractDeps(scopedDb)` in connectors to avoid a third copy */
      })
    })
  : undefined;
```

Refactor: export `buildEmailExtractDeps(scopedDb, aiRepo, aiCipher): EmailExtractDeps` from connectors (extracted from `sync-jobs.ts:569-601`), reuse in sync-jobs, imap-sync-jobs, and here (DRY).

- readToolServices → `{ featureGrants, sourceContext: sourceContextService }`.
- chat: pass `sourceContextService` through `registerChatRoutes` deps into its tool services object.
- briefings: `ComposeDeps` gains `readonly sourceContextService?: SourceContextToolService;` (structural inline type, same shape as the tools' local interface); `gatherToolSection` toolServices becomes:

```ts
const toolServices = {
  ...(deps.featureGrantService ? { featureGrants: deps.featureGrantService } : {}),
  ...(deps.sourceContextService ? { sourceContext: deps.sourceContextService } : {})
};
```

- [ ] Wire all three; typecheck; update `tests/unit/briefings-compose.test.ts` fixtures to inject a fake sourceContext service via composeDeps; commit `feat(module-registry,briefings,chat): inject sourceContext into read-tool services (#729)`

### Task 8: Briefings consume triage + live/cache metadata

**Files:** Modify `packages/briefings/src/compose.ts` (email/calendar sections, sourceMetadata :425-446), `packages/briefings/src/compose-evening.ts` (read it first — its email section must apply the same rules), `packages/briefings/src/signals.ts` if `deriveEmailSignals` reads old fields; Test: update `tests/unit/briefings-compose.test.ts`, `tests/unit/prod-compose-plan.test.ts`.

- Email section format allow-list now: `sender · subject · actionability · summary-or-snippet` and FILTERS items to actionable categories `needs_reply | needs_action | time_sensitive_info | waiting_on_someone` (waiting_on_someone only when `importance === "high"` or `confidence >= 0.7`). `noise`/`fyi`/`unknown` excluded from prompt lines (spec §7).
- Calendar section: items already future-only from the service; keep local-day bound for morning "today" framing, evening uses tomorrow framing per its existing structure.
- sourceMetadata: add `sourceContext: { email: { accounts: [{connectorAccountId, source, degradedReason}], gaps }, calendar: {...} }` built from the tool responses' `accounts`/`gaps` arrays (tool data now carries them — thread through `rawItems`? No: `gatherToolSection` only extracts the array. Add an optional `metaKeys?: string[]` arg to `gatherToolSection` that copies named top-level keys from tool `data` onto the returned Section as `meta?: Record<string, unknown>`). `degraded: true` when any account `source === "cache"`; auth/grant gaps map to a new BriefingGap reason `"source_auth"` (extend the union in compose-shared.ts: `"tool_failed" | "truncated" | "empty" | "unwired" | "source_auth"`).
- Briefing text: when degraded, synthesized prompt trusted-instructions already handle gaps notes; ensure gap note strings for auth say "reconnect" style actionable copy (pure literal in trusted instructions).

- [ ] Update tests: fake sourceContext-backed tool returns mixed categories → prompt lines contain only actionable ones; cache-degraded account → `sourceMetadata.degraded === true`; auth gap → gap recorded with `source_auth`
- [ ] Implement; unit tests pass; commit `feat(briefings): actionable-triage email section + live/cache source metadata (#729)`

### Task 9: Migration 0140 — `suggested` task status

**Files:** Create `packages/tasks/sql/0140_task_status_suggested.sql`; Modify `packages/db/src/types.ts:162`, `packages/shared/src/tasks-api.ts:4`, `packages/tasks/src/repository.ts` (status handling: `suggested` never sets completed_at; completion cascade ignores it), `tests/integration/foundation.test.ts` (append row); Test `tests/integration/tasks-suggested-status.test.ts`.

```sql
-- 0140_task_status_suggested.sql
-- Email-derived staged tasks (spec #729 §5): the smallest explicit review state.
ALTER TYPE app.task_status ADD VALUE IF NOT EXISTS 'suggested';
```

TS: `TaskStatus = "todo" | "suggested" | "done" | "archived"`; `TASK_STATUSES = ["todo", "suggested", "done", "archived"]`.

- [ ] Failing integration test: create task with `status: "suggested"` via repository (source "email", externalKey) → row persists; duplicate externalKey create returns the existing row; PATCH status suggested→todo works
- [ ] Add migration + type updates + foundation.test.ts row `{ version: "0140", name: "0140_task_status_suggested.sql" }`; run `pnpm db:migrate` + the new test + full `pnpm test:integration` locally (foundation list assertion); commit `feat(tasks): suggested status for staged email tasks (#729)`

### Task 10: Migration 0141 — email triage feedback table + repository methods

**Files:** Create `packages/connectors/sql/0141_email_triage_feedback.sql`; Modify `packages/connectors/src/repository.ts` (add `recordTriageFeedback`, `listTriageRejectionAggregates`); foundation.test.ts (append row); Test `tests/integration/email-triage-feedback.test.ts`.

```sql
-- 0141_email_triage_feedback.sql — per-user accept/reject learning (spec #729 §6).
-- No message bodies: sender/domain/subject prefix + verdict only.
CREATE TABLE app.email_triage_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  connector_account_id uuid,
  source text NOT NULL DEFAULT 'email',
  actionability text NOT NULL,
  sender text NOT NULL,
  sender_domain text NOT NULL,
  subject_prefix text,
  action_type text,
  confidence real,
  model_version text,
  verdict text NOT NULL CHECK (verdict IN ('accepted', 'rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_triage_feedback_owner_domain_idx
  ON app.email_triage_feedback (owner_user_id, sender_domain, verdict);
ALTER TABLE app.email_triage_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.email_triage_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY email_triage_feedback_app_rw ON app.email_triage_feedback
  FOR ALL TO jarvis_app_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
CREATE POLICY email_triage_feedback_worker_rw ON app.email_triage_feedback
  FOR ALL TO jarvis_worker_runtime
  USING (owner_user_id = app.current_actor_user_id())
  WITH CHECK (owner_user_id = app.current_actor_user_id());
GRANT SELECT, INSERT ON app.email_triage_feedback TO jarvis_app_runtime, jarvis_worker_runtime;
```

(Verify policy/grant phrasing against `packages/connectors/sql/0131…` and the wellness 0139 pattern before finalizing; add the table to the RLS audit lists if `protectedTables` enumerates tables — grep `protectedTables` in tests.)

Repository methods:

```ts
export interface TriageFeedbackInput {
  readonly connectorAccountId: string | null;
  readonly actionability: string;
  readonly sender: string;
  readonly senderDomain: string;
  readonly subjectPrefix: string | null; // caller truncates to 120 chars
  readonly actionType: string | null;
  readonly confidence: number | null;
  readonly modelVersion: string | null;
  readonly verdict: "accepted" | "rejected";
  readonly reason: string | null;
}
async recordTriageFeedback(scopedDb: DataContextDb, input: TriageFeedbackInput): Promise<void>;
async listTriageRejectionAggregates(
  scopedDb: DataContextDb
): Promise<Array<{ senderDomain: string; rejected: number; accepted: number }>>;
```

- [ ] Failing integration test: record accepted+rejected rows; aggregates group correctly; RLS — second user sees zero rows (use `resetFoundationDatabase` + two actor contexts, pattern from `tests/integration/google-sync-rls.test.ts`)
- [ ] Migration + methods + foundation row `0141`; tests pass; commit `feat(connectors): email triage feedback store (#729)`

### Task 11: Task-creation modes + email task engine

**Files:** Create `packages/connectors/src/source-context/email-tasks.ts`; Modify `packages/email/src/manifest.ts` (remove the stale `email.capture-tasks` coming-soon behavior — replaced by the functional mode), `packages/email/src/routes.ts` (GET/PUT `/api/email/task-creation-mode`), `packages/shared/src/email-api.ts` (mode types); Test `tests/unit/email-monitor-tasks.test.ts`, `tests/unit/email-task-mode-routes.test.ts`.

**Produces:**

```ts
export type EmailTaskCreationMode = "off" | "suggest" | "auto_safe" | "auto";
export const EMAIL_TASK_MODE_PREF_KEY = "email.task_creation_mode";
export const DEFAULT_EMAIL_TASK_MODE: EmailTaskCreationMode = "suggest";
export function parseEmailTaskMode(value: unknown): EmailTaskCreationMode; // invalid → default
export interface EmailTaskCreationPort {
  create(
    scopedDb: DataContextDb,
    input: {
      readonly title: string;
      readonly description: string | null; // bounded summary, never body
      readonly status: "suggested" | "todo";
      readonly dueAt: string | null;
      readonly priority: number | null;
      readonly source: "email";
      readonly sourceRef: string;
      readonly externalKey: string;
    }
  ): Promise<{ readonly id: string }>;
}
export function emailTaskExternalKey(
  connectorAccountId: string,
  messageKey: string,
  actionTitle: string
): string; // `${connectorAccountId}:${messageKey}:${normalized}` — normalized = lowercase alnum+dash, 40 chars
export interface PlanEmailTasksInput {
  readonly items: readonly EmailContextItem[];
  readonly mode: EmailTaskCreationMode;
  readonly rejectionAggregates: readonly {
    senderDomain: string;
    rejected: number;
    accepted: number;
  }[];
}
export interface PlannedEmailTask {
  readonly status: "suggested" | "todo";
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: string | null;
  readonly priority: number | null;
  readonly sourceRef: string; // messageKey
  readonly externalKey: string;
  readonly item: EmailContextItem;
}
export function planEmailTasks(input: PlanEmailTasksInput): PlannedEmailTask[];
```

`planEmailTasks` rules (pure, spec §5): mode `off` → []. Candidates only from `needs_action`/`needs_reply`/high-confidence `time_sensitive_info` with suggestedTasks or clear dueDate; never `noise`/`fyi`/marketing; skip `confidence < 0.4`. Domain with ≥3 rejections and 0 accepted → skip entirely; ≥3 rejections with some accepts → halve effective confidence. Status: `suggest` mode → all `suggested`; `auto_safe` → `todo` only for (bill due) OR (hard deadline) OR (explicit request with dueDate) — encoded as `needs_action` with `dueDate` present and `confidence ≥ 0.75` — else `suggested`; `auto` → `todo` for confidence ≥ 0.6, else `suggested`; `needs_reply` and ambiguous ALWAYS `suggested` in every auto mode. Priority: dueDate within 48h or importance high → 2; else 3. Description = `reason`/`summary` bounded 600 chars.

Routes (email module): `GET /api/email/task-creation-mode` → `{ mode }` (PreferencesRepository.get + parse); `PUT` body `{ mode }` validated against the union → upsert. Mirror an existing email route for auth/handler shape (see `packages/email/src/routes.ts`).

- [ ] Failing unit tests: every mode × candidate matrix above; externalKey determinism + normalization; rejection-domain skip/halve; marketing/receipt never planned; description never exceeds 600 chars and never equals a body string planted on the item
- [ ] Failing route tests (pattern from `tests/unit/email-routes.test.ts`): GET default `suggest`; PUT `auto_safe` persists; PUT garbage → 400
- [ ] Implement; tests pass; commit `feat(email,connectors): email task-creation modes + deterministic task planning (#729)`

### Task 12: Proactive monitor jobs (email 15 min, calendar 30 min)

**Files:** Create `packages/connectors/src/monitor-jobs.ts`, `packages/connectors/src/monitor-schedule.ts`; Modify `packages/module-registry/src/index.ts` (connectors entry: queues + `registerSourceMonitorWorkers`), wherever `reconcileImapAccountSchedule`/`reconcileGoogleAccountSchedule` are invoked (routes/connect/revoke paths — grep callers) to also reconcile monitor schedules; Test `tests/unit/monitor-schedule.test.ts`, `tests/unit/email-monitor-run.test.ts`.

```ts
export const EMAIL_MONITOR_QUEUE = "connectors.email-monitor";
export const CALENDAR_MONITOR_QUEUE = "connectors.calendar-monitor";
export const EMAIL_MONITOR_CRON = "*/15 * * * *";
export const CALENDAR_MONITOR_CRON = "*/30 * * * *";
export interface MonitorPayload extends ActorScopedJobPayload {
  readonly kind: "email-monitor" | "calendar-monitor";
  readonly connectorAccountId: string;
}
export async function reconcileMonitorSchedules(
  boss: PgBoss,
  actorUserId: string,
  connectorAccountId: string,
  capabilities: { email: boolean; calendar: boolean },
  connected: boolean
): Promise<void>; // schedule/unschedule both queues, key = connectorAccountId, tz UTC, assertMetadataOnlyPayload
export const MONITOR_STATUS_PREF_KEY = (accountId: string) =>
  `connector.${accountId}.monitor_status`;
export interface RunEmailMonitorDeps {
  readonly sourceContext: SourceContextService;
  readonly connectorsRepository: ConnectorsRepository; // feedback aggregates
  readonly taskPort: EmailTaskCreationPort;
  readonly preferencesRepository: {
    get(scopedDb: DataContextDb, key: string): Promise<unknown>;
    upsert(scopedDb: DataContextDb, key: string, value: unknown): Promise<void>;
  };
  readonly now?: () => Date;
  readonly logger?: SyncLogger;
}
export async function runEmailMonitor(
  scopedDb: DataContextDb,
  connectorAccountId: string,
  deps: RunEmailMonitorDeps
): Promise<{ planned: number; created: number; degraded: boolean }>;
export async function registerSourceMonitorWorkers(
  boss: PgBoss,
  deps: {
    dataContext: DataContextRunner;
    taskPort: EmailTaskCreationPort;
    workOptions?: WorkOptions;
    logger?: SyncLogger;
  }
): Promise<string[]>;
```

`runEmailMonitor`: mode from prefs; `listEmailContext` filtered to this account's items; `planEmailTasks`; `taskPort.create` per plan (dedupe is repository-level via externalKey); persist bounded status `{ lastRunAt, status: "ok"|"degraded"|"gap", planned, created }` under `MONITOR_STATUS_PREF_KEY` (counts only, never content). Calendar monitor v1: run `listCalendarContext` and persist the same bounded status (health signal; no calendar-derived tasks in this spec). Queue definitions mirror `IMAP_SYNC_QUEUE_DEFINITIONS` (exclusive, retryLimit 1). Payload keys `actorUserId|connectorAccountId|kind` are already in ALLOWED_PAYLOAD_KEYS — no pg-boss.ts change. Composition root builds `taskPort` from `TasksRepository`:

```ts
const tasksRepositoryForEmail = new TasksRepository();
const emailTaskPort: EmailTaskCreationPort = {
  async create(scopedDb, input) {
    const task = await tasksRepositoryForEmail.create(scopedDb, {
      title: input.title,
      description: input.description ?? undefined,
      status: input.status,
      dueAt: input.dueAt ?? undefined,
      priority: input.priority ?? undefined,
      source: input.source,
      sourceRef: input.sourceRef,
      externalKey: input.externalKey
    });
    return { id: task.id };
  }
};
```

(module-registry already imports tasks; connectors receives only the structural port.)

- [ ] Failing tests: reconcile schedules on connect/revoke (fake boss records schedule/unschedule calls, both queues, right crons/keys); `runEmailMonitor` with fake service/port — suggest mode stages suggested tasks, second run creates zero new (fake port dedupes by externalKey), off mode creates none, degraded read → status `degraded` and no auth-gap task creation
- [ ] Implement + wire into module-registry connectors entry + connect/revoke reconcile call sites; tests pass; commit `feat(connectors): proactive email/calendar monitors staging idempotent tasks (#729)`

### Task 13: Accept/reject feedback wiring in tasks

**Files:** Modify `packages/tasks/src/routes.ts` (PATCH `/api/tasks/:id` handler), `packages/tasks/src/manifest.ts`/route-registration deps (add optional structural port), `packages/module-registry/src/index.ts` (compose port from `ConnectorsRepository.recordTriageFeedback`); Test `tests/integration/tasks-email-feedback.test.ts`.

Structural port declared in tasks (no connectors import):

```ts
export interface EmailTriageFeedbackPort {
  record(
    scopedDb: DataContextDb,
    input: {
      readonly taskSourceRef: string | null;
      readonly verdict: "accepted" | "rejected";
      readonly title: string;
    }
  ): Promise<void>;
}
```

In PATCH handler: load existing task first (route already does via repository); if `existing.source === "email"` and `existing.status === "suggested"` and new status is `"todo" | "done"` → record `accepted`; new status `"archived"` → record `rejected`. Port impl (module-registry) resolves sender/domain/actionability by looking up the cached email row by `sourceRef` via `EmailRepository` methods where possible; when the cached row is gone, record with `sender: "unknown"`, `sender_domain: "unknown"` (feedback still counts against nothing — acceptable degradation). Failures in the port are caught + logged, never fail the PATCH.

- [ ] Failing integration test: seed cached email + suggested email task; PATCH → todo records `accepted` row; PATCH → archived records `rejected`; manual (source "manual") task transitions record nothing; port throwing does not break the PATCH
- [ ] Implement; commit `feat(tasks): record email triage feedback on suggested-task accept/reject (#729)`

### Task 14: Frontend — remove Sync now, live vs cache health

**Files:** Modify `apps/web/src/settings/settings-personal-data-panes.tsx` (drop AccountCard Sync-now button :196-208, `syncMutation` + `canSyncConnectorAccount` import/usages in ConnectedPane; KEEP the notes-source Sync now :604-643 — different feature), `apps/web/src/settings/settings-admin-panes.tsx` (drop OversightPane button :746-755 + mutation :701-709); update `apps/web/src/api/client.ts` only if `syncGoogleConnector` becomes unused (remove export + fn; grep first — connect flow may auto-sync via backend, not this client fn); Tests: update `tests/unit/settings-connector-sync.test.ts` (assert controls GONE), e2e `tests/e2e/*` any seed relying on sync UI.

Health split in AccountCard: keep `getConnectorAccountHealth` indicator but relabel section — "Live connection" = account status indicator (active/error/revoked); add muted line "Fallback cache updated {relative(lastSyncFinishedAt)}" (existing field on the DTO). Same two-line treatment in the admin OversightPane row (it already renders lastSync fields :724-731 — reword label to "Fallback cache"). Use existing authored classes (`jds-*`, `cono__*`), no new raw colors.

- [ ] Update/replace `tests/unit/settings-connector-sync.test.ts`: renders ConnectedPane with a connected account → no "Sync now" button; shows "Fallback cache" line; admin pane likewise
- [ ] Implement; `pnpm --filter web test` (or the unit gate) passes; commit `feat(web): remove manual sync controls; split live vs fallback-cache health (#729)`

### Task 15: Frontend — suggested tasks review (Tasks + Today) + email mode setting

**Files:** Modify `apps/web/src/tasks/task-view-model.ts:12-13` (`statusFilters = ["all","todo","suggested","done","archived"]`), `apps/web/src/tasks/task-format.ts:3` (`statusLabels.suggested = "Suggested"`), `apps/web/src/tasks/tasks-page.tsx` + `task-list-view.tsx` (suggested rows render Accept / Dismiss actions → PATCH status todo/archived via existing update mutation; invalidate `queryKeys.tasks.list`), `apps/web/src/today/today-page.tsx` (a "Suggested from email" block listing tasks with `status === "suggested"` from the existing `queryKeys.tasks.list` query, with the same Accept/Dismiss actions; empty → render nothing), `apps/web/src/settings/settings-personal-data-panes.tsx` (Email source pane: "Task creation" select with the four modes wired to new client fns), `apps/web/src/api/client.ts` (+ `getEmailTaskMode`/`putEmailTaskMode`), `apps/web/src/api/query-keys.ts` (+ `email.taskMode`); shared types from Task 11.

Mode copy (Settings → Data sources → Email): Off — "Never create tasks from email." / Suggest — "Stage suggestions for your review (default)." / Auto for safe items — "Auto-add bills and hard deadlines; stage the rest." / Auto — "Auto-add anything Jarvis is confident about."

- [ ] Update e2e mocks: `tests/e2e/mock-api.ts` task fixtures accept `suggested`; add mode route mock; adjust any spec listing status filters
- [ ] Implement UI; run web unit tests + `pnpm check:design-tokens`; commit `feat(web): suggested-task review flow + email task-creation mode setting (#729)`

### Task 16: Integration tests + full gate + PR

**Files:** Create `tests/integration/source-context-briefing.test.ts` (briefing composes via fake-provider-backed real service: live path populates email section with only actionable categories; transient failure → cache fallback marked degraded; grant-disabled → gap, cache NOT used); extend `tests/integration/tasks-suggested-status.test.ts` externalKey idempotency under real unique index; verify `tests/integration/foundation.test.ts` passes with 0140+0141.

- [ ] Write + pass integration tests
- [ ] `pnpm verify:foundation` in the worktree — full pass with exit code 0 (record commands + exit codes)
- [ ] Prettier the plan doc (`pnpm prettier --write docs/superpowers/plans/2026-07-04-live-first-source-context.md`) before it rides any commit
- [ ] Push branch, open PR: "feat: live-first email/calendar source context (#729)" — body maps spec sections → tasks, lists verification evidence, notes "near-term refresh before briefings" satisfied by compose-time live reads
- [ ] `memory_save` (project jarvis): sourceContext service seam + suggested-status + feedback-table decisions

## Self-Review (done at write time)

- **Spec coverage:** §2 service+isolation (T1,3–7), §3 calendar (T4,8), §4 fallback rules (T1,3,4 tests), §5 tasks/modes/dedupe (T9,11,12,15), §6 feedback (T10,13), §7 briefings (T8), §8 monitors (T12), §9 settings UX (T14,15), §10 invariants (constraints + tests), §12 verification (T16). Sync-now removal both surfaces (T14). Reply tools untouched (out of scope).
- **Placeholders:** none — every step names exact files, code, or the grounded pattern file to mirror.
- **Type consistency:** `SourceContextService`/`EmailContextItem`/`EmailTaskCreationPort`/`planEmailTasks` names checked across T1/3/5/6/11/12; `suggested` status spelled identically in T9/11/13/15.
- **Known risk:** chat routes' read-tool services assembly location unverified — T7 starts with a grep in packages/chat; compose-evening.ts email section unread — T8 starts by reading it.
