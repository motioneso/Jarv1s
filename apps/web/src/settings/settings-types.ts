import type { MeResponse } from "@jarv1s/shared";

/** Shared props every settings pane receives from the shell. */
export interface PaneProps {
  /** The persistent Advanced switch — reveals provider/host/developer detail. */
  readonly advanced: boolean;
  readonly me: MeResponse;
  /** Navigate to an in-app route (used by "Open settings →" module links). */
  readonly onNavigate: (path: string) => void;
}

/** Editorial one-liners for modules (the module DTOs carry no description). */
export const MODULE_DESCRIPTIONS: Record<string, string> = {
  tasks: "Capture, prioritise and track what you need to do.",
  calendar: "The events Jarvis plans around and protects.",
  briefings: "Your daily reading ritual. Cadence lives in here.",
  knowledge: "What Jarvis remembers about you — facts, patterns, corrections.",
  wellness: "Private capacity signals — mood, energy, meds.",
  notifications: "What's worth surfacing. Sensitivity lives in here.",
  finance: "Planning context, kept out of your briefings.",
  email: "Back-end context and task capture — never a nav destination.",
  chat: "The assistant you talk to, inside the product."
};

export function moduleDescription(id: string): string {
  return MODULE_DESCRIPTIONS[id] ?? "A Jarvis module.";
}

export function readError(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}
