// external-modules/job-search/src/web/root.tsx
// JS-06 (#935): the external Root. Owns internal routing (host exposes no
// react-router), a single polite live region, and the module chrome. Renders
// entirely from jds-* primitives + layout-only jsm-* styles.
import { h, useSyncExternalStore, type ReactNodeLike } from "./runtime";
import { ModuleLink, useModulePath } from "./router";
import { MODULE_STYLES } from "./styles";
import { currentLiveMessage, outcomeGate, subscribeLive } from "./states";
import { useToolQuery } from "./store";
import { OverviewScreen } from "./screens/overview";
import { ProfileScreen } from "./screens/profile";
import { MonitorsScreen } from "./screens/monitors";
import { MatchesScreen } from "./screens/matches";

export type HostActions = { openAssistant: (input: { starterPrompt: string }) => void };

const TABS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/", label: "Overview" },
  { to: "/matches", label: "Matches" },
  { to: "/monitors", label: "Monitors" },
  { to: "/profile", label: "Profile" }
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
  if (tab === "/matches") {
    return <MatchesScreen path={props.path} hostActions={props.hostActions} />;
  }
  if (tab === "/monitors") return <MonitorsScreen />;
  if (tab === "/profile") return <ProfileScreen hostActions={props.hostActions} />;
  return <OverviewScreen hostActions={props.hostActions} />;
}

function FirstRunPlaceholder(): ReactNodeLike {
  return (
    <section className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">First run</span>
      <h1>Setting up your job search</h1>
      {/* #1193/#1197: Lane E replaces this dependency-safe placeholder with JobsOnboarding. */}
      <p>Guided onboarding will appear here.</p>
    </section>
  );
}

export function RootView(props: {
  path: string;
  onboardingStep: string;
  hostActions: HostActions;
}): ReactNodeLike {
  if (props.onboardingStep !== "done") {
    return (
      <div className="jsm-root" data-module="job-search">
        <style>{MODULE_STYLES}</style>
        <LiveRegion />
        <FirstRunPlaceholder />
      </div>
    );
  }

  const current = activeTab(props.path);
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
      <RouteSwitch path={props.path} hostActions={props.hostActions} />
    </div>
  );
}

export function Root(props: { hostActions: HostActions }): ReactNodeLike {
  const path = useModulePath();
  const onboarding = useToolQuery<{ step: string } & Record<string, unknown>>(
    "job-search.onboarding.get-state"
  );
  return outcomeGate(
    onboarding,
    (state) => <RootView path={path} onboardingStep={state.step} hostActions={props.hostActions} />,
    { loadingLabel: "Loading job search" }
  );
}
