import { CORE_VERSION, satisfiesCoreVersion, type JarvisModuleManifest } from "@jarv1s/module-sdk";

/**
 * Validate-then-enable at the composition root (ADR 0009 §3): refuse to wire any
 * built-in whose compatibility.jarv1s range does not admit CORE_VERSION, BEFORE its
 * routes/workers/tools register (the module's code never executes if it is rejected).
 *
 * Also asserts the deny-only store's precondition: every built-in must be
 * defaultEnabled:true. A defaultEnabled:false module would need an allow-row
 * mechanism the deny-only store does not provide (out of scope — see the spec),
 * so it is rejected here rather than silently mis-resolved.
 */
export function assertModulesCompatible(manifests: readonly JarvisModuleManifest[]): void {
  for (const manifest of manifests) {
    const range = manifest.compatibility.jarv1s;
    if (!satisfiesCoreVersion(range)) {
      throw new Error(
        `Module "${manifest.id}" declares compatibility.jarv1s "${range}", which is not ` +
          `compatible with platform CORE_VERSION ${CORE_VERSION}. Refusing to register it.`
      );
    }
    if (manifest.availability?.defaultEnabled !== true) {
      throw new Error(
        `Module "${manifest.id}" must declare availability.defaultEnabled: true. The module ` +
          `enablement store is deny-only; defaultEnabled:false (allow-list semantics) is out of scope.`
      );
    }
  }
}
