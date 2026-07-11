// external-modules/job-search/src/web/router.ts
// JS-06 (#935): the host exposes no react-router on the runtime global, so the
// Root owns a minimal pushState router under the fixed /m/job-search base. The
// host's /m/:moduleId/* route keeps matching for every internal path, and the
// browser back button works because the host re-renders on popstate.
import { h, useCallback, useSyncExternalStore, type ReactNodeLike } from "./runtime";

export const MODULE_BASE = "/m/job-search";

export function parseModulePath(pathname: string): string {
  if (pathname !== MODULE_BASE && !pathname.startsWith(`${MODULE_BASE}/`)) return "/";
  const rest = pathname.slice(MODULE_BASE.length);
  return rest === "" || rest === "/" ? "/" : rest;
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function navigate(to: string): void {
  if (typeof window === "undefined") return;
  window.history.pushState({}, "", `${MODULE_BASE}${to === "/" ? "" : to}`);
  notify();
}

function subscribeToPath(onChange: () => void): () => void {
  listeners.add(onChange);
  if (typeof window !== "undefined") window.addEventListener("popstate", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("popstate", onChange);
  };
}

function currentPath(): string {
  return typeof window === "undefined" ? "/" : parseModulePath(window.location.pathname);
}

export function useModulePath(): string {
  return useSyncExternalStore(subscribeToPath, currentPath, currentPath);
}

export function ModuleLink(props: {
  to: string;
  className?: string;
  "aria-current"?: string;
  children?: unknown;
}): ReactNodeLike {
  const { to, children, ...rest } = props;
  const onClick = useCallback(
    (event: { preventDefault: () => void; metaKey?: boolean; ctrlKey?: boolean }) => {
      // Let modifier-clicks open a real tab; plain clicks stay in-app.
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      navigate(to);
    },
    [to]
  );
  return h("a", { href: `${MODULE_BASE}${to === "/" ? "" : to}`, onClick, ...rest }, children);
}
