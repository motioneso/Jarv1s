import { errorResponseSchema } from "./schema-fragments.js";
import type { ChatMultiplexerChoice } from "./platform-api.js";

// ---------------------------------------------------------------------------
// Onboarding (Phase 2 primary-user onboarding). See
// docs/superpowers/specs/2026-06-12-p2-primary-user-onboarding-design.md
// NOTE: ChatMultiplexerChoice ("auto"|"tmux"|"herdr") is the existing CLI-adapter
// contract from platform-api. Onboarding reuses it; it is not redefined here.
// ---------------------------------------------------------------------------

/** Single, unambiguous onboarding lifecycle state (replaces two booleans). */
export type OnboardingState = "pending" | "completed" | "skipped";

export interface OnboardingMultiplexerStepDto {
  /** done ⇔ the chosen multiplexer is USABLE (tmux installed | herdr installed+root pane | auto). */
  readonly done: boolean;
  /** The persisted chat.multiplexer choice, or null when no row exists yet. */
  readonly selected: ChatMultiplexerChoice | null;
  /** tmux is usable on this host (installed). */
  readonly tmuxUsable: boolean;
  /** herdr is usable on this host (installed AND a root pane is configured). */
  readonly herdrUsable: boolean;
}

export type OnboardingProviderKind = "anthropic" | "openai-compatible" | "google";

export interface OnboardingCliProviderDto {
  readonly kind: OnboardingProviderKind;
  /** Presence-only: the binary is on PATH. NOT a claim of authentication. */
  readonly cliPresent: boolean;
}

export interface OnboardingProviderCheckRequest {
  readonly providerKind: OnboardingProviderKind;
}

export type OnboardingProviderCheckStatus =
  | "ready"
  | "needs_login"
  | "not_installed"
  | "multiplexer_unavailable"
  | "error";

export interface OnboardingProviderCheckResponse {
  readonly status: OnboardingProviderCheckStatus;
  readonly message?: string;
}

export interface OnboardingCliAuthStepDto {
  /** Documented floor: done ⇔ at least one provider CLI is PRESENT (presence ≠ authed). */
  readonly done: boolean;
  readonly providers: readonly OnboardingCliProviderDto[];
}

export interface OnboardingConnectorStepDto {
  readonly done: boolean;
}

export interface OnboardingStepsDto {
  readonly multiplexer: OnboardingMultiplexerStepDto;
  readonly cliAuth: OnboardingCliAuthStepDto;
  readonly connectors: OnboardingConnectorStepDto;
}

// --- Phase 4: role-tagged onboarding status. The "founder" variant is the Phase-2
//     shape (instance-global provisioning, keyed on the OnboardingState lifecycle); the
//     "member" variant is per-user (one row in app.member_onboarding). Consumers narrow on
//     `role` before touching variant-specific fields. ---

export interface OnboardingFounderStatus {
  readonly role: "founder";
  readonly state: OnboardingState;
  readonly steps: OnboardingStepsDto;
}

/**
 * Member step flags are DERIVED CLIENT-SIDE from the connectors / AI modules' own public
 * endpoints (module isolation — packages/settings never reads another module's tables).
 * The server returns neutral `false` defaults; the member wizard fills them in.
 */
export interface OnboardingMemberStepFlags {
  readonly apiKeyOptOut: { readonly done: boolean };
  readonly connectors: { readonly done: boolean };
}

export interface OnboardingMemberStatus {
  readonly role: "member";
  readonly completed: boolean;
  readonly steps: OnboardingMemberStepFlags;
}

export type OnboardingStatusResponse = OnboardingFounderStatus | OnboardingMemberStatus;

export interface OnboardingStateResponse {
  readonly state: OnboardingState;
}

/**
 * Phase 4: the member complete/skip response. A member's onboarding has no separate
 * "skipped" lifecycle (skip == terminal "onboarded"), so the response carries a single
 * `completed` boolean — distinct from the founder's instance-global `{ state }` shape.
 */
export interface OnboardingMemberCompleteResponse {
  readonly completed: boolean;
}

