// packages/module-web-sdk/src/react-dom-runtime.ts
// #1388 Foundation: esbuild `alias` target for the bare "react-dom"/"react-dom/client"
// specifiers (scripts/build-external-module.ts) — mirrors runtime.ts's "react" shim so a
// module bundle never carries its own react-dom copy even if some dependency imports it
// directly. No module currently renders its own root (the host mounts each Root via
// apps/web/src/external-modules/loader.ts's own react-dom/client instance), so this is
// unused today; it exists so the alias has a resolvable target per the Foundation spec.
type ModuleRuntime = { contractVersion: number; reactDomClient: unknown };

function readRuntime(): ModuleRuntime {
  const runtime = (globalThis as { __JARVIS_MODULE_RUNTIME__?: ModuleRuntime })
    .__JARVIS_MODULE_RUNTIME__;
  if (!runtime || runtime.contractVersion !== 2) {
    throw new Error("module-web-sdk runtime shim requires the Moss module runtime v2");
  }
  return runtime;
}

const reactDomClient = readRuntime().reactDomClient as {
  createRoot: (...args: never[]) => unknown;
  hydrateRoot: (...args: never[]) => unknown;
};

export const createRoot = reactDomClient.createRoot;
export const hydrateRoot = reactDomClient.hydrateRoot;

export default reactDomClient;
