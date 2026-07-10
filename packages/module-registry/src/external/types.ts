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
