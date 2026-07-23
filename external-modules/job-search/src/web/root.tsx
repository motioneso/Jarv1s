import { Landing } from "./landing";
import { useModulePath } from "./router";
import { h, type ReactNodeLike } from "./runtime";
import { MODULE_STYLES } from "./styles";

export type HostActions = { readonly openAssistant: (input: { starterPrompt: string }) => void };

export function Root(props: {
  hostActions: HostActions;
  assistantSurface?: unknown;
}): ReactNodeLike {
  const path = useModulePath();
  return (
    <div className="jsn-root" data-module="job-search">
      <style>{MODULE_STYLES}</style>
      <header className="jsn-module-header">
        <div>
          <span className="jsn-eyebrow">Job Search</span>
          <p>Build a search around the work you want next.</p>
        </div>
      </header>
      {path === "/" ? (
        <Landing />
      ) : (
        <div className="jsn-skeleton jsn-skeleton--line" role="status" />
      )}
    </div>
  );
}
