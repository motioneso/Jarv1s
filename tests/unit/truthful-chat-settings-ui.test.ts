import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("truthful chat settings UI", () => {
  it("does not expose fake chat controls", () => {
    const source = readFileSync("apps/web/src/settings/settings-module-subviews.tsx", "utf8");

    expect(source).not.toContain("Chat settings aren't saved or applied yet.");
    expect(source).not.toContain("Stream responses");
    expect(source).not.toContain("Suggested actions");
    expect(source).not.toContain("Remember across conversations");
    expect(source).toContain("Response style");
    expect(source).toContain("Coming soon");
  });

  it("uses the real chat settings API client", () => {
    const client = readFileSync("apps/web/src/api/client.ts", "utf8");
    const queryKeys = readFileSync("apps/web/src/api/query-keys.ts", "utf8");

    expect(client).toContain("getChatSettings");
    expect(client).toContain("putChatSettings");
    expect(client).toContain("/api/chat/settings");
    expect(queryKeys).toContain('settings: ["chat", "settings"] as const');
  });
});
