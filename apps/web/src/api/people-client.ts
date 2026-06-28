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
  const qs = entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}` : "";
  return requestJson<{ people: PersonDto[] }>(`/api/people${qs}`);
}

export async function listMatchCandidates(): Promise<{ candidates: MatchCandidateDto[] }> {
  return requestJson<{ candidates: MatchCandidateDto[] }>("/api/people/match-candidates");
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
    body: params ?? {},
  });
}
