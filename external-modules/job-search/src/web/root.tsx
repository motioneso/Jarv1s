import { Landing } from "./landing";
import { OnboardingScreen, type AssistantSurfaceHandle } from "./onboarding";
import { useModulePath } from "./router";
import { h, type ReactNodeLike } from "./runtime";
import { MODULE_STYLES } from "./styles";

export type HostActions = { readonly openAssistant: (input: { starterPrompt: string }) => void };

export function Root(props: {
  hostActions: HostActions;
  assistantSurface?: AssistantSurfaceHandle;
}): ReactNodeLike {
  const path = useModulePath();
  return (
    <div className="jsn-root" data-module="job-search">
      <style>{MODULE_STYLES}</style>
      {path === "/" ? (
        <Landing />
      ) : path === "/onboarding" ? (
        <OnboardingScreen assistantSurface={props.assistantSurface} />
      ) : (
        <div className="jsn-skeleton jsn-skeleton--line" role="status" />
      )}
    </div>
  );
}
