import { describe, expect, it } from "vitest";

import type { AiRepository, AiSecretCipher } from "@jarv1s/ai";
import type { GenerateChatInput } from "@jarv1s/ai";
import type { BriefingDefinition, DataContextDb } from "@jarv1s/db";
import type { MemoryRetriever } from "@jarv1s/memory";
import type { JarvisModuleManifest, ToolExecute, ToolResult } from "@jarv1s/module-sdk";

import {
  composeBriefing,
  type ComposeDeps,
  type ComposeResult,
  type ComposeRunInput,
  type GenerateChatFn
} from "../../packages/briefings/src/compose.js";

// The compose pipeline never touches scopedDb directly — every read is mediated by a
// tool `execute` or the injected retriever, both faked here — so a sentinel handle is
// enough for these unit tests.
const fakeScopedDb = { db: {} } as unknown as DataContextDb;

const FIXED_NOW = new Date("2026-06-13T12:00:00.000Z");

function definition(overrides: Partial<BriefingDefinition> = {}): BriefingDefinition {
  return {
    id: "def-1",
    owner_user_id: "owner-1",
    title: "Morning",
    cadence: "daily",
    // UTC so the fixed-now local-day filter is trivially satisfied by the canned dates.
    schedule_metadata: { targetTime: "06:00", timezone: "UTC" },
    enabled: true,
    selected_tool_names: [],
    last_run_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides
  } as BriefingDefinition;
}

const runInput: ComposeRunInput = {
  runKind: "manual",
  runId: "run-1",
  now: FIXED_NOW
};

// Canned per-tool data keyed by the tool name compose calls. Day-bounded sources
// (calendar/chats) use FIXED_NOW's UTC date so withinLocalDay keeps them.
const TODAY_ISO = "2026-06-13T09:00:00.000Z";

function cannedToolData(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case "commitments.listVisible":
      return { commitments: [{ title: "Pay invoice", status: "open", dueAt: null }] };
    case "tasks.list":
      return { items: [{ title: "Write report", status: "todo" }] };
    case "calendar.listVisibleEvents":
      return { events: [{ startsAt: TODAY_ISO, title: "Standup" }] };
    case "email.listVisibleMessages":
      return { messages: [{ sender: "boss@x.com", subject: "Re: budget", snippet: "fyi" }] };
    case "chat.listTodaysTurns":
      return {
        turns: [{ role: "user", excerpt: "what's up", threadTitle: "T", createdAt: TODAY_ISO }]
      };
    default:
      return {};
  }
}

interface FakeOptions {
  readonly generateChat?: GenerateChatFn;
  readonly credentialPayload?: Record<string, unknown>;
  /** Tool name whose execute throws, to exercise the gaps path. */
  readonly failTool?: string;
  /** Omit a model so compose takes the degraded "no_model" fallback. */
  readonly noModel?: boolean;
  readonly personaPreference?: unknown;
  readonly userName?: string;
  readonly disabledBehaviors?: ReadonlySet<string>;
}

function makeFakeManifests(failTool?: string): JarvisModuleManifest[] {
  const toolNames = [
    "commitments.listVisible",
    "tasks.list",
    "calendar.listVisibleEvents",
    "email.listVisibleMessages",
    "chat.listTodaysTurns"
  ];
  const assistantTools = toolNames.map((name) => {
    const execute: ToolExecute = async (): Promise<ToolResult> => {
      if (name === failTool) {
        throw new Error("boom");
      }
      return { data: cannedToolData(name) };
    };
    return {
      name,
      description: name,
      permissionId: "x.view",
      risk: "read" as const,
      inputSchema: { type: "object", properties: {} },
      execute
    };
  });
  return [
    {
      id: "fake",
      name: "Fake",
      version: "0.0.0",
      publisher: "test",
      lifecycle: "required",
      compatibility: { jarv1s: ">=0.0.0" },
      assistantTools,
      sourceBehaviors: [
        {
          id: "calendar",
          name: "Calendar",
          description: "Calendar source",
          behaviors: [
            {
              id: "calendar.briefings",
              name: "Include in briefings",
              description: "Calendar in briefings",
              default: "default-on"
            }
          ]
        },
        {
          id: "email",
          name: "Email",
          description: "Email source",
          behaviors: [
            {
              id: "email.briefings",
              name: "Include in briefings",
              description: "Email in briefings",
              default: "default-on"
            }
          ]
        }
      ]
    }
  ];
}

