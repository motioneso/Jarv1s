import type {
  ActionRequestPreview,
  JarvisModuleManifest,
  ToolResultMedia
} from "@jarv1s/module-sdk";

/**
 * Resolves the modules whose tools are exposed for a user. The enablement SEAM
 * (ADR 0009 §3): the real resolver (createActiveModulesResolver in
 * @jarv1s/module-registry) reads the app.module_enablement deny-list under
 * withDataContext, so a disabled module's tools vanish from the surface with no
 * change to the gateway or any module. Async because it does a DB round-trip.
 */
export type ActiveModulesResolver = (
  actorUserId: string
) => Promise<readonly JarvisModuleManifest[]>;

/**
 * A record the gateway pushes into a chat session's live stream (out-of-band from
 * the tmux transcript). The real implementation wires to chat-session-manager in
 * the transport/integration plan.
 */
export type GatewaySessionRecord =
  | {
      readonly kind: "action_request";
      readonly actionRequestId: string;
      readonly toolName: string;
      readonly summary: string;
      /**
       * Optional rich, server-derived card preview (e.g. email reply recipient/subject/body).
       * Rides the live stream ONLY — it is never written to the persisted action_request row,
       * whose `inputSummary` stays key-names-only (metadata-only persistence). Produced by the
       * tool's async `preview` hook under withDataContext; absent when the tool declares none
       * or the hook returned undefined / threw (the card still renders from `summary`).
       */
      readonly preview?: ActionRequestPreview;
    }
  | {
      readonly kind: "action_result";
      readonly actionRequestId: string;
      readonly toolName: string;
      readonly outcome: "executed" | "denied" | "error" | "allowed";
    };

export interface SessionNotifier {
  emit(chatSessionId: string, record: GatewaySessionRecord): void;
}

export type GatewayToolResponse =
  // #1133 — `media` is an optional verbatim pass-through from ToolResult.media (image
  // bytes for MCP image content blocks). It deliberately does NOT flow through
  // renderAndCap; see AssistantToolGateway.runHandler.
  | {
      readonly ok: true;
      readonly data: Record<string, unknown>;
      readonly media?: ToolResultMedia;
    }
  | { readonly ok: false; readonly denied: true; readonly reason: string }
  | { readonly ok: false; readonly error: string };
