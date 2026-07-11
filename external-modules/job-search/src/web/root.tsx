// external-modules/job-search/src/web/root.tsx
// JS-06 (#935): the external Root. Owns internal routing (host exposes no
// react-router), a single polite live region, and the module chrome. Renders
// entirely from jds-* primitives + layout-only jsm-* styles.
import { h, useSyncExternalStore, type ReactNodeLike } from "./runtime";
import { ModuleLink, useModulePath } from "./router";
import { MODULE_STYLES } from "./styles";
import { currentLiveMessage, subscribeLive } from "./states";
import { OverviewScreen } from "./screens/overview";
import { OnboardingScreen } from "./screens/onboarding";
import { ProfileScreen } from "./screens/profile";
import { MonitorsScreen } from "./screens/monitors";
import { OpportunitiesScreen } from "./screens/opportunities";

export type HostActions = { openAssistant: (input: { starterPrompt: string }) => void };

const TABS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Overview" },
  { to: "/onboarding", label: "Onboarding" },
  { to: "/profile", label: "Profile & resume" },
  { to: "/monitors", label: "Monitors" },
  { to: "/opportunities", label: "Opportunities" }
];

function activeTab(path: string): string {
  if (path === "/") return "/";
  const first = `/${path.split("/")[1] ?? ""}`;
  return TABS.some((tab) => tab.to === first) ? first : "/";
}

function LiveRegion(): ReactNodeLike {
  const message = useSyncExternalStore(subscribeLive, currentLiveMessage, currentLiveMessage);
  return (
    <div aria-live="polite" role="status" className="jsm-visually-hidden">
      {message}
    </div>
  );
}

function RouteSwitch(props: { path: string; hostActions: HostActions }): ReactNodeLike {
  const tab = activeTab(props.path);
  if (tab === "/onboarding") return <OnboardingScreen hostActions={props.hostActions} />;
  if (tab === "/profile") return <ProfileScreen hostActions={props.hostActions} />;
  if (tab === "/monitors") return <MonitorsScreen />;
  if (tab === "/opportunities") return <OpportunitiesScreen path={props.path} />;
  return <OverviewScreen hostActions={props.hostActions} />;
}

export function Root(props: { hostActions: HostActions }): ReactNodeLike {
  const path = useModulePath();
  const current = activeTab(path);
  return (
    <div className="jsm-root" data-module="job-search">
      <style>{MODULE_STYLES}</style>
      <LiveRegion />
      <header className="jsm-header">
        <span className="jds-eyebrow">Module</span>
        <h1>Job Search</h1>
      </header>
      <nav className="jsm-nav" aria-label="Job Search sections">
        {TABS.map((tab) => (
          <ModuleLink
            key={tab.to}
            to={tab.to}
            className={`jds-btn jds-btn--ghost jds-btn--sm${current === tab.to ? " jds-btn--secondary" : ""}`}
            aria-current={current === tab.to ? "page" : undefined}
          >
            {tab.label}
          </ModuleLink>
        ))}
      </nav>
      <RouteSwitch path={path} hostActions={props.hostActions} />
    </div>
  );
}
