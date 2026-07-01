import { assertDataContextDb, type DataContextDb, type EmailMessage } from "@jarv1s/db";
import {
  buildReplyMime,
  deriveReplyTarget,
  type EmailWriteResult,
  type EmailWriteService,
  type ReplyInput
} from "@jarv1s/email";
import {
  GoogleApiError,
  GoogleConnectError,
  featureGrantsPrefKey,
  isFeatureGranted,
  type ConnectorsRepository,
  type GoogleApiClient,
  type GoogleConnectionService
} from "@jarv1s/connectors";
import type { ToolContext } from "@jarv1s/module-sdk";
import type { PreferencesRepository } from "@jarv1s/structured-state";

/**
 * Dependencies for the email reply write-impl. Narrowed to the exact methods used so the
 * unit tests can inject fakes; the composition host passes the concrete repositories/services.
 */
export interface EmailWriteImplDeps {
  readonly emailRepository: {
    getById(scopedDb: DataContextDb, id: string): Promise<EmailMessage | undefined>;
  };
  readonly connectorsRepository: Pick<ConnectorsRepository, "getGmailWriteScopeState">;
  readonly googleService: Pick<GoogleConnectionService, "getFreshAccessToken">;
  readonly googleApiClient: Pick<GoogleApiClient, "createDraft" | "sendMessage">;
  readonly preferencesRepository?: Pick<PreferencesRepository, "get">;
}

// Human-facing, secret-free reasons. None carry tokens, upstream error bodies, or the email body.
const MSG_NOT_FOUND = "That message isn't in your inbox anymore — it may have been removed.";
const MSG_UNSUPPORTED = "Replies aren't supported for this account yet.";
const MSG_NO_SCOPE =
  "Your Google connection doesn't have send permission yet — reconnect in Settings to grant it.";
const MSG_DISABLED = "Email access is disabled for this account in Settings.";
const MSG_NO_CONNECTION = "Connect Google in Settings first.";
const MSG_REFRESH_FAILED = "Couldn't refresh your Google access — reconnect in Settings.";
const MSG_NO_THREAD = "Couldn't find the original conversation to reply to.";
const MSG_UPSTREAM_FAILED = "Couldn't send your reply right now — try again.";

/**
 * Build the email reply write service. Recipient/subject/threadId are ALWAYS derived from the
 * owner-visible cached email under the actor's DataContextDb — the tool input never addresses.
 * Every failure returns a secret-free EmailWriteResult; the impl never throws to the gateway.
 */
export function buildEmailWriteService(deps: EmailWriteImplDeps): EmailWriteService {
  async function run(
    mode: "draft" | "send",
    scopedDbRaw: unknown,
    _ctx: ToolContext,
    input: ReplyInput
  ): Promise<EmailWriteResult> {
    assertDataContextDb(scopedDbRaw);
    const scopedDb = scopedDbRaw as DataContextDb;

    // 1. Resolve the cached message (owner-RLS-scoped; cross-user row is invisible → undefined).
    const message = await deps.emailRepository.getById(scopedDb, input.cacheMessageId);
    if (!message) return { ok: false, mode, message: MSG_NOT_FOUND };

    // 2. Provider + scope gate. Only the active Google account can reply, and only with
    //    gmail.modify. A message from any other account (IMAP) is unsupported — never call Gmail.
    const gmailScope = await deps.connectorsRepository.getGmailWriteScopeState(scopedDb);
    if (!gmailScope || gmailScope.accountId !== message.connector_account_id) {
      return { ok: false, mode, message: MSG_UNSUPPORTED };
    }
    if (!gmailScope.hasScope) return { ok: false, mode, message: MSG_NO_SCOPE };

    // 3. Feature grant — the user can disable email per account in Settings (default-on).
    const preferencesRepository = deps.preferencesRepository;
    if (preferencesRepository) {
      const stored = await preferencesRepository.get(
        scopedDb,
        featureGrantsPrefKey(gmailScope.accountId)
      );
      if (!isFeatureGranted(stored, "email")) return { ok: false, mode, message: MSG_DISABLED };
    }

    // 4. Server-derived addressing — the single source of truth for the reply target.
    const target = deriveReplyTarget(message);
    if (!target.threadId) return { ok: false, mode, message: MSG_NO_THREAD };

    // 5. Fresh access token (refreshes on <60s-to-expiry, after approval).
    let accessToken: string;
    try {
      accessToken = await deps.googleService.getFreshAccessToken(scopedDb);
    } catch (error) {
      return {
        ok: false,
        mode,
        message: error instanceof GoogleConnectError ? MSG_NO_CONNECTION : MSG_REFRESH_FAILED
      };
    }

    // 6. Compose + write to Gmail. Body lives only in `raw` (never persisted/logged).
    const raw = buildReplyMime({ to: target.to, subject: target.subject, body: input.body });
    try {
      if (mode === "draft") {
        await deps.googleApiClient.createDraft({ accessToken, raw, threadId: target.threadId });
      } else {
        await deps.googleApiClient.sendMessage({ accessToken, raw, threadId: target.threadId });
      }
    } catch (error) {
      // Never surface the upstream body/status — GoogleApiError.message may embed neither, but
      // we still map to a fixed string so no future change can leak through this path.
      if (error instanceof GoogleApiError || error instanceof GoogleConnectError) {
        return { ok: false, mode, message: MSG_UPSTREAM_FAILED };
      }
      return { ok: false, mode, message: MSG_UPSTREAM_FAILED };
    }

    return { ok: true, mode };
  }

  return {
    draftReply: (scopedDb, ctx, input) => run("draft", scopedDb, ctx, input),
    sendReply: (scopedDb, ctx, input) => run("send", scopedDb, ctx, input)
  };
}
