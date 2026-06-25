import type { Job, PgBoss, WorkOptions } from "pg-boss";
import { sql } from "kysely";

import type { ActorScopedJobPayload, QueueDefinition } from "@jarv1s/jobs";
import type { ConnectorSyncStatus, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { registerDataContextWorker } from "@jarv1s/jobs";
import {
  AiRepository,
  HttpApiAdapter,
  createAiSecretCipher,
  parseAiApiKeyCredential,
  type AiConfiguredModelSafeRow,
  type ProviderKind
} from "@jarv1s/ai";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";

import { createConnectorSecretCipher, type ConnectorSecretCipher } from "./crypto.js";
import {
  GoogleApiClient,
  type GoogleCalendarEvent,
  type GmailMessageFull
} from "./google-api-client.js";
import { decryptGoogleConnectionSecret, GoogleConnectionService } from "./google-connection.js";
import { GoogleOAuthClient } from "./oauth.js";
import { ConnectorsRepository } from "./repository.js";
import { extractEmailSignals, parseEmail, type EmailExtractDeps } from "./email-extract.js";

export const GOOGLE_SYNC_QUEUE = "connectors.google-sync";

export const GOOGLE_SYNC_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: GOOGLE_SYNC_QUEUE,
    options: {
      // exclusive: at most one job per (queue, singletonKey) across created+active.
      // The route sets singletonKey to the actor id so a manual sync racing
      // sync-on-connect collapses to one job (spec §error handling; briefings precedent).
      policy: "exclusive",
      retryLimit: 1,
      deleteAfterSeconds: 300,
      retentionSeconds: 600
    }
  }
];

export interface GoogleSyncPayload extends ActorScopedJobPayload {
  readonly kind: "google-sync";
  readonly idempotencyKey?: string;
}

export interface GoogleSyncResult {
  readonly calendarUpserted: number;
  readonly emailUpserted: number;
  /** Count of messages that failed to fetch/parse/upsert (metadata only; no detail). */
  readonly emailFailures?: number;
  /** Count of LLM escalations to a higher tier (cost/telemetry; metadata only). */
  readonly escalations?: number;
  readonly errors: string[];
  readonly truncated?: boolean;
}

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const CALENDAR_WINDOW_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const CALENDAR_WINDOW_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_QUERY = "newer_than:30d";
const DEFAULT_EMAIL_MESSAGE_CAP = 50;

/**
 * Parse JARVIS_EMAIL_SYNC_CAP into a positive integer, falling back to the default when it is
 * unset OR misconfigured. Previously `Number(... ?? "50")` returned NaN for a non-numeric value
 * (e.g. "abc"), and `stubs.slice(0, NaN)` yields an EMPTY array — so a typo'd env var silently
 * synced ZERO emails while reporting truncated=true. Guard against NaN / <=0 / non-integer.
 */
export function resolveEmailMessageCap(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_EMAIL_MESSAGE_CAP;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_EMAIL_MESSAGE_CAP;
  return parsed;
}

const EMAIL_MESSAGE_CAP = resolveEmailMessageCap(process.env.JARVIS_EMAIL_SYNC_CAP);

