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

export interface WorkspaceDto {
  readonly id: string;
  readonly name: string;
  readonly createdByUserId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceMembershipDto {
  readonly userId: string;
  readonly workspaceId: string;
  readonly role: string;
  readonly createdAt: string;
}

export interface ResourceGrantDto {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly granteeUserId: string;
  readonly grantLevel: "view" | "contribute" | "manage";
  readonly grantedByUserId: string | null;
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
  readonly userCount: number;
}

export interface MeResponse {
  readonly user: UserDto;
  readonly memberships: readonly WorkspaceMembershipDto[];
  readonly workspaces: readonly WorkspaceDto[];
  readonly activeWorkspaceId: string | null;
}

export interface ListUsersResponse {
  readonly users: readonly UserDto[];
}

export interface ListWorkspacesResponse {
  readonly workspaces: readonly WorkspaceDto[];
}

export interface ListWorkspaceMembershipsResponse {
  readonly memberships: readonly WorkspaceMembershipDto[];
}

export interface CreateWorkspaceRequest {
  readonly name: string;
}

export interface CreateWorkspaceResponse {
  readonly workspace: WorkspaceDto;
}

export interface UpsertWorkspaceMembershipRequest {
  readonly userId: string;
  readonly role: string;
}

export interface UpsertWorkspaceMembershipResponse {
  readonly membership: WorkspaceMembershipDto;
}

export interface DeleteWorkspaceMembershipResponse {
  readonly membership: WorkspaceMembershipDto;
}

export interface ListResourceGrantsResponse {
  readonly grants: readonly ResourceGrantDto[];
}

export interface UpsertResourceGrantRequest {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly granteeUserId: string;
  readonly grantLevel: "view" | "contribute" | "manage";
}

export interface UpsertResourceGrantResponse {
  readonly grant: ResourceGrantDto;
}

export interface DeleteResourceGrantResponse {
  readonly grant: ResourceGrantDto;
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

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" }
  }
} as const;

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

const workspaceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "createdByUserId", "createdAt", "updatedAt"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    createdByUserId: { type: ["string", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const workspaceMembershipSchema = {
  type: "object",
  additionalProperties: false,
  required: ["userId", "workspaceId", "role", "createdAt"],
  properties: {
    userId: { type: "string" },
    workspaceId: { type: "string" },
    role: { type: "string" },
    createdAt: { type: "string" }
  }
} as const;

const resourceGrantSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "resourceType",
    "resourceId",
    "granteeUserId",
    "grantLevel",
    "grantedByUserId",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    resourceType: { type: "string" },
    resourceId: { type: "string" },
    granteeUserId: { type: "string" },
    grantLevel: { type: "string", enum: ["view", "contribute", "manage"] },
    grantedByUserId: { type: ["string", "null"] },
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
      required: ["needsBootstrap", "userCount"],
      properties: {
        needsBootstrap: { type: "boolean" },
        userCount: { type: "number" }
      }
    }
  }
} as const;

export const meRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["user", "memberships", "workspaces", "activeWorkspaceId"],
      properties: {
        user: userSchema,
        memberships: { type: "array", items: workspaceMembershipSchema },
        workspaces: { type: "array", items: workspaceSchema },
        activeWorkspaceId: { type: ["string", "null"] }
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

export const listWorkspacesRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["workspaces"],
      properties: {
        workspaces: { type: "array", items: workspaceSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const listWorkspaceMembershipsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["memberships"],
      properties: {
        memberships: { type: "array", items: workspaceMembershipSchema }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const createWorkspaceRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string" }
    }
  },
  response: {
    201: {
      type: "object",
      additionalProperties: false,
      required: ["workspace"],
      properties: {
        workspace: workspaceSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const upsertWorkspaceMembershipRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["userId", "role"],
    properties: {
      userId: { type: "string" },
      role: { type: "string" }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["membership"],
      properties: {
        membership: workspaceMembershipSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const deleteWorkspaceMembershipRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["membership"],
      properties: {
        membership: workspaceMembershipSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const listResourceGrantsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["grants"],
      properties: {
        grants: { type: "array", items: resourceGrantSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const upsertResourceGrantRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["resourceType", "resourceId", "granteeUserId", "grantLevel"],
    properties: {
      resourceType: { type: "string" },
      resourceId: { type: "string" },
      granteeUserId: { type: "string" },
      grantLevel: { type: "string", enum: ["view", "contribute", "manage"] }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["grant"],
      properties: {
        grant: resourceGrantSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const deleteResourceGrantRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["grant"],
      properties: {
        grant: resourceGrantSchema
      }
    },
    400: errorResponseSchema,
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
