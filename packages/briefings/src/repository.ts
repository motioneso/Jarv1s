import { randomUUID } from "node:crypto";

import { sql, type Updateable } from "kysely";

import { AiRepository, findAssistantToolFromManifests } from "@jarv1s/ai";
import {
  assertDataContextDb,
  type BriefingCadence,
  type BriefingDefinition,
  type BriefingDefinitionsTable,
  type BriefingRun,
  type BriefingRunKind,
  type BriefingRunStatus,
  type DataContextDb
} from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import type { AiAssistantToolDto } from "@jarv1s/shared";

export interface CreateBriefingDefinitionInput {
  readonly title: string;
  readonly cadence?: BriefingCadence;
  readonly scheduleMetadata?: Record<string, unknown>;
  readonly enabled?: boolean;
  readonly selectedToolNames: readonly string[];
}

export interface UpdateBriefingDefinitionInput {
  readonly title?: string;
  readonly cadence?: BriefingCadence;
  readonly scheduleMetadata?: Record<string, unknown>;
  readonly enabled?: boolean;
  readonly selectedToolNames?: readonly string[];
}

export interface GenerateBriefingRunInput {
  readonly moduleManifests: readonly JarvisModuleManifest[];
  readonly runKind: BriefingRunKind;
  readonly runId?: string;
}

interface ToolSummary {
  readonly name: string;
  readonly status: "succeeded" | "blocked" | "failed";
  readonly itemCount: number;
  readonly excerpts: readonly string[];
  readonly blockedReason?: string;
}

interface SummaryResult {
  readonly status: BriefingRunStatus;
  readonly summaryText: string;
  readonly sourceMetadata: {
    readonly tools: readonly ToolSummary[];
    readonly aiModel: {
      readonly id: string;
      readonly displayName: string;
      readonly tier: string;
    } | null;
  };
}

export class BriefingsRepository {
  async listDefinitions(scopedDb: DataContextDb): Promise<BriefingDefinition[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.briefing_definitions")
      .selectAll()
      .orderBy("updated_at", "desc")
      .orderBy("id")
      .execute();
  }

