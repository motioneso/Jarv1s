// external-modules/job-search/src/worker/validate.ts
//
// Task 13 (#1297): tool-input readers. Every error names the offending KEY and the violated
// CONSTRAINT only — never the value — so a validation failure can flow back through an RPC
// result without echoing anything the caller typed.
//
// Ruling N12: never write literal control bytes into source. There are none here — every check
// below inspects `typeof`/length/key membership, never a pattern that could be tempted to.

export class InputError extends Error {
  readonly code: string;

  /**
   * One-arg form keeps the classic validation code ("invalid_input"); a two-arg form is
   * available for a later task that needs to key remediation on something more specific
   * (finance's InputError precedent), unused by this file today.
   */
  constructor(codeOrMessage: string, message?: string) {
    super(message ?? codeOrMessage);
    this.name = "InputError";
    this.code = message === undefined ? "invalid_input" : codeOrMessage;
  }
}

/**
 * The host spreads actorUserId onto every external tool input as an anti-spoof measure
 * (FIN-04). It is deliberate and it is not going away, so every strict validator in this
 * module strips it before checking for unknown keys.
 */
export function stripEnvelope(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InputError("input must be an object");
  }
  // ignoreRestSiblings (eslint.config.mjs) permits this destructure-to-omit without a lint
  // exception: the point of the line is dropping `actorUserId`, not reading it.
  const { actorUserId, ...rest } = raw as Record<string, unknown>;
  return rest;
}

const PROFILE_INPUT_KEYS = new Set(["profileId"]);

export function validateProfileInput(raw: unknown): { profileId: string } {
  const input = stripEnvelope(raw);

  for (const key of Object.keys(input)) {
    if (!PROFILE_INPUT_KEYS.has(key)) {
      throw new InputError(`unknown key: ${key}`);
    }
  }

  const profileId = input.profileId;
  if (typeof profileId !== "string" || profileId.length === 0) {
    throw new InputError("profileId is required");
  }

  return { profileId };
}
