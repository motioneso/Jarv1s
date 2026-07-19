import { describe, expect, it } from "vitest";

import { CliChatUnavailableError } from "@jarv1s/chat";
import { HttpError } from "@jarv1s/module-sdk";

import { buildOnboardingLogin } from "../../packages/module-registry/src/onboarding-login.js";

const repository = {} as never;

describe("onboarding provider-login wiring", () => {
  it("maps runner unavailability to a retryable HTTP 503", async () => {
    const seam = buildOnboardingLogin({
      enabled: true,
      getConnection: () =>
        ({
          beginLogin: async () => {
            throw new CliChatUnavailableError("a provider login is already in progress");
          }
        }) as never,
      repository
    });

    await expect(seam?.loginClient.begin("anthropic")).rejects.toMatchObject({
      statusCode: 503,
      message: "Provider login is currently unavailable. Please try again."
    });
    await expect(seam?.loginClient.begin("anthropic")).rejects.toBeInstanceOf(HttpError);
  });

  it("reports a missing runner connection as a retryable HTTP 503", async () => {
    const seam = buildOnboardingLogin({
      enabled: true,
      getConnection: () => undefined,
      repository
    });

    await expect(seam?.loginClient.begin("anthropic")).rejects.toMatchObject({ statusCode: 503 });
  });
});
