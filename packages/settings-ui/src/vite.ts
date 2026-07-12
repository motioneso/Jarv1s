import {
  emitVirtualModule,
  emitWebVirtualModule,
  scanModuleSettings,
  scanModuleWeb,
  SHELL_RESERVED_WEB_PATHS
} from "./scanner.ts";

export {
  emitVirtualModule,
  emitWebVirtualModule,
  scanModuleSettings,
  scanModuleWeb,
  SHELL_RESERVED_WEB_PATHS
};

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

export function jarvisModuleWebPlugin(options: { readonly rootDir?: string } = {}) {
  const virtualId = "virtual:jarvis-module-web";
  const resolvedId = `\0${virtualId}`;

  return {
    name: "jarvis-module-web",
    resolveId(id: string) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(this: { addWatchFile?: (file: string) => void }, id: string) {
      if (id !== resolvedId) return undefined;
      const result = scanModuleWeb({ rootDir: options.rootDir ?? process.cwd() });
      for (const file of result.manifestFiles) this.addWatchFile?.(file);
      return emitWebVirtualModule(result);
    }
  };
}
