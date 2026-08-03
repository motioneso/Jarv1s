import { createHash, randomUUID } from "node:crypto";

import type { Job, PgBoss, WorkOptions } from "pg-boss";
import { sql } from "kysely";

import type { ActorScopedJobPayload, QueueDefinition } from "@jarv1s/jobs";
import type { ConnectorSyncStatus, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { sendJob, toAccessContext } from "@jarv1s/jobs";
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { createConnectorSecretCipher, type ConnectorSecretCipher } from "./crypto.js";
import { featureGrantsPrefKey, isFeatureGranted } from "./feature-grants.js";
import {
  GoogleApiClient,
  type GoogleCalendarEvent,
  type GmailMessageFull
} from "./google-api-client.js";
import { decryptGoogleConnectionSecret, GoogleConnectionService } from "./google-connection.js";
import { GoogleOAuthClient } from "./oauth.js";
import { ConnectorsRepository } from "./repository.js";
import {
  EmailExtractNeedsConfigurationError,
  extractEmailSignalsBatch,
  partitionEmailExtractionBatches,
  type EmailExtractDeps,
  type EmailExtractResult,
  type ParsedEmail
} from "./email-extract.js";
import { buildEmailExtractDeps, type BuildEmailExtractDepsOptions } from "./extract-deps.js";
import { GoogleEmailReadProvider, GMAIL_READ_FOLDER } from "./email-read-provider.js";
import { EmailActionSuppressionRepository } from "./action-suppression-repository.js";
import { projectEmailActions, type ProjectEmailActionsDeps } from "./monitor-jobs.js";
import { listSavedEmailContext } from "./source-context/email.js";

export const GOOGLE_SYNC_QUEUE = "connectors.google-sync";
export const GOOGLE_SYNC_CONTINUATION_QUEUE = "connectors.google-sync-continuation";
export const GOOGLE_EMAIL_CHUNK_SIZE = 8;
export const GOOGLE_CURRENT_DAY_EMAIL_PAGE_SIZE = 500;
export const GOOGLE_EMAIL_FETCH_CONCURRENCY = 8;
export const GOOGLE_CALENDAR_CHUNK_SIZE = 100;
export const GOOGLE_SYNC_EXPIRE_SECONDS = 840;

export const GOOGLE_SYNC_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: GOOGLE_SYNC_QUEUE,
    options: {
      // exclusive: at most one job per (queue, singletonKey) across created+active.
      // The route sets singletonKey to the actor id so a manual sync racing
      // sync-on-connect collapses to one job (spec §error handling; briefings precedent).
      policy: "exclusive",
      retryLimit: 1,
      expireInSeconds: GOOGLE_SYNC_EXPIRE_SECONDS,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  },
  {
    name: GOOGLE_SYNC_CONTINUATION_QUEUE,
    options: {
      // One active continuation globally keeps CLI structured extraction sequential. The adapter's
      // existing process-global guard remains the final safety net for other structured callers.
      policy: "singleton",
      retryLimit: 1,
      expireInSeconds: GOOGLE_SYNC_EXPIRE_SECONDS,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  }
];

export interface GoogleSyncPayload extends ActorScopedJobPayload {
  readonly kind: "google-sync";
  readonly idempotencyKey?: string;
}

type GoogleSyncPhase = "calendar" | "email-current-day" | "email";

export interface GoogleSyncContinuationPayload extends ActorScopedJobPayload {
  readonly kind: "google-sync-continuation";
  readonly idempotencyKey: string;
  readonly connectorAccountId: string;
  readonly phase: GoogleSyncPhase;
  readonly cursor?: string;
  readonly chunkIndex: number;
  readonly startedAt: string;
  readonly calendarSeenSince: string;
  readonly calendarUpserted: number;
  readonly calendarReconciled: number;
  readonly emailUpserted: number;
  readonly emailFailures: number;
  readonly escalations: number;
  readonly errors: readonly string[];
}

export type GoogleSyncContinuationState = Omit<
  GoogleSyncContinuationPayload,
  "actorUserId" | "kind"
>;

export interface GoogleSyncChunkOutcome {
  readonly result: GoogleSyncResult;
  readonly continuation?: GoogleSyncContinuationState;
}

export interface GoogleSyncResult {
  readonly calendarUpserted: number;
  readonly calendarReconciled: number;
  readonly emailUpserted: number;
  /** Count of messages that failed to fetch/parse/upsert (metadata only; no detail). */
  readonly emailFailures?: number;
  /** Count of LLM escalations to a higher tier (cost/telemetry; metadata only). */
  readonly escalations?: number;
  readonly errors: string[];
  readonly truncated?: boolean;
}

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const CALENDAR_WINDOW_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const CALENDAR_WINDOW_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_QUERY = "newer_than:30d older_than:1d";
const CURRENT_DAY_EMAIL_QUERY = "newer_than:1d";

interface GoogleClientLike {
  listCalendarEvents(input: {
    accessToken: string;
    calendarId?: string;
    timeMin: string;
    timeMax: string;
  }): Promise<GoogleCalendarEvent[]>;
  listCalendarEventsPage?(input: {
    accessToken: string;
    calendarId?: string;
    timeMin: string;
    timeMax: string;
    pageToken?: string;
    maxResults?: number;
  }): Promise<{ items: GoogleCalendarEvent[]; nextPageToken?: string }>;
  listMessageIds(input: { accessToken: string; query?: string }): Promise<Array<{ id: string }>>;
  listMessageIdsPage?(input: {
    accessToken: string;
    query?: string;
    pageToken?: string;
    maxResults?: number;
  }): Promise<{ messages: Array<{ id: string }>; nextPageToken?: string }>;
  getMessage(input: { accessToken: string; id: string }): Promise<GmailMessageFull>;
}

export interface GoogleSyncDeps {
  getActiveAccount(scopedDb: DataContextDb): Promise<{ id: string; scopes: string[] } | undefined>;
  /**
   * Return a usable access token. When `force` is true, bypass the cached-token fast path and
   * force a network refresh (used for the single 401 retry). The production impl is
   * GoogleConnectionService.getFreshAccessToken with its optional `{ force }` arg.
   */
  getFreshAccessToken(scopedDb: DataContextDb, opts?: { force?: boolean }): Promise<string>;
  readonly googleClient: GoogleClientLike;
  readonly emailExtractDeps: EmailExtractDeps;
  readonly now?: () => Date;
  readonly calendarRepository?: CalendarRepository;
  readonly emailRepository?: EmailRepository;
  readonly connectorsRepository?: ConnectorsRepository;
  readonly preferencesRepository?: PreferencesRepository;
  /** Structured, sanitized sync logger (never token/body content). Defaults to a console shim. */
  readonly logger?: SyncLogger;
  readonly actionProjection?: ProjectEmailActionsDeps;
  /** Stable root job id used to derive deterministic continuation job ids. */
  readonly runId?: string;
}

/** Sanitized structured logging for partial-failure observability (never secrets/body). */
export interface SyncLogger {
  warn(data: Record<string, unknown>, message: string): void;
  info(data: Record<string, unknown>, message: string): void;
}

const NOOP_SYNC_LOGGER: SyncLogger = {
  // Silent — production always injects a real logger (server.log adapter) at the
  // composition root. Noop (not console) so a forgotten injection degrades quietly
  // instead of spamming unstructured console output (observability spec).
  warn: () => undefined,
  info: () => undefined
};

export async function loadGoogleSyncActiveAccount(
  repository: ConnectorsRepository,
  cipher: ConnectorSecretCipher,
  scopedDb: DataContextDb,
  logger: SyncLogger
): Promise<{ id: string; scopes: string[] } | undefined> {
  const secret = await repository.getActiveGoogleAccountSecret(scopedDb);
  if (!secret) return undefined;
  try {
    const bundle = decryptGoogleConnectionSecret(cipher, secret.encryptedSecret);
    return { id: secret.id, scopes: bundle.grantedScopes };
  } catch {
    logger.warn({ actorScoped: true, stage: "auth" }, "google-sync stored connection invalid");
    return undefined;
  }
}

/** Mutable holder for the current access token, shared across the whole sync run. */
interface TokenHolder {
  token: string;
  refreshing?: Promise<string>;
}

/**
 * Run one Google API operation, retrying ONCE on a 401 after forcing a token refresh.
 * Mirrors the standard expired-access-token recovery: the cached token may have been revoked
 * or expired between the >60s freshness check and the call. `GoogleApiError.statusCode` is the
 * 401 signal (see google-api-client.ts). Any non-401 error propagates to the per-section catch.
 *
 * The token lives in a shared mutable HOLDER: as soon as a forced refresh succeeds, the new
 * token is written back to the holder BEFORE the retry runs. So even if the retried op throws
 * (e.g. the message itself 404s after the refresh), the rotated token is NOT lost — the next
 * message in the loop uses the fresh token instead of re-triggering a 401 → refresh on every
 * remaining message (the mid-loop stale-token bug). On a non-401 error, the holder is untouched.
 */
async function withTokenRetry<T>(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps,
  holder: TokenHolder,
  op: (token: string) => Promise<T>
): Promise<T> {
  const attemptedToken = holder.token;
  try {
    return await op(attemptedToken);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== 401) throw error;
    if (holder.token === attemptedToken) {
      holder.refreshing ??= deps.getFreshAccessToken(scopedDb, { force: true });
      try {
        holder.token = await holder.refreshing;
      } finally {
        holder.refreshing = undefined;
      }
    }
    return op(holder.token);
  }
}

