import { parseEmail, type ParsedEmail } from "./email-extract.js";
import type { GmailMessageFull } from "./google-api-client.js";

/**
 * Provider-neutral key identifying one message within one mailbox. Gmail has no real folders, so
 * GoogleEmailReadProvider uses a single synthetic folder name; a future IMAP-over-Bridge provider
 * (Proton, docs/superpowers/specs/2026-06-30-proton-mail-connector-spike-output.md §9) would use the
 * real IMAP folder + UID here instead.
 */
export interface MailMessageKey {
  readonly folder: string;
  readonly id: string;
}

/**
 * Read-only seam between connector sync orchestration (sync-jobs.ts) and a provider's mail API.
 * GoogleEmailReadProvider is the only implementor today; a Proton IMAP-over-Bridge provider
 * (Slice C of the spec above) implements the same interface so sync-jobs.ts never branches on
 * provider identity. Token acquisition/refresh stays the caller's responsibility (account-scoped,
 * not part of this seam) — every method takes an already-resolved access token.
 */
export interface EmailReadProvider<TCredential = string> {
  listFolders(credential: TCredential): Promise<string[]>;
  listMessageKeys(
    credential: TCredential,
    folder: string,
    sinceKey?: string
  ): Promise<MailMessageKey[]>;
  getMessage(credential: TCredential, key: MailMessageKey): Promise<ParsedEmail>;
}

/** The subset of GoogleApiClient this provider needs (matches sync-jobs.ts's GoogleClientLike). */
export interface GmailReadClient {
  listMessageIds(input: { accessToken: string; query?: string }): Promise<Array<{ id: string }>>;
  getMessage(input: { accessToken: string; id: string }): Promise<GmailMessageFull>;
}

/** Gmail exposes one flat, query-filtered mailbox view — modeled as a single synthetic folder. */
export const GMAIL_READ_FOLDER = "INBOX";

export class GoogleEmailReadProvider implements EmailReadProvider {
  constructor(
    private readonly client: GmailReadClient,
    private readonly query: string
  ) {}

  async listFolders(): Promise<string[]> {
    return [GMAIL_READ_FOLDER];
  }

  async listMessageKeys(accessToken: string, folder: string): Promise<MailMessageKey[]> {
    const stubs = await this.client.listMessageIds({ accessToken, query: this.query });
    return stubs.map((stub) => ({ folder, id: stub.id }));
  }

  async getMessage(accessToken: string, key: MailMessageKey): Promise<ParsedEmail> {
    const full = await this.client.getMessage({ accessToken, id: key.id });
    return parseEmail(full);
  }
}
