import { errorResponseSchema } from "./schema-fragments.js";
import { userSchema } from "./platform-api.js";
import type { UserDto } from "./platform-api.js";

export interface YoloUserStateDto {
  readonly allowed: boolean;
  readonly enabled: boolean;
  readonly active: boolean;
}

export interface YoloAdminUserDto extends UserDto {
  readonly yoloAllowed: boolean;
  readonly yoloEnabled: boolean;
  readonly yoloActive: boolean;
}

export interface YoloSettingsResponse {
  readonly instanceEnabled: boolean;
  readonly self: YoloUserStateDto;
}

export interface YoloAdminSettingsResponse {
  readonly instanceEnabled: boolean;
  readonly users: readonly YoloAdminUserDto[];
}

export interface PutYoloSelfRequest {
  readonly enabled: boolean;
}

export interface PutYoloInstanceRequest {
  readonly enabled: boolean;
}

export interface PutYoloUserRequest {
  readonly allowed: boolean;
}

const yoloUserStateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["allowed", "enabled", "active"],
  properties: {
    allowed: { type: "boolean" },
    enabled: { type: "boolean" },
    active: { type: "boolean" }
  }
} as const;

const yoloAdminUserSchema = {
  ...userSchema,
  required: [...userSchema.required, "yoloAllowed", "yoloEnabled", "yoloActive"],
  properties: {
    ...userSchema.properties,
    yoloAllowed: { type: "boolean" },
    yoloEnabled: { type: "boolean" },
    yoloActive: { type: "boolean" }
  }
} as const;

export const getYoloSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["instanceEnabled", "self"],
      properties: {
        instanceEnabled: { type: "boolean" },
        self: yoloUserStateSchema
      }
    },
    401: errorResponseSchema
  }
} as const;

export const putYoloSelfRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["enabled"],
    properties: {
      enabled: { type: "boolean" }
    }
  },
  response: getYoloSettingsRouteSchema.response
} as const;

export const getAdminYoloSettingsRouteSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["instanceEnabled", "users"],
      properties: {
        instanceEnabled: { type: "boolean" },
        users: { type: "array", items: yoloAdminUserSchema }
      }
    },
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const putAdminYoloInstanceRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["enabled"],
    properties: {
      enabled: { type: "boolean" }
    }
  },
  response: getAdminYoloSettingsRouteSchema.response
} as const;

export const putAdminYoloUserRouteSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["allowed"],
    properties: {
      allowed: { type: "boolean" }
    }
  },
  response: getAdminYoloSettingsRouteSchema.response
} as const;