  async getDefinitionById(
    scopedDb: DataContextDb,
    definitionId: string
  ): Promise<BriefingDefinition | undefined> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.briefing_definitions")
      .selectAll()
      .where("id", "=", definitionId)
      .executeTakeFirst();
  }

  async createDefinition(
    scopedDb: DataContextDb,
    input: CreateBriefingDefinitionInput
  ): Promise<BriefingDefinition> {
    assertDataContextDb(scopedDb);

    const now = new Date();

    return scopedDb.db
      .insertInto("app.briefing_definitions")
      .values({
        id: randomUUID(),
        owner_user_id: sql<string>`app.current_actor_user_id()`,
        title: input.title,
        cadence: input.cadence ?? "manual",
        schedule_metadata: input.scheduleMetadata ?? {},
        enabled: input.enabled ?? true,
        selected_tool_names: [...input.selectedToolNames],
        last_run_at: null,
        created_at: now,
        updated_at: now
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateDefinition(
    scopedDb: DataContextDb,
    definitionId: string,
    input: UpdateBriefingDefinitionInput
  ): Promise<BriefingDefinition | undefined> {
    assertDataContextDb(scopedDb);

    const updates: Updateable<BriefingDefinitionsTable> = {
      updated_at: new Date()
    };

    if (input.title !== undefined) {
      updates.title = input.title;
    }
    if (input.cadence !== undefined) {
      updates.cadence = input.cadence;
    }
    if (input.scheduleMetadata !== undefined) {
      updates.schedule_metadata = input.scheduleMetadata;
    }
    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }
    if (input.selectedToolNames !== undefined) {
      updates.selected_tool_names = [...input.selectedToolNames];
    }

    return scopedDb.db
      .updateTable("app.briefing_definitions")
      .set(updates)
      .where("id", "=", definitionId)
      .returningAll()
      .executeTakeFirst();
  }

  async listRuns(scopedDb: DataContextDb, definitionId: string): Promise<BriefingRun[]> {
    assertDataContextDb(scopedDb);

    return scopedDb.db
      .selectFrom("app.briefing_runs")
      .selectAll()
      .where("definition_id", "=", definitionId)
      .orderBy("created_at", "desc")
      .orderBy("id")
      .execute();
  }

  async generateRun(
    scopedDb: DataContextDb,
    definitionId: string,
    input: GenerateBriefingRunInput
  ): Promise<BriefingRun | undefined> {
    assertDataContextDb(scopedDb);

    const definition = await this.getOwnedDefinitionById(scopedDb, definitionId);

    if (!definition) {
      return undefined;
    }

    const summary = await generateSummary(scopedDb, definition, input);
    const createdAt = new Date();
    const run = await scopedDb.db
      .insertInto("app.briefing_runs")
      .values({
        id: input.runId ?? randomUUID(),
        definition_id: definition.id,
        owner_user_id: definition.owner_user_id,
        status: summary.status,
        run_kind: input.runKind,
        summary_text: summary.summaryText,
        source_metadata: summary.sourceMetadata,
        created_at: createdAt
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await scopedDb.db
      .updateTable("app.briefing_definitions")
      .set({
        last_run_at: createdAt,
        updated_at: createdAt
      })
      .where("id", "=", definition.id)
      .execute();

    return run;
  }

  private async getOwnedDefinitionById(
    scopedDb: DataContextDb,
    definitionId: string
  ): Promise<BriefingDefinition | undefined> {
    return scopedDb.db
      .selectFrom("app.briefing_definitions")
      .selectAll()
      .where("id", "=", definitionId)
      .where("owner_user_id", "=", sql<string>`app.current_actor_user_id()`)
      .executeTakeFirst();
  }
}

async function generateSummary(
  scopedDb: DataContextDb,
  definition: BriefingDefinition,
  input: GenerateBriefingRunInput
): Promise<SummaryResult> {
  const tools = definition.selected_tool_names.map((name) =>
    selectReadTool(input.moduleManifests, name)
  );

  if (tools.some((tool) => !tool || tool.risk !== "read")) {
    return blockedSummary(
      definition.selected_tool_names.map((name) => ({
        name,
        status: "blocked",
        itemCount: 0,
        excerpts: [],
        blockedReason: "non_read_tool"
      }))
    );
  }

  const toolSummaries: ToolSummary[] = [];

  for (const tool of tools) {
    if (!tool) {
      continue;
    }

    const manifestTool = input.moduleManifests
      .flatMap((m) => m.assistantTools ?? [])
      .find((t) => t.name === tool.name);

    if (!manifestTool?.execute) {
      toolSummaries.push({
        name: tool.name,
        status: "blocked",
        itemCount: 0,
        excerpts: [],
        blockedReason: "unsupported_tool"
      });
      continue;
    }

    try {
      const toolResult = await manifestTool.execute(
        scopedDb,
        {},
        {
          actorUserId: "",
          requestId: "",
          chatSessionId: ""
        }
      );
      const result = toolResult.data ?? {};
      toolSummaries.push(summarizeToolResult(tool, result));
    } catch {
      toolSummaries.push({
        name: tool.name,
        status: "failed",
        itemCount: 0,
        excerpts: [],
        blockedReason: "tool_failed"
      });
    }
  }

  const status = selectRunStatus(toolSummaries);
  const summaryText = toolSummaries.map(formatToolSummary).join("\n");

  const aiRepository = new AiRepository();
  const aiModel = await aiRepository.selectModelForCapability(scopedDb, "summarization", "economy");

  return {
    status,
    summaryText: summaryText || "Briefing did not produce visible source items.",
    sourceMetadata: {
      tools: toolSummaries,
      aiModel: aiModel
        ? { id: aiModel.id, displayName: aiModel.display_name, tier: aiModel.tier }
        : null
    }
  };
}

function selectReadTool(
  moduleManifests: readonly JarvisModuleManifest[],
  toolName: string
): AiAssistantToolDto | undefined {
  return findAssistantToolFromManifests(moduleManifests, toolName);
}

function blockedSummary(toolSummaries: readonly ToolSummary[]): SummaryResult {
  return {
    status: "blocked",
    summaryText: "Briefing blocked because selected tools are not all declared read tools.",
    sourceMetadata: {
      tools: toolSummaries,
      aiModel: null
    }
  };
}

function selectRunStatus(toolSummaries: readonly ToolSummary[]): BriefingRunStatus {
  if (toolSummaries.some((tool) => tool.status === "failed")) {
    return "failed";
  }
  if (toolSummaries.some((tool) => tool.status === "blocked")) {
    return "blocked";
  }

  return "succeeded";
}

function summarizeToolResult(
  tool: AiAssistantToolDto,
  result: Record<string, unknown>
): ToolSummary {
  switch (tool.name) {
    case "tasks.listVisible":
    case "tasks.list":
      return summarizeNamedItems(tool.name, result.items, (item) => {
        const task = item as { readonly title?: unknown; readonly status?: unknown };

        return compactExcerpt([task.title, task.status]);
      });
    case "notifications.listVisible":
      return summarizeNamedItems(tool.name, result.notifications, (item) => {
        const notification = item as { readonly title?: unknown; readonly readAt?: unknown };
        const state = notification.readAt ? "read" : "unread";

        return compactExcerpt([notification.title, state]);
      });
    case "calendar.listVisibleEvents":
      return summarizeNamedItems(tool.name, result.events, (item) => {
        const event = item as { readonly title?: unknown; readonly startsAt?: unknown };

        return compactExcerpt([event.startsAt, event.title]);
      });
    case "email.listVisibleMessages":
      return summarizeNamedItems(tool.name, result.messages, (item) => {
        const message = item as { readonly sender?: unknown; readonly subject?: unknown };

        return compactExcerpt([message.sender, message.subject]);
      });
    default:
      return summarizeUnknownResult(tool.name, result);
  }
}

function summarizeNamedItems(
  toolName: string,
  value: unknown,
  formatItem: (item: unknown) => string
): ToolSummary {
  const items = Array.isArray(value) ? value : [];

  return {
    name: toolName,
    status: "succeeded",
    itemCount: items.length,
    excerpts: items.slice(0, 3).map(formatItem).filter(Boolean)
  };
}

function summarizeUnknownResult(toolName: string, result: Record<string, unknown>): ToolSummary {
  const firstArray = Object.values(result).find((value) => Array.isArray(value));
  const itemCount = Array.isArray(firstArray) ? firstArray.length : 0;

  return {
    name: toolName,
    status: "succeeded",
    itemCount,
    excerpts: []
  };
}

function formatToolSummary(tool: ToolSummary): string {
  if (tool.status !== "succeeded") {
    return `${displayToolName(tool.name)}: ${tool.status}${
      tool.blockedReason ? ` (${tool.blockedReason})` : ""
    }`;
  }

  const visibleLabel = tool.itemCount === 1 ? "visible" : "visible";
  const excerpts = tool.excerpts.length > 0 ? `; top: ${tool.excerpts.join("; ")}` : "";

  return `${displayToolName(tool.name)}: ${tool.itemCount} ${visibleLabel}${excerpts}`;
}

function displayToolName(toolName: string): string {
  switch (toolName) {
    case "tasks.listVisible":
    case "tasks.list":
      return "Tasks";
    case "notifications.listVisible":
      return "Notifications";
    case "calendar.listVisibleEvents":
      return "Calendar";
    case "email.listVisibleMessages":
      return "Email";
    default:
      return toolName;
  }
}

function compactExcerpt(parts: readonly unknown[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .map((part) => part.trim().replace(/\s+/g, " ").slice(0, 120))
    .join(" - ");
}
