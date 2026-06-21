/**
 * #368 — "Ask Jarvis" finish-step handoff.
 *
 * The onboarding wizard is an early-return in app.tsx: it is NOT mounted inside the AppShell, so
 * the chat drawer (which lives in the shell) does not exist while the wizard is on screen.
 * Completing onboarding invalidates the onboarding status, App re-renders, and the wizard is
 * replaced by the shell — a full remount. To carry the "open the chat drawer with a setup-check
 * starter" intent across that remount we drop a one-shot flag in sessionStorage (cleared on the
 * very next page load if the user navigates away instead of into the shell — session-scoped, not
 * persistent). The shell consumes it once on mount.
 *
 * The starter is PRE-FILLED into the composer, never auto-sent (spec-locked: opens the drawer with
 * the chip; does not auto-send). It is provider-agnostic — generic setup-verification copy, no
 * provider or model named.
 */

/** Spec-locked setup-check starter. Exported so the wizard, shell, and tests share one source. */
export const ASK_JARVIS_STARTER = "Help me verify my Jarvis setup.";

const ASK_JARVIS_STORAGE_KEY = "jarvis.ask-jarvis-onboarding:v1";

type HandoffStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): HandoffStorage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Mark that the user chose "Ask Jarvis" at the Finish step. Called alongside the normal complete-
 * onboarding mutation (NOT from inside a setState updater — StrictMode double-fire trap).
 */
export function requestAskJarvis(storage: HandoffStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(ASK_JARVIS_STORAGE_KEY, "1");
  } catch {
    // Storage can be disabled, full, or unavailable in private browsing — the affordance then
    // degrades to a normal finish (the user simply lands on Today without the drawer open).
  }
}

/**
 * Read-and-clear the one-shot flag. Returns true exactly once after {@link requestAskJarvis}; the
 * shell calls this on mount so the drawer opens at most once and a refresh does not re-trigger it.
 */
export function consumeAskJarvis(storage: HandoffStorage | undefined = defaultStorage()): boolean {
  try {
    const flagged = storage?.getItem(ASK_JARVIS_STORAGE_KEY) === "1";
    if (flagged) {
      storage?.removeItem(ASK_JARVIS_STORAGE_KEY);
    }
    return flagged;
  } catch {
    return false;
  }
}
