import type {
  AiAssistantToolDto,
  BriefingDefinitionDto,
  BriefingType,
  CreateBriefingDefinitionRequest,
  UpdateBriefingDefinitionRequest
} from "@jarv1s/shared";

export function findDefinition(
  definitions: readonly BriefingDefinitionDto[],
  briefingType: BriefingType
): BriefingDefinitionDto | undefined {
  return definitions.find((definition) => definition.briefingType === briefingType);
}

export function defaultScheduleMetadataFor(
  briefingType: BriefingType,
  timezone?: string
): {
  readonly targetTime: string;
  readonly timezone: string;
} {
  return {
    targetTime: briefingType === "evening" ? "19:00" : "07:00",
    timezone: timezone ?? "UTC"
  };
}

export function targetTimeFor(definition: BriefingDefinitionDto | undefined, type: BriefingType) {
  const raw = definition?.scheduleMetadata.targetTime;
  return typeof raw === "string" && raw.length > 0
    ? raw
    : defaultScheduleMetadataFor(type).targetTime;
}

export function readToolNames(tools: readonly AiAssistantToolDto[]): readonly string[] {
  return tools
    .filter((tool) => tool.risk === "read")
    .map((tool) => tool.name)
    .sort();
}

export function createDefinitionRequest(input: {
  readonly briefingType: BriefingType;
  readonly enabled?: boolean;
  readonly targetTime?: string;
  readonly selectedToolNames: readonly string[];
  readonly timezone?: string;
}): CreateBriefingDefinitionRequest {
  const defaults = defaultScheduleMetadataFor(input.briefingType, input.timezone);
  return {
    title: input.briefingType === "evening" ? "Evening review" : "Morning briefing",
    briefingType: input.briefingType,
    cadence: "daily",
    enabled: input.enabled ?? true,
    scheduleMetadata: { ...defaults, targetTime: input.targetTime ?? defaults.targetTime },
    selectedToolNames: input.selectedToolNames
  };
}

export function updateDefinitionRequest(
  definition: BriefingDefinitionDto,
  patch: {
    readonly enabled?: boolean;
    readonly targetTime?: string;
  }
): UpdateBriefingDefinitionRequest {
  return {
    enabled: patch.enabled,
    scheduleMetadata:
      patch.targetTime === undefined
        ? undefined
        : { ...definition.scheduleMetadata, targetTime: patch.targetTime }
  };
}
