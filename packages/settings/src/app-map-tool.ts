import type { ToolExecute } from "@jarv1s/module-sdk";
import type { AppMapReadService, AppMapQuery } from "./app-map.js";

export const appGetMapSliceInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    screenId: { type: "string", maxLength: 120 },
    settingId: { type: "string", maxLength: 120 },
    errorCode: { type: "string", maxLength: 160 },
    query: { type: "string", maxLength: 240 },
    limit: { type: "integer", minimum: 1, maximum: 8 }
  },
  anyOf: [
    { required: ["screenId"] },
    { required: ["settingId"] },
    { required: ["errorCode"] },
    { required: ["query"] }
  ]
} as const;

const mapItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    moduleId: { type: "string" },
    id: { type: "string" },
    featureId: { type: "string" },
    code: { type: "string" },
    class: { type: "string" },
    remediationRef: { type: "string" },
    label: { type: "string" },
    description: { type: "string" },
    path: { type: "string" },
    scope: { type: "string" },
    requires: {
      type: "object",
      additionalProperties: false,
      properties: {
        service: { type: "string" },
        capability: { type: "string" },
        tier: { type: "string" }
      }
    }
  }
} as const;

export const appGetMapSliceOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "items", "build", "narrative"],
  properties: {
    kind: { type: "string" },
    items: { type: "array", items: mapItemSchema },
    build: {
      type: "object",
      additionalProperties: false,
      required: ["version", "buildId"],
      properties: { version: { type: "string" }, buildId: { type: "string" } }
    },
    narrative: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["authoritative", "markdown"],
          properties: { authoritative: { type: "boolean" }, markdown: { type: "string" } }
        }
      ]
    }
  }
} as const;

export const appGetMapSliceExecute: ToolExecute = async (scopedDb, input, ctx, services) => {
  const service = services?.appMap as AppMapReadService | undefined;
  if (!service) throw new Error("appMap read service is unavailable");
  return { data: await service.query(scopedDb as never, ctx.actorUserId, input as AppMapQuery) };
};