interface GoogleClientLike {
  listCalendarEvents(input: {
    accessToken: string;
    calendarId?: string;
    timeMin: string;
    timeMax: string;
  }): Promise<GoogleCalendarEvent[]>;
  listMessageIds(input: { accessToken: string; query?: string }): Promise<Array<{ id: string }>>;
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
  /** Structured, sanitized sync logger (never token/body content). Defaults to a console shim. */
  readonly logger?: SyncLogger;
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
  try {
    return await op(holder.token);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== 401) throw error;
    // Capture the refreshed token into the shared holder immediately, so it survives even if
    // the retried op below throws.
    holder.token = await deps.getFreshAccessToken(scopedDb, { force: true });
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

async function withSavepoint<T>(
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

export async function runGoogleSync(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps
): Promise<GoogleSyncResult> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? NOOP_SYNC_LOGGER;
  const calendarRepo = deps.calendarRepository ?? new CalendarRepository();
  const emailRepo = deps.emailRepository ?? new EmailRepository();
  const connectorsRepo = deps.connectorsRepository ?? new ConnectorsRepository();
  const errors: string[] = [];
  let calendarUpserted = 0;
  let emailUpserted = 0;
  let emailFailures = 0;
  let escalations = 0;
  let truncated = false;

  const account = await deps.getActiveAccount(scopedDb);
  if (!account) {
    return { calendarUpserted: 0, emailUpserted: 0, errors: ["no-active-connection"] };
  }

  // Stamp the start of the run on the account row (health metadata only — never status).
  await connectorsRepo.markSyncStarted(scopedDb, account.id, now());

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
          emailUpserted: 0,
          emailFailures: 0,
          escalations: 0,
          truncated: false
        }
      });
    } catch (persistErr) {
      logger.warn({ err: persistErr }, "google-sync: failed to persist auth-failure outcome");
    }
    return { calendarUpserted: 0, emailUpserted: 0, errors: ["auth-error"] };
  }

  // --- Calendar (independent of email; one failing does not abort the other) ---
  if (account.scopes.includes(CALENDAR_SCOPE) || account.scopes.includes("calendar")) {
    try {
      const ref = now().getTime();
      const events = await withTokenRetry(scopedDb, deps, tokenHolder, (token) =>
        deps.googleClient.listCalendarEvents({
          accessToken: token,
          calendarId: "primary",
          timeMin: new Date(ref - CALENDAR_WINDOW_PAST_MS).toISOString(),
          timeMax: new Date(ref + CALENDAR_WINDOW_FUTURE_MS).toISOString()
        })
      );
      for (const event of events) {
        if (!event.id) continue;
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
  }

  // --- Email (independent) ---
  if (account.scopes.includes(GMAIL_SCOPE) || account.scopes.includes("gmail")) {
    try {
      const stubs = await withTokenRetry(scopedDb, deps, tokenHolder, (token) =>
        deps.googleClient.listMessageIds({ accessToken: token, query: EMAIL_QUERY })
      );
      const capped = stubs.slice(0, EMAIL_MESSAGE_CAP);
      if (stubs.length > capped.length) truncated = true;

      // Skip-unchanged: external_metadata.historyId (Gmail per-message revision marker)
      // lets us avoid re-summarizing messages whose content hasn't changed since the last
      // sync — bounding LLM cost/latency without a separate revision store (spec risk #6).
      // We track BOTH the prior historyId and whether a usable summary already exists, so a
      // message cached before a model was configured is still summarized on a later sync.
      const existing = await emailRepo.listSyncMarkers(scopedDb, account.id);
      const seen = new Map(
        existing.map((r) => [r.externalId, { historyId: r.historyId, hasSummary: r.hasSummary }])
      );

      for (const stub of capped) {
        try {
          const full = await withTokenRetry(scopedDb, deps, tokenHolder, (token) =>
            deps.googleClient.getMessage({ accessToken: token, id: stub.id })
          );
          const parsed = parseEmail(full);
          // Skip the (costly) LLM pass + re-upsert ONLY when this message's historyId is
          // unchanged AND a usable summary is already stored. A null-summary prior row (no model
          // at first sync, or a failed extraction) is intentionally NOT skipped, so it gets a
          // summary once a model is configured.
          const prior = seen.get(parsed.externalId);
          if (parsed.historyId && prior?.historyId === parsed.historyId && prior.hasSummary) {
            continue;
          }
          const extracted = await extractEmailSignals(parsed, deps.emailExtractDeps);
          if (extracted.escalated) escalations += 1;
          const { summary, signals } = extracted;
          // The full body lives only in `parsed.body` here; it is NEVER persisted — only the
          // model-derived summary + signals (+ snippet) are written, and body_excerpt is NOT
          // passed (stays null), so no body fragment lands in a column (privacy posture §6).
          // SAVEPOINT-wrap the upsert: a single DB-level failure must NOT abort the whole sync
          // transaction (which would silently discard every other upsert under a fabricated count).
          await withSavepoint(scopedDb, (savepointDb) =>
            emailRepo.upsertCachedMessage(savepointDb, {
              connectorAccountId: account.id,
              externalId: parsed.externalId,
              sender: parsed.from,
              recipients: parsed.recipients,
              subject: parsed.subject,
              snippet: parsed.snippet,
              receivedAt: parsed.receivedAt,
              externalMetadata: { labelIds: parsed.labelIds, historyId: parsed.historyId ?? null },
              summary,
              // EmailSignals is a structured interface (no index signature); the repository column
              // is a jsonb object, so widen to Record<string, unknown> at this boundary.
              signals: signals as Record<string, unknown>
            })
          );
          emailUpserted += 1;
        } catch (error) {
          emailFailures += 1;
          logger.warn(
            {
              stage: "email-message",
              name: (error as Error).name,
              status: (error as { statusCode?: number }).statusCode ?? null
            },
            "google-sync email message failed"
          );
          // Bounded error labels: record once, not one per message (keeps result metadata small).
          if (!errors.includes("email-message-error")) errors.push("email-message-error");
        }
      }
    } catch (error) {
      logger.warn(
        {
          stage: "email",
          name: (error as Error).name,
          status: (error as { statusCode?: number }).statusCode ?? null
        },
        "google-sync email failed"
      );
      errors.push("email-error");
    }
  }

  logger.info(
    {
      calendarUpserted,
      emailUpserted,
      emailFailures,
      escalations,
      truncated,
      errorCount: errors.length
    },
    "google-sync complete"
  );
  // Bounded item errors (calendar/email section or per-item labels) make the run `partial`;
  // a truncated run is also partial — some items were silently dropped.
  // A clean run is `success`. A thrown top-level failure (auth) is recorded as `failed` above.
  // The persisted error is the first bounded label only — never raw provider/error text.
  const status: ConnectorSyncStatus = errors.length > 0 || truncated ? "partial" : "success";
  try {
    await connectorsRepo.markSyncFinished(scopedDb, account.id, {
      finishedAt: now(),
      status,
      error: errors[0] ?? null,
      counts: { calendarUpserted, emailUpserted, emailFailures, escalations, truncated }
    });
  } catch (error) {
    logger.warn({ err: error }, "google-sync: failed to persist sync outcome; not retrying job");
  }
  return { calendarUpserted, emailUpserted, emailFailures, escalations, errors, truncated };
}

export interface RegisterConnectorsJobWorkersDeps {
  readonly dataContext: DataContextRunner;
  readonly workOptions?: WorkOptions;
  readonly onResult?: (job: Job<GoogleSyncPayload>, result: GoogleSyncResult) => void;
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

  const workId = await registerDataContextWorker<GoogleSyncPayload, GoogleSyncResult>(
    boss,
    GOOGLE_SYNC_QUEUE,
    deps.dataContext,
    async (job, scopedDb) => {
      const emailExtractDeps: EmailExtractDeps = {
        selectModel: (tier) => aiRepo.selectModelForCapability(scopedDb, "summarization", tier),
        runChat: async (model, prompt) => {
          // `model` is the AiConfiguredModelSafeRow returned by selectModelForCapability:
          // it carries provider_config_id, provider_kind, and provider_model_id directly.
          // Load + decrypt the provider credential in-process (never logged/forwarded), then
          // call the adapter.
          const row = model as AiConfiguredModelSafeRow;
          const provider = await aiRepo.selectProviderWithCredential(
            scopedDb,
            row.provider_config_id
          );
          if (!provider) return { text: "" };
          const credential = parseAiApiKeyCredential(
            aiCipher.decryptJson(provider.encrypted_credential)
          );
          if (!credential) return { text: "" };
          // HttpApiAdapter supports anthropic/openai-compatible/google (ProviderKind); narrow
          // the wider AiProviderKind at this boundary — the router already selected the model.
          const adapter = new HttpApiAdapter(
            row.provider_kind as ProviderKind,
            credential.apiKey,
            provider.base_url ? { baseUrl: provider.base_url } : {}
          );
          return adapter.generateChat({
            model: {
              provider_kind: row.provider_kind,
              provider_model_id: row.provider_model_id
            },
            messages: [{ role: "user", content: prompt }]
          });
        }
      };

      const result = await runGoogleSync(scopedDb, {
        getActiveAccount: async (db) => {
          return loadGoogleSyncActiveAccount(
            connectorsRepo,
            connectorCipher,
            db,
            deps.logger ?? NOOP_SYNC_LOGGER
          );
        },
        getFreshAccessToken: (db, opts) => googleService.getFreshAccessToken(db, opts),
        googleClient,
        emailExtractDeps,
        logger: deps.logger
      });

      deps.onResult?.(job, result);
      return result;
    },
    deps.workOptions
  );

  return [workId];
}
