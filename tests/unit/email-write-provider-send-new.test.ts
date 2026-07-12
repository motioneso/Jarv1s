import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";
import { GoogleEmailWriteProvider } from "@jarv1s/connectors";
import { buildNewMessageMime } from "@jarv1s/email";

describe("fresh email sends", () => {
  it("sends a fresh Gmail message without a threadId", async () => {
    const sent: unknown[] = [];
    const provider = new GoogleEmailWriteProvider(
      { getFreshAccessToken: async () => "access-token" },
      {
        createDraft: async () => ({ id: "draft-1" }),
        sendMessage: async (input: unknown) => {
          sent.push(input);
          return { id: "msg-1" };
        }
      }
    );

    const result = await provider.sendNew({} as DataContextDb, {
      to: "me@example.test",
      subject: "Jarvis digest",
      body: "Digest body"
    });

    expect(result).toEqual({ ok: true, mode: "send" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ accessToken: "access-token" });
    expect(sent[0]).not.toHaveProperty("threadId");
  });

  it("builds fresh-send MIME without reply threading headers", () => {
    const raw = buildNewMessageMime({
      to: "me@example.test",
      subject: "Jarvis digest\r\nBcc: attacker@example.test",
      body: "Digest body"
    });

    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: me@example.test");
    expect(decoded).toContain("Subject: Jarvis digestBcc: attacker@example.test");
    expect(decoded).toContain("Digest body");
    expect(decoded).not.toContain("In-Reply-To");
    expect(decoded).not.toContain("References");
  });
});
