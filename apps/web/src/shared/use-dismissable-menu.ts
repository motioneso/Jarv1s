import { useEffect, useRef, type RefObject } from "react";

export function isOutsideTarget(container: Element | null, target: EventTarget | null): boolean {
  if (!container) return true;
  // Duck-typed Node check (not `instanceof Node`): this repo's Vitest runs in a node
  // environment with no DOM globals, and `instanceof Node` would throw ReferenceError there.
  const node = target as { readonly nodeType?: unknown } | null;
  if (!node || typeof node.nodeType !== "number") return true;
  return !container.contains(target as unknown as Node);
}

/**
 * Shared outside-pointerdown + Escape dismiss behavior for popover-style menus.
 * Does NOT return focus to the trigger element — the caller owns the trigger
 * ref and must call `.focus()` on it from `onClose` if that's desired.
 */
export function useDismissableMenu<T extends HTMLElement>(opts: {
  readonly open: boolean;
  readonly onClose: () => void;
}): { readonly ref: RefObject<T | null> } {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!opts.open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (isOutsideTarget(ref.current, event.target)) opts.onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") opts.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [opts.open, opts.onClose]);

  return { ref };
}
