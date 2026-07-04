import { describe, expect, it } from "vitest";

import type { DataContextDb } from "@jarv1s/db";
import {
  EMAIL_TASK_MODE_PREF_KEY,
  MONITOR_STATUS_PREF_KEY,
  runEmailMonitor,
  type EmailContextItem,
  type EmailContextResult,
  type MonitorPreferencesPort,
  type RunEmailMonitorDeps,
  type TriageRejectionAggregate
} from "@jarv1s/connectors";

const DB = {} as DataContextDb;
const ACCOUNT = "acct-1";
const NOW = () => new Date("2026-07-04T12:00:00.000Z");

function item(overrides: Partial<EmailContextItem> = {}): EmailContextItem {
  return {
    messageKey: "msg-1",
    account: { connectorAccountId: ACCOUNT, providerId: "google", providerLabel: "Gmail" },
    sender: "boss@work.example",
    recipients: ["me@self.example"],
    subject: "Budget approval needed",
    receivedAt: "2026-07-04T09:00:00.000Z",
    threadId: null,
    snippet: null,
    summary: "Approve the Q3 budget by Friday",
    actionability: "needs_action",
    importance: "normal",
    confidence: 0.9,
    reason: "Asks you to approve the budget",
    dueDate: null,
    suggestedTasks: [{ title: "Approve Q3 budget", dueDate: "2026-07-10T00:00:00.000Z" }],
    source: "live",
    degradedReason: null,
    cacheMessageId: null,
    ...overrides
  };
}

function liveResult(items: EmailContextItem[]): EmailContextResult {
  return {
    items,
    accounts: [
      {
        account: { connectorAccountId: ACCOUNT, providerId: "google", providerLabel: "Gmail" },
        source: "live",
        degradedReason: null
      }
    ],
    gaps: []
  };
}

interface FakePorts {
  deps: RunEmailMonitorDeps;
  taskStore: Map<string, { status: string; title: string }>;
  prefs: Map<string, unknown>;
}

function fakePorts(
  result: EmailContextResult,
  options: { mode?: string; aggregates?: TriageRejectionAggregate[] } = {}
): FakePorts {
  const taskStore = new Map<string, { status: string; title: string }>();
  const prefs = new Map<string, unknown>();
  if (options.mode) {
    prefs.set(EMAIL_TASK_MODE_PREF_KEY, options.mode);
  }
  const preferencesRepository: MonitorPreferencesPort = {
    get: async (_db: DataContextDb, key: string) => prefs.get(key) ?? null,
    upsert: async (_db: DataContextDb, key: string, value: unknown) => {
      prefs.set(key, value);
    }
  };
  const deps: RunEmailMonitorDeps = {
    sourceContext: { listEmailContext: async () => result },
    connectorsRepository: {
      listTriageRejectionAggregates: async () => options.aggregates ?? []
    },
    taskPort: {
      // Dedupes on externalKey like TasksRepository.create's (source, external_key) check.
      create: async (_db, input) => {
        const key = input.externalKey ?? `no-key-${taskStore.size}`;
        if (!taskStore.has(key)) {
          taskStore.set(key, { status: input.status, title: input.title });
        }
        return { id: key };
      }
    },
    preferencesRepository,
    now: NOW
  };
  return { deps, taskStore, prefs };
}

