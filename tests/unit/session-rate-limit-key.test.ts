import { createHash } from "node:crypto";

import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { sessionRateLimitKey } from "@jarv1s/module-sdk";

// Build a minimal FastifyRequest stand-in carrying only the fields the helper reads.
function req(opts: { authorization?: string; cookie?: string; ip?: string }): FastifyRequest {
  return {
    headers: { authorization: opts.authorization, cookie: opts.cookie },
    ip: opts.ip ?? "203.0.113.7"
  } as unknown as FastifyRequest;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

describe("sessionRateLimitKey", () => {
  it("hashes a Bearer token into the bearer namespace and never leaks the raw token", () => {
    const token = "secret-session-token-abc123";
    const key = sessionRateLimitKey(req({ authorization: `Bearer ${token}` }));
    expect(key).toBe(`bearer:${hash(token)}`);
    expect(key).not.toContain(token);
  });

  it("hashes the better-auth session cookie into the cookie namespace", () => {
    const value = "cookie-session-value-xyz";
    const key = sessionRateLimitKey(req({ cookie: `better-auth.session_token=${value}; other=1` }));
    expect(key).toBe(`cookie:${hash(value)}`);
    expect(key).not.toContain(value);
  });

  it("recognizes the __Secure- prefixed cookie (TLS) instead of degrading to per-IP", () => {
    const value = "tls-cookie-value";
    const key = sessionRateLimitKey(req({ cookie: `__Secure-better-auth.session_token=${value}` }));
    expect(key).toBe(`cookie:${hash(value)}`);
  });

  it("prefers the Bearer token over a session cookie when both are present", () => {
    const token = "bearer-wins";
    const key = sessionRateLimitKey(
      req({ authorization: `Bearer ${token}`, cookie: "better-auth.session_token=ignored" })
    );
    expect(key).toBe(`bearer:${hash(token)}`);
  });

  it("falls back to the per-IP namespace when no credential is presented", () => {
    expect(sessionRateLimitKey(req({ ip: "198.51.100.4" }))).toBe("ip:198.51.100.4");
  });

  it("falls back to per-IP for an empty Bearer value rather than minting an empty bucket", () => {
    expect(sessionRateLimitKey(req({ authorization: "Bearer ", ip: "198.51.100.9" }))).toBe(
      "ip:198.51.100.9"
    );
  });

  it("is stable for the same credential and distinct across credentials", () => {
    const a = sessionRateLimitKey(req({ authorization: "Bearer tok-A" }));
    const a2 = sessionRateLimitKey(req({ authorization: "Bearer tok-A" }));
    const b = sessionRateLimitKey(req({ authorization: "Bearer tok-B" }));
    expect(a).toBe(a2);
    expect(a).not.toBe(b);
  });
});
