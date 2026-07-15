import { describe, expect, it } from "vitest";
import { postHerdrInstallRouteSchema } from "@jarv1s/shared";

describe("postHerdrInstallRouteSchema", () => {
  it("rejects unknown response fields via additionalProperties:false", () => {
    const schema = postHerdrInstallRouteSchema.response[200];
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["state", "herdrInstalled"]);
    expect(schema.properties.state.enum).toEqual(["installed", "failed", "timeout"]);
    expect(schema.properties.herdrInstalled.type).toBe("boolean");
  });
});
