import { describe, expect, it } from "vitest";

import type { AiAssistantToolDto, BriefingDefinitionDto } from "@jarv1s/shared";

import {
  createDefinitionRequest,
  defaultScheduleMetadataFor,
  findDefinition,
  readSourceLabels,
  sourceListDescription
} from "../../apps/web/src/briefings/briefing-settings-model.js";

describe("briefing settings model", () => {
  it("finds definitions by briefing type and exposes evening default time", () => {
    const definitions: BriefingDefinitionDto[] = [
      definition({ id: "morning-1", briefingType: "morning", targetTime: "07:00" }),
      definition({ id: "evening-1", briefingType: "evening", targetTime: "19:00" })
    ];

    expect(findDefinition(definitions, "evening")?.scheduleMetadata.targetTime).toBe("19:00");
    expect(defaultScheduleMetadataFor("evening").targetTime).toBe("19:00");
    expect(defaultScheduleMetadataFor("morning").targetTime).toBe("07:00");
  });

  it("defaults new evening definitions to the user-local timezone fallback", () => {
    const request = createDefinitionRequest({
      briefingType: "evening",
      selectedToolNames: ["tasks.list"]
    });

    expect(request.scheduleMetadata).toEqual({
      targetTime: "19:00",
      timezone: "America/Los_Angeles"
    });
  });
});

describe("readSourceLabels", () => {
  it("maps read tools to human-readable, deduplicated module labels", () => {
    const tools: AiAssistantToolDto[] = [
      tool({ name: "calendar.listVisibleEvents", moduleName: "Calendar", risk: "read" }),
      tool({ name: "calendar.listUpcoming", moduleName: "Calendar", risk: "read" }),
      tool({ name: "email.listVisibleMessages", moduleName: "Email", risk: "read" }),
      tool({ name: "tasks.list", moduleName: "Tasks", risk: "read" }),
      // non-read tools must never contribute a label
      tool({ name: "tasks.create", moduleName: "Tasks", risk: "write" })
    ];

    const labels = readSourceLabels(tools);

    expect(labels).toEqual(["Calendar", "Email", "Tasks"]);
    for (const label of labels) {
      expect(label).not.toMatch(/\./);
    }
  });

  it("returns no labels when there are no read tools", () => {
    expect(readSourceLabels([])).toEqual([]);
  });
});

describe("sourceListDescription", () => {
  it("renders human-readable module labels, never raw assistant tool names", () => {
    const desc = sourceListDescription(["Calendar", "Email", "Tasks"]);

    expect(desc).toContain("Calendar");
    expect(desc).toContain("Email");
    expect(desc).toContain("Tasks");
    // Regression guard for #739: raw function/method-style tool ids must never leak into copy.
    expect(desc).not.toMatch(/[a-z]+\.[a-zA-Z]+/);
  });

  it("reports no sources configured when the label list is empty", () => {
    expect(sourceListDescription([])).toBe(
      "No read-only sources configured yet. Briefings need at least one."
    );
  });

  it("pluralizes the source count correctly", () => {
    expect(sourceListDescription(["Calendar"])).toContain("1 read-only source ");
    expect(sourceListDescription(["Calendar", "Email"])).toContain("2 read-only sources ");
  });
});

function tool(input: {
  readonly name: string;
  readonly moduleName: string;
  readonly risk: AiAssistantToolDto["risk"];
}): AiAssistantToolDto {
  return {
    moduleId: input.name.split(".")[0] ?? input.name,
    moduleName: input.moduleName,
    name: input.name,
    description: "",
    permissionId: input.name,
    risk: input.risk,
    inputSchema: null,
    outputSchema: null
  };
}

function definition(input: {
  readonly id: string;
  readonly briefingType: BriefingDefinitionDto["briefingType"];
  readonly targetTime: string;
}): BriefingDefinitionDto {
  return {
    id: input.id,
    ownerUserId: "user-1",
    title: input.briefingType,
    briefingType: input.briefingType,
    cadence: "daily",
    scheduleMetadata: { targetTime: input.targetTime, timezone: "UTC" },
    enabled: true,
    selectedToolNames: ["tasks.search"],
    lastRunAt: null,
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T00:00:00.000Z"
  };
}