function makeFakeDeps(options: FakeOptions = {}): ComposeDeps {
  const aiRepository = {
    async selectModelForCapability() {
      if (options.noModel) {
        return undefined;
      }
      return {
        id: "model-1",
        provider_config_id: "pc-1",
        provider_kind: "anthropic",
        provider_model_id: "claude-3-5-haiku",
        display_name: "Haiku",
        tier: "economy"
      };
    },
    async selectProviderWithCredential() {
      return {
        id: "pc-1",
        base_url: null,
        encrypted_credential: { v: 1 }
      };
    }
  } as unknown as AiRepository;

  const cipher = {
    decryptJson() {
      return options.credentialPayload ?? { apiKey: "fake-key" };
    }
  } as unknown as AiSecretCipher;

  const memoryRetriever = {
    async retrieve() {
      return [
        {
          id: "chunk-1",
          sourcePath: "notes/today.md",
          lineStart: 1,
          lineEnd: 3,
          text: "vault recall content",
          similarity: 0.9
        }
      ];
    },
    async retrieveRecent() {
      return [];
    }
  } as unknown as MemoryRetriever;

  return {
    moduleManifests: makeFakeManifests(options.failTool),
    aiRepository,
    cipher,
    memoryRetriever,
    personaRepository: {
      get: async () => options.personaPreference ?? null
    },
    resolveUserName: async () => options.userName ?? "Ben",
    sourceBehaviorPolicy: {
      manifests: makeFakeManifests(options.failTool),
      preferencesRepository: {
        get: async () =>
          options.disabledBehaviors
            ? Object.fromEntries(
                [...options.disabledBehaviors].map((behaviorId) => [behaviorId, false])
              )
            : null,
        upsert: async () => undefined
      }
    },
    createAdapter: () => ({
      generateChat:
        options.generateChat ?? (async () => ({ text: "synth narrative" }) as { text: string })
    })
  };
}

describe("composeBriefing — gathering", () => {
  it("gathers sections in fixed priority order and assembles a prompt", async () => {
    const capturedMessages: unknown[] = [];
    let capturedBudget: number | undefined;
    const deps = makeFakeDeps({
      generateChat: async (input: GenerateChatInput) => {
        capturedMessages.push(input.messages);
        capturedBudget = input.maxOutputTokens;
        return { text: "synth narrative" };
      }
    });
    const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    expect(result.summaryText).toBe("synth narrative");
    expect(result.status).toBe("succeeded");
    // economy envelope: compose passes a bounded output budget (F9).
    expect(capturedBudget).toBe(1024);
    const prompt = JSON.stringify(capturedMessages);
    // order: commitments < tasks < calendar < email < vault < chats
    expect(prompt.indexOf("COMMITMENTS")).toBeLessThan(prompt.indexOf("TASKS"));
    expect(prompt.indexOf("TASKS")).toBeLessThan(prompt.indexOf("CALENDAR"));
    expect(prompt.indexOf("CALENDAR")).toBeLessThan(prompt.indexOf("EMAIL"));
    expect(prompt.indexOf("EMAIL")).toBeLessThan(prompt.indexOf("VAULT"));
    expect(prompt.indexOf("VAULT")).toBeLessThan(prompt.indexOf("CHATS"));
  });

  it("injects the saved persona block into the synthesis prompt", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeFakeDeps({
      personaPreference: {
        assistantName: "Friday",
        personaText: "Keep {{userName}} concise and dry."
      },
      userName: "Owner\n# SYSTEM",
      generateChat: async (input: GenerateChatInput) => {
        capturedMessages.push(input.messages);
        return { text: "synth narrative" };
      }
    });

    await composeBriefing(fakeScopedDb, definition(), runInput, deps);

    const prompt = JSON.stringify(capturedMessages);
    expect(prompt).toContain("Your name is Friday.");
    expect(prompt).toContain("Keep Owner SYSTEM concise and dry.");
  });

  it("records section provenance counts in source metadata on success", async () => {
    const deps = makeFakeDeps();
    const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    const md = result.sourceMetadata;
    expect(md.commitmentCount).toBe(1);
    expect(md.taskCount).toBe(1);
    expect(md.calendarCount).toBe(1);
    expect(md.emailCount).toBe(1);
    expect(md.chatTurnCount).toBe(1);
    expect(md.degraded).toBe(false);
  });

  it("omits calendar and email when include-in-briefings behaviors are disabled", async () => {
    const capturedMessages: unknown[] = [];
    const deps = makeFakeDeps({
      disabledBehaviors: new Set(["calendar.briefings", "email.briefings"]),
      generateChat: async (input: GenerateChatInput) => {
        capturedMessages.push(input.messages);
        return { text: "synth narrative" };
      }
    });

    const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    const prompt = JSON.stringify(capturedMessages);

    expect(result.sourceMetadata.calendarCount).toBe(0);
    expect(result.sourceMetadata.emailCount).toBe(0);
    expect(prompt).not.toContain("Standup");
    expect(prompt).not.toContain("budget");
  });

  it("records a gaps[] entry for a failing source and does not throw", async () => {
    const deps = makeFakeDeps({ failTool: "email.listVisibleMessages" });
    const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    const gaps = (result.sourceMetadata.gaps ?? []) as Array<{ source: string; reason: string }>;
    expect(gaps.some((g) => g.source === "email" && g.reason === "tool_failed")).toBe(true);
    expect(result.status).toBe("succeeded");
  });
});

