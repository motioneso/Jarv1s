import type { DataContextDb } from "@jarv1s/db";

import type { ConnectorsRepository } from "./repository.js";
import { CALENDAR_SCOPE, GMAIL_SCOPE } from "./sync-jobs.js";

export async function getConnectorSyncAt(
  repo: Pick<ConnectorsRepository, "listAccounts">,
  scopedDb: DataContextDb,
  kind: "email" | "calendar"
): Promise<Date | null> {
  let accounts;
  try {
    accounts = await repo.listAccounts(scopedDb);
  } catch {
    return null;
  }
  const matching = accounts.filter((a) => {
    const s = a.scopes;
    return kind === "email"
      ? s.includes(GMAIL_SCOPE) || s.includes("gmail")
      : s.includes(CALENDAR_SCOPE) || s.includes("calendar");
  });
  const times = matching.map((a) => a.last_sync_finished_at).filter((t): t is Date => t !== null);
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((t) => t.getTime())));
}
