import { Fragment, lazy, Suspense, type ReactNode } from "react";
import { MODULE_WEB_CONTRIBUTIONS } from "virtual:jarvis-module-web";

/**
 * Generic Today-widget docking (#799 module-web-registry Phase A).
 *
 * Replaces the old hardcoded `SportsDesk` render path in `today-page.tsx`: any module that
 * declares a `./web` contribution with `todayWidgets` now renders on Today automatically,
 * without this file needing per-module knowledge. Each module's contribution is lazily loaded
 * once (stable `lazy()` identity, computed at module scope from the static
 * `virtual:jarvis-module-web` scan) and wrapped in its own `<Suspense fallback={null}>` boundary
 * so one module's load never blocks another's.
 */
const widgetComponents = MODULE_WEB_CONTRIBUTIONS.map((entry) => ({
  moduleId: entry.moduleId,
  Component: lazy(async () => {
    const contribution = (await entry.load()).default;
    const widgets = contribution.todayWidgets ?? [];
    return {
      default: () => (
        <>
          {widgets.map((widget, index) => (
            <Fragment key={`${widget.slot}-${index}`}>{widget.element}</Fragment>
          ))}
        </>
      )
    };
  })
}));

export function ModuleTodayWidgets(props: {
  readonly disabledModuleIds: readonly string[];
}): ReactNode {
  const disabled = new Set(props.disabledModuleIds);
  return (
    <>
      {widgetComponents
        .filter((widget) => !disabled.has(widget.moduleId))
        .map(({ moduleId, Component }) => (
          <Suspense key={moduleId} fallback={null}>
            <Component />
          </Suspense>
        ))}
    </>
  );
}
