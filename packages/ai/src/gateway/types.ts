import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

/**
 * Resolves the modules whose tools are exposed for a user. The enablement SEAM:
 * Phase 2 wires this to `() => getBuiltInModuleManifests()` from
 * `@jarv1s/module-registry` (done where the gateway is constructed, to avoid an
 * ai -> module-registry dependency). When per-user module enable/disable ships
 * (#30), this resolver reads it and disabled modules' tools vanish from the
 * surface with no change to the gateway or any module.
 */
export type ActiveModulesResolver = (actorUserId: string) => readonly JarvisModuleManifest[];

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
    }
  | {
      readonly kind: "action_result";
      readonly actionRequestId: string;
      readonly toolName: string;
      readonly outcome: "executed" | "denied" | "error";
    };

export interface SessionNotifier {
  emit(chatSessionId: string, record: GatewaySessionRecord): void;
}

export type GatewayToolResponse =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly denied: true; readonly reason: string }
  | { readonly ok: false; readonly error: string };
