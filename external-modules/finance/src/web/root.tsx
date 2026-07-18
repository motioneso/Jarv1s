// external-modules/finance/src/web/root.tsx
// FIN-02 (#1147) Task 8: skeleton Root — module chrome only, rendered from
// jds-* primitives + layout-only fnm-* styles. Task 11 replaces the placeholder
// state with the real transaction feed (month nav, account/category filters,
// categorize actions).
import { h, type ReactNodeLike } from "./runtime";
import { MODULE_STYLES } from "./styles";

export type HostActions = { openAssistant: (input: { starterPrompt: string }) => void };

export function Root(_props: { hostActions: HostActions }): ReactNodeLike {
  return (
    <div className="fnm-root" data-module="finance">
      <style>{MODULE_STYLES}</style>
      <header className="fnm-header">
        <span className="jds-eyebrow">Module</span>
        <h1>Finance</h1>
      </header>
      <div className="fnm-state jds-card">
        <p>The transaction feed lands in the next slice.</p>
      </div>
    </div>
  );
}
