// external-modules/job-search/src/web/use-profiles.ts
// Task 18 (#1302): owns fetch + poll timing only. Root owns the enqueue latch and all
// rendered UI (bound split, part file section "Root vs. hook"); this hook's public surface
// intentionally carries no actorScopeKey.
//
// The wire shape below is `job-search.profile.list`'s ACTUAL result
// (worker/handlers/profile.ts createProfileListHandler), which does NOT match the domain
// Profile in ../domain/store-port.ts (that interface has id/criteria/contextSummary/schedule/
// surfaceKey/createdAt — none of which the tool returns). Defining a fresh type here matching
// the wire, rather than importing the domain type, avoids a shape that would compile but lie.
import { useEffect, useRef, useState } from "./runtime";
import { invokeTool } from "./api";

export const POLL_INTERVAL_MS = 3_000;
export const POLL_WINDOW_MS = 120_000;
export const POLL_MAX_ATTEMPTS = 40;

export type ProfileState = "in_conversation" | "active" | "paused";

export interface Profile {
  profileId: string;
  name: string;
  state: ProfileState;
  briefingDetail: string | null;
  completedSteps: number;
  readyToCrawl: boolean;
}

export type ProfilesState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "ready"; profiles: Profile[]; selectedId: string };

export interface UseProfilesOptions {
  pollArmed: boolean;
  onPollExpired(): void;
}

function selectedIdKey(): string {
  return "job-search:selected-profile-id";
}

function readSelectedId(): string | null {
  try {
    return window.localStorage.getItem(selectedIdKey());
  } catch {
    return null;
  }
}

function writeSelectedId(id: string): void {
  try {
    window.localStorage.setItem(selectedIdKey(), id);
  } catch {
    // Storage can be unavailable (private mode, quota) — selection just won't
    // survive a remount; not worth surfacing to the user.
  }
}

async function fetchProfiles(): Promise<Profile[]> {
  const result = (await invokeTool("job-search.profile.list")) as { profiles?: Profile[] };
  return Array.isArray(result?.profiles) ? result.profiles : [];
}

export function useProfiles(options: UseProfilesOptions): ProfilesState & {
  refetch(): void;
  select(id: string): void;
} {
  const { pollArmed, onPollExpired } = options;
  const [state, setState] = useState<ProfilesState>({ status: "loading" });
  const [, setSelectedId] = useState<string | null>(null);

  // Latest-callback refs so the polling effect's dependency array can stay on
  // primitives (pollArmed) without re-subscribing every render.
  const onPollExpiredRef = useRef(onPollExpired);
  onPollExpiredRef.current = onPollExpired;

  // Plain closure, not memoized: setState/setSelectedId setters are stable
  // (React guarantee), so every effect below reads current profiles only via
  // these functional updates — no stale-closure risk from redefining this
  // each render.
  function applyProfiles(profiles: Profile[]): void {
    if (profiles.length === 0) {
      setState({ status: "empty" });
      return;
    }
    setSelectedId((current) => {
      const stored = current ?? readSelectedId();
      const resolved =
        stored && profiles.some((p) => p.profileId === stored) ? stored : profiles[0].profileId;
      setState({ status: "ready", profiles, selectedId: resolved });
      return resolved;
    });
  }

  // One-shot mount fetch: Root needs bootstrap-vs-onboarding-vs-board on first
  // render regardless of pollArmed. This is NOT the bounded poll (bound 1 only
  // gates the repeating timer below) — a single existence check is not
  // "free-running."
  useEffect(() => {
    let cancelled = false;
    fetchProfiles()
      .then((profiles) => {
        if (!cancelled) applyProfiles(profiles);
      })
      .catch(() => {
        // Leave state as "loading"; the next tick (poll, if armed) retries.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bounded, armed poll (bounds 1-4 from the part file):
  //  1. zero calls until pollArmed flips true;
  //  2. expires at POLL_WINDOW_MS OR POLL_MAX_ATTEMPTS, whichever first;
  //  3. suspended while document.hidden — no fire and no elapsed-time accrual;
  //     fetch once immediately on becoming visible, then resume the interval;
  //  4. Root resets pollArmed on expiry and offers a retry (not an error state).
  useEffect(() => {
    if (!pollArmed || state.status !== "empty") return;

    let attempts = 0;
    let elapsedMs = 0;
    let expired = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const tick = () => {
      if (document.hidden) return; // bound 3: no fire while hidden.
      elapsedMs += POLL_INTERVAL_MS;
      attempts += 1;
      if (elapsedMs >= POLL_WINDOW_MS || attempts >= POLL_MAX_ATTEMPTS) {
        expired = true;
        stop();
        onPollExpiredRef.current();
        return;
      }
      fetchProfiles()
        .then((profiles) => {
          if (!expired) applyProfiles(profiles);
        })
        .catch(() => {
          // Transient failure — retried on the next tick.
        });
    };

    const onVisibilityChange = () => {
      // bound 3: becoming visible fetches once immediately, ahead of the next
      // tick, and does not itself count as an elapsed interval.
      if (!document.hidden && !expired) {
        fetchProfiles()
          .then((profiles) => {
            if (!expired) applyProfiles(profiles);
          })
          .catch(() => {});
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    timer = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollArmed, state.status]);

  // A plain manual re-fetch (e.g. Root after enqueueing a crawl, or a future
  // "Search now" in Task 20). Deliberately does NOT touch the armed-poll's
  // attempt/window budget above — that budget only resets by pollArmed itself
  // transitioning false→true (the retry action), per bound 4.
  function refetch(): void {
    fetchProfiles()
      .then(applyProfiles)
      .catch(() => {});
  }

  function select(id: string): void {
    writeSelectedId(id);
    setSelectedId(id);
    setState((current) => (current.status === "ready" ? { ...current, selectedId: id } : current));
  }

  return { ...state, refetch, select };
}
