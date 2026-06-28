import type { CommitmentExtractionProvider, CommitmentTextBoundary } from "@jarv1s/module-sdk";

export const notesCommitmentProvider: CommitmentExtractionProvider = {
  sourceKind: "notes",
  async getTextBoundaries(
    _scopedDb: unknown,
    _actorUserId: string,
    _since: Date | null
  ): Promise<CommitmentTextBoundary[]> {
    // TODO: query notes for actorUserId where updated_at > since
    return [];
  }
};
