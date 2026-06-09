import { CalendarRepository, serializeCalendarEvent } from "@jarv1s/calendar";
import type { DataContextDb } from "@jarv1s/db";
import { assertDataContextDb } from "@jarv1s/db";
import { EmailRepository, serializeEmailMessage } from "@jarv1s/email";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { NotificationsRepository, serializeNotification } from "@jarv1s/notifications";
import type { AiAssistantToolDto } from "@jarv1s/shared";
import { TasksRepository, serializeTask } from "@jarv1s/tasks";

export interface AiAssistantToolExecutorDependencies {
  readonly tasksRepository?: TasksRepository;
  readonly notificationsRepository?: NotificationsRepository;
  readonly calendarRepository?: CalendarRepository;
  readonly emailRepository?: EmailRepository;
}

export class AiAssistantToolExecutor {
  private readonly tasksRepository: TasksRepository;
  private readonly notificationsRepository: NotificationsRepository;
  private readonly calendarRepository: CalendarRepository;
  private readonly emailRepository: EmailRepository;

  constructor(dependencies: AiAssistantToolExecutorDependencies = {}) {
    this.tasksRepository = dependencies.tasksRepository ?? new TasksRepository();
    this.notificationsRepository =
      dependencies.notificationsRepository ?? new NotificationsRepository();
    this.calendarRepository = dependencies.calendarRepository ?? new CalendarRepository();
    this.emailRepository = dependencies.emailRepository ?? new EmailRepository();
  }

  async invokeReadTool(
    scopedDb: DataContextDb,
    tool: AiAssistantToolDto,
    _input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    assertDataContextDb(scopedDb);

    switch (tool.name) {
      case "tasks.listVisible": {
        const tasks = await this.tasksRepository.listVisible(scopedDb);

        return { tasks: tasks.map(serializeTask) };
      }
      case "notifications.listVisible": {
        const result = await this.notificationsRepository.listVisible(scopedDb);

        return {
          notifications: result.notifications.map(serializeNotification),
          unreadCount: result.unreadCount
        };
      }
      case "calendar.listVisibleEvents": {
        const events = await this.calendarRepository.listVisible(scopedDb);

        return { events: events.map(serializeCalendarEvent) };
      }
      case "email.listVisibleMessages": {
        const messages = await this.emailRepository.listVisible(scopedDb);

        return { messages: messages.map(serializeEmailMessage) };
      }
      default:
        throw new UnsupportedAssistantToolError(tool.name);
    }
  }
}

export class UnsupportedAssistantToolError extends Error {
  constructor(readonly toolName: string) {
    super(`Assistant tool is not executable in this slice: ${toolName}`);
  }
}

export function listAssistantToolsFromManifests(
  moduleManifests: readonly JarvisModuleManifest[]
): AiAssistantToolDto[] {
  return moduleManifests.flatMap((module) =>
    (module.assistantTools ?? []).map((tool) => ({
      moduleId: module.id,
      moduleName: module.name,
      name: tool.name,
      description: tool.description,
      permissionId: tool.permissionId,
      risk: tool.risk,
      inputSchema: tool.inputSchema ?? null,
      outputSchema: tool.outputSchema ?? null
    }))
  );
}

export function findAssistantToolFromManifests(
  moduleManifests: readonly JarvisModuleManifest[],
  toolName: string
): AiAssistantToolDto | undefined {
  return listAssistantToolsFromManifests(moduleManifests).find((tool) => tool.name === toolName);
}

/**
 * Metadata-only summary of a tool's input for persisting on an action request and
 * rendering the Approve/Deny card. Never includes the raw values — only key names
 * and count, so private content never lands in the action-requests table.
 */
export function summarizeAssistantToolInput(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputKeys = Object.keys(input).sort();

  return {
    inputKeys,
    inputKeyCount: inputKeys.length
  };
}
