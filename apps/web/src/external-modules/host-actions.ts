/**
 * #916 — external module host starter action.
 *
 * The one generic seam an enabled external web module uses to ask the Jarv1s host to open the
 * existing assistant drawer with a stable, module-authored starter prompt. The host validates and
 * caps the prompt, then inserts it as an EDITABLE DRAFT — it never submits a turn or runs a tool
 * (that stays a manual user action, identical to typed text). See the spec:
 * docs/superpowers/specs/2026-07-10-job-search-module-host-starter-action.md.
 *
 * This module is intentionally pure and browser-safe (no DOM, no node:*, no Chat-module import) so
 * the entire fail-closed surface is unit-testable in the node env without jsdom/RTL.
 */

/** Contract v1 host actions handed to an external module's Root (see loader.ts). */
export interface ExternalModuleHostActionsV1 {
  /**
   * Open the assistant with `starterPrompt` inserted as an editable draft. The host validates and
   * caps the prompt; invalid/oversize input fails closed (the assistant is not opened). The input
   * intentionally carries ONLY `starterPrompt` — there is no module-id field, so a module cannot
   * name (or spoof) another module.
   */
  openAssistant(input: { starterPrompt: string }): void;
}

/**
 * Hard cap on a module-authored starter. A starter is static package copy (a short paragraph), not
 * user/resume/job content — 1000 chars is ample. Over-length FAILS CLOSED (no truncation): the cap
 * is a bound the host enforces, not a way for a module to smuggle a larger payload via a trim.
 */
export const MAX_STARTER_PROMPT_LENGTH = 1000;

// A starter is human-readable copy. Allow ordinary whitespace (tab \t, newline \n, carriage-return
// \r) but reject other C0 controls (0x00-0x08, 0x0B-0x0C, 0x0E-0x1F) and DEL (0x7F) — they have
// no place in display copy and could smuggle terminal escapes into a surface that renders the draft.
// This pattern's entire purpose is to detect and reject control characters.
// eslint-disable-next-line no-control-regex -- deliberate, see comment above
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// Module ids are lower-kebab slugs (matches the server-side discovery slug rule). Re-checked here
// as defense in depth so the host only ever exposes an action bound to a well-formed id.
const MODULE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Validate + cap a module-authored starter prompt. Returns the trimmed prompt when valid, else null
 * (fail closed). Never throws — a non-string input yields null.
 */
export function sanitizeStarterPrompt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_STARTER_PROMPT_LENGTH) return null;
  if (CONTROL_CHAR_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Build the host actions for ONE external module, bound to `moduleId` by closure at the
 * host-controlled call site (app.tsx). `openAssistantWithDraft` is the shell callback that opens the
 * drawer with an editable draft (never auto-sent). A blank/malformed binding, or an invalid prompt,
 * fails closed.
 */
export function createModuleHostActions(
  moduleId: string,
  openAssistantWithDraft: (draft: string) => void
): ExternalModuleHostActionsV1 {
  return {
    openAssistant(input) {
      // Defense in depth: only ever act when the host binding is a well-formed module id.
      if (!MODULE_ID_PATTERN.test(moduleId)) return;
      const prompt = sanitizeStarterPrompt(input?.starterPrompt);
      if (prompt === null) return; // fail closed — do not open the assistant
      openAssistantWithDraft(prompt);
    }
  };
}
