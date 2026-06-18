import { requestJson } from "./client.js";

export interface MemorySettings {
  readonly recallEnabled: boolean;
  readonly factsEnabled: boolean;
}

export interface MemoryFact {
  readonly id: string;
  readonly category: string;
  readonly content: string;
  readonly importance: number;
  readonly provenance: "volunteered" | "inferred" | "confirmed";
  readonly sourceThreadId: string | null;
  readonly createdAt: string;
}

export interface MemoryCorrection {
  readonly id: string;
  readonly category: string;
  readonly content: string;
  readonly reason: "rejected" | "corrected";
  readonly source: "chat" | "pattern-reject";
  readonly factId: string | null;
  readonly beforeContent: string | null;
  readonly afterContent: string | null;
  readonly createdAt: string;
}

export async function getMemorySettings(): Promise<MemorySettings> {
  return requestJson<MemorySettings>("/api/chat/memory/settings");
}

export async function patchMemorySettings(patch: Partial<MemorySettings>): Promise<MemorySettings> {
  return requestJson<MemorySettings>("/api/chat/memory/settings", { method: "PATCH", body: patch });
}

export async function getMemoryFacts(): Promise<{ facts: MemoryFact[] }> {
  return requestJson<{ facts: MemoryFact[] }>("/api/chat/memory/facts");
}

export async function getMemoryCorrections(): Promise<{ corrections: MemoryCorrection[] }> {
  return requestJson<{ corrections: MemoryCorrection[] }>("/api/chat/memory/corrections");
}

export async function deleteMemoryFact(id: string): Promise<void> {
  await requestJson<unknown>(`/api/chat/memory/facts/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function confirmMemoryFact(id: string): Promise<void> {
  await requestJson<unknown>(`/api/chat/memory/facts/${encodeURIComponent(id)}/confirm`, {
    method: "POST"
  });
}

export async function rejectMemoryFact(id: string): Promise<void> {
  await requestJson<unknown>(`/api/chat/memory/facts/${encodeURIComponent(id)}/reject`, {
    method: "POST"
  });
}
