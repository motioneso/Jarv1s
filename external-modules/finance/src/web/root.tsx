// external-modules/finance/src/web/root.tsx
// FIN-02 (#1147) Task 11: module Root — chrome (eyebrow + heading), one polite
// live region for the whole surface, and the transaction feed. Single nav path
// ("/"), so no router; jds-* primitives + layout-only fnm-* styles.
import { h, useSyncExternalStore, type ReactNodeLike } from "./runtime";
import { FeedScreen } from "./screens/feed";
import { currentLiveMessage, subscribeLive } from "./states";
import { MODULE_STYLES } from "./styles";

export type HostActions = { openAssistant: (input: { starterPrompt: string }) => void };

// One aria-live region at the root: queue-run confirmations and poll-loop
// outcomes announce here so screen readers hear async results without focus
// moves (job-search precedent).
function LiveRegion(): ReactNodeLike {
  const message = useSyncExternalStore(subscribeLive, currentLiveMessage, currentLiveMessage);
  return (
    <div aria-live="polite" role="status" className="fnm-visually-hidden">
      {message}
    </div>
  );
}

export function Root(props: { hostActions: HostActions }): ReactNodeLike {
  return (
    <div className="fnm-root" data-module="finance">
      <style>{MODULE_STYLES}</style>
      <LiveRegion />
      <header className="fnm-header">
        <span className="jds-eyebrow">Module</span>
        <h1>Finance</h1>
      </header>
      <FeedScreen hostActions={props.hostActions} />
    </div>
  );
}
