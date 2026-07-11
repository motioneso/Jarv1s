// external-modules/job-search/src/web/states.tsx
// JS-06 (#935): authored loading/empty/error/disabled/degraded states shared
// by every route (spec: every route has all five). Text-only — no icons, no
// animation, so prefers-reduced-motion needs no special casing.
import { Fragment, h, type ReactNodeLike } from "./runtime";
import type { QuerySnapshot } from "./store";

export function LoadingState(props: { label: string }): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">Loading</span>
      <p>{props.label}…</p>
    </div>
  );
}

export function EmptyState(props: {
  title: string;
  body: string;
  action?: ReactNodeLike;
}): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state">
      <span className="jds-eyebrow">Nothing here yet</span>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      {props.action ?? null}
    </div>
  );
}

export function ErrorState(props: { message: string }): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="alert">
      <span className="jds-eyebrow">Something went wrong</span>
      <p>{props.message}</p>
    </div>
  );
}

// Disable removes actions without deleting data (spec): fixed copy, no buttons,
// no assistant handoff from a disabled surface.
export function DisabledState(): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">Module off</span>
      <h2>Job Search is turned off</h2>
      <p>
        This module was disabled on the server. Your data is preserved; an administrator can
        re-enable it under Settings.
      </p>
    </div>
  );
}

export function DegradedState(props: { detail: string }): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">Partially unavailable</span>
      <p>{props.detail}</p>
    </div>
  );
}

// Shared render ladder: every screen funnels its query snapshot through this
// so the five authored states are consistent across routes.
export function outcomeGate<T extends Record<string, unknown>>(
  snapshot: QuerySnapshot<T>,
  render: (result: T) => ReactNodeLike,
  opts?: { loadingLabel?: string }
): ReactNodeLike {
  if (snapshot.status === "loading") {
    return <LoadingState label={opts?.loadingLabel ?? "Loading"} />;
  }
  const outcome = snapshot.outcome;
  if (outcome.kind === "disabled") return <DisabledState />;
  if (outcome.kind === "blocked") {
    return <DegradedState detail="This data needs confirmation in the assistant." />;
  }
  if (outcome.kind === "error") return <ErrorState message={outcome.message} />;
  const status = (outcome.result as { status?: unknown }).status;
  if (status === "error") {
    return <DegradedState detail="This section could not load safely. Try again later." />;
  }
  // Direct h() call: Fragment is typed unknown (host-provided), which JSX
  // element positions reject; createElement accepts it fine.
  return h(Fragment, null, render(outcome.result));
}

// Tiny aria-live announcer: run-now and similar async outcomes push a message
// here; the Root renders one polite live region for the whole surface.
const liveListeners = new Set<() => void>();
let liveMessage = "";

export function announce(message: string): void {
  liveMessage = message;
  for (const listener of liveListeners) listener();
}

export function subscribeLive(onChange: () => void): () => void {
  liveListeners.add(onChange);
  return () => {
    liveListeners.delete(onChange);
  };
}

export function currentLiveMessage(): string {
  return liveMessage;
}
