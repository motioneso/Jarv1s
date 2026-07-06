import { assertDataContextDb, type DataContextDb, type EmailMessage } from "@jarv1s/db";
import {
  deriveReplyTarget,
  type EmailWriteProvider,
  type EmailWriteResult,
  type EmailWriteService,
  type ReplyInput
} from "@jarv1s/email";
import {
  featureGrantsPrefKey,
  isFeatureGranted,
  type ConnectorsRepository,
  type ConnectorSecretCipher,
  type GoogleApiClient,
  type GoogleConnectionService
} from "@jarv1s/connectors";
import { GoogleEmailWriteProvider } from "@jarv1s/connectors";
import { ImapEmailWriteProvider } from "@jarv1s/connectors";
import type { ToolContext } from "@jarv1s/module-sdk";
import type { PreferencesRepository } from "@jarv1s/structured-state";

export interface EmailWriteImplDeps {
  readonly emailRepository: {
    getById(scopedDb: DataContextDb, id: string): Promise<EmailMessage | undefined>;
  };
  readonly connectorsRepository: Pick<
    ConnectorsRepository,
    "getGmailWriteScopeState" | "getAccountProviderType" | "getActiveImapAccountSecret"
  >;
  readonly googleService: Pick<GoogleConnectionService, "getFreshAccessToken">;
  readonly googleApiClient: Pick<GoogleApiClient, "createDraft" | "sendMessage">;
  readonly cipher: ConnectorSecretCipher;
  readonly preferencesRepository?: Pick<PreferencesRepository, "get">;
}

const MSG_NOT_FOUND = "That message isn't in your inbox anymore — it may have been removed.";
const MSG_UNSUPPORTED = "Replies aren't supported for this account yet.";
const MSG_NO_SCOPE =
  "Your Google connection doesn't have send permission yet — reconnect in Settings to grant it.";
const MSG_DISABLED = "Email access is disabled for this account in Settings.";
const MSG_NO_THREAD = "Couldn't find the original conversation to reply to.";

export function buildEmailWriteService(deps: EmailWriteImplDeps): EmailWriteService {
  const googleProvider = new GoogleEmailWriteProvider(deps.googleService, deps.googleApiClient);
  const imapProvider = new ImapEmailWriteProvider(deps.connectorsRepository, deps.cipher);

  async function run(
    mode: "draft" | "send",
    scopedDbRaw: unknown,
    _ctx: ToolContext,
    input: ReplyInput
  ): Promise<EmailWriteResult> {
    assertDataContextDb(scopedDbRaw);
    const scopedDb = scopedDbRaw as DataContextDb;

    const message = await deps.emailRepository.getById(scopedDb, input.cacheMessageId);
    if (!message) return { ok: false, mode, message: MSG_NOT_FOUND };

    const providerType = await deps.connectorsRepository.getAccountProviderType(
      scopedDb,
      message.connector_account_id
    );
    if (!providerType) return { ok: false, mode, message: MSG_UNSUPPORTED };

    // The per-account "email" feature grant is a provider-agnostic gate: a revoked
    // grant must deny draft/send for BOTH Gmail and IMAP. Keyed by the message's own
    // connector account so it can never be satisfied by a different account's grant.
    const preferencesRepository = deps.preferencesRepository;
    if (preferencesRepository) {
      const stored = await preferencesRepository.get(
        scopedDb,
        featureGrantsPrefKey(message.connector_account_id)
      );
      if (!isFeatureGranted(stored, "email")) return { ok: false, mode, message: MSG_DISABLED };
    }

    let provider: EmailWriteProvider;
    if (providerType === "google") {
      const gmailScope = await deps.connectorsRepository.getGmailWriteScopeState(scopedDb);
      if (!gmailScope || gmailScope.accountId !== message.connector_account_id) {
        return { ok: false, mode, message: MSG_UNSUPPORTED };
      }
      if (!gmailScope.hasScope) return { ok: false, mode, message: MSG_NO_SCOPE };

      provider = googleProvider;
    } else if (providerType === "imap") {
      provider = imapProvider;
    } else {
      return { ok: false, mode, message: MSG_UNSUPPORTED };
    }

    const target = deriveReplyTarget(message);
    // Gmail's API threads by threadId, so it is mandatory there. IMAP threads via
    // RFC822 headers and legitimately carries no Gmail-style threadId (spec §8), so
    // a null threadId must not block an IMAP APPEND/SMTP send.
    if (providerType === "google" && !target.threadId) {
      return { ok: false, mode, message: MSG_NO_THREAD };
    }

    if (mode === "draft") {
      return provider.saveDraft(
        scopedDb,
        message,
        target.to,
        target.subject,
        target.threadId,
        input.body
      );
    } else {
      return provider.send(
        scopedDb,
        message,
        target.to,
        target.subject,
        target.threadId,
        input.body
      );
    }
  }

  return {
    draftReply: (scopedDb, ctx, input) => run("draft", scopedDb, ctx, input),
    sendReply: (scopedDb, ctx, input) => run("send", scopedDb, ctx, input)
  };
}
