import { describe, expect, it } from "vitest";

import { serializeEmailMessage } from "@jarv1s/email";

describe("serializeEmailMessage summary/signals (C2)", () => {
  it("serializes summary + signals onto EmailMessageDto", () => {
    const dto = serializeEmailMessage({
      id: "00000000-0000-0000-0000-000000000001",
      connector_account_id: "00000000-0000-0000-0000-000000000002",
      owner_user_id: "00000000-0000-0000-0000-000000000003",
      sender: "a@b.com",
      recipients: [],
      subject: "s",
      snippet: null,
      body_excerpt: null,
      received_at: new Date("2026-06-13T09:00:00.000Z"),
      external_id: "x",
      external_metadata: {},
      summary: "concise",
      signals: { importance: "high" },
      created_at: new Date("2026-06-13T09:00:00.000Z"),
      updated_at: new Date("2026-06-13T09:00:00.000Z")
    } as never);
    expect(dto.summary).toBe("concise");
    expect((dto.signals as { importance?: string }).importance).toBe("high");
  });

  it("omits connector account ids and raw external metadata from EmailMessageDto", () => {
    const dto = serializeEmailMessage({
      id: "00000000-0000-0000-0000-000000000001",
      connector_account_id: "00000000-0000-0000-0000-000000000002",
      owner_user_id: "00000000-0000-0000-0000-000000000003",
      sender: "sender@example.test",
      recipients: ["owner@example.test"],
      subject: "Subject",
      snippet: "Snippet",
      body_excerpt: "Excerpt",
      received_at: new Date("2026-06-13T09:00:00.000Z"),
      external_id: "provider-message-id",
      external_metadata: {
        historyId: "secret-history-id",
        labelIds: ["INBOX"],
        providerToken: "must-not-leak"
      },
      summary: "concise",
      signals: { importance: "high" },
      created_at: new Date("2026-06-13T09:00:00.000Z"),
      updated_at: new Date("2026-06-13T09:00:00.000Z")
    } as never);

    expect("connectorAccountId" in dto).toBe(false);
    expect("externalMetadata" in dto).toBe(false);
    expect("historyId" in dto).toBe(false);
    expect("providerToken" in dto).toBe(false);
    expect(Object.keys(dto).sort()).toEqual([
      "bodyExcerpt",
      "createdAt",
      "externalId",
      "id",
      "ownerUserId",
      "receivedAt",
      "recipients",
      "sender",
      "signals",
      "snippet",
      "subject",
      "summary",
      "updatedAt"
    ]);
  });
});
