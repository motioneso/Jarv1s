import { describe, expect, it } from "vitest";

import type { BriefingDefinitionDto } from "@jarv1s/shared";

import {
  defaultScheduleMetadataFor,
  findDefinition
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
});

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