/**
 * Run one DB write inside its OWN SAVEPOINT (a Kysely nested transaction compiles to
 * SAVEPOINT / ROLLBACK TO SAVEPOINT). The whole sync runs in a SINGLE outer transaction
 * (registerDataContextWorker → one rootDb.transaction()), so without this a single DB-level
 * failure (e.g. a CHECK/unique/serialization error on one upsert) would ABORT the entire
 * transaction; every later write then fails 25P02 and the per-item catch swallows it, yet the
 * handler returns "success" with non-zero counts → silent total-sync data loss with fabricated
 * counts. A SAVEPOINT confines a failure to the one item: it rolls back to the savepoint and
 * the outer transaction stays usable, so committed counts are HONEST.
 *
 * The actor GUC (app.actor_user_id) is set with set_config(..., local=true) on the outer
 * transaction and is unaffected by a SAVEPOINT rollback (savepoints don't reset transaction-local
 * GUCs to a pre-savepoint value here — they're set once at the top of the transaction), so RLS
 * still applies inside and after the savepoint. The work runs against the SAME branded
 * DataContextDb (DataContextDb-only invariant preserved — no raw handle is exposed).
 */
let savepointCounter = 0;

export async function withSavepoint<T>(
  scopedDb: DataContextDb,
  work: (savepointDb: DataContextDb) => Promise<T>
): Promise<T> {
  // Kysely 0.29 disallows nested transactions / startTransaction() on a Transaction (both at the
  // type level AND at runtime — "calling the controlled transaction method for a Transaction is
  // not supported"). So we issue raw SAVEPOINT markers directly on the SAME transaction connection.
  // The work still runs against `scopedDb` (same connection, same actor GUC, same RLS), so the
  // upsert is just bracketed by SAVEPOINT/RELEASE. On failure we ROLLBACK TO SAVEPOINT, which
  // leaves the OUTER transaction usable (the whole point: confine a per-item failure so it can't
  // poison every other upsert and cause silent total-sync data loss under fabricated counts).
  //
  // The savepoint name is a fixed-prefix + monotonic counter (never user input → injection-safe).
  savepointCounter += 1;
  const name = `jarvis_sync_sp_${savepointCounter}`;
  await sql.raw(`SAVEPOINT ${name}`).execute(scopedDb.db);
  try {
    const result = await work(scopedDb);
    await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(scopedDb.db);
    return result;
  } catch (error) {
    await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(scopedDb.db);
    await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(scopedDb.db);
    throw error;
  }
}

