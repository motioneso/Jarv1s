import { useEffect } from "react";
import { useLocation } from "react-router";
import { updatePageContext } from "../api/client.js";
import { capturePageContextSnapshot } from "./page-context.js";

const SYNC_DEBOUNCE_MS = 250;

export function createDebouncedPageContextSync(input: {
  readonly capture: typeof capturePageContextSnapshot;
  readonly upload: typeof updatePageContext;
  readonly delayMs: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => void input.upload(input.capture()).catch(() => undefined),
        input.delayMs
      );
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    }
  };
}

/**
 * #1109 — replaces the per-turn `<page_context>` push (deleted in Task 5): the client keeps the
 * server's live-view snapshot current independent of chat activity, debounced so route changes,
 * DOM mutations, focus, and selection changes don't each fire a request.
 */
export function usePageContextSync(): void {
  const location = useLocation();
  useEffect(() => {
    const sync = createDebouncedPageContextSync({
      capture: capturePageContextSnapshot,
      upload: updatePageContext,
      delayMs: SYNC_DEBOUNCE_MS
    });
    const observer = new MutationObserver(sync.schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("focusin", sync.schedule);
    document.addEventListener("selectionchange", sync.schedule);
    sync.schedule();
    return () => {
      sync.stop();
      observer.disconnect();
      document.removeEventListener("focusin", sync.schedule);
      document.removeEventListener("selectionchange", sync.schedule);
    };
  }, [location.pathname, location.search]);
}
