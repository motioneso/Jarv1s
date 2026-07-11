// external-modules/job-search/src/domain/confirmations.ts
//
// JS-03 (#932): recorded user confirmations — the only path by which an
// unquoted material claim may pass the truth guard. The confirmation id IS
// the claim identity (derived from normalized kind + text), so a stored
// record can never vouch for a different claim than the one the user saw:
// saveConfirmation rejects any id that doesn't re-derive from its own
// (claimKind, claimText). Records live in NS.resume under confirmation/<id>
// and are first-write-wins (re-confirming the same claim is a no-op, keeping
// the original confirmedAt).
import { JobSearchKvError } from "./errors.js";
import { contentHash, keys } from "./keys.js";
import type { JobSearchKv } from "./kv-port.js";
import { NS } from "./kv-port.js";
import { readRecord, writeRecord } from "./records.js";
import type { MaterialClaimKind } from "./truth-guard.js";

export const CONFIRMATION_TEXT_MAX_CHARS = 500;

const CONFIRMATION_KEY_PREFIX = "confirmation/";

export interface ConfirmationRecord {
  schemaVersion: 1;
  confirmationId: string;
  claimKind: MaterialClaimKind;
  claimText: string;
  confirmedAt: string;
}

/** Deterministic claim identity; `confirm\0` prefix keeps it from ever colliding with other contentHash derivations. */
export function confirmationIdFor(kind: MaterialClaimKind, text: string): string {
  return contentHash(`confirm\0${kind}\0${text}`);
}

export async function saveConfirmation(kv: JobSearchKv, record: ConfirmationRecord): Promise<void> {
  if (record.claimText.length > CONFIRMATION_TEXT_MAX_CHARS) {
    // Cap only — the text itself is private claim content and must not
    // appear in an error message.
    throw new JobSearchKvError(
      "invalid_record",
      `confirmation claimText exceeds the ${CONFIRMATION_TEXT_MAX_CHARS}-char cap`
    );
  }
  if (record.confirmationId !== confirmationIdFor(record.claimKind, record.claimText)) {
    throw new JobSearchKvError(
      "invalid_record",
      "confirmationId does not derive from the record's claimKind + claimText"
    );
  }
  const key = keys.resumeConfirmation(record.confirmationId);
  const existing = await readRecord(kv, NS.resume, key);
  if (existing !== null) {
    // Same id ⇒ same (kind, text); keep the original confirmedAt.
    return;
  }
  await writeRecord(kv, NS.resume, key, record);
}

/**
 * Full confirmation records, not just ids. The markdown-coverage guard needs
 * the user-confirmed claim TEXTS as its only non-source vouching corpus —
 * AI-declared claim texts must never vouch (QA RED B1, PR #956
 * issuecomment-4945986416 + issuecomment-4946000922). saveConfirmation
 * guarantees every stored record's id re-derives from its own kind + text,
 * so these texts are exactly what the user confirmed.
 */
export async function listConfirmations(kv: JobSearchKv): Promise<ConfirmationRecord[]> {
  const allKeys = await kv.list(NS.resume);
  const records: ConfirmationRecord[] = [];
  for (const key of allKeys) {
    if (!key.startsWith(CONFIRMATION_KEY_PREFIX)) {
      continue;
    }
    const record = await readRecord(kv, NS.resume, key);
    if (record !== null) {
      // readRecord fails closed on shape drift; schemaVersion 1 is verified.
      records.push(record as unknown as ConfirmationRecord);
    }
  }
  return records;
}

export async function listConfirmationIds(kv: JobSearchKv): Promise<ReadonlySet<string>> {
  const allKeys = await kv.list(NS.resume);
  const ids = new Set<string>();
  for (const key of allKeys) {
    if (key.startsWith(CONFIRMATION_KEY_PREFIX)) {
      ids.add(key.slice(CONFIRMATION_KEY_PREFIX.length));
    }
  }
  return ids;
}