/**
 * Map a Google event's start/end to cache instants, or return null to SKIP an event we can't
 * place on a timeline. The prior impl mapped a missing start/end to `new Date(0)` (the 1970
 * epoch): a dateTime-start event with a missing end produced end < start, violating the
 * `ends_at >= starts_at` CHECK and aborting the whole sync transaction (the 25P02 landmine).
 *
 * Rules (fail-safe):
 *  - Both sides carry `dateTime` → use them verbatim (RFC3339 instants).
 *  - All-day (both sides carry `date`, no time) → map each date to UTC midnight. Google's
 *    all-day `end.date` is EXCLUSIVE (the morning after), so end > start and the CHECK holds.
 *    We tag it `allDay` in metadata; UTC-midnight..UTC-midnight is a consistent, valid range
 *    (we deliberately don't guess the user's tz here — the sync job has no tz context).
 *  - Anything else (missing or mixed/unusable start/end) → null (skip), never a fabricated
 *    epoch instant. A skipped event simply isn't cached this run; it isn't silent data loss
 *    of OTHER events the way a poisoned transaction was.
 */
function mapEventInstants(
  event: Pick<GoogleCalendarEvent, "start" | "end">
): { startsAt: string; endsAt: string; allDay: boolean } | null {
  const start = event.start;
  const end = event.end;
  if (start?.dateTime && end?.dateTime) {
    return { startsAt: start.dateTime, endsAt: end.dateTime, allDay: false };
  }
  if (start?.date && end?.date) {
    return {
      startsAt: `${start.date}T00:00:00.000Z`,
      endsAt: `${end.date}T00:00:00.000Z`,
      allDay: true
    };
  }
  return null;
}

