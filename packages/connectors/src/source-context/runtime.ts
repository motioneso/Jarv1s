import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import { CalendarRepository } from "@jarv1s/calendar";
import { EmailRepository } from "@jarv1s/email";
import { PreferencesRepository } from "@jarv1s/structured-state";

import { createConnectorSecretCipher } from "../crypto.js";
import { GoogleEmailReadProvider } from "../email-read-provider.js";
import { buildEmailExtractDeps } from "../extract-deps.js";
import { GoogleApiClient } from "../google-api-client.js";
import { GoogleConnectionService } from "../google-connection.js";
import { ImapEmailReadProvider } from "../imap-email-read-provider.js";
import { decryptImapConnectionSecret } from "../imap-secret.js";
import { GoogleOAuthClient } from "../oauth.js";
import { ConnectorsRepository } from "../repository.js";
import type { SyncLogger } from "../sync-jobs.js";
import { buildSourceContextService } from "./service.js";
import type { SourceContextService } from "./types.js";

// Mirrors the sync worker's 30-day window (EMAIL_QUERY in sync-jobs.ts) so the live read
// surface and the cache cover the same horizon.
const LIVE_EMAIL_QUERY = "newer_than:30d";

/**
 * Composition helper: assemble the live-first SourceContextService from real runtime
 * collaborators (repositories, ciphers, OAuth-backed Google connection, IMAP secrets, and the
 * shared email-extract deps). Composition hosts (module-registry, chat routes, briefings
 * workers) call this per injection site — everything constructed here is stateless per call,
 * matching the buildFeatureGrantService pattern. All credential resolution stays in-process;
 * secrets never leave this service.
 */
export function buildRuntimeSourceContextService(
  options: { readonly logger?: SyncLogger } = {}
): SourceContextService {
  const connectorsRepository = new ConnectorsRepository();
  const connectorCipher = createConnectorSecretCipher();
  const googleService = new GoogleConnectionService({
    repository: connectorsRepository,
    cipher: connectorCipher,
    oauthClient: new GoogleOAuthClient()
  });
  const googleClient = new GoogleApiClient();
  const aiRepo = new AiRepository();
  const aiCipher = createAiSecretCipher();
  return buildSourceContextService({
    connectorsRepository,
    preferencesRepository: new PreferencesRepository(),
    resolveGoogleCredential: (scopedDb, opts) => googleService.getFreshAccessToken(scopedDb, opts),
    resolveImapCredential: async (scopedDb, connectorAccountId) => {
      const stored = await connectorsRepository.getActiveImapAccountSecret(
        scopedDb,
        connectorAccountId
      );
      if (!stored) return undefined;
      return decryptImapConnectionSecret(connectorCipher, stored.encryptedSecret);
    },
    googleProvider: new GoogleEmailReadProvider(googleClient, LIVE_EMAIL_QUERY),
    imapProvider: new ImapEmailReadProvider(),
    googleClient,
    emailRepository: new EmailRepository(),
    calendarRepository: new CalendarRepository(),
    makeEmailExtractDeps: (scopedDb) => buildEmailExtractDeps(scopedDb, aiRepo, aiCipher),
    logger: options.logger
  });
}