export type OnboardingCompleteResponse = OnboardingStateResponse | OnboardingMemberCompleteResponse;

// Phase 4: the founder branch is the unchanged Phase-2 shape with a `role` discriminant.
const onboardingFounderStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "state", "steps"],
  properties: {
    role: { type: "string", enum: ["founder"] },
    state: { type: "string", enum: ["pending", "completed", "skipped"] },
    steps: {
      type: "object",
      additionalProperties: false,
      required: ["multiplexer", "cliAuth", "connectors"],
      properties: {
        multiplexer: {
          type: "object",
          additionalProperties: false,
          required: ["done", "selected", "tmuxUsable", "herdrUsable"],
          properties: {
            done: { type: "boolean" },
            selected: { type: ["string", "null"], enum: ["auto", "tmux", "herdr", null] },
            tmuxUsable: { type: "boolean" },
            herdrUsable: { type: "boolean" }
          }
        },
        cliAuth: {
          type: "object",
          additionalProperties: false,
          required: ["done", "providers"],
          properties: {
            done: { type: "boolean" },
            providers: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["kind", "cliPresent"],
                properties: {
                  kind: {
                    type: "string",
                    enum: ["anthropic", "openai-compatible", "google"]
                  },
                  cliPresent: { type: "boolean" }
                }
              }
            }
          }
        },
        connectors: {
          type: "object",
          additionalProperties: false,
          required: ["done"],
          properties: { done: { type: "boolean" } }
        }
      }
    }
  }
} as const;

// Phase 4: the member branch — per-user completion + client-derived step flags.
const onboardingMemberStatusSchema = {
  type: "object",
  additionalProperties: false,
  required: ["role", "completed", "steps"],
  properties: {
    role: { type: "string", enum: ["member"] },
    completed: { type: "boolean" },
    steps: {
      type: "object",
      additionalProperties: false,
      required: ["apiKeyOptOut", "connectors"],
      properties: {
        apiKeyOptOut: {
          type: "object",
          additionalProperties: false,
          required: ["done"],
          properties: { done: { type: "boolean" } }
        },
        connectors: {
          type: "object",
          additionalProperties: false,
          required: ["done"],
          properties: { done: { type: "boolean" } }
        }
      }
    }
  }
} as const;

const onboardingStatusResponseSchema = {
  oneOf: [onboardingFounderStatusSchema, onboardingMemberStatusSchema]
} as const;

const onboardingProviderCheckRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["providerKind"],
  properties: {
    providerKind: {
      type: "string",
      enum: ["anthropic", "openai-compatible", "google"]
    }
  }
} as const;

const onboardingProviderCheckResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: {
      type: "string",
      enum: ["ready", "needs_login", "not_installed", "multiplexer_unavailable", "error"]
    },
    message: { type: "string" }
  }
} as const;

const onboardingStateResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["state"],
  properties: {
    state: { type: "string", enum: ["pending", "completed", "skipped"] }
  }
} as const;

// Phase 4: the member complete/skip response — a single `completed` boolean.
const onboardingMemberCompleteResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["completed"],
  properties: {
    completed: { type: "boolean" }
  }
} as const;

// Phase 4: complete/skip now serve BOTH the founder `{ state }` shape and the member
// `{ completed }` shape, branched on role inside the handler. The response is validated
// against this role-tagged-by-shape union (each variant keeps additionalProperties:false).
const onboardingCompleteResponseSchema = {
  oneOf: [onboardingStateResponseSchema, onboardingMemberCompleteResponseSchema]
} as const;

export const getOnboardingStatusRouteSchema = {
  response: {
    200: onboardingStatusResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingProviderCheckRouteSchema = {
  body: onboardingProviderCheckRequestSchema,
  response: {
    200: onboardingProviderCheckResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingCompleteRouteSchema = {
  response: {
    200: onboardingCompleteResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;

export const onboardingSkipRouteSchema = {
  response: {
    200: onboardingCompleteResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema
  }
} as const;
