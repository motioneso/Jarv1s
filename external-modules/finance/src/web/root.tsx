// external-modules/finance/src/web/root.tsx
// FIN-02 (#1147) Task 11: module Root — chrome (eyebrow + heading), one polite
// live region for the whole surface. FIN-03 (#1148) Task 4 adds the in-module
// router (job-search idiom): Feed at "/", Budget at "/budget"; jds-*
// primitives + layout-only fnm-* styles.
import { ModuleLink, useModulePath } from "./router";
import { h, useSyncExternalStore, type ReactNodeLike } from "./runtime";
import { BudgetScreen } from "./screens/budget";
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

const TABS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Feed" },
  { to: "/budget", label: "Budget" }
];

export function Root(props: { hostActions: HostActions }): ReactNodeLike {
  const path = useModulePath();
  return (
    <div className="fnm-root" data-module="finance">
      <style>{MODULE_STYLES}</style>
      <LiveRegion />
      <header className="fnm-header">
        <span className="jds-eyebrow">Module</span>
        <h1>Finance</h1>
      </header>
      <nav className="fnm-chips" aria-label="Finance sections">
        {TABS.map((tab) => (
          <ModuleLink
            key={tab.to}
            to={tab.to}
            className={`jds-btn jds-btn--sm ${path === tab.to ? "jds-btn--secondary" : "jds-btn--ghost"}`}
            aria-current={path === tab.to ? "page" : undefined}
          >
            {tab.label}
          </ModuleLink>
        ))}
      </nav>
      {path === "/budget" ? <BudgetScreen /> : <FeedScreen hostActions={props.hostActions} />}
    </div>
  );
}
