import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginOnboardingProviderLogin,
  cancelOnboardingProviderLogin,
  installOnboardingProvider,
  pollOnboardingProviderLogin,
  submitOnboardingProviderLoginToken
} from "../../apps/web/src/api/onboarding-connect-client.js";

function mockFetchOnce(body: unknown) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("onboarding connect client (#365)", () => {
  it("installOnboardingProvider POSTs providerKind and returns the lifecycle", async () => {
    const fetchMock = mockFetchOnce({ providerKind: "anthropic", installState: "installed" });
    const res = await installOnboardingProvider({ providerKind: "anthropic" });
    expect(res).toEqual({ providerKind: "anthropic", installState: "installed" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/onboarding/provider-install");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ providerKind: "anthropic" });
  });

  it("beginOnboardingProviderLogin POSTs to /begin", async () => {
    const fetchMock = mockFetchOnce({
      providerKind: "anthropic",
      loginId: "L1",
      status: "awaiting_token",
      authorizationUrl: "https://claude.ai/oauth",
      installState: "needs_login"
    });
    const res = await beginOnboardingProviderLogin({ providerKind: "anthropic" });
    expect(res.authorizationUrl).toBe("https://claude.ai/oauth");
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "/api/onboarding/provider-login/begin"
    );
  });

  it("submitToken forwards the pasted code to /submit-token", async () => {
    const fetchMock = mockFetchOnce({
      providerKind: "anthropic",
      loginId: "L1",
      status: "ready",
      installState: "ready"
    });
    const res = await submitOnboardingProviderLoginToken({
      providerKind: "anthropic",
      loginId: "L1",
      token: "code-123"
    });
    expect(res.status).toBe("ready");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/onboarding/provider-login/submit-token");
    expect(JSON.parse(init.body as string)).toEqual({
      providerKind: "anthropic",
      loginId: "L1",
      token: "code-123"
    });
  });

  it("pollOnboardingProviderLogin POSTs to /poll", async () => {
    const fetchMock = mockFetchOnce({
      providerKind: "anthropic",
      loginId: "L1",
      status: "ready",
      installState: "ready"
    });
    await pollOnboardingProviderLogin({ providerKind: "anthropic", loginId: "L1" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      "/api/onboarding/provider-login/poll"
    );
  });

  it("cancelOnboardingProviderLogin POSTs the login handle to /cancel", async () => {
    const fetchMock = mockFetchOnce({
      providerKind: "anthropic",
      loginId: "L1",
      ok: true,
      installState: "needs_login"
    });
    await cancelOnboardingProviderLogin({ providerKind: "anthropic", loginId: "L1" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/onboarding/provider-login/cancel");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ providerKind: "anthropic", loginId: "L1" });
  });
});
