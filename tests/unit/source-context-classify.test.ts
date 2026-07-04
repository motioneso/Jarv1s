import { describe, expect, it } from "vitest";

import { classifyLiveReadFailure } from "../../packages/connectors/src/source-context/types.js";

function withStatus(statusCode: number): Error {
  const error = new Error(`provider returned ${statusCode}`) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

describe("classifyLiveReadFailure", () => {
  it("treats 401 and 403 as auth failures (gap, never cache)", () => {
    expect(classifyLiveReadFailure(withStatus(401))).toEqual({ kind: "auth" });
    expect(classifyLiveReadFailure(withStatus(403))).toEqual({ kind: "auth" });
  });

  it("treats 429 as transient rate limiting", () => {
    expect(classifyLiveReadFailure(withStatus(429))).toEqual({
      kind: "transient",
      degradedReason: "rate_limited"
    });
  });

  it("treats 5xx as transient provider errors", () => {
    expect(classifyLiveReadFailure(withStatus(500))).toEqual({
      kind: "transient",
      degradedReason: "provider_error"
    });
    expect(classifyLiveReadFailure(withStatus(503))).toEqual({
      kind: "transient",
      degradedReason: "provider_error"
    });
  });

  it("treats other 4xx (e.g. 404) as transient provider errors, not auth", () => {
    expect(classifyLiveReadFailure(withStatus(404))).toEqual({
      kind: "transient",
      degradedReason: "provider_error"
    });
  });

  it("classifies timeouts", () => {
    const abort = new Error("The operation was aborted");
    abort.name = "AbortError";
    expect(classifyLiveReadFailure(abort)).toEqual({
      kind: "transient",
      degradedReason: "timeout"
    });
    expect(classifyLiveReadFailure(new Error("connect ETIMEDOUT 1.2.3.4:993"))).toEqual({
      kind: "transient",
      degradedReason: "timeout"
    });
    expect(classifyLiveReadFailure(new Error("request timeout after 10s"))).toEqual({
      kind: "transient",
      degradedReason: "timeout"
    });
  });

  it("classifies network errors", () => {
    expect(classifyLiveReadFailure(new TypeError("fetch failed"))).toEqual({
      kind: "transient",
      degradedReason: "network_error"
    });
    for (const code of ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"]) {
      expect(classifyLiveReadFailure(new Error(`getaddrinfo ${code} imap.example.com`))).toEqual({
        kind: "transient",
        degradedReason: "network_error"
      });
    }
  });

  it("defaults unknown failures to transient internal errors", () => {
    expect(classifyLiveReadFailure(new Error("something odd"))).toEqual({
      kind: "transient",
      degradedReason: "internal_error"
    });
    expect(classifyLiveReadFailure("not even an error")).toEqual({
      kind: "transient",
      degradedReason: "internal_error"
    });
  });
});