export async function runGoogleSyncChunk(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps,
  continuation?: GoogleSyncContinuationState
): Promise<GoogleSyncChunkOutcome> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? NOOP_SYNC_LOGGER;
  const calendarRepo = deps.calendarRepository ?? new CalendarRepository();
  const emailRepo = deps.emailRepository ?? new EmailRepository();
  const connectorsRepo = deps.connectorsRepository ?? new ConnectorsRepository();
  const preferencesRepo = deps.preferencesRepository ?? new PreferencesRepository();
  const errors: string[] = [...(continuation?.errors ?? [])];
  let calendarUpserted = continuation?.calendarUpserted ?? 0;
  let calendarReconciled = continuation?.calendarReconciled ?? 0;
  let emailUpserted = continuation?.emailUpserted ?? 0;
  let emailFailures = continuation?.emailFailures ?? 0;
  let escalations = continuation?.escalations ?? 0;

  const account = await deps.getActiveAccount(scopedDb);
  if (!account) {
    return {
      result: {
        calendarUpserted,
        calendarReconciled,
        emailUpserted,
        emailFailures,
        escalations,
        errors: [...errors, "no-active-connection"],
        truncated: false
      }
    };
  }
  if (continuation && continuation.connectorAccountId !== account.id) {
    return {
      result: {
        calendarUpserted,
        calendarReconciled,
        emailUpserted,
        emailFailures,
        escalations,
        errors: [...errors, "no-active-connection"],
        truncated: false
      }
    };
  }

  // Stamp the start of the run on the account row (health metadata only — never status).
  if (!continuation) await connectorsRepo.markSyncStarted(scopedDb, account.id, now());

  // Single shared token holder for the whole run: withTokenRetry writes a refreshed token back
  // here the instant it refreshes (even if the retried op then fails), so every later call —
  // across the calendar AND email sections and every message in the loop — uses the fresh token
  // rather than re-triggering a 401 → refresh per remaining message (mid-loop stale-token bug).
  const tokenHolder: TokenHolder = { token: "" };
  try {
    tokenHolder.token = await deps.getFreshAccessToken(scopedDb);
  } catch {
    // Never log the underlying auth error object (may carry client_secret/refresh_token).
    logger.warn({ actorScoped: true, stage: "auth" }, "google-sync auth failed");
    // Record a failed run with the bounded auth label only — never the raw provider error.
    try {
      await connectorsRepo.markSyncFinished(scopedDb, account.id, {
        finishedAt: now(),
        status: "failed",
        error: "auth-error",
        counts: {
          calendarUpserted: 0,
          calendarReconciled: 0,
          emailUpserted: 0,
          emailFailures: 0,
          escalations: 0,
          truncated: false
        }
      });
    } catch (persistErr) {
      logger.warn({ err: persistErr }, "google-sync: failed to persist auth-failure outcome");
    }
    return {
      result: {
        calendarUpserted,
        calendarReconciled,
        emailUpserted,
        emailFailures,
        escalations,
        errors: ["auth-error"],
        truncated: false
      }
    };
  }

  const featureGrants = await preferencesRepo.get(scopedDb, featureGrantsPrefKey(account.id));
  const calendarEnabled =
    (account.scopes.includes(CALENDAR_SCOPE) || account.scopes.includes("calendar")) &&
    isFeatureGranted(featureGrants, "calendar");
  const emailEnabled =
    (account.scopes.includes(GMAIL_SCOPE) || account.scopes.includes("gmail")) &&
    isFeatureGranted(featureGrants, "email");
  let phase: GoogleSyncPhase | undefined =
    continuation?.phase ??
    (calendarEnabled ? "calendar" : emailEnabled ? "email-current-day" : undefined);
  let phaseCursor = continuation?.cursor;
  const startedAt = continuation?.startedAt ?? now().toISOString();
  // Match CalendarRepository's wall-clock updated_at; `now` may be an injected scheduling clock.
  const calendarSeenSince = continuation?.calendarSeenSince ?? new Date().toISOString();
  const runId = continuation?.idempotencyKey ?? deps.runId ?? randomUUID();
  const chunkIndex = continuation?.chunkIndex ?? 0;

  const next = (nextPhase: GoogleSyncPhase, cursor?: string): GoogleSyncChunkOutcome => ({
    result: {
      calendarUpserted,
      calendarReconciled,
      emailUpserted,
      emailFailures,
      escalations,
      errors,
      truncated: true
    },
    continuation: {
      idempotencyKey: runId,
      connectorAccountId: account.id,
      phase: nextPhase,
      cursor,
      chunkIndex: chunkIndex + 1,
      startedAt,
      calendarSeenSince,
      calendarUpserted,
      calendarReconciled,
      emailUpserted,
      emailFailures,
      escalations,
      errors
    }
  });

  // --- Calendar (independent of email; one failing does not abort the other) ---
  if (phase === "calendar" && calendarEnabled) {
    let nextCalendarCursor: string | undefined;
    try {
      const ref = new Date(startedAt).getTime();
      const page: { items: GoogleCalendarEvent[]; nextPageToken?: string } = await withTokenRetry(
        scopedDb,
        deps,
        tokenHolder,
        async (token) => {
          const input = {
            accessToken: token,
            calendarId: "primary",
            timeMin: new Date(ref - CALENDAR_WINDOW_PAST_MS).toISOString(),
            timeMax: new Date(ref + CALENDAR_WINDOW_FUTURE_MS).toISOString()
          };
          return deps.googleClient.listCalendarEventsPage
            ? deps.googleClient.listCalendarEventsPage({
                ...input,
                pageToken: continuation?.cursor,
                maxResults: GOOGLE_CALENDAR_CHUNK_SIZE
              })
            : { items: await deps.googleClient.listCalendarEvents(input) };
        }
      );
      nextCalendarCursor = page.nextPageToken;
      for (const event of page.items) {
        if (!event.id) continue;
        if (event.status === "cancelled") continue;
        const instants = mapEventInstants(event);
        if (!instants) {
          // Unusable/missing start or end — skip rather than fabricate a 1970-epoch instant
          // that would violate the ends_at >= starts_at CHECK and poison the transaction.
          logger.warn(
            { stage: "calendar", reason: "unusable-event-times" },
            "google-sync skipped a calendar event with no usable start/end"
          );
          continue;
        }
        try {
          // SAVEPOINT-wrap each upsert: a single DB-level failure must NOT abort the whole
          // sync transaction (which would silently roll back every other upsert while the job
          // reports fabricated success counts).
          await withSavepoint(scopedDb, (savepointDb) =>
            calendarRepo.upsertCachedEvent(savepointDb, {
              connectorAccountId: account.id,
              externalId: event.id,
              title: event.summary ?? "(no title)",
              startsAt: instants.startsAt,
              endsAt: instants.endsAt,
              location: event.location ?? null,
              summary: event.description ? event.description.slice(0, 2000) : null,
              externalMetadata: {
                status: event.status ?? null,
                htmlLink: event.htmlLink ?? null,
                attendeeCount: event.attendees?.length ?? 0,
                allDay: instants.allDay
              }
            })
          );
          calendarUpserted += 1;
        } catch (error) {
          // Bounded error label: record once, not one per failing item.
          if (!errors.includes("calendar-item-error")) errors.push("calendar-item-error");
          logger.warn(
            {
              stage: "calendar-item",
              name: (error as Error).name,
              status: (error as { statusCode?: number }).statusCode ?? null
            },
            "google-sync calendar item upsert failed"
          );
        }
      }
      if (!nextCalendarCursor) {
        calendarReconciled = await calendarRepo.deleteCachedEventsNotSeenSince(scopedDb, {
          connectorAccountId: account.id,
          seenSince: new Date(calendarSeenSince)
        });
      }
    } catch (error) {
      logger.warn(
        {
          stage: "calendar",
          name: (error as Error).name,
          status: (error as { statusCode?: number }).statusCode ?? null
        },
        "google-sync calendar failed"
      );
      errors.push("calendar-error");
    }
    if (nextCalendarCursor) return next("calendar", nextCalendarCursor);
    if (emailEnabled) {
      phase = "email-current-day";
      phaseCursor = undefined;
    }
  }

  // --- Email (independent) ---
  if ((phase === "email-current-day" || phase === "email") && emailEnabled) {
    let nextEmailCursor: string | undefined;
    let emailSectionFailed = false;
    const query = phase === "email-current-day" ? CURRENT_DAY_EMAIL_QUERY : EMAIL_QUERY;
    const pageLimit =
      phase === "email-current-day" ? GOOGLE_CURRENT_DAY_EMAIL_PAGE_SIZE : GOOGLE_EMAIL_CHUNK_SIZE;

    const persistEmail = (parsed: ParsedEmail, extracted: EmailExtractResult) =>
      withSavepoint(scopedDb, (savepointDb) =>
        emailRepo.upsertCachedMessage(savepointDb, {
          connectorAccountId: account.id,
          externalId: parsed.externalId,
          sender: parsed.from,
          recipients: parsed.recipients,
          subject: parsed.subject,
          snippet: parsed.snippet,
          receivedAt: parsed.receivedAt,
          externalMetadata: {
            labelIds: parsed.labelIds,
            historyId: parsed.historyId ?? null,
            threadId: parsed.threadId ?? null
          },
          summary: extracted.summary,
          signals: extracted.signals as Record<string, unknown>
        })
      );

    const projectKeys = async (keys: readonly string[]) => {
      if (!deps.actionProjection || keys.length === 0) return;
      const projection = deps.actionProjection;
      const saved = await listSavedEmailContext(
        scopedDb,
        {
          connectorsRepository: connectorsRepo,
          preferencesRepository: preferencesRepo,
          emailRepository: emailRepo
        },
        account.id,
        keys
      );
      await projectEmailActions(scopedDb, saved.items, {
        ...projection,
        taskPort: {
          create: (db, input) =>
            withSavepoint(db, (savepointDb) => projection.taskPort.create(savepointDb, input))
        },
        now: projection.now ?? now
      });
    };

    try {
      const emailReadProvider = new GoogleEmailReadProvider(deps.googleClient, query);
      const page = await withTokenRetry(scopedDb, deps, tokenHolder, (token) =>
        emailReadProvider.listMessageKeyPage(token, GMAIL_READ_FOLDER, {
          cursor: phaseCursor,
          limit: pageLimit
        })
      );
      nextEmailCursor = page.nextCursor;
      const existing = await emailRepo.listSyncMarkers(scopedDb, account.id);
      const seen = new Map(existing.map((marker) => [marker.externalId, marker]));
      const parsedMessages: ParsedEmail[] = [];

      for (let start = 0; start < page.keys.length; start += GOOGLE_EMAIL_FETCH_CONCURRENCY) {
        const keys = page.keys.slice(start, start + GOOGLE_EMAIL_FETCH_CONCURRENCY);
        const fetched = await Promise.allSettled(
          keys.map((key) =>
            withTokenRetry(scopedDb, deps, tokenHolder, (token) =>
              emailReadProvider.getMessage(token, key)
            )
          )
        );
        for (const result of fetched) {
          if (result.status === "fulfilled") {
            parsedMessages.push(result.value);
          } else {
            emailFailures += 1;
            if (!errors.includes("email-message-error")) errors.push("email-message-error");
            logger.warn(
              { stage: "email-message", name: "ProviderReadError", status: null },
              "google-sync email message failed"
            );
          }
        }
      }

      const pending: ParsedEmail[] = [];
      const unchangedKeys: string[] = [];
      for (const parsed of parsedMessages) {
        const prior = seen.get(parsed.externalId);
        if (
          parsed.historyId &&
          prior?.historyId === parsed.historyId &&
          prior.hasSummary &&
          prior.hasCompleteTriage
        ) {
          unchangedKeys.push(parsed.externalId);
          continue;
        }
        try {
          // Persist provider metadata before model work. The body remains only in `parsed` memory.
          await persistEmail(parsed, { summary: null, signals: {} });
          emailUpserted += 1;
          pending.push(parsed);
        } catch (error) {
          emailFailures += 1;
          if (!errors.includes("email-message-error")) errors.push("email-message-error");
          logger.warn(
            {
              stage: "email-message",
              name: (error as Error).name,
              status: (error as { statusCode?: number }).statusCode ?? null
            },
            "google-sync email message failed"
          );
        }
      }

      let processed = 0;
      const batches = partitionEmailExtractionBatches(pending);
      for (const [batchIndex, batch] of batches.entries()) {
        const batchResults = await extractEmailSignalsBatch(batch, deps.emailExtractDeps, {
          telemetry: (telemetryBatchIndex, telemetryBatchSize) => ({
            emit: (event) =>
              logger.info(
                {
                  stage: "email-extraction",
                  jobId: runId,
                  batchIndex: telemetryBatchIndex,
                  batchSize: telemetryBatchSize,
                  ...event
                },
                "google-sync email extraction telemetry"
              )
          })
        });
        const projectedKeys: string[] = [];
        for (let index = 0; index < batch.length; index += 1) {
          try {
            const extracted = batchResults[index]!;
            if (extracted.escalated) escalations += 1;
            await persistEmail(batch[index]!, extracted);
            projectedKeys.push(batch[index]!.externalId);
          } catch (error) {
            emailFailures += 1;
            if (!errors.includes("email-message-error")) errors.push("email-message-error");
            logger.warn(
              {
                stage: "email-message",
                name: (error as Error).name,
                status: (error as { statusCode?: number }).statusCode ?? null
              },
              "google-sync email message failed"
            );
          }
        }
        await projectKeys(projectedKeys);
        processed += batch.length;
        logger.info(
          {
            stage: phase,
            batchIndex,
            batchSize: batch.length,
            processed,
            total: pending.length
          },
          "google-sync email extraction progress"
        );
      }
      await projectKeys(unchangedKeys);
    } catch (error) {
      emailSectionFailed = true;
      const errorLabel =
        error instanceof EmailExtractNeedsConfigurationError ? "email-needs-config" : "email-error";
      logger.warn(
        {
          stage: "email",
          name: (error as Error).name,
          status: (error as { statusCode?: number }).statusCode ?? null
        },
        "google-sync email failed"
      );
      if (!errors.includes(errorLabel)) errors.push(errorLabel);
    }

    if (!emailSectionFailed) {
      if (nextEmailCursor) return next(phase, nextEmailCursor);
      if (phase === "email-current-day") return next("email");
    }
  }

  logger.info(
    {
      calendarUpserted,
      calendarReconciled,
      emailUpserted,
      emailFailures,
      escalations,
      truncated: false,
      errorCount: errors.length
    },
    "google-sync complete"
  );
  // Bounded item errors (calendar/email section or per-item labels) make the run `partial`.
  // A clean run is `success`. A thrown top-level failure (auth) is recorded as `failed` above.
  // The persisted error is the first bounded label only — never raw provider/error text.
  const status: ConnectorSyncStatus = errors.length > 0 ? "partial" : "success";
  try {
    await connectorsRepo.markSyncFinished(scopedDb, account.id, {
      finishedAt: now(),
      status,
      error: errors[0] ?? null,
      counts: {
        calendarUpserted,
        calendarReconciled,
        emailUpserted,
        emailFailures,
        escalations,
        truncated: false
      }
    });
  } catch (error) {
    logger.warn({ err: error }, "google-sync: failed to persist sync outcome; not retrying job");
  }
  return {
    result: {
      calendarUpserted,
      calendarReconciled,
      emailUpserted,
      emailFailures,
      escalations,
      errors,
      truncated: false
    }
  };
}

