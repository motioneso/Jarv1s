import { describe, expect, it } from "vitest";

import {
  runEmailMonitor,
  type EmailExtractDeps,
  type EmailTaskCreationPort
} from "@jarv1s/connectors";
import { PreferencesRepository } from "@jarv1s/structured-state";
import { TasksRepository } from "@jarv1s/tasks";

import {
  handles,
  ids,
  runGoogleSync,
  seedGoogleAccount
} from "./helpers/google-sync-orchestration.js";
import {
  buildTestSourceContextService,
  fakeEmailProvider,
  parsedEmail
} from "./source-context-helpers.js";

const NOW = new Date("2026-08-01T04:00:00.000Z");
const MESSAGE_ID = "sync-monitor-actionable-1";
const SUBJECT = "Approval needed for the launch plan";
const BODY = "Please approve the launch plan today and reply when it is done.";

const summaryOnlyExtractDeps: EmailExtractDeps = {
  selectModel: async () => ({ tier: "economy" }),
  runChat: async () => ({
    text: JSON.stringify({
      summary: "A colleague requested launch-plan approval.",
      billsDue: [],
      actionItems: [],
      deadlines: [],
      mayGetLostInShuffle: false,
      importance: "normal",
      confidence: 0.9,
      actionability: {
        category: "needs_action",
        reason: "The sender requests approval."
      }
    })
  })
};

const actionableExtractDeps: EmailExtractDeps = {
  selectModel: async () => ({ tier: "economy" }),
  runChat: async () => ({
    text: JSON.stringify({
      summary: "A colleague needs launch-plan approval today.",
      billsDue: [],
      actionItems: [],
      deadlines: [],
      mayGetLostInShuffle: true,
      importance: "high",
      confidence: 0.95,
      actionability: {
        category: "needs_action",
        reason: "The sender explicitly requests approval today.",
        inferredSubject: "Launch plan approval",
        suggestedTasks: [{ text: "Approve the launch plan" }]
      }
    })
  })
};

describe("Google sync → source context → email monitor", () => {
  it("evaluates a recently synced actionable inbound email into one suggested task", async () => {
    const accountId = await seedGoogleAccount(handles.dataContext, [
      "https://www.googleapis.com/auth/gmail.modify"
    ]);
    const context = { actorUserId: ids.userA, requestId: "test:sync-monitor-pipeline" };

    const sync = await handles.workerDataContext.withDataContext(context, (scopedDb) =>
      runGoogleSync(scopedDb, {
        getFreshAccessToken: async () => "fixture-token",
        getActiveAccount: async () => ({ id: accountId, scopes: ["gmail"] }),
        googleClient: {
          listCalendarEvents: async () => [],
          listMessageIds: async () => [{ id: MESSAGE_ID }],
          getMessage: async () => ({
            id: MESSAGE_ID,
            threadId: "fixture-thread",
            historyId: "fixture-history-1",
            labelIds: ["INBOX"],
            internalDate: String(NOW.getTime() - 60_000),
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "Subject", value: SUBJECT },
                { name: "From", value: "colleague@example.test" },
                { name: "To", value: "owner@example.test" }
              ],
              body: { data: Buffer.from(BODY).toString("base64") }
            }
          })
        },
        emailExtractDeps: summaryOnlyExtractDeps,
        now: () => NOW
      })
    );
    expect(sync.emailUpserted).toBe(1);

    const sourceContext = buildTestSourceContextService({
      googleProvider: fakeEmailProvider<string>([
        parsedEmail({
          externalId: MESSAGE_ID,
          threadId: "fixture-thread",
          historyId: "fixture-history-1",
          subject: SUBJECT,
          from: "colleague@example.test",
          receivedAt: new Date(NOW.getTime() - 60_000).toISOString(),
          snippet: BODY,
          body: BODY
        })
      ]),
      makeEmailExtractDeps: () => actionableExtractDeps
    });
    const tasksRepository = new TasksRepository();
    const taskPort: EmailTaskCreationPort = {
      async create(scopedDb, input) {
        const task = await tasksRepository.create(scopedDb, {
          title: input.title,
          description: input.description ?? undefined,
          status: input.status,
          dueAt: input.dueAt ?? undefined,
          priority: input.priority ?? undefined,
          source: input.source,
          sourceRef: input.sourceRef,
          externalKey: input.externalKey,
          suggestionMetadata: input.suggestionMetadata
        });
        return { id: task.id };
      }
    };

    const monitor = await handles.dataContext.withDataContext(context, (scopedDb) =>
      runEmailMonitor(scopedDb, accountId, {
        sourceContext,
        taskPort,
        preferencesRepository: new PreferencesRepository(),
        now: () => NOW
      })
    );

    expect(monitor).toMatchObject({ planned: 1, created: 1 });
    const tasks = await handles.dataContext.withDataContext(context, (scopedDb) =>
      tasksRepository.listVisible(scopedDb)
    );
    expect(
      tasks.filter((task) => task.source === "email" && task.status === "suggested")
    ).toHaveLength(1);
  });
});
