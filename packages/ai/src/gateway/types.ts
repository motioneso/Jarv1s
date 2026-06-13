import type { JarvisModuleManifest } from "@jarv1s/module-sdk";

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
