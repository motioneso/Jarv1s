import { invokeTool } from "./api";
import { landingState, profileCardsFromResult, type ProfileCard } from "./landing-model";
import { h, useCallback, useEffect, useState, type ReactNodeLike } from "./runtime";
import { navigate } from "./router";
import { ErrorState, LandingSkeleton } from "./states";

function FirstRunHero(): ReactNodeLike {
  return (
    <section className="jsn-hero" aria-labelledby="jsn-hero-title">
      <span className="jsn-eyebrow">A clearer next move</span>
      <h1 id="jsn-hero-title">Find work that fits the life you’re building.</h1>
      <p>
        We’ll start with what you already know: your experience, your strengths, and the kind of
        role you want next.
      </p>
      <button
        className="jds-btn jds-btn--primary"
        type="button"
        onClick={() => navigate("/onboarding")}
      >
        Start a new search
      </button>
    </section>
  );
}

function ProfileCard(props: { profile: ProfileCard; key?: string }): ReactNodeLike {
  return (
    <article className="jsn-profile-card">
      <div className="jsn-profile-card__topline">
        <span className="jsn-eyebrow">Profile</span>
        <span className="jsn-run-state" aria-label={`Profile ${props.profile.status}`} />
      </div>
      <h2>{props.profile.title}</h2>
      <span className="jsn-new-since">N new since last visit</span>
      <p className="jsn-profile-card__status">{props.profile.status}</p>
    </article>
  );
}

function ConfiguredLanding(props: { profiles: readonly ProfileCard[] }): ReactNodeLike {
  return (
    <section className="jsn-landing-state" aria-labelledby="jsn-configured-title">
      <div className="jsn-landing-heading">
        <div>
          <span className="jsn-eyebrow">Your search desk</span>
          <h1 id="jsn-configured-title">Keep the right search moving.</h1>
        </div>
        <button
          className="jds-btn jds-btn--primary"
          type="button"
          onClick={() => navigate("/onboarding")}
        >
          Start a new search
        </button>
      </div>
      <div className="jsn-profile-grid">
        {props.profiles.map((profile) => (
          <ProfileCard key={profile.id} profile={profile} />
        ))}
      </div>
    </section>
  );
}

export function Landing(): ReactNodeLike {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; profiles: ProfileCard[] }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  const load = useCallback(() => {
    let active = true;
    void invokeTool<{ profiles?: unknown }>("job-search.profiles.list").then((outcome) => {
      if (!active) return;
      if (outcome.kind === "ok") {
        setState({ kind: "ok", profiles: profileCardsFromResult(outcome.result) });
      } else if (outcome.kind === "blocked") {
        setState({ kind: "error", message: outcome.reason });
      } else if (outcome.kind === "disabled") {
        setState({ kind: "error", message: "This module is not available right now." });
      } else {
        setState({ kind: "error", message: outcome.message });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(load, [load]);

  if (state.kind === "loading") return <LandingSkeleton />;
  if (state.kind === "error") return <ErrorState message={state.message} />;
  return landingState(state.profiles) === "first-run" ? (
    <FirstRunHero />
  ) : (
    <ConfiguredLanding profiles={state.profiles} />
  );
}
