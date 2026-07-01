import { describe, expect, it } from "vitest";

import {
  decodeImapExternalId,
  encodeImapExternalId
} from "../../packages/connectors/src/imap-message-key.js";

describe("imap message key encoding", () => {
  it("round-trips folder/uidValidity/uid", () => {
    const encoded = encodeImapExternalId({ folder: "INBOX", uidValidity: "1719700000", uid: 42 });
    expect(decodeImapExternalId(encoded)).toEqual({
      folder: "INBOX",
      uidValidity: "1719700000",
      uid: 42
    });
  });

  it("escapes a folder name containing a colon so decode is unambiguous", () => {
    const encoded = encodeImapExternalId({
      folder: "Archive:2026",
      uidValidity: "1",
      uid: 1
    });
    expect(decodeImapExternalId(encoded)?.folder).toBe("Archive:2026");
  });

  it("produces a different external_id for the same uid under a different uidValidity", () => {
    const before = encodeImapExternalId({ folder: "INBOX", uidValidity: "1", uid: 42 });
    const after = encodeImapExternalId({ folder: "INBOX", uidValidity: "2", uid: 42 });
    expect(before).not.toBe(after);
  });

  it("returns null for a non-imap external_id", () => {
    expect(decodeImapExternalId("gmail-message-id-123")).toBeNull();
  });
});
