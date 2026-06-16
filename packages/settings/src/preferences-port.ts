import type { DataContextDb } from "@jarv1s/db";

export interface ProfilePreferencesPort {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
  upsert(scopedDb: DataContextDb, key: string, value: unknown): Promise<void>;
}

export interface PersonaPreviewInput {
  readonly actorUserId: string;
  readonly userName: string;
  readonly assistantName: string;
  readonly personaText: string;
}
