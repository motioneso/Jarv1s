import { describe, expect, it } from "vitest";

import {
  adminModuleParamsSchema,
  listAdminModulesRouteSchema,
  listMyModulesRouteSchema,
  patchModuleEnablementRouteSchema
} from "@jarv1s/shared";

describe("module-enablement route schemas", () => {
  it("admin list response requires a modules array", () => {
    expect(listAdminModulesRouteSchema.response[200].required).toContain("modules");
  });

  it("self list response requires a modules array", () => {
    expect(listMyModulesRouteSchema.response[200].required).toContain("modules");
  });

  it("patch body requires a boolean disabled flag", () => {
    expect(patchModuleEnablementRouteSchema.body.required).toContain("disabled");
    expect(patchModuleEnablementRouteSchema.body.properties.disabled.type).toBe("boolean");
  });

  it("patch declares 404/409/422 error responses", () => {
    expect(patchModuleEnablementRouteSchema.response).toHaveProperty("404");
    expect(patchModuleEnablementRouteSchema.response).toHaveProperty("409");
    expect(patchModuleEnablementRouteSchema.response).toHaveProperty("422");
  });

  it("module id param schema requires id", () => {
    expect(adminModuleParamsSchema.required).toContain("id");
  });
});