/** Compatibility runner for direct callers; production workers persist one bounded chunk/job. */
export async function runGoogleSync(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps
): Promise<GoogleSyncResult> {
  let continuation: GoogleSyncContinuationState | undefined;
  let outcome: GoogleSyncChunkOutcome;
  do {
    outcome = await runGoogleSyncChunk(scopedDb, deps, continuation);
    continuation = outcome.continuation;
  } while (continuation);
  return outcome.result;
}

const GOOGLE_SYNC_ERROR_LABELS = new Set([
  "auth-error",
  "calendar-error",
  "calendar-item-error",
  "email-error",
  "email-needs-config",
  "email-message-error",
  "no-active-connection"
]);

function assertGoogleSyncContinuationPayload(payload: GoogleSyncContinuationPayload): void {
  if (payload.kind !== "google-sync-continuation") throw new Error("invalid continuation kind");
  if (
    payload.phase !== "calendar" &&
    payload.phase !== "email-current-day" &&
    payload.phase !== "email"
  ) {
    throw new Error("invalid continuation phase");
  }
  if (
    payload.cursor !== undefined &&
    (payload.cursor.length === 0 || payload.cursor.length > 2048)
  ) {
    throw new Error("invalid continuation cursor");
  }
  if (payload.idempotencyKey.length === 0 || payload.idempotencyKey.length > 128) {
    throw new Error("invalid continuation idempotency key");
  }
  if (!Number.isFinite(Date.parse(payload.startedAt))) throw new Error("invalid continuation time");
  if (!Number.isFinite(Date.parse(payload.calendarSeenSince))) {
    throw new Error("invalid calendar continuation time");
  }
  const counts = [
    payload.chunkIndex,
    payload.calendarUpserted,
    payload.calendarReconciled,
    payload.emailUpserted,
    payload.emailFailures,
    payload.escalations
  ];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 1_000_000)) {
    throw new Error("invalid continuation count");
  }
  if (
    payload.errors.length > GOOGLE_SYNC_ERROR_LABELS.size ||
    payload.errors.some((error) => !GOOGLE_SYNC_ERROR_LABELS.has(error))
  ) {
    throw new Error("invalid continuation error label");
  }
}

