// external-modules/job-search/src/web/root.tsx
// Task 18 (#1302): the module's web entrypoint. Owns the empty-install bootstrap handoff, the
// enqueue latch, and the onboarding/board branch — the two branches themselves are intentionally
// minimal placeholders for Tasks 19 (onboarding) and 20 (board) to replace.
//
// No chat button lives here (variant-flow.tsx:145's drawer button is prototype-only and must not
// be ported) — the only way into the assistant from this surface is hostActions.openAssistant,
// which drops an editable, unsent draft into the host composer (the consent boundary, ledger H5).
import { Fragment, h, useCallback, useEffect, useState, type ReactNodeLike } from "./runtime";
import { runQueue, type RunOutcome } from "./api";
import { isLatched, setLatched } from "./latch";
import { useProfiles, type Profile } from "./use-profiles";
import styles from "./styles.css";

export interface HostActions {
  actorScopeKey: string;
  openAssistant(input: { starterPrompt: string }): void;
}

export interface RootProps {
  hostActions: HostActions;
  // Task 17 owns binding an assistant surface handle; Task 18 doesn't read it.
  assistantSurface?: unknown;
}

const BOOTSTRAP_PROMPT =
  "Let's set up my job search profile — I'll tell you what kind of roles I'm looking for.";

function LoadingPanel(): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
      <span className="jds-eyebrow">Job search</span>
      <p>Loading your job search…</p>
    </div>
  );
}

type BootstrapPhase = "idle" | "waiting" | "expired";

function BootstrapPanel(props: {
  phase: BootstrapPhase;
  onStart(): void;
  onRetry(): void;
}): ReactNodeLike {
  if (props.phase === "waiting") {
    return (
      <div className="jds-card jds-card--sunken jsm-state" role="status">
        <span className="jds-eyebrow">Job search</span>
        <p>Setting up your job search profile…</p>
      </div>
    );
  }
  if (props.phase === "expired") {
    return (
      <div className="jds-card jds-card--sunken jsm-state" role="status">
        <span className="jds-eyebrow">Job search</span>
        <p>Still setting up?</p>
        <button type="button" className="jds-btn jds-btn--primary" onClick={props.onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="jds-card jds-card--sunken jsm-state">
      <span className="jds-eyebrow">Job search</span>
      <p>Find roles that match what you're looking for.</p>
      <button type="button" className="jds-btn jds-btn--primary" onClick={props.onStart}>
        Start your job search
      </button>
    </div>
  );
}

// Placeholder for Task 19: rendered while a profile has no criteria yet
// (state === "in_conversation" — briefing not complete, readyToCrawl false).
function OnboardingPlaceholder(props: { profile: Profile }): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state">
      <span className="jds-eyebrow">Job search</span>
      <p>Finishing setup for {props.profile.name}…</p>
    </div>
  );
}

// Placeholder for Task 20: rendered once a profile has criteria (state ===
// "active" | "paused"). The switcher is real (Task 18 owns selection), the
// table body is a stand-in for the real board.
function BoardPlaceholder(props: {
  profiles: Profile[];
  selectedId: string;
  onSelect(id: string): void;
}): ReactNodeLike {
  const switcher =
    props.profiles.length > 1 ? (
      <div className="jsm-switcher" role="tablist">
        {props.profiles.map((profile) => (
          <button
            key={profile.profileId}
            type="button"
            role="tab"
            aria-selected={profile.profileId === props.selectedId}
            className={
              profile.profileId === props.selectedId
                ? "jds-btn jds-btn--secondary jsm-switcher-btn is-selected"
                : "jds-btn jds-btn--secondary jsm-switcher-btn"
            }
            onClick={() => props.onSelect(profile.profileId)}
          >
            {profile.name}
          </button>
        ))}
      </div>
    ) : null;
  const table = (
    <table className="jds-table jsm-board">
      <thead>
        <tr>
          <th>Job search</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Your board is being built out in an upcoming task.</td>
        </tr>
      </tbody>
    </table>
  );
  // Plain h(Fragment, ...) call rather than <>...</> shorthand: TS's JSX
  // fragment-shorthand check requires the fragment factory to have a
  // call/construct signature, which our loosely-typed `Fragment: unknown`
  // (jsx.d.ts's "correctness via tests, not the type system" stance) doesn't
  // satisfy. A direct call sidesteps that JSX-syntax-only check.
  return h(Fragment, null, switcher, table);
}

