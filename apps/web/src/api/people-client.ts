import { requestJson } from "./client.js";

export type PersonCandidateKind =
  | "create_person"
  | "link_identity"
  | "merge_people"
  | "split_identity";

export interface PersonDto {
  readonly id: string;
  readonly displayName: string;
  readonly status: "active" | "archived" | "merged";
  readonly confidence: number;
  readonly relationshipSummary: string | null;
  readonly contextSummary: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PeopleNotesSettingsDto {
  readonly folder: string | null;
}

export interface PeopleNotesDirectoryDto {
  readonly name: string;
  readonly path: string;
}

export interface PeopleNotesDirectoriesResponse {
  readonly path: string | null;
  readonly directories: PeopleNotesDirectoryDto[];
}

export interface PeopleNotesRefreshResponse {
  readonly discovered: number;
  readonly projected: number;
  readonly ignored: number;
  readonly candidates: number;
}

export interface PeopleNoteWriteResponse {
  readonly person: PersonDto;
  readonly notePath: string;
}

export interface CreatePersonRequest {
  readonly displayName: string;
  readonly aliases?: readonly string[];
  readonly emails?: readonly string[];
  readonly phones?: readonly string[];
}

export interface UpdatePersonRequest {
  readonly displayName?: string;
  readonly status?: "active" | "archived";
}

export interface MatchCandidateDto {
  readonly id: string;
  readonly candidateKind: PersonCandidateKind;
  readonly status: "pending" | "accepted" | "rejected" | "suppressed" | "resolved";
  readonly suggestedDisplayName: string | null;
  readonly reasonSummary: string | null;
  readonly confidence: number;
}

export async function listPeople(params?: {
  search?: string;
  status?: string;
  limit?: number;
}): Promise<{ people: PersonDto[] }> {
  const entries = Object.entries(params ?? {}).filter(([, v]) => v != null);
  const qs = entries.length
    ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`
    : "";
  return requestJson<{ people: PersonDto[] }>(`/api/people${qs}`);
}

export async function listMatchCandidates(): Promise<{ candidates: MatchCandidateDto[] }> {
  return requestJson<{ candidates: MatchCandidateDto[] }>("/api/people/match-candidates");
}

export async function getPeopleNotesSettings(): Promise<PeopleNotesSettingsDto> {
  return requestJson<PeopleNotesSettingsDto>("/api/people/notes-settings");
}

export async function getPeopleNotesDirectories(
  path: string | null
): Promise<PeopleNotesDirectoriesResponse> {
  const query = path ? `?${new URLSearchParams({ path }).toString()}` : "";
  return requestJson<PeopleNotesDirectoriesResponse>(`/api/people/notes-directories${query}`);
}

export async function putPeopleNotesSettings(
  body: PeopleNotesSettingsDto
): Promise<PeopleNotesSettingsDto> {
  return requestJson<PeopleNotesSettingsDto>("/api/people/notes-settings", {
    method: "PUT",
    body
  });
}

export async function refreshPeopleNotes(): Promise<PeopleNotesRefreshResponse> {
  return requestJson<PeopleNotesRefreshResponse>("/api/people/notes/refresh", {
    method: "POST"
  });
}

export async function createPerson(body: CreatePersonRequest): Promise<PeopleNoteWriteResponse> {
  return requestJson<PeopleNoteWriteResponse>("/api/people", { method: "POST", body });
}

export async function updatePerson(
  id: string,
  body: UpdatePersonRequest
): Promise<PeopleNoteWriteResponse> {
  return requestJson<PeopleNoteWriteResponse>(`/api/people/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body
  });
}

export async function archivePerson(id: string): Promise<PeopleNoteWriteResponse> {
  return requestJson<PeopleNoteWriteResponse>(`/api/people/${encodeURIComponent(id)}/archive`, {
    method: "POST"
  });
}

export async function acceptCandidate(id: string): Promise<{ accepted: boolean }> {
  return requestJson<{ accepted: boolean }>(
    `/api/people/match-candidates/${encodeURIComponent(id)}/accept`,
    { method: "POST" }
  );
}

export async function rejectCandidate(id: string): Promise<{ rejected: boolean }> {
  return requestJson<{ rejected: boolean }>(
    `/api/people/match-candidates/${encodeURIComponent(id)}/reject`,
    { method: "POST" }
  );
}

export async function refreshIndex(params?: { limit?: number }): Promise<{ enqueued: number }> {
  return requestJson<{ enqueued: number }>("/api/people/index/refresh", {
    method: "POST",
    body: params ?? {}
  });
}
