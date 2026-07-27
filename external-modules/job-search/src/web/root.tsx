// external-modules/job-search/src/web/root.tsx
// Task 18 (#1302): the module's web entrypoint. Owns the empty-install bootstrap handoff, the
// enqueue latch, and the onboarding/board branch. The onboarding branch renders the real
// screen (Task 19, ./screens/onboarding.tsx); the board branch (Task 20, #1304) now renders
// the real BoardScreen/Inspector and SettingsScreen behind a Board/Settings tab switcher —
// this file is the sole place both halves of Task 20 are wired in (rulings ledger N32: root.tsx
// stays one agent's file for the whole task, so chat-surface wires in criteria's settings.tsx
// too rather than criteria touching this file directly).
//
// No chat button lives here (variant-flow.tsx:145's drawer button is prototype-only and must not
// be ported) — the only way into the assistant from this surface is hostActions.openAssistant,
// which drops an editable, unsent draft into the host composer (the consent boundary, ledger H5).
import { Fragment, h, useCallback, useEffect, useState, type ReactNodeLike } from "./runtime";
import { runQueue, type RunOutcome } from "./api";
import { isLatched, setLatched } from "./latch";
import { useProfiles, type Profile } from "./use-profiles";
import { useProfileThread, type AssistantSurfaceHandleV1 } from "../domain/seed-prompt.js";
import { OnboardingScreen } from "./screens/onboarding";
import { BoardScreen } from "./screens/board";
import { SettingsScreen } from "./screens/settings";
import styles from "./styles.css";

export interface HostActions {
  actorScopeKey: string;
  openAssistant(input: { starterPrompt: string }): void;
}

export interface RootProps {
  hostActions: HostActions;
  // #1284/Task 17: optional only so a v1.1 module bundle can fail closed on an older host
  // (mirrors ExternalWebContributionProps's own optionality). Root is the sole caller of
  // useProfileThread — see that function's header for why the binding effect lives here rather
  // than inside useProfiles (root.test.tsx mocks the whole use-profiles module, so logic buried
  // inside that hook would be untestable from here).
  assistantSurface?: AssistantSurfaceHandleV1;
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

type ActiveView = "board" | "settings";

// Rendered once a profile has criteria (state === "active" | "paused"). Two independent
// switchers stack here: the profile switcher (Task 18, picks which profile's data loads) and
// the Board/Settings view switcher (Task 20, picks which screen renders that data) — kept as
// separate pieces of state so switching one never resets the other.
function ActiveProfilePanel(props: {
  profiles: Profile[];
  selectedId: string;
  onSelectProfile(id: string): void;
  selected: Profile;
}): ReactNodeLike {
  const [view, setView] = useState<ActiveView>("board");

  const profileSwitcher =
    props.profiles.length > 1 ? (
      <div className="jsm-switcher" role="tablist" aria-label="Job search profile">
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
            onClick={() => props.onSelectProfile(profile.profileId)}
          >
            {profile.name}
          </button>
        ))}
      </div>
    ) : null;

  const viewSwitcher = (
    <div className="jsm-switcher" role="tablist" aria-label="Job search view">
      <button
        type="button"
        role="tab"
        aria-selected={view === "board"}
        className={
          view === "board"
            ? "jds-btn jds-btn--secondary jsm-switcher-btn is-selected"
            : "jds-btn jds-btn--secondary jsm-switcher-btn"
        }
        onClick={() => setView("board")}
      >
        Board
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "settings"}
        className={
          view === "settings"
            ? "jds-btn jds-btn--secondary jsm-switcher-btn is-selected"
            : "jds-btn jds-btn--secondary jsm-switcher-btn"
        }
        onClick={() => setView("settings")}
      >
        Settings
      </button>
    </div>
  );

  const screen =
    view === "board" ? (
      <BoardScreen profileId={props.selected.profileId} />
    ) : (
      <SettingsScreen profile={props.selected} />
    );

  // Plain h(Fragment, ...) call rather than <>...</> shorthand: TS's JSX
  // fragment-shorthand check requires the fragment factory to have a
  // call/construct signature, which our loosely-typed `Fragment: unknown`
  // (jsx.d.ts's "correctness via tests, not the type system" stance) doesn't
  // satisfy. A direct call sidesteps that JSX-syntax-only check.
  return h(Fragment, null, profileSwitcher, viewSwitcher, screen);
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

  // The profile the rest of Root renders around — same fallback the board branch below already
  // used, hoisted so useProfileThread and the render branch share one derivation instead of two.
  const selectedProfile: Profile | null =
    profiles.status === "ready"
      ? (profiles.profiles.find((p) => p.profileId === profiles.selectedId) ??
        profiles.profiles[0])
      : null;

  // Binds this module's chat surface to whichever profile is selected, and frames it with the
  // seed prompt (Task 17). A no-op whenever the host gave no assistantSurface, or there's no
  // profile yet to bind.
  useProfileThread(props.assistantSurface, selectedProfile);

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
    // Non-null here: profiles.status === "ready" (the only remaining branch) is exactly the
    // condition selectedProfile above was derived under.
    const selected = selectedProfile as Profile;
    body =
      selected.state === "in_conversation" ? (
        <OnboardingScreen profile={selected} />
      ) : (
        <ActiveProfilePanel
          profiles={profiles.profiles}
          selectedId={profiles.selectedId}
          onSelectProfile={profiles.select}
          selected={selected}
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
