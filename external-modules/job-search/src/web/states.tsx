import { h, type ReactNodeLike } from "./runtime";

export function LandingSkeleton(): ReactNodeLike {
  return (
    <section className="jsn-landing-state" aria-label="Loading Job Search" role="status">
      <span className="jsn-eyebrow">Job Search</span>
      <div className="jsn-skeleton jsn-skeleton--title" aria-hidden="true" />
      <div className="jsn-skeleton jsn-skeleton--line" aria-hidden="true" />
      <div className="jsn-profile-grid" aria-hidden="true">
        {["one", "two", "three"].map((id) => (
          <div className="jsn-profile-card jsn-profile-card--skeleton" key={id}>
            <div className="jsn-skeleton jsn-skeleton--card-title" />
            <div className="jsn-skeleton jsn-skeleton--card-line" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ErrorState(props: { message: string }): ReactNodeLike {
  return (
    <section className="jsn-landing-state" role="alert">
      <span className="jsn-eyebrow">Job Search unavailable</span>
      <h1>We could not load your profiles.</h1>
      <p>{props.message}</p>
    </section>
  );
}