function QueueNotice(props: { outcome: RunOutcome }): ReactNodeLike {
  const outcome = props.outcome;
  if (outcome.kind === "queued" || outcome.kind === "already-queued") {
    return (
      <p className="jsm-queue-notice" role="status">
        A search run has been queued.
      </p>
    );
  }
  if (outcome.kind === "disabled") {
    return (
      <p className="jsm-queue-notice" role="status">
        Manual search runs are turned off for this account.
      </p>
    );
  }
  return (
    <p className="jsm-queue-notice" role="alert">
      Couldn't queue a search run: {outcome.message}
    </p>
  );
}

export function Root(props: RootProps): ReactNodeLike {
  const { hostActions } = props;
  const [phase, setPhase] = useState<BootstrapPhase>("idle");
  const [pollArmed, setPollArmed] = useState(false);
  const [queueNotice, setQueueNotice] = useState<RunOutcome | null>(null);

  // Root owns the latch (bound split: the hook has no actorScopeKey) and the
  // armed/expired UI; the hook owns only fetch + timing (bounds 1-4).
  const onPollExpired = useCallback(() => {
    setPollArmed(false);
    setPhase("expired");
  }, []);

  const profiles = useProfiles({ pollArmed, onPollExpired });

  // Enqueue exactly one crawl.run per profile that arrives "active" and isn't
  // already latched for this actor+profile. in_conversation and paused never
  // enqueue (bound: paused is a deliberate user pause, not a stall).
  useEffect(() => {
    if (profiles.status !== "ready") return;
    for (const profile of profiles.profiles) {
      if (profile.state !== "active") continue;
      if (isLatched(hostActions.actorScopeKey, profile.profileId)) continue;
      // Set the latch before the request resolves so a fast refetch (or
      // StrictMode double-invoke) can't race a second enqueue.
      setLatched(hostActions.actorScopeKey, profile.profileId);
      runQueue("job-search.crawl-run", "crawl.run", { profileId: profile.profileId })
        .then(setQueueNotice)
        .catch(() => setQueueNotice({ kind: "error", message: "Network error" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, hostActions.actorScopeKey]);

  function handleStart(): void {
    hostActions.openAssistant({ starterPrompt: BOOTSTRAP_PROMPT });
    setPollArmed(true);
    setPhase("waiting");
  }

  function handleRetry(): void {
    setPollArmed(true);
    setPhase("waiting");
  }

  let body: ReactNodeLike;
  if (profiles.status === "loading") {
    body = <LoadingPanel />;
  } else if (profiles.status === "empty") {
    body = <BootstrapPanel phase={phase} onStart={handleStart} onRetry={handleRetry} />;
  } else {
    const selected =
      profiles.profiles.find((p) => p.profileId === profiles.selectedId) ?? profiles.profiles[0];
    body =
      selected.state === "in_conversation" ? (
        <OnboardingPlaceholder profile={selected} />
      ) : (
        <BoardPlaceholder
          profiles={profiles.profiles}
          selectedId={profiles.selectedId}
          onSelect={profiles.select}
        />
      );
  }

  // Plain h(Fragment, ...) call — see BoardPlaceholder's comment on why the
  // <>...</> shorthand doesn't typecheck against our loosely-typed Fragment.
  return h(
    Fragment,
    null,
    <style>{styles}</style>,
    <div className="jsm-root">
      <div className="jsm-header">
        <span className="jds-eyebrow">Job search</span>
      </div>
      {queueNotice ? <QueueNotice outcome={queueNotice} /> : null}
      {body}
    </div>
  );
}
