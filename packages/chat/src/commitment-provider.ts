import type { CommitmentExtractionProvider, CommitmentTextBoundary } from "@jarv1s/module-sdk";

export const chatCommitmentProvider: CommitmentExtractionProvider = {
  sourceKind: "chat",
  async getTextBoundaries(
    _scopedDb: unknown,
    _actorUserId: string,
    _since: Date | null
  ): Promise<CommitmentTextBoundary[]> {
    // TODO: query chat_messages for actorUserId where created_at > since
    return [];
  }
};
