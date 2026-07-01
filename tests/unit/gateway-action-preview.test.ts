import { describe, expect, it, vi } from "vitest";

import { AssistantToolGateway, ConfirmationRegistry, SessionTokenRegistry } from "@jarv1s/ai";
import type { ActionRequestPreview, JarvisModuleManifest } from "@jarv1s/module-sdk";

/**
 * T7 — gateway threads a tool's async `preview` hook into the `action_request` emit ONLY.
 * The persisted action row's `inputSummary` must stay key-names-only (metadata-only
 * persistence); a preview that throws must NOT block the card.
 */
describe("gateway action_request preview threading", () => {
  const preview: ActionRequestPreview = {
    to: "alice@example.test",
    subject: "Re: lunch",
    body: "Sounds great — see you at noon."
  };

  const moduleWith = (
    tool: JarvisModuleManifest["assistantTools"] extends readonly (infer T)[] ? T : never
  ): JarvisModuleManifest => ({
    id: "email",
    name: "Email",
    version: "1.0.0",
    publisher: "Jarv1s",
    lifecycle: "optional",
    compatibility: { jarv1s: "*" },
    assistantTools: [tool]
  });

  const buildGateway = (
    module: JarvisModuleManifest,
    capture: { emitted: unknown[]; created: unknown[] }
  ) => {
    const tokens = new SessionTokenRegistry();
    const confirmations = new ConfirmationRegistry();
    const gateway = new AssistantToolGateway({
      resolveActiveModules: async () => [module],
      repository: {
        createPendingAssistantAction: async (_db: unknown, input: unknown) => {
          capture.created.push(input);
          return { id: "action-1" };
        }
      } as never,
      runner: {
        withDataContext: async (_access: unknown, work: (db: unknown) => Promise<unknown>) =>
          work({})
      } as never,
      tokens,
      confirmations,
      notifier: { emit: (_chatSessionId, record) => capture.emitted.push(record) },
      confirmTimeoutMs: 1000
    });
    const token = tokens.mint({ actorUserId: "u1", chatSessionId: "s1", allowedToolNames: null });
    return { gateway, token, confirmations };
  };

  const draftTool = (previewHook: unknown) => ({
    name: "email.draftReply",
    description: "Draft a reply.",
    permissionId: "email.write",
    risk: "destructive" as const,
    inputSchema: {
      type: "object",
      required: ["cacheMessageId", "body"],
      properties: { cacheMessageId: { type: "string" }, body: { type: "string" } }
    },
    execute: async () => ({ data: { ok: true } }),
    preview: previewHook
  });

  it("includes the tool's preview in the action_request emit", async () => {
    const capture = { emitted: [] as unknown[], created: [] as unknown[] };
    const module = moduleWith(draftTool(async () => preview) as never);
    const { gateway, token, confirmations } = buildGateway(module, capture);

    const pending = gateway.callTool(token, "email.draftReply", {
      cacheMessageId: "m1",
      body: "Sounds great — see you at noon."
    });

    await vi.waitFor(() =>
      expect(capture.emitted.some((r) => (r as { kind: string }).kind === "action_request")).toBe(
        true
      )
    );
    const request = capture.emitted.find(
      (r) => (r as { kind: string }).kind === "action_request"
    ) as { preview?: ActionRequestPreview };
    expect(request.preview).toEqual(preview);

    // Persisted row carries only key names — never the composed body.
    expect(capture.created[0]).toMatchObject({
      inputSummary: expect.objectContaining({ inputKeys: expect.arrayContaining(["body"]) })
    });
    const persistedJson = JSON.stringify(capture.created[0]);
    expect(persistedJson).not.toContain("Sounds great");

    confirmations.resolve("action-1", "confirmed");
    await pending;
  });

  it("still emits the card (without preview) when the preview hook throws", async () => {
    const capture = { emitted: [] as unknown[], created: [] as unknown[] };
    const module = moduleWith(
      draftTool(async () => {
        throw new Error("db exploded with a SECRET");
      }) as never
    );
    const { gateway, token, confirmations } = buildGateway(module, capture);

    const pending = gateway.callTool(token, "email.draftReply", {
      cacheMessageId: "m1",
      body: "hello"
    });

    await vi.waitFor(() =>
      expect(capture.emitted.some((r) => (r as { kind: string }).kind === "action_request")).toBe(
        true
      )
    );
    const request = capture.emitted.find(
      (r) => (r as { kind: string }).kind === "action_request"
    ) as { preview?: ActionRequestPreview; summary?: string };
    expect(request.preview).toBeUndefined();
    expect(typeof request.summary).toBe("string");
    // The thrown message (which could carry sensitive detail) never rides the emit.
    expect(JSON.stringify(request)).not.toContain("SECRET");

    confirmations.resolve("action-1", "confirmed");
    await pending;
  });

  it("omits preview entirely for a tool that declares no preview hook", async () => {
    const capture = { emitted: [] as unknown[], created: [] as unknown[] };
    const module = moduleWith(draftTool(undefined) as never);
    const { gateway, token, confirmations } = buildGateway(module, capture);

    const pending = gateway.callTool(token, "email.draftReply", {
      cacheMessageId: "m1",
      body: "hello"
    });

    await vi.waitFor(() =>
      expect(capture.emitted.some((r) => (r as { kind: string }).kind === "action_request")).toBe(
        true
      )
    );
    const request = capture.emitted.find(
      (r) => (r as { kind: string }).kind === "action_request"
    ) as { preview?: ActionRequestPreview };
    expect(request.preview).toBeUndefined();

    confirmations.resolve("action-1", "confirmed");
    await pending;
  });
});
