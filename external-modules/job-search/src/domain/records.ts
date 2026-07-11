// external-modules/job-search/src/domain/records.ts
//
// JS-02 (#931): the record envelope. EVERY domain read/write goes through
// writeRecord/readRecord so the schemaVersion + size invariants hold on all
// thirteen key families — repositories never call kv.set/get directly for
// JSON records.
import { JobSearchKvError } from "./errors.js";
import type { JobSearchKv } from "./kv-port.js";
import { KV_VALUE_MAX_BYTES } from "./limits.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Write a domain record. Throws `invalid_record` for non-plain-object values
 * or `schemaVersion !== 1`, and `oversize_value` when the JSON serialization
 * exceeds KV_VALUE_MAX_BYTES (65_535 — strictly below the DB's 65_536 check,
 * so the domain always fires first). Error messages carry sizes only, never
 * record content.
 */
// Generic (not Record<string, unknown>) so interface-typed domain records
// are accepted without index signatures; runtime validation does the real
// shape enforcement.
export async function writeRecord<T extends object>(
  kv: JobSearchKv,
  namespace: string,
  key: string,
  record: T
): Promise<void> {
  if (!isPlainObject(record) || record.schemaVersion !== 1) {
    throw new JobSearchKvError("invalid_record", "record must be an object with schemaVersion 1");
  }
  const bytes = Buffer.byteLength(JSON.stringify(record), "utf8");
  if (bytes > KV_VALUE_MAX_BYTES) {
    throw new JobSearchKvError(
      "oversize_value",
      `record is ${bytes} bytes; limit is ${KV_VALUE_MAX_BYTES}`
    );
  }
  await kv.set(namespace, key, record);
}

/**
 * Read a domain record. Returns null when absent. Fails closed on stored
 * shape drift: non-object garbage → `invalid_record`; a schemaVersion other
 * than 1 (e.g. written by a newer module version) → `invalid_schema_version`.
 */
export async function readRecord(
  kv: JobSearchKv,
  namespace: string,
  key: string
): Promise<Record<string, unknown> | null> {
  const value = await kv.get(namespace, key);
  if (value === null) {
    return null;
  }
  if (!isPlainObject(value)) {
    throw new JobSearchKvError("invalid_record", `stored value at ${namespace} is not a record`);
  }
  if (value.schemaVersion !== 1) {
    throw new JobSearchKvError(
      "invalid_schema_version",
      `stored record at ${namespace} has unsupported schemaVersion`
    );
  }
  return value;
}
