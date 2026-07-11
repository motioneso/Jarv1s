// external-modules/job-search/src/web/index.ts
// JS-01 (#930): placeholder web root proving the external web contract v1.
// The bundle must never carry its own React — the host exposes its instance on
// the frozen global (see apps/web external-modules loader). We read the global
// directly instead of importing "react" so the browser bundle stays react-free
// by construction; later JS slices can move to an esbuild react-shim alias when
// real components need hooks/JSX.
type HostReact = {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown;
};

type ModuleRuntime = { react: HostReact };

function hostReact(): HostReact {
  const runtime = (globalThis as { __JARVIS_MODULE_RUNTIME__?: ModuleRuntime })
    .__JARVIS_MODULE_RUNTIME__;
  if (!runtime) throw new Error("job-search web root requires the Jarvis module runtime");
  return runtime.react;
}

function Root(): unknown {
  const react = hostReact();
  return react.createElement(
    "section",
    { "data-module": "job-search" },
    react.createElement("h1", null, "Job Search"),
    react.createElement("p", null, "Module installed. Feature slices arrive in later releases.")
  );
}

export default { contractVersion: 1, Root };
