import { createHash } from "node:crypto";
import type { PersonContextSignal } from "@jarv1s/module-sdk";
import type { PersonIdentityKind, PersonCandidateKind } from "./types.js";

export function normalizeIdentity(kind: PersonIdentityKind, raw: string): string {
  if (kind === "email_address" || kind === "source_identity") {
    return raw.trim().toLowerCase();
  }
  return raw.trim();
}

export function candidateSignature(kind: PersonCandidateKind, ids: string[]): string {
  const sorted = [...ids].sort().join("|");
  return createHash("sha256").update(`${kind}:${sorted}`).digest("hex").slice(0, 32);
}

export interface MatchResultEntry {
  readonly normalizedValue: string;
  readonly displayValue: string;
  readonly identityKind: PersonContextSignal["identityKind"];
  readonly signals: PersonContextSignal[];
  readonly confidence: number;
}

export type MatchResultMap = Map<string, MatchResultEntry>;

export function matchResult(signals: PersonContextSignal[]): MatchResultMap {
  const map: MatchResultMap = new Map();
  for (const signal of signals) {
    const key = `${signal.identityKind}:${signal.normalizedValue}`;
    const existing = map.get(key);
    if (existing) {
      const updated: MatchResultEntry = {
        ...existing,
        signals: [...existing.signals, signal],
        confidence: Math.min(1, existing.confidence + signal.confidence * 0.1)
      };
      map.set(key, updated);
    } else {
      map.set(key, {
        normalizedValue: signal.normalizedValue,
        displayValue: signal.displayValue,
        identityKind: signal.identityKind,
        signals: [signal],
        confidence: signal.confidence
      });
    }
  }
  return map;
}
