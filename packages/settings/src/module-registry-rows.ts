// Task 6 (#964): pure derivation of the admin module-registry rows (spec §8).
// No I/O here — the route feeds it the cached index, the BOOT discovery snapshot,
// a LIVE on-disk id listing (so remove/download reflect immediately, before the
// restart that refreshes the boot snapshot), the app.external_modules admin state,
// and the JARVIS_MODULES_ENSURE ids. Settings must not import @jarv1s/module-registry
// (dependency cycle — see ExternalModuleDiscovery's doc-comment in routes.ts), so the
// index entry is a structural mirror of Task 1's ModuleRegistryEntry subset.
import { compareJarvisVersions, satisfiesCoreVersion } from "@jarv1s/module-sdk/core-version";
import type {
  ModuleRegistryCapabilitiesDto,
  ModuleRegistryLifecycleState,
  ModuleRegistryRowDto
} from "@jarv1s/shared";

import type { ExternalModuleAdminState } from "./repository-external-modules.js";

/** Structural subset of @jarv1s/module-registry's ModuleRegistryEntry (Task 1). */
export interface ModuleRegistryEntryLike {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly version: string;
  readonly requiresCore: string;
  readonly capabilities: ModuleRegistryCapabilitiesDto;
}

/** Structural subset of the boot discovery (id + manifest identity fields). */
export interface DiscoveredModuleLike {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
}

export interface ModuleRegistryDeriveInput {
  /** null = registry fetch failed (degrade to local-only rows; spec §6). */
  readonly registryEntries: readonly ModuleRegistryEntryLike[] | null;
  /** Boot-time discovery snapshot (loaded modules with manifest info). */
  readonly discoveries: readonly DiscoveredModuleLike[];
  /** Boot-time loader rejections (present on disk but refused). */
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
  readonly adminStates: readonly ExternalModuleAdminState[];
  /** LIVE readdir of JARVIS_MODULES_DIR (excludes dot-dirs) — presence truth. */
  readonly onDiskIds: readonly string[];
  readonly ensureIds: readonly string[];
}

export function deriveModuleRegistryRows(input: ModuleRegistryDeriveInput): ModuleRegistryRowDto[] {
  const entries = new Map((input.registryEntries ?? []).map((e) => [e.id, e]));
  const discoveries = new Map(input.discoveries.map((d) => [d.id, d]));
  const rejections = new Map(input.rejected.map((r) => [r.id, r.reason]));
  const states = new Map(input.adminStates.map((s) => [s.id, s]));
  const onDisk = new Set(input.onDiskIds);

  const ids = new Set<string>([
    ...entries.keys(),
    ...discoveries.keys(),
    ...rejections.keys(),
    ...states.keys(),
    ...onDisk,
    ...input.ensureIds
  ]);

  const rows: ModuleRegistryRowDto[] = [];
  for (const id of [...ids].sort()) {
    const entry = entries.get(id);
    const discovery = discoveries.get(id);
    const state = states.get(id);
    const rejectionReason = rejections.get(id) ?? null;
    const present = onDisk.has(id);
    const staged = state?.stagedVersion != null;

    // Precedence (first match wins). Staged beats a stale install error — a retry
    // re-download means "try this content next boot", so the old error is history.
    let lifecycle: ModuleRegistryLifecycleState;
    if (staged) {
      lifecycle = discovery ? "update-pending-restart" : "pending-restart";
    } else if (state?.lastInstallError != null) {
      lifecycle = "install-failed";
    } else if (present && rejectionReason !== null) {
      lifecycle = "install-failed";
    } else if (present && discovery) {
      if (state?.status === "enabled") {
        lifecycle =
          entry && compareJarvisVersions(entry.version, discovery.version) > 0
            ? "update-available"
            : "installed-enabled";
      } else {
        lifecycle = "installed-disabled";
      }
    } else if (present) {
      // On disk but not loaded at boot (dropped in mid-session, no rejection row):
      // treat as disabled until the next boot classifies it.
      lifecycle = "installed-disabled";
    } else if (input.ensureIds.includes(id)) {
      lifecycle = "declared-not-present";
    } else if (entry && !satisfiesCoreVersion(entry.requiresCore)) {
      lifecycle = "incompatible";
    } else {
      // In the index (downloadable), or a leftover DB row after Remove (renders as
      // not-installed; purgePending flags the pending destruction).
      lifecycle = "not-installed";
    }

    rows.push({
      id,
      name: entry?.name ?? discovery?.name ?? id,
      description: entry?.description ?? discovery?.description ?? null,
      state: lifecycle,
      installedVersion: discovery?.version ?? null,
      latestVersion: entry?.version ?? null,
      stagedVersion: state?.stagedVersion ?? null,
      requiresCore: entry?.requiresCore ?? null,
      capabilities: entry?.capabilities ?? null,
      lastInstallError: state?.lastInstallError ?? rejectionReason,
      purgePending: state?.purgeRequestedAt != null
    });
  }
  return rows;
}