describe("runEmailMonitor", () => {
  it("suggest mode (default) stages suggested tasks and persists an ok status", async () => {
    const { deps, taskStore, prefs } = fakePorts(liveResult([item()]));
    const run = await runEmailMonitor(DB, ACCOUNT, deps);
    expect(run).toEqual({ planned: 1, created: 1, degraded: false });
    expect([...taskStore.values()]).toEqual([{ status: "suggested", title: "Approve Q3 budget" }]);
    expect(prefs.get(MONITOR_STATUS_PREF_KEY(ACCOUNT))).toEqual({
      lastRunAt: "2026-07-04T12:00:00.000Z",
      status: "ok",
      planned: 1,
      created: 1
    });
  });

  it("second run over the same items creates zero new tasks (externalKey dedupe)", async () => {
    const { deps, taskStore } = fakePorts(liveResult([item()]));
    await runEmailMonitor(DB, ACCOUNT, deps);
    expect(taskStore.size).toBe(1);
    await runEmailMonitor(DB, ACCOUNT, deps);
    expect(taskStore.size).toBe(1);
  });

  it("off mode creates nothing and skips the rejection-aggregate query", async () => {
    let aggregateQueries = 0;
    const { deps, taskStore } = fakePorts(liveResult([item()]), { mode: "off" });
    const deps2: RunEmailMonitorDeps = {
      ...deps,
      connectorsRepository: {
        listTriageRejectionAggregates: async () => {
          aggregateQueries += 1;
          return [];
        }
      }
    };
    const run = await runEmailMonitor(DB, ACCOUNT, deps2);
    expect(run).toEqual({ planned: 0, created: 0, degraded: false });
    expect(taskStore.size).toBe(0);
    expect(aggregateQueries).toBe(0);
  });

  it("an account gap plans nothing and persists a gap status — no auth-gap tasks", async () => {
    const gapResult: EmailContextResult = {
      items: [],
      accounts: [],
      gaps: [
        {
          account: { connectorAccountId: ACCOUNT, providerId: "google", providerLabel: "Gmail" },
          reason: "auth_error"
        }
      ]
    };
    const { deps, taskStore, prefs } = fakePorts(gapResult);
    const run = await runEmailMonitor(DB, ACCOUNT, deps);
    expect(run).toEqual({ planned: 0, created: 0, degraded: true });
    expect(taskStore.size).toBe(0);
    expect(prefs.get(MONITOR_STATUS_PREF_KEY(ACCOUNT))).toEqual({
      lastRunAt: "2026-07-04T12:00:00.000Z",
      status: "gap",
      planned: 0,
      created: 0
    });
  });

  it("a cache-fallback read still plans but persists a degraded status", async () => {
    const cacheResult: EmailContextResult = {
      items: [item({ source: "cache", degradedReason: "network_error" })],
      accounts: [
        {
          account: { connectorAccountId: ACCOUNT, providerId: "google", providerLabel: "Gmail" },
          source: "cache",
          degradedReason: "network_error"
        }
      ],
      gaps: []
    };
    const { deps, taskStore, prefs } = fakePorts(cacheResult);
    const run = await runEmailMonitor(DB, ACCOUNT, deps);
    expect(run).toEqual({ planned: 1, created: 1, degraded: true });
    expect(taskStore.size).toBe(1);
    expect(prefs.get(MONITOR_STATUS_PREF_KEY(ACCOUNT))).toMatchObject({ status: "degraded" });
  });

  it("ignores items and gaps belonging to other accounts", async () => {
    const mixed: EmailContextResult = {
      items: [
        item(),
        item({
          messageKey: "msg-other",
          account: { connectorAccountId: "acct-2", providerId: "imap", providerLabel: "Yahoo" },
          suggestedTasks: [{ title: "Other account task", dueDate: null }]
        })
      ],
      accounts: [
        {
          account: { connectorAccountId: ACCOUNT, providerId: "google", providerLabel: "Gmail" },
          source: "live",
          degradedReason: null
        },
        {
          account: { connectorAccountId: "acct-2", providerId: "imap", providerLabel: "Yahoo" },
          source: "cache",
          degradedReason: "network_error"
        }
      ],
      gaps: [
        {
          account: { connectorAccountId: "acct-2", providerId: "imap", providerLabel: "Yahoo" },
          reason: "auth_error"
        }
      ]
    };
    const { deps, taskStore } = fakePorts(mixed);
    const run = await runEmailMonitor(DB, ACCOUNT, deps);
    expect(run).toEqual({ planned: 1, created: 1, degraded: false });
    expect([...taskStore.values()].map((t) => t.title)).toEqual(["Approve Q3 budget"]);
  });

  it("persisted status holds counts only — never titles, subjects, or bodies", async () => {
    const { deps, prefs } = fakePorts(liveResult([item({ subject: "SECRET subject line" })]));
    await runEmailMonitor(DB, ACCOUNT, deps);
    const status = JSON.stringify(prefs.get(MONITOR_STATUS_PREF_KEY(ACCOUNT)));
    expect(status).not.toMatch(/SECRET|Approve|budget/i);
  });
});
