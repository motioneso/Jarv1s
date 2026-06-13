import type { Job, PgBoss, WorkOptions } from "pg-boss";

import type { ActorScopedJobPayload, QueueDefinition } from "@jarv1s/jobs";
import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import { registerDataContextWorker } from "@jarv1s/jobs";
import {
  AiRepository,
  HttpApiAdapter,
  createAiSecretCipher,
  type AiConfiguredModelSafeRow,
  type ProviderKind
} from "@jarv1s/ai";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";

import { createConnectorSecretCipher } from "./crypto.js";
import {
  GoogleApiClient,
  type GoogleCalendarEvent,
  type GmailMessageFull
} from "./google-api-client.js";
import { GoogleConnectionService } from "./google-connection.js";
import { GoogleOAuthClient, type GoogleConnectionSecret } from "./oauth.js";
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
const EMAIL_MESSAGE_CAP = Number(process.env.JARVIS_EMAIL_SYNC_CAP ?? "50");

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
  /** Structured, sanitized sync logger (never token/body content). Defaults to a console shim. */
  readonly logger?: SyncLogger;
}

/** Sanitized structured logging for partial-failure observability (never secrets/body). */
export interface SyncLogger {
  warn(data: Record<string, unknown>, message: string): void;
  info(data: Record<string, unknown>, message: string): void;
}

const NOOP_SYNC_LOGGER: SyncLogger = {
  warn: (data, msg) => console.warn(msg, data),
  info: (data, msg) => console.info(msg, data)
};

/**
 * Run one Google API operation, retrying ONCE on a 401 after forcing a token refresh.
 * Mirrors the standard expired-access-token recovery: the cached token may have been revoked
 * or expired between the >60s freshness check and the call. `GoogleApiError.statusCode` is the
 * 401 signal (see google-api-client.ts). Any non-401 error propagates to the per-section catch.
 */
async function withTokenRetry<T>(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps,
  initialToken: string,
  op: (token: string) => Promise<T>
): Promise<{ result: T; token: string }> {
  try {
    return { result: await op(initialToken), token: initialToken };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== 401) throw error;
    const refreshed = await deps.getFreshAccessToken(scopedDb, { force: true });
    return { result: await op(refreshed), token: refreshed };
  }
}

function mapEventTimes(side: GoogleCalendarEvent["start"]): string {
  return side?.dateTime ?? (side?.date ? `${side.date}T00:00:00.000Z` : new Date(0).toISOString());
}

export async function runGoogleSync(
  scopedDb: DataContextDb,
  deps: GoogleSyncDeps
): Promise<GoogleSyncResult> {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? NOOP_SYNC_LOGGER;
  const calendarRepo = deps.calendarRepository ?? new CalendarRepository();
  const emailRepo = deps.emailRepository ?? new EmailRepository();
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

  let accessToken: string;
  try {
    accessToken = await deps.getFreshAccessToken(scopedDb);
  } catch {
    // Never log the underlying auth error object (may carry client_secret/refresh_token).
    logger.warn({ actorScoped: true, stage: "auth" }, "google-sync auth failed");
    return { calendarUpserted: 0, emailUpserted: 0, errors: ["auth-error"] };
  }

  // --- Calendar (independent of email; one failing does not abort the other) ---
  if (account.scopes.includes(CALENDAR_SCOPE) || account.scopes.includes("calendar")) {
    try {
      const ref = now().getTime();
      const { result: events, token: rotated } = await withTokenRetry(
        scopedDb,
        deps,
        accessToken,
        (token) =>
          deps.googleClient.listCalendarEvents({
            accessToken: token,
            calendarId: "primary",
            timeMin: new Date(ref - CALENDAR_WINDOW_PAST_MS).toISOString(),
            timeMax: new Date(ref + CALENDAR_WINDOW_FUTURE_MS).toISOString()
          })
      );
      accessToken = rotated; // carry a refreshed token forward to the email section
      for (const event of events) {
        if (!event.id) continue;
        await calendarRepo.upsertCachedEvent(scopedDb, {
          connectorAccountId: account.id,
          externalId: event.id,
          title: event.summary ?? "(no title)",
          startsAt: mapEventTimes(event.start),
          endsAt: mapEventTimes(event.end),
          location: event.location ?? null,
          summary: event.description ? event.description.slice(0, 2000) : null,
          externalMetadata: {
            status: event.status ?? null,
            htmlLink: event.htmlLink ?? null,
            attendeeCount: event.attendees?.length ?? 0
          }
        });
        calendarUpserted += 1;
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
      const { result: stubs, token: rotated } = await withTokenRetry(
        scopedDb,
        deps,
        accessToken,
        (token) => deps.googleClient.listMessageIds({ accessToken: token, query: EMAIL_QUERY })
      );
      accessToken = rotated;
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
          const { result: full, token: rotatedMsg } = await withTokenRetry(
            scopedDb,
            deps,
            accessToken,
            (token) => deps.googleClient.getMessage({ accessToken: token, id: stub.id })
          );
          accessToken = rotatedMsg;
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
          await emailRepo.upsertCachedMessage(scopedDb, {
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
          });
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
          const credential = aiCipher.decryptJson(provider.encrypted_credential) as {
            apiKey?: string;
          };
          if (!credential.apiKey) return { text: "" };
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
          const secret = await connectorsRepo.getActiveGoogleAccountSecret(db);
          if (!secret) return undefined;
          const bundle = connectorCipher.decryptJson(
            secret.encryptedSecret
          ) as GoogleConnectionSecret;
          return { id: secret.id, scopes: bundle.grantedScopes ?? [] };
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
