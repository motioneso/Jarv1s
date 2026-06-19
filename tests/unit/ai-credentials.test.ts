import { describe, expect, it } from "vitest";

import { parseAiApiKeyCredential } from "@jarv1s/ai";

describe("parseAiApiKeyCredential", () => {
  it("accepts a non-empty apiKey string", () => {
    expect(parseAiApiKeyCredential({ apiKey: "sk-test" })).toEqual({ apiKey: "sk-test" });
  });

  it.each([{ apiKey: "" }, { apiKey: 123 }, {}, { apiKey: null }])(
    "rejects malformed AI credentials %#",
    (value) => {
      expect(parseAiApiKeyCredential(value)).toBeNull();
    }
  );
});
