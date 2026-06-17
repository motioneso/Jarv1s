import type { PreferencesPort } from "@jarv1s/db";

/** The settings profile uses the shared scoped KV preferences port. */
export type ProfilePreferencesPort = PreferencesPort;

export interface PersonaPreviewInput {
  readonly actorUserId: string;
  readonly userName: string;
  readonly assistantName: string;
  readonly personaText: string;
}
