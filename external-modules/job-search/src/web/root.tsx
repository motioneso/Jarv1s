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
// be ported). The assistant reaches this surface one way only: the onboarding screen renders the
// host's own Surface, bound and framed by useProfileThread. `hostActions.openAssistant` stays on
// the props contract (the host always passes it, and ledger H5's editable-unsent-draft consent
// boundary still governs anything that uses it) but nothing in this module calls it any more —
// the empty state now writes its own first record through the module's queue, see handleStart.
import {
  Fragment,
  h,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNodeLike
} from "./runtime";
import { runQueue, type RunOutcome } from "./api";
import { isLatched, setLatched } from "./latch";
import { useProfiles, type Profile } from "./use-profiles";
import { useProfileThread, type AssistantSurfaceHandleV1 } from "../domain/seed-prompt.js";
import { OnboardingScreen } from "./screens/onboarding";
import { BoardScreen } from "./screens/board";
import { SettingsScreen } from "./screens/settings";
import styles from "./styles.css";

/** How often the profile record is re-read while the interview is still going. Matched to
 * `POLL_INTERVAL_MS` in use-profiles.ts — this is the same kind of wait (a worker write the
 * browser cannot be notified about) and there is no reason for the two to differ. */
const ONBOARDING_REFRESH_MS = 3_000;

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

function LoadingPanel(): ReactNodeLike {
  return (
    <div className="jds-card jds-card--sunken jsm-state" role="status">
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
          <p>Setting up your job search profile…</p>
      </div>
    );
  }
  if (props.phase === "expired") {
    return (
      <div className="jds-card jds-card--sunken jsm-state" role="status">
          <p>Still setting up?</p>
        <button type="button" className="jds-btn jds-btn--primary" onClick={props.onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="jds-card jds-card--sunken jsm-state">
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
  // Task 20/#1304: threaded through to BoardScreen for Discuss, same optionality as everywhere
  // else this handle travels — a v1.1 bundle on an older host still renders the board, just
  // without Discuss offered (discuss.tsx's own no-op-when-absent stance).
  assistantSurface?: AssistantSurfaceHandleV1;
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

  // `jds-tabs`, not two identical secondary buttons: these are two views of one thing, and the
  // design system already draws that — an underline on the selected tab against a shared rule.
  // As buttons they were visually identical apart from a font-weight bump, so nothing on screen
  // said which view you were looking at.
  const viewSwitcher = (
    <div className="jds-tabs" role="tablist" aria-label="Job search view">
      <button
        type="button"
        role="tab"
        aria-selected={view === "board"}
        className="jds-tab"
        onClick={() => setView("board")}
      >
        Board
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "settings"}
        className="jds-tab"
        onClick={() => setView("settings")}
      >
        Settings
      </button>
    </div>
  );

  const screen =
    view === "board" ? (
      <BoardScreen profileId={props.selected.profileId} assistantSurface={props.assistantSurface} />
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
        Searching for new roles — they'll appear below as they're scored.
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

  // A queued run is news for about as long as it takes to read, then it is a stale line sitting at
  // the top of a board that has already filled in. It used to stay there for the whole session —
  // the board showed twenty scored matches under a banner still announcing the search. Failures
  // are not cleared: an error the user never acknowledged should not disappear on a timer.
  useEffect(() => {
    if (queueNotice === null) return;
    if (queueNotice.kind !== "queued" && queueNotice.kind !== "already-queued") return;
    const timer = setTimeout(() => setQueueNotice(null), 12_000);
    return () => clearTimeout(timer);
  }, [queueNotice]);

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
      ? (profiles.profiles.find((p) => p.profileId === profiles.selectedId) ?? profiles.profiles[0])
      : null;

  // Binds this module's chat surface to whichever profile is selected, and frames it with the
  // seed prompt (Task 17). A no-op whenever the host gave no assistantSurface, or there's no
  // profile yet to bind.
  useProfileThread(props.assistantSurface, selectedProfile);

  // Keep the profile record fresh while the interview is still running.
  //
  // `useProfiles`' bounded poll only runs while the list is EMPTY — its whole job is waiting for
  // the bootstrap row to appear, and it stops the moment one does. Everything the interview then
  // writes (the criteria, the enabled board, and the state flip to "active") happens in the worker,
  // behind tool calls this component never sees, so without a second refresh the browser holds the
  // profile it fetched on mount for the rest of the conversation. On a live run that had two
  // visible consequences: the progress chips stayed unlit no matter how many questions the user
  // answered, and the profile reached "active" in the database while the effect below — which is
  // what enqueues the first crawl — was still looking at a stale "in_conversation". The user
  // answered everything and nothing ever happened.
  //
  // Deliberately narrow: it only runs while the selected profile is mid-interview, and stops on
  // its own the moment that profile is active or paused, so a user sitting on the board is not
  // polling. The refetch is a single profile.list read.
  const refetchRef = useRef(profiles.refetch);
  refetchRef.current = profiles.refetch;
  const interviewing = selectedProfile?.state === "in_conversation";
  useEffect(() => {
    if (!interviewing) return;
    const timer = setInterval(() => {
      refetchRef.current();
    }, ONBOARDING_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [interviewing]);

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
  }, [profiles, hostActions.actorScopeKey]);

  // The empty state's one job: get a profile row to exist. It goes through the module's own
  // declared queue rather than through the assistant, because the assistant is not a reliable
  // writer and the browser is not an allowed one:
  //   - packages/ai/src/routes.ts 403s every risk:"write" assistant tool invoked over REST
  //     ("confirmation_required"), deliberately and un-bypassably, so this component cannot call
  //     job-search.profile.create itself;
  //   - handing the model a starter prompt asking it to create the record is a coin flip. On a
  //     live instance it opened an interview and never called the tool, so this panel sat on
  //     "Setting up your job search profile…" forever, polling profile.list against an empty
  //     table. That was the module's first click, and it dead-ended.
  // `job-search.profile-bootstrap` (manifest worker.queues) runs handlers/profile.ts's idempotent
  // bootstrap under the module's own runtime role, which CAN write. The conversation then starts
  // on the onboarding screen's real Surface, framed by buildSeedPrompt — so no turn in this module
  // reaches the model unframed any more, and the user is never made to say a sentence about tools.
  function handleStart(): void {
    setPollArmed(true);
    setPhase("waiting");
    runQueue("job-search.profile-bootstrap", "profile.bootstrap")
      .then((outcome) => {
        // "disabled" is the one outcome the user must be told about: the queue is off for this
        // account, so no amount of waiting will produce a profile.
        if (outcome.kind === "disabled" || outcome.kind === "error") {
          setPollArmed(false);
          setQueueNotice(outcome);
          setPhase("expired");
        }
      })
      .catch(() => {
        setPollArmed(false);
        setQueueNotice({ kind: "error", message: "Network error" });
        setPhase("expired");
      });
  }

  // Retry re-runs the bootstrap rather than only re-arming the poll: if the profile still does not
  // exist, waiting harder was never going to produce one. Safe to repeat — the handler returns the
  // existing profile instead of creating a second (handlers/profile.ts).
  function handleRetry(): void {
    handleStart();
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
        <OnboardingScreen profile={selected} assistantSurface={props.assistantSurface} />
      ) : (
        <ActiveProfilePanel
          profiles={profiles.profiles}
          selectedId={profiles.selectedId}
          onSelectProfile={profiles.select}
          selected={selected}
          assistantSurface={props.assistantSurface}
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
      {queueNotice ? <QueueNotice outcome={queueNotice} /> : null}
      {body}
    </div>
  );
}
