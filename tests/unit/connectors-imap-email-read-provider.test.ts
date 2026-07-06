import { describe, expect, it } from "vitest";

import { ImapEmailReadProvider } from "../../packages/connectors/src/imap-email-read-provider.js";
import type { ImapConnectionSecret } from "../../packages/connectors/src/imap-secret.js";

const SECRET: ImapConnectionSecret = {
  kind: "imap-password",
  providerId: "imap-proton",
  username: "user@proton.local",
  password: "secret",
  imapHost: "127.0.0.1",
  imapPort: 1143,
  imapTls: false,
  smtpHost: "127.0.0.1",
  smtpPort: 1025,
  smtpSecurity: "none"
};

const RAW_MESSAGE = [
  "From: Alice <alice@example.com>",
  "To: user@proton.local",
  "Subject: Test subject",
  "Date: Mon, 01 Jun 2026 12:00:00 +0000",
  "",
  "Hello world"
].join("\r\n");

function makeFakeClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    connect: async () => undefined,
    logout: async () => undefined,
    close: async () => undefined,
    list: async () => [{ path: "INBOX" }, { path: "Archive" }],
    mailboxOpen: async () => ({ uidValidity: 1719700000n, exists: 1 }),
    search: async () => [1, 2],
    fetchOne: async () => ({ uid: 1, source: Buffer.from(RAW_MESSAGE) }),
    ...overrides
  };
}

describe("ImapEmailReadProvider", () => {
  it("lists real mailbox paths via list()", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    const folders = await provider.listFolders(SECRET);
    expect(folders).toEqual(["INBOX", "Archive"]);
  });

  it("encodes folder+uidValidity+uid into each key's id", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    const keys = await provider.listMessageKeys(SECRET, "INBOX");
    expect(keys).toEqual([
      { folder: "INBOX", id: "imap:INBOX:1719700000:1" },
      { folder: "INBOX", id: "imap:INBOX:1719700000:2" }
    ]);
  });

  it("fetches and parses a message body/headers by decoding the key", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    const parsed = await provider.getMessage(SECRET, {
      folder: "INBOX",
      id: "imap:INBOX:1719700000:1"
    });
    expect(parsed.externalId).toBe("imap:INBOX:1719700000:1");
    expect(parsed.subject).toBe("Test subject");
    expect(parsed.from).toContain("alice@example.com");
    expect(parsed.body).toContain("Hello world");
  });

  it("throws on a malformed key rather than silently fetching the wrong message", async () => {
    const provider = new ImapEmailReadProvider(() => makeFakeClient() as never);
    await expect(
      provider.getMessage(SECRET, { folder: "INBOX", id: "not-an-imap-key" })
    ).rejects.toThrow();
  });
});
