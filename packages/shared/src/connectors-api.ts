export type ConnectorProviderType = "calendar" | "email" | "google";
export type ConnectorProviderStatus = "available" | "disabled";
export type ConnectorAccountStatus = "active" | "error" | "revoked";

export interface ConnectorProviderDto {
  readonly id: string;
  readonly providerType: ConnectorProviderType;
  readonly displayName: string;
  readonly status: ConnectorProviderStatus;
  readonly defaultScopes: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConnectorAccountDto {
  readonly id: string;
  readonly providerId: string;
  readonly providerType: ConnectorProviderType;
  readonly providerDisplayName: string;
  readonly providerStatus: ConnectorProviderStatus;
  readonly ownerUserId: string;
  readonly scopes: readonly string[];
  readonly status: ConnectorAccountStatus;
  readonly hasSecret: boolean;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListConnectorProvidersResponse {
  readonly providers: readonly ConnectorProviderDto[];
}

export interface ListConnectorAccountsResponse {
  readonly accounts: readonly ConnectorAccountDto[];
}

export interface CreateConnectorAccountRequest {
  readonly providerId: string;
  readonly scopes?: readonly string[];
  readonly status?: Exclude<ConnectorAccountStatus, "revoked">;
  readonly tokenPayload: Record<string, unknown>;
}

export interface CreateConnectorAccountResponse {
  readonly account: ConnectorAccountDto;
}

export interface UpdateConnectorAccountRequest {
  readonly scopes?: readonly string[];
  readonly status?: Exclude<ConnectorAccountStatus, "revoked">;
  readonly tokenPayload?: Record<string, unknown>;
}

export interface UpdateConnectorAccountResponse {
  readonly account: ConnectorAccountDto;
}

export interface RevokeConnectorAccountResponse {
  readonly account: ConnectorAccountDto;
}

export interface ListAdminConnectorAccountsResponse {
  readonly accounts: readonly ConnectorAccountDto[];
}

const errorResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: { type: "string" }
  }
} as const;

const jsonObjectSchema = {
  type: "object",
  additionalProperties: true
} as const;

const connectorProviderSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "providerType",
    "displayName",
    "status",
    "defaultScopes",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    providerType: { type: "string", enum: ["calendar", "email", "google"] },
    displayName: { type: "string" },
    status: { type: "string", enum: ["available", "disabled"] },
    defaultScopes: { type: "array", items: { type: "string" } },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const connectorAccountSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "providerId",
    "providerType",
    "providerDisplayName",
    "providerStatus",
    "ownerUserId",
    "scopes",
    "status",
    "hasSecret",
    "revokedAt",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    providerId: { type: "string" },
    providerType: { type: "string", enum: ["calendar", "email", "google"] },
    providerDisplayName: { type: "string" },
    providerStatus: { type: "string", enum: ["available", "disabled"] },
    ownerUserId: { type: "string" },
    scopes: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["active", "error", "revoked"] },
    hasSecret: { type: "boolean" },
    revokedAt: { type: ["string", "null"] },
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

export const createConnectorAccountRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerId", "tokenPayload"],
  properties: {
    providerId: { type: "string" },
    scopes: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["active", "error"] },
    tokenPayload: jsonObjectSchema
  }
} as const;

export const updateConnectorAccountRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scopes: { type: "array", items: { type: "string" } },
    status: { type: "string", enum: ["active", "error"] },
    tokenPayload: jsonObjectSchema
  }
} as const;

export const listConnectorProvidersResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providers"],
  properties: {
    providers: { type: "array", items: connectorProviderSchema }
  }
} as const;

export const listConnectorAccountsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["accounts"],
  properties: {
    accounts: { type: "array", items: connectorAccountSchema }
  }
} as const;

export const createConnectorAccountResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["account"],
  properties: {
    account: connectorAccountSchema
  }
} as const;

export const updateConnectorAccountResponseSchema = createConnectorAccountResponseSchema;
export const revokeConnectorAccountResponseSchema = createConnectorAccountResponseSchema;
export const listAdminConnectorAccountsResponseSchema = listConnectorAccountsResponseSchema;

export const listConnectorProvidersRouteSchema = {
  response: {
    200: listConnectorProvidersResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const listConnectorAccountsRouteSchema = {
  response: {
    200: listConnectorAccountsResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const createConnectorAccountRouteSchema = {
  body: createConnectorAccountRequestSchema,
  response: {
    201: createConnectorAccountResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const updateConnectorAccountRouteSchema = {
  body: updateConnectorAccountRequestSchema,
  response: {
    200: updateConnectorAccountResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const revokeConnectorAccountRouteSchema = {
  response: {
    200: revokeConnectorAccountResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema
  }
} as const;

export const listAdminConnectorAccountsRouteSchema = {
  response: {
    200: listAdminConnectorAccountsResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export interface GoogleAuthorizeRequest {
  clientId: string;
  clientSecret: string;
}

export interface GoogleAuthorizeResponse {
  authUrl: string;
}

export interface GoogleCompleteRequest {
  redirectUrl: string;
}

export interface GoogleCompleteResponse {
  account: ConnectorAccountDto;
}

export const googleAuthorizeRequestSchema = {
  type: "object",
  required: ["clientId", "clientSecret"],
  additionalProperties: false,
  properties: {
    clientId: { type: "string", minLength: 1 },
    clientSecret: { type: "string", minLength: 1 }
  }
} as const;

export const googleAuthorizeResponseSchema = {
  type: "object",
  required: ["authUrl"],
  properties: { authUrl: { type: "string" } }
} as const;

export const googleCompleteRequestSchema = {
  type: "object",
  required: ["redirectUrl"],
  additionalProperties: false,
  properties: { redirectUrl: { type: "string", minLength: 1 } }
} as const;

export const googleAuthorizeRouteSchema = {
  body: googleAuthorizeRequestSchema,
  response: { 200: googleAuthorizeResponseSchema }
} as const;

export const googleCompleteRouteSchema = {
  body: googleCompleteRequestSchema,
  response: { 201: createConnectorAccountResponseSchema }
} as const;
