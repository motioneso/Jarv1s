import { emitVirtualModule, scanModuleSettings } from "./scanner.js";

export { emitVirtualModule, scanModuleSettings };

export function jarvisModuleSettingsPlugin(options: { readonly rootDir?: string } = {}) {
  const virtualId = "virtual:jarvis-module-settings";
  const resolvedId = `\0${virtualId}`;

  return {
    name: "jarvis-module-settings",
    resolveId(id: string) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(this: { addWatchFile?: (file: string) => void }, id: string) {
      if (id !== resolvedId) return undefined;
      const result = scanModuleSettings({ rootDir: options.rootDir ?? process.cwd() });
      for (const file of result.manifestFiles) this.addWatchFile?.(file);
      return emitVirtualModule(result);
    }
  };
}
