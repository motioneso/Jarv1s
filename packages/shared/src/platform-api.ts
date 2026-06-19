import { errorResponseSchema } from "./schema-fragments.js";

export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
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

export interface ProfilePrefs {
  readonly addressed: string | null;
}

export interface MeResponse {
  readonly user: UserDto;
  readonly profilePrefs: ProfilePrefs;
}

export interface PatchMeProfileRequest {
  readonly name: string;
  readonly addressed: string;
}

export type MeSessionDeviceKind = "laptop" | "desktop" | "phone" | "tablet";

/**
 * Safe metadata for one of the current user's active sessions. NEVER carries the
 * session token, cookie value, bearer secret, or any token fingerprint (#237).
 * Covers both cookie sessions (rich UA/IP metadata) and legacy bearer/CLI sessions
 * (minimal metadata — UA/IP null, generic device label).
 */
export interface MeSessionDto {
  readonly id: string;
  readonly isCurrent: boolean;
  readonly createdAt: string;
  /** Derived from the session row's updated_at; falls back to createdAt when absent. */
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly deviceLabel: string;
  readonly browser: string | null;
  readonly os: string | null;
  readonly deviceKind: MeSessionDeviceKind;
}

export interface ListMySessionsResponse {
  readonly sessions: readonly MeSessionDto[];
}

export interface RevokeMySessionResponse {
  readonly success: boolean;
}

export interface RevokeMyOtherSessionsResponse {
  readonly success: boolean;
  readonly count: number;
}

export interface AdminRevokeSessionsResponse {
  readonly success: boolean;
  readonly count: number;
}

export type LocaleDateFormat = "24" | "12";
export interface LocaleSettingsDto {
  readonly timezone: string;
  readonly region: string;
  readonly dateFormat: LocaleDateFormat;
}
export interface GetLocaleSettingsResponse {
  readonly locale: LocaleSettingsDto;
}
export interface PutLocaleSettingsRequest {
  readonly locale: LocaleSettingsDto;
}
export type PutLocaleSettingsResponse = GetLocaleSettingsResponse;
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
    "emailVerified",
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
    emailVerified: { type: "boolean" },
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
      required: ["user", "profilePrefs"],
      properties: {
        user: userSchema,
        profilePrefs: {
          type: "object",
          additionalProperties: false,
          required: ["addressed"],
          properties: {
            addressed: { type: ["string", "null"] }
          }
        }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const patchMeProfileRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["name", "addressed"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 100 },
      addressed: { type: "string", maxLength: 100 }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["user", "profilePrefs"],
      properties: {
        user: userSchema,
        profilePrefs: {
          type: "object",
          additionalProperties: false,
          required: ["addressed"],
          properties: {
            addressed: { type: ["string", "null"] }
          }
        }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

const meSessionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "isCurrent",
    "createdAt",
    "lastSeenAt",
    "expiresAt",
    "ipAddress",
    "userAgent",
    "deviceLabel",
    "browser",
    "os",
    "deviceKind"
  ],
  properties: {
    id: { type: "string" },
    isCurrent: { type: "boolean" },
    createdAt: { type: "string" },
    lastSeenAt: { type: "string" },
    expiresAt: { type: "string" },
    ipAddress: { type: ["string", "null"] },
    userAgent: { type: ["string", "null"] },
    deviceLabel: { type: "string" },
    browser: { type: ["string", "null"] },
    os: { type: ["string", "null"] },
    deviceKind: { type: "string", enum: ["laptop", "desktop", "phone", "tablet"] }
  }
} as const;

export const listMySessionsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["sessions"],
      properties: {
        sessions: { type: "array", items: meSessionSchema }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const revokeMySessionRouteSchema = {
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
      required: ["success"],
      properties: { success: { type: "boolean" } }
    },
    401: errorResponseSchema,
    // 404: unknown / cross-user-guessed session id (no existence leak).
    404: errorResponseSchema,
    // 422: refusing to revoke the request's own current session via this surface.
    422: errorResponseSchema
  }
} as const;

export const revokeMyOtherSessionsRouteSchema = {
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
    401: errorResponseSchema
  }
} as const;

const localeSettingsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timezone", "region", "dateFormat"],
  properties: {
    timezone: { type: "string", minLength: 1, maxLength: 100 },
    region: { type: "string", minLength: 1, maxLength: 35 },
    dateFormat: { type: "string", enum: ["24", "12"] }
  }
} as const;
export const getLocaleSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["locale"],
      properties: {
        locale: localeSettingsSchema
      }
    },
    401: errorResponseSchema
  }
} as const;
export const putLocaleSettingsRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["locale"],
    properties: {
      locale: localeSettingsSchema
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["locale"],
      properties: {
        locale: localeSettingsSchema
      }
    },
    400: errorResponseSchema,
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

// ── Host diagnostics (admin-only, read-only, secret-safe) ───────────────────

/** Pass/warn/fail status for a single diagnostic check. */
export type HostDiagnosticStatus = "pass" | "warn" | "fail";

/** One diagnostic check. `detail` is a short, fixed, secret-free message. */
export interface HostDiagnosticCheckDto {
  readonly id: string;
  readonly label: string;
  readonly status: HostDiagnosticStatus;
  readonly detail: string;
}

/**
 * Sync runtime facts supplied by the API composition root. Every field is an
 * explicit allowlisted, non-secret value — never an env-var value, connection
 * string, secret, token, or user-data path.
 */
export interface HostDiagnosticsInfo {
  readonly uptimeSeconds: number;
  readonly environment: "production" | "development" | "test" | "unknown";
  /** App version if the deployment sets JARVIS_APP_VERSION, else null. */
  readonly version: string | null;
  /** Short commit if the deployment sets JARVIS_GIT_COMMIT, else null. */
  readonly commit: string | null;
  /** Bind host (e.g. "0.0.0.0") — a config value, not a secret. */
  readonly host: string;
  readonly port: number;
  /** Configured log level readout (env-configured; not a runtime toggle). */
  readonly logLevel: string;
  readonly deployMode: "compose" | "systemd" | "dev" | "unknown";
  /** Documented operator restart command for the deploy mode, or null. */
  readonly restartCommand: string | null;
  readonly moduleCount: number;
  readonly routeCount: number;
}

export interface HostDiagnosticsDto extends HostDiagnosticsInfo {
  readonly multiplexer: ChatMultiplexerChoice;
  readonly available: ChatMultiplexerAvailability;
  readonly checks: readonly HostDiagnosticCheckDto[];
}

const hostDiagnosticCheckSchema = {
  type: "object",
  required: ["id", "label", "status", "detail"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    label: { type: "string" },
    status: { type: "string", enum: ["pass", "warn", "fail"] },
    detail: { type: "string" }
  }
} as const;

export const hostDiagnosticsSchema = {
  type: "object",
  required: [
    "uptimeSeconds",
    "environment",
    "version",
    "commit",
    "host",
    "port",
    "logLevel",
    "deployMode",
    "restartCommand",
    "moduleCount",
    "routeCount",
    "multiplexer",
    "available",
    "checks"
  ],
  additionalProperties: false,
  properties: {
    uptimeSeconds: { type: "number" },
    environment: { type: "string", enum: ["production", "development", "test", "unknown"] },
    version: { type: ["string", "null"] },
    commit: { type: ["string", "null"] },
    host: { type: "string" },
    port: { type: "number" },
    logLevel: { type: "string" },
    deployMode: { type: "string", enum: ["compose", "systemd", "dev", "unknown"] },
    restartCommand: { type: ["string", "null"] },
    moduleCount: { type: "number" },
    routeCount: { type: "number" },
    multiplexer: { type: "string", enum: ["auto", "tmux", "herdr"] },
    available: {
      type: "object",
      required: ["tmux", "herdr"],
      additionalProperties: false,
      properties: { tmux: { type: "boolean" }, herdr: { type: "boolean" } }
    },
    checks: { type: "array", items: hostDiagnosticCheckSchema }
  }
} as const;

export const getHostDiagnosticsRouteSchema = {
  response: {
    200: hostDiagnosticsSchema,
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
