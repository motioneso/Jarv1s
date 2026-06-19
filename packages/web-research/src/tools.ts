import type { ToolExecute } from "@jarv1s/module-sdk";

export const webSearchExecute: ToolExecute = async () => ({
  data: { query: "", results: [], trace: { provider: "unavailable", resultCount: 0 } }
});

export const webReadExecute: ToolExecute = async () => ({
  data: {
    documents: [],
    trace: { requestedUrlCount: 0, fetchedUrlCount: 0, skippedUrlCount: 0, documents: [] }
  }
});
