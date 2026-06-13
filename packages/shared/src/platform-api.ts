import { errorResponseSchema } from "./schema-fragments.js";

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly isInstanceAdmin: boolean;
  readonly status: "pending" | "active" | "deactivated";
  readonly isBootstrapOwner: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AdminAuditEventDto {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly requestId: string | null;
  readonly createdAt: string;
}

export interface AuthProviderStatusDto {
  readonly id: string;
  readonly displayName: string;
  readonly providerType: "local" | "oauth" | "oidc";
  readonly enabled: boolean;
}

export interface ModuleNavigationEntryDto {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon: string | null;
  readonly order: number | null;
}

export interface ModuleSettingsSurfaceDto {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly scope: "user" | "admin" | "system";
  readonly order: number | null;
}

export interface ModuleDto {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly lifecycle: "required" | "optional" | "user-toggleable" | "workspace-toggleable";
  readonly navigation: readonly ModuleNavigationEntryDto[];
  readonly settings: readonly ModuleSettingsSurfaceDto[];
}

export interface InstanceSettingDto {
  readonly key: string;
  readonly value: Record<string, unknown>;
  readonly updatedByUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BootstrapStatusResponse {
  readonly needsBootstrap: boolean;
}

export interface MeResponse {
  readonly user: UserDto;
}

export interface ListUsersResponse {
  readonly users: readonly UserDto[];
}

export interface ListInstanceSettingsResponse {
  readonly settings: readonly InstanceSettingDto[];
}

export interface UpsertInstanceSettingRequest {
  readonly value: Record<string, unknown>;
}

export interface UpsertInstanceSettingResponse {
  readonly setting: InstanceSettingDto;
}

export interface ListAdminAuditEventsResponse {
  readonly auditEvents: readonly AdminAuditEventDto[];
}

export interface ListAuthProviderStatusesResponse {
  readonly providers: readonly AuthProviderStatusDto[];
}

export interface ListModulesResponse {
  readonly modules: readonly ModuleDto[];
}

const authProviderStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "displayName", "providerType", "enabled"],
  properties: {
    id: { type: "string" },
    displayName: { type: "string" },
    providerType: { type: "string", enum: ["local", "oauth", "oidc"] },
    enabled: { type: "boolean" }
  }
} as const;

const moduleNavigationEntrySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "path", "icon", "order"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    path: { type: "string" },
    icon: { type: ["string", "null"] },
    order: { type: ["number", "null"] }
  }
} as const;

const moduleSettingsSurfaceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "path", "scope", "order"],
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    path: { type: "string" },
    scope: { type: "string", enum: ["user", "admin", "system"] },
    order: { type: ["number", "null"] }
  }
} as const;

const moduleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "version", "lifecycle", "navigation", "settings"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    version: { type: "string" },
    lifecycle: {
      type: "string",
      enum: ["required", "optional", "user-toggleable", "workspace-toggleable"]
    },
    navigation: { type: "array", items: moduleNavigationEntrySchema },
    settings: { type: "array", items: moduleSettingsSurfaceSchema }
  }
} as const;

const userSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "email",
    "name",
    "isInstanceAdmin",
    "status",
    "isBootstrapOwner",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
    isInstanceAdmin: { type: "boolean" },
    status: { type: "string", enum: ["pending", "active", "deactivated"] },
    isBootstrapOwner: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const adminAuditEventSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "actorUserId",
    "action",
    "targetType",
    "targetId",
    "metadata",
    "requestId",
    "createdAt"
  ],
  properties: {
    id: { type: "string" },
    actorUserId: { type: ["string", "null"] },
    action: { type: "string" },
    targetType: { type: "string" },
    targetId: { type: ["string", "null"] },
    metadata: { type: "object", additionalProperties: true },
    requestId: { type: ["string", "null"] },
    createdAt: { type: "string" }
  }
} as const;

const settingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "value", "updatedByUserId", "createdAt", "updatedAt"],
  properties: {
    key: { type: "string" },
    value: { type: "object", additionalProperties: true },
    updatedByUserId: { type: ["string", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const listAuthProviderStatusesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["providers"],
      properties: {
        providers: { type: "array", items: authProviderStatusSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const listModulesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["modules"],
      properties: {
        modules: { type: "array", items: moduleSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const bootstrapStatusRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["needsBootstrap"],
      properties: {
        needsBootstrap: { type: "boolean" }
      }
    }
  }
} as const;

export const meRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["user"],
      properties: {
        user: userSchema
      }
    },
    401: errorResponseSchema
  }
} as const;

export const listUsersRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["users"],
      properties: {
        users: { type: "array", items: userSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const listInstanceSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["settings"],
      properties: {
        settings: { type: "array", items: settingSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const listAdminAuditEventsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["auditEvents"],
      properties: {
        auditEvents: { type: "array", items: adminAuditEventSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const upsertInstanceSettingRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: {
      value: { type: "object", additionalProperties: true }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["setting"],
      properties: {
        setting: settingSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

/** The admin-selectable multiplexer choice. Single source of truth — ai/settings import this. */
export type ChatMultiplexerChoice = "auto" | "tmux" | "herdr";

export interface RegistrationSettingsDto {
  readonly registrationEnabled: boolean;
  readonly requiresApproval: boolean;
}

const registrationSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["registrationEnabled", "requiresApproval"],
  properties: {
    registrationEnabled: { type: "boolean" },
    requiresApproval: { type: "boolean" }
  }
} as const;

// ---------------------------------------------------------------------------
// Onboarding (Phase 2 primary-user onboarding). See
// docs/superpowers/specs/2026-06-12-p2-primary-user-onboarding-design.md
// NOTE: ChatMultiplexerChoice ("auto"|"tmux"|"herdr") is the EXISTING CLI-adapter
// contract (this file, ~line 345). Onboarding reuses it; it is NOT redefined here.
// ---------------------------------------------------------------------------

/** Single, unambiguous onboarding lifecycle state (replaces two booleans). */
export type OnboardingState = "pending" | "completed" | "skipped";

export interface OnboardingMultiplexerStepDto {
  /** done ⇔ the chosen multiplexer is USABLE (tmux installed | herdr installed+root pane | auto). */
  readonly done: boolean;
  /** The persisted chat.multiplexer choice, or null when no row exists yet. */
  readonly selected: ChatMultiplexerChoice | null;
  /** tmux is usable on this host (installed). */
  readonly tmuxUsable: boolean;
  /** herdr is usable on this host (installed AND a root pane is configured). */
  readonly herdrUsable: boolean;
}

export interface OnboardingCliProviderDto {
  readonly kind: "anthropic" | "openai-compatible" | "google";
  /** Presence-only: the binary is on PATH. NOT a claim of authentication. */
  readonly cliPresent: boolean;
}

export interface OnboardingCliAuthStepDto {
  /** Documented floor: done ⇔ at least one provider CLI is PRESENT (presence ≠ authed). */
  readonly done: boolean;
  readonly providers: readonly OnboardingCliProviderDto[];
}

export interface OnboardingConnectorStepDto {
  readonly done: boolean;
}

export interface OnboardingStepsDto {
  readonly multiplexer: OnboardingMultiplexerStepDto;
  readonly cliAuth: OnboardingCliAuthStepDto;
  readonly connectors: OnboardingConnectorStepDto;
}

export interface OnboardingStatusResponse {
  readonly state: OnboardingState;
  readonly steps: OnboardingStepsDto;
}

export interface OnboardingStateResponse {
  readonly state: OnboardingState;
}

const onboardingStatusResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state", "steps"],
  properties: {
    state: { type: "string", enum: ["pending", "completed", "skipped"] },
    steps: {
      type: "object",
      additionalProperties: false,
      required: ["multiplexer", "cliAuth", "connectors"],
      properties: {
        multiplexer: {
          type: "object",
          additionalProperties: false,
          required: ["done", "selected", "tmuxUsable", "herdrUsable"],
          properties: {
            done: { type: "boolean" },
            selected: { type: ["string", "null"], enum: ["auto", "tmux", "herdr", null] },
            tmuxUsable: { type: "boolean" },
            herdrUsable: { type: "boolean" }
          }
        },
        cliAuth: {
          type: "object",
          additionalProperties: false,
          required: ["done", "providers"],
          properties: {
            done: { type: "boolean" },
            providers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "cliPresent"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["anthropic", "openai-compatible", "google"]
                  },
                  cliPresent: { type: "boolean" }
                }
              }
            }
          }
        },
        connectors: {
          type: "object",
          additionalProperties: false,
          required: ["done"],
          properties: { done: { type: "boolean" } }
        }
      }
    }
  }
} as const;

const onboardingStateResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state"],
  properties: {
    state: { type: "string", enum: ["pending", "completed", "skipped"] }
  }
} as const;

export const getOnboardingStatusRouteSchema = {
  response: {
    200: onboardingStatusResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingCompleteRouteSchema = {
  response: {
    200: onboardingStateResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingSkipRouteSchema = {
  response: {
    200: onboardingStateResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const adminUserActionRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["user"],
      properties: { user: userSchema }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;

export const adminRevokeSessionsRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["success", "count"],
      properties: {
        success: { type: "boolean" },
        count: { type: "number" }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const adminDeleteUserRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["deletedUserId"],
      properties: { deletedUserId: { type: "string" } }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;

export const adminRejectUserRouteSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: { id: { type: "string" } }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["rejectedUserId"],
      properties: { rejectedUserId: { type: "string" } }
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
    422: errorResponseSchema
  }
} as const;

export const getRegistrationSettingsRouteSchema = {
  response: {
    200: registrationSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putRegistrationSettingsRouteSchema = {
  body: registrationSettingsSchema,
  response: {
    200: registrationSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export interface ChatMultiplexerAvailability {
  readonly tmux: boolean;
  readonly herdr: boolean;
}

export interface ChatMultiplexerSettingsDto {
  readonly multiplexer: ChatMultiplexerChoice;
  readonly available: ChatMultiplexerAvailability;
}

export const chatMultiplexerSettingsSchema = {
  type: "object",
  required: ["multiplexer", "available"],
  additionalProperties: false,
  properties: {
    multiplexer: { type: "string", enum: ["auto", "tmux", "herdr"] },
    available: {
      type: "object",
      required: ["tmux", "herdr"],
      additionalProperties: false,
      properties: { tmux: { type: "boolean" }, herdr: { type: "boolean" } }
    }
  }
} as const;

export const getChatMultiplexerSettingsRouteSchema = {
  response: {
    200: chatMultiplexerSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putChatMultiplexerSettingsRouteSchema = {
  body: {
    type: "object",
    required: ["multiplexer"],
    additionalProperties: false,
    properties: { multiplexer: { type: "string", enum: ["auto", "tmux", "herdr"] } }
  },
  response: {
    200: chatMultiplexerSettingsSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

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
