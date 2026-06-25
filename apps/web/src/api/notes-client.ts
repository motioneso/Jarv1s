import type {
  GetNotesSourceDirectoriesResponse,
  GetNotesLastSyncResponse,
  GetNotesSourceResponse,
  PostNotesSyncResponse,
  PutNotesSourceRequest
} from "@jarv1s/shared";

import { requestJson } from "./client.js";

export async function getNotesSource(): Promise<GetNotesSourceResponse> {
  return requestJson<GetNotesSourceResponse>("/api/me/notes-source");
}

export async function getNotesSourceDirectories(
  path: string | null
): Promise<GetNotesSourceDirectoriesResponse> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return requestJson<GetNotesSourceDirectoriesResponse>(`/api/me/notes-source/directories${query}`);
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
