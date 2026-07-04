/**
 * Shared live-first source-context fixtures for integration suites (#729).
 *
 * These build the REAL buildSourceContextService against the integration database — real
 * ConnectorsRepository grant/status filtering, real EmailRepository / CalendarRepository
 * cache fallback under RLS — with only the provider network edge faked. Defaults read
 * "live" successfully with zero provider items; individual tests override the providers
 * to return live messages or to throw a transient error (→ cache fallback).
 */
import { CalendarRepository } from "@jarv1s/calendar";
import {
  ConnectorsRepository,
  buildSourceContextService,
  type EmailReadProvider,
  type ImapConnectionSecret,
  type MailMessageKey,
  type ParsedEmail,
  type SourceContextService,
  type SourceContextServiceDeps
} from "@jarv1s/connectors";
import { EmailRepository } from "@jarv1s/email";

/** A provider failure the live reader must classify as TRANSIENT (→ cache fallback). */
export function transientProviderError(): Error {
  return Object.assign(new Error("upstream unavailable (integration test)"), {
    statusCode: 503
  });
}

export function parsedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    externalId: "live-ext-1",
    historyId: null,
    subject: "Hello from live",
    from: "Alice <alice@example.test>",
    recipients: ["ben@example.test"],
    receivedAt: "2026-07-03T10:00:00.000Z",
    labelIds: ["INBOX"],
    snippet: "Hi Ben",
    body: "Hi Ben, quick question about the plan.",
    bodyTruncated: false,
    ...overrides
  };
}

export function fakeEmailProvider<TCredential>(
  messages: readonly ParsedEmail[],
  options: { listError?: () => Error } = {}
): EmailReadProvider<TCredential> {
  return {
    async listFolders() {
      return ["INBOX"];
    },
    async listMessageKeys() {
      if (options.listError) throw options.listError();
      return messages.map((message) => ({ folder: "INBOX", id: message.externalId }));
    },
    async getMessage(_credential: TCredential, key: MailMessageKey) {
      const found = messages.find((message) => message.externalId === key.id);
      if (!found) throw new Error(`no such message ${key.id}`);
      return found;
    }
  };
}

/** Deterministic triage stub — no model call ever leaves the test process. */
function stubExtractDeps() {
  return {
    selectModel: async () => ({ tier: "economy" }),
    runChat: async () => ({
      text: JSON.stringify({
        summary: "Triage summary (integration stub).",
        billsDue: [],
        actionItems: [],
        deadlines: [],
        mayGetLostInShuffle: false,
        importance: "normal",
        confidence: 0.7,
        actionability: { category: "fyi", reason: "Informational." }
      })
    })
  };
}

export function buildTestSourceContextService(
  overrides: Partial<SourceContextServiceDeps> = {}
): SourceContextService {
  return buildSourceContextService({
    connectorsRepository: new ConnectorsRepository(),
    preferencesRepository: { get: async () => null },
    resolveGoogleCredential: async () => "integration-test-token",
    resolveImapCredential: async () => undefined,
    googleProvider: fakeEmailProvider<string>([]),
    imapProvider: fakeEmailProvider<ImapConnectionSecret>([]),
    emailRepository: new EmailRepository(),
    makeEmailExtractDeps: stubExtractDeps,
    googleClient: { listCalendarEvents: async () => [] },
    calendarRepository: new CalendarRepository(),
    ...overrides
  });
}