function continuationJobId(runId: string, chunkIndex: number): string {
  const bytes = createHash("sha256").update(`${runId}:${chunkIndex}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function handleGoogleSyncJob(
  boss: PgBoss,
  dataContext: DataContextRunner,
  job: Job<GoogleSyncPayload | GoogleSyncContinuationPayload>,
  runChunk: (
    scopedDb: DataContextDb,
    continuation?: GoogleSyncContinuationState
  ) => Promise<GoogleSyncChunkOutcome>
): Promise<GoogleSyncResult> {
  const continuation =
    job.data.kind === "google-sync-continuation"
      ? ((assertGoogleSyncContinuationPayload(job.data), job.data) as GoogleSyncContinuationState)
      : undefined;
  const outcome = await dataContext.withDataContext(toAccessContext(job), (scopedDb) =>
    runChunk(scopedDb, continuation)
  );
  if (outcome.continuation) {
    const payload: GoogleSyncContinuationPayload = {
      actorUserId: job.data.actorUserId,
      kind: "google-sync-continuation",
      ...outcome.continuation
    };
    assertGoogleSyncContinuationPayload(payload);
    await sendJob(boss, GOOGLE_SYNC_CONTINUATION_QUEUE, payload, {
      id: continuationJobId(payload.idempotencyKey, payload.chunkIndex)
    });
  }
  return outcome.result;
}

export interface RegisterConnectorsJobWorkersDeps {
  readonly dataContext: DataContextRunner;
  readonly taskPort: ProjectEmailActionsDeps["taskPort"];
  readonly actionRowRelevance?: ProjectEmailActionsDeps["actionRowRelevance"];
  readonly createCliStructuredAdapter?: BuildEmailExtractDepsOptions["createCliStructuredAdapter"];
  readonly workOptions?: WorkOptions;
  readonly onResult?: (
    job: Job<GoogleSyncPayload | GoogleSyncContinuationPayload>,
    result: GoogleSyncResult
  ) => void;
  readonly logger?: SyncLogger;
}

export async function registerConnectorsJobWorkers(
  boss: PgBoss,
  deps: RegisterConnectorsJobWorkersDeps
): Promise<string[]> {
  const connectorsRepo = new ConnectorsRepository();
  const connectorCipher = createConnectorSecretCipher();
  const aiRepo = new AiRepository();
  const aiCipher = createAiSecretCipher();
  const googleService = new GoogleConnectionService({
    repository: connectorsRepo,
    cipher: connectorCipher,
    oauthClient: new GoogleOAuthClient()
  });
  const googleClient = new GoogleApiClient();
  const preferencesRepository = new PreferencesRepository();
  const suppressionRepository = new EmailActionSuppressionRepository();

  const processJob = async (
    job: Job<GoogleSyncPayload | GoogleSyncContinuationPayload>
  ): Promise<GoogleSyncResult> => {
    const result = await handleGoogleSyncJob(boss, deps.dataContext, job, (scopedDb, state) => {
      const emailExtractDeps = buildEmailExtractDeps(scopedDb, aiRepo, aiCipher, {
        createCliStructuredAdapter: deps.createCliStructuredAdapter,
        logger: deps.logger
      });
      return runGoogleSyncChunk(
        scopedDb,
        {
          getActiveAccount: (db) =>
            loadGoogleSyncActiveAccount(
              connectorsRepo,
              connectorCipher,
              db,
              deps.logger ?? NOOP_SYNC_LOGGER
            ),
          getFreshAccessToken: (db, opts) => googleService.getFreshAccessToken(db, opts),
          googleClient,
          emailExtractDeps,
          actionProjection: {
            taskPort: deps.taskPort,
            preferencesRepository,
            suppressionRepository,
            actionRowRelevance: deps.actionRowRelevance,
            actorUserId: job.data.actorUserId,
            logger: deps.logger
          },
          logger: deps.logger,
          runId: job.data.kind === "google-sync" ? job.id : job.data.idempotencyKey
        },
        state
      );
    });
    if (!result.truncated) deps.onResult?.(job, result);
    return result;
  };

  const register = <TPayload extends GoogleSyncPayload | GoogleSyncContinuationPayload>(
    queue: string
  ) =>
    boss.work<TPayload, GoogleSyncResult>(
      queue,
      deps.workOptions ?? { pollingIntervalSeconds: 2 },
      async ([job]) => {
        if (!job) throw new Error(`pg-boss invoked ${queue} without a job`);
        return processJob(job);
      }
    );

  return Promise.all([
    register<GoogleSyncPayload>(GOOGLE_SYNC_QUEUE),
    register<GoogleSyncContinuationPayload>(GOOGLE_SYNC_CONTINUATION_QUEUE)
  ]);
}
