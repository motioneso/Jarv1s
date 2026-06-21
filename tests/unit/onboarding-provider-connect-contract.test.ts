import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  onboardingProviderInstallRequestSchema,
  onboardingProviderLoginSubmitTokenRequestSchema,
  getOnboardingStatusRouteSchema
} from "@jarv1s/shared";

// These schemas ARE the runtime Fastify validation contract — exercise them through a real
// Fastify ajv path (mirrors tests/unit/shared-contract-schemas.test.ts).
async function parseBody(bodySchema: unknown, payload: Record<string, unknown>) {
  const app = Fastify();
  app.post("/probe", { schema: { body: bodySchema as never } }, async (req) => req.body);
  const res = await app.inject({
    method: "POST",
    url: "/probe",
    payload,
    headers: { "content-type": "application/json" }
  });
  await app.close();
  return {
    status: res.statusCode,
    body: res.statusCode === 200 ? (JSON.parse(res.body) as Record<string, unknown>) : undefined
  };
}

describe("onboarding provider-connect contract (#365)", () => {
  it("install request strips unknown keys and keeps providerKind", async () => {
    const { status, body } = await parseBody(onboardingProviderInstallRequestSchema, {
      providerKind: "anthropic",
      __unexpected__: "x"
    });
    expect(status).toBe(200);
    expect(body).toEqual({ providerKind: "anthropic" });
  });

  it("submit-token request requires a token and keeps it (auth material flows through)", async () => {
    const missing = await parseBody(onboardingProviderLoginSubmitTokenRequestSchema, {
      providerKind: "anthropic",
      loginId: "L1"
    });
    expect(missing.status).toBe(400);
    const ok = await parseBody(onboardingProviderLoginSubmitTokenRequestSchema, {
      providerKind: "anthropic",
      loginId: "L1",
      token: "code-123"
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ providerKind: "anthropic", loginId: "L1", token: "code-123" });
  });

  it("status response schema declares an additive `installable` boolean on providers", () => {
    const founder = (
      getOnboardingStatusRouteSchema.response[200] as unknown as {
        oneOf: ReadonlyArray<Record<string, unknown>>;
      }
    ).oneOf[0] as unknown as {
      properties: {
        steps: {
          properties: {
            cliAuth: {
              properties: { providers: { items: { properties: Record<string, unknown> } } };
            };
          };
        };
      };
    };
    const providerProps =
      founder.properties.steps.properties.cliAuth.properties.providers.items.properties;
    expect(providerProps.installable).toEqual({ type: "boolean" });
  });
});