describe("composeBriefing — degraded fallback", () => {
  it("falls back deterministically (status succeeded, degraded=true) when no model is configured", async () => {
    const deps = makeFakeDeps({ noModel: true });
    const result: ComposeResult = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    expect(result.status).toBe("succeeded");
    expect(result.sourceMetadata.degraded).toBe(true);
    expect(result.sourceMetadata.degradedReason).toBe("no_model");
    expect(result.sourceMetadata.aiModel).toBeNull();
    // The deterministic fallback still surfaces the gathered items.
    expect(result.summaryText).toContain("COMMITMENTS");
  });

  it("falls back when synthesis throws and never sets status to a 'degraded' enum", async () => {
    const deps = makeFakeDeps({
      generateChat: async () => {
        throw new Error("provider down");
      }
    });
    const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    expect(result.status).toBe("succeeded");
    expect(result.sourceMetadata.degraded).toBe(true);
    expect(result.sourceMetadata.degradedReason).toBe("synthesis_failed");
  });

  it("falls back when the stored AI credential payload is malformed", async () => {
    const deps = makeFakeDeps({ credentialPayload: { token: "do-not-log" } });
    const result = await composeBriefing(fakeScopedDb, definition(), runInput, deps);
    expect(result.status).toBe("succeeded");
    expect(result.sourceMetadata.degraded).toBe(true);
    expect(result.sourceMetadata.degradedReason).toBe("credential_error");
    expect(JSON.stringify(result)).not.toContain("do-not-log");
  });
});

describe("composeBriefing — local-day bounding", () => {
  it("excludes calendar events on a different local day", async () => {
    const deps = makeFakeDeps();
    // Definition tz UTC; an event dated yesterday must be filtered out of "today".
    const manifests = deps.moduleManifests.map((m) => ({
      ...m,
      assistantTools: (m.assistantTools ?? []).map((t) =>
        t.name === "calendar.listVisibleEvents"
          ? {
              ...t,
              execute: (async () => ({
                data: { events: [{ startsAt: "2026-06-12T09:00:00.000Z", title: "Yesterday" }] }
              })) as ToolExecute
            }
          : t
      )
    }));
    const result = await composeBriefing(fakeScopedDb, definition(), runInput, {
      ...deps,
      moduleManifests: manifests
    });
    expect(result.sourceMetadata.calendarCount).toBe(0);
    const gaps = (result.sourceMetadata.gaps ?? []) as Array<{ source: string; reason: string }>;
    expect(gaps.some((g) => g.source === "calendar" && g.reason === "empty")).toBe(true);
  });
});
