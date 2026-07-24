// #1232 — external web code delegates every React call to the host runtime.
export type ReactNodeLike = unknown;

type Dispatch<S> = (next: S | ((prev: S) => S)) => void;

export type HostReact = {
  createElement: (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => ReactNodeLike;
  Fragment: unknown;
  useState: <S>(initial: S | (() => S)) => [S, Dispatch<S>];
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
  useCallback: <T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]) => T;
  useRef: <T>(initial: T) => { current: T };
  useSyncExternalStore: <T>(
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T
  ) => T;
};

type ModuleRuntime = { contractVersion: number; react: HostReact };

function readRuntime(): ModuleRuntime {
  const runtime = (globalThis as { __JARVIS_MODULE_RUNTIME__?: ModuleRuntime })
    .__JARVIS_MODULE_RUNTIME__;
  if (!runtime || runtime.contractVersion !== 1) {
    throw new Error("job-search web root requires the Jarvis module runtime v1");
  }
  return runtime;
}

export const react: HostReact = readRuntime().react;
export const h: HostReact["createElement"] = (type, props, ...children) =>
  react.createElement(type, props, ...children);
export const Fragment: unknown = react.Fragment;
export const useState = react.useState;
export const useEffect = react.useEffect;
export const useCallback = react.useCallback;
export const useRef = react.useRef;
export const useSyncExternalStore = react.useSyncExternalStore;
