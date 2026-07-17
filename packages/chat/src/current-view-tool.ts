import type { ToolExecute } from "@jarv1s/module-sdk";
import type { CurrentViewReadService } from "./live/current-view.js";

const stringArray = { type: "array", items: { type: "string" } } as const;
const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "class"],
  properties: {
    code: { type: "string" },
    class: { type: "string" },
    remediationRef: { type: "string" }
  }
} as const;

// #1109 v1 intentionally ships Tier 1 only. The DOM tier from design §6 is deferred to an
// approved follow-up and must reuse projection/redaction with a 16KB cap; screenshots require
// separate per-capture consent UX. Do not add model-controlled capture escalation here.
export const chatGetCurrentViewOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["available", "view", "serverFacts"],
  properties: {
    available: { type: "boolean" },
    view: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "route",
            "pageTitle",
            "headings",
            "buttons",
            "labels",
            "visibleText",
            "focused",
            "selectedText",
            "errors",
            "capturedAt"
          ],
          properties: {
            route: { type: "string" },
            pageTitle: { type: "string" },
            headings: stringArray,
            buttons: stringArray,
            labels: stringArray,
            visibleText: stringArray,
            focused: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["tag", "role", "label"],
                  properties: {
                    tag: { type: "string" },
                    role: { anyOf: [{ type: "string" }, { type: "null" }] },
                    label: { anyOf: [{ type: "string" }, { type: "null" }] }
                  }
                }
              ]
            },
            selectedText: { anyOf: [{ type: "string" }, { type: "null" }] },
            errors: { type: "array", items: errorSchema },
            capturedAt: { type: "string" }
          }
        }
      ]
    },
    serverFacts: {
      type: "object",
      additionalProperties: false,
      required: ["appVersion", "buildId", "platform", "modelCapabilities"],
      properties: {
        appVersion: { type: "string" },
        buildId: { type: "string" },
        platform: { type: "string", enum: ["web"] },
        modelCapabilities: stringArray
      }
    }
  }
} as const;

export const chatGetCurrentViewExecute: ToolExecute = async (scopedDb, _input, ctx, services) => {
  const service = services?.currentView as CurrentViewReadService | undefined;
  if (!service) throw new Error("currentView read service is unavailable");
  return { data: { ...(await service.get(scopedDb as never, ctx.actorUserId)) } };
};
