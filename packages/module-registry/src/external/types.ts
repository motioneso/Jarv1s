// Node-free shared types for external module discovery (#917). Kept out of node.ts so
// the browser entry (index.ts) and the pure reconcile step can import them too.
import type { JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

/** A validated, on-disk external module: its metadata-only manifest + content hashes. */
export interface ExternalModuleDiscovery {
  readonly id: string;
  readonly dir: string;
  readonly manifest: JsonJarvisModuleManifest;
  readonly manifestHash: string;
  readonly packageHash: string;
}

/** A directory under the modules root that was NOT loaded, with a human-readable reason. */
export interface ExternalModuleRejection {
  readonly id: string;
  readonly reason: string;
}

export interface ExternalModuleLoadResult {
  readonly discoveries: readonly ExternalModuleDiscovery[];
  readonly rejected: readonly ExternalModuleRejection[];
}

/** One persisted app.external_modules row, narrowed to what reconcile needs (#917). */
export interface ExternalModuleStateInput {
  readonly id: string;
  readonly status: "enabled" | "disabled";
  readonly packageHash: string | null;
  readonly disabledReason: string | null;
}

/** 'discovered' is virtual — it means "on disk, no DB row". Only enabled/disabled persist. */
export type ExternalModuleStatus = "discovered" | "enabled" | "disabled";

export interface ReconciledExternalModule {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly status: ExternalModuleStatus;
  readonly active: boolean;
  readonly drifted: boolean;
  readonly disabledReason: string | null;
  /** Web contribution declared by the manifest, or null when the module has no web surface (#918). */
  readonly web: { readonly entrypoint: string; readonly contractVersion: number } | null;
}

export interface ExternalReconcileResult {
  readonly modules: ReconciledExternalModule[];
  readonly driftDisable: Array<{ id: string; reason: string }>;
}
