import type {
  GetNotesLastSyncResponse,
  GetNotesSourceResponse,
  PostNotesSyncResponse,
  PutNotesSourceRequest
} from "@jarv1s/shared";

import { requestJson } from "./client.js";

export async function getNotesSource(): Promise<GetNotesSourceResponse> {
  return requestJson<GetNotesSourceResponse>("/api/me/notes-source");
}

export async function putNotesSource(body: PutNotesSourceRequest): Promise<GetNotesSourceResponse> {
  return requestJson<GetNotesSourceResponse>("/api/me/notes-source", {
    method: "PUT",
    body
  });
}

export async function getNotesLastSync(): Promise<GetNotesLastSyncResponse> {
  return requestJson<GetNotesLastSyncResponse>("/api/me/notes-last-sync");
}

export async function postNotesSync(): Promise<PostNotesSyncResponse> {
  return requestJson<PostNotesSyncResponse>("/api/notes/sync", { method: "POST" });
}
