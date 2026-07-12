// JARVIS_MODULES_ENSURE parsing (#964, spec §7 compose-ensure). Format: comma- or
// whitespace-separated `id` / `id@version` tokens. Parsing never throws — bad tokens
// become errors so the boot reconcile can warn-and-continue (registry problems must
// never make boot fatal, spec §7).
import { MODULE_ID_RE } from "../external/validate.js";

export interface EnsureListEntry {
  readonly id: string;
  readonly version?: string;
}

export interface EnsureListParse {
  readonly entries: readonly EnsureListEntry[];
  readonly errors: readonly string[];
}

export function parseModulesEnsure(raw: string | null | undefined): EnsureListParse {
  const entries: EnsureListEntry[] = [];
  const errors: string[] = [];
  if (!raw || raw.trim() === "") return { entries, errors };

  const seen = new Set<string>();
  for (const token of raw.split(/[,\s]+/).filter((t) => t.length > 0)) {
    const at = token.indexOf("@");
    const id = at === -1 ? token : token.slice(0, at);
    const version = at === -1 ? undefined : token.slice(at + 1);
    if (!MODULE_ID_RE.test(id)) {
      errors.push(`invalid module id in JARVIS_MODULES_ENSURE: "${token}"`);
      continue;
    }
    if (version !== undefined && (version.length === 0 || version.length > 64)) {
      errors.push(`invalid version pin in JARVIS_MODULES_ENSURE: "${token}"`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`duplicate module id in JARVIS_MODULES_ENSURE: "${id}" (first entry wins)`);
      continue;
    }
    seen.add(id);
    entries.push(version === undefined ? { id } : { id, version });
  }
  return { entries, errors };
}
