// Module admin/credential contract family (#917/#918). Extracted verbatim from
// platform-api.ts to satisfy the 1000-line file-size gate: Task 13 added the
// module-credential DTOs/schemas and pushed platform-api.ts over the cap. This is a
// PURE MOVE — the module-enablement (admin + self-service), external-module admin, and
// module-credential contracts keep the same shape and order. platform-api.ts re-exports
// this file's surface (`export * from "./platform-api-modules.js"`) so `@jarv1s/shared`
// consumers see no change.
import { errorResponseSchema } from "./schema-fragments.js";

// ── Module enablement (admin + self-service) ────────────────────────────────

export interface AdminModuleDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly lifecycle: "required" | "optional" | "user-toggleable" | "workspace-toggleable";
  readonly required: boolean;
  readonly supportsUserDisable: boolean;
  readonly instanceDisabled: boolean;
}

export interface MyModuleDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly lifecycle: "required" | "optional" | "user-toggleable" | "workspace-toggleable";
  readonly required: boolean;
  readonly supportsUserDisable: boolean;
  readonly instanceDisabled: boolean;
  readonly userDisabled: boolean;
  readonly active: boolean;
}

export interface ListAdminModulesResponse {
  readonly modules: readonly AdminModuleDto[];
}

export interface ListMyModulesResponse {
  readonly modules: readonly MyModuleDto[];
}

export interface PatchModuleEnablementRequest {
  readonly disabled: boolean;
}

const lifecycleEnum = {
  type: "string",
  enum: ["required", "optional", "user-toggleable", "workspace-toggleable"]
} as const;

const adminModuleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "version",
    "lifecycle",
    "required",
    "supportsUserDisable",
    "instanceDisabled"
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    lifecycle: lifecycleEnum,
    required: { type: "boolean" },
    supportsUserDisable: { type: "boolean" },
    instanceDisabled: { type: "boolean" }
  }
} as const;

const myModuleSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "name",
    "version",
    "lifecycle",
    "required",
    "supportsUserDisable",
    "instanceDisabled",
    "userDisabled",
    "active"
  ],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    lifecycle: lifecycleEnum,
    required: { type: "boolean" },
    supportsUserDisable: { type: "boolean" },
    instanceDisabled: { type: "boolean" },
    userDisabled: { type: "boolean" },
    active: { type: "boolean" }
  }
} as const;

export const adminModuleParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: { type: "string" } }
} as const;

export const listAdminModulesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["modules"],
      properties: { modules: { type: "array", items: adminModuleSchema } }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const listMyModulesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["modules"],
      properties: { modules: { type: "array", items: myModuleSchema } }
    },
    401: errorResponseSchema
  }
} as const;

export const patchModuleEnablementRouteSchema = {
  params: adminModuleParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["disabled"],
    properties: { disabled: { type: "boolean" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["module"],
      properties: { module: { ...myModuleSchema } }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;

// #917: external-module admin surface contracts. ExternalModuleDto is field-identical to
// module-registry's ReconciledExternalModule (same 8 readonly fields) so the composition
// root can hand reconcile output straight through the injected port without a mapper.
export interface ExternalModuleDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly status: "discovered" | "enabled" | "disabled";
  readonly active: boolean;
  readonly drifted: boolean;
  readonly disabledReason: string | null;
}

export interface ExternalModuleRejectionDto {
  readonly id: string;
  readonly reason: string;
}

export interface ListExternalModulesResponse {
  readonly enabled: boolean;
  readonly modules: readonly ExternalModuleDto[];
  readonly rejected: readonly ExternalModuleRejectionDto[];
}

export interface SetExternalModuleEnablementRequest {
  readonly enabled: boolean;
}

const externalModuleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "version", "publisher", "status", "active", "drifted", "disabledReason"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    publisher: { type: "string" },
    status: { type: "string", enum: ["discovered", "enabled", "disabled"] },
    active: { type: "boolean" },
    drifted: { type: "boolean" },
    disabledReason: { type: ["string", "null"] }
  }
} as const;

const externalModuleRejectionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "reason"],
  properties: { id: { type: "string" }, reason: { type: "string" } }
} as const;

export const listExternalModulesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["enabled", "modules", "rejected"],
      properties: {
        enabled: { type: "boolean" },
        modules: { type: "array", items: externalModuleSchema },
        rejected: { type: "array", items: externalModuleRejectionSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const setExternalModuleEnablementRouteSchema = {
  params: adminModuleParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["enabled"],
    properties: { enabled: { type: "boolean" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["module"],
      properties: { module: { ...externalModuleSchema } }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema
  }
} as const;

// #918: module-credential admin/user surface contracts. ModuleCredentialStatusDto is
// METADATA ONLY by construction — there is no field that could carry plaintext or the
// ciphertext envelope, and the strict response schema below (additionalProperties: false)
// silently strips any accidentally emitted extra field (the fast-json-stringify trap
// works FOR us here — see docs/superpowers/handoffs for the recurring gotcha).
export interface ModuleCredentialStatusDto {
  readonly credentialId: string;
  readonly displayName: string;
  readonly scope: "instance" | "user";
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

export interface ListModuleCredentialsResponse {
  readonly moduleId: string;
  readonly credentials: readonly ModuleCredentialStatusDto[];
}

export interface SetModuleCredentialRequest {
  readonly value: string;
}

const moduleCredentialStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["credentialId", "displayName", "scope", "configured", "updatedAt"],
  properties: {
    credentialId: { type: "string" },
    displayName: { type: "string" },
    scope: { type: "string", enum: ["instance", "user"] },
    configured: { type: "boolean" },
    updatedAt: { type: ["string", "null"] }
  }
} as const;

const moduleCredentialParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["moduleId", "credentialId"],
  properties: {
    moduleId: { type: "string", minLength: 1, maxLength: 100 },
    credentialId: { type: "string", minLength: 1, maxLength: 200 }
  }
} as const;

export const listModuleCredentialsRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["moduleId"],
    properties: { moduleId: { type: "string", minLength: 1, maxLength: 100 } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["moduleId", "credentials"],
      properties: {
        moduleId: { type: "string" },
        credentials: { type: "array", items: moduleCredentialStatusSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const setModuleCredentialRouteSchema = {
  params: moduleCredentialParamsSchema,
  body: {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: { value: { type: "string", minLength: 1, maxLength: 4096 } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["credential"],
      properties: { credential: moduleCredentialStatusSchema }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const revokeModuleCredentialRouteSchema = {
  params: moduleCredentialParamsSchema,
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["credential"],
      properties: { credential: moduleCredentialStatusSchema }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;
