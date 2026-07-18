// external-modules/finance/src/web/household.ts
//
// FIN-04 (#1149) Task 5: web-side owner resolution for the merged household
// feed. Workers can't call host HTTP routes, so the deleted/deactivated-owner
// drop lives HERE: a shared entry renders only when its ownerUserId resolves
// against GET /api/users/directory (active users only). If the directory is
// unavailable, every shared entry is dropped — fail closed rather than show
// unattributed household data.

export type DirectoryUser = {
  id: string;
  name: string | null;
};

type SharedTagged = {
  shared?: boolean;
  ownerUserId?: string;
};

/** Neutral label when an owner has no display name set. */
export const OWNER_FALLBACK_LABEL = "Household member";

/**
 * Pass own entries through untouched; annotate shared entries with their
 * owner's display name, dropping any whose owner can't be resolved.
 */
export function resolveSharedOwners<T extends SharedTagged>(
  entries: T[],
  directory: DirectoryUser[] | null
): (T | (T & { ownerName: string }))[] {
  const result: (T | (T & { ownerName: string }))[] = [];
  for (const entry of entries) {
    if (entry.shared !== true) {
      result.push(entry);
      continue;
    }
    if (directory === null) continue; // directory fetch failed → fail closed
    const owner = directory.find((user) => user.id === entry.ownerUserId);
    if (!owner) continue; // owner deactivated/deleted → drop the entry
    result.push({ ...entry, ownerName: owner.name ?? OWNER_FALLBACK_LABEL });
  }
  return result;
}
