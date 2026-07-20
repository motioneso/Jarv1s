// #1197: shared Park Press presentation helpers for the four Job Search screens.
// Labels stay on the app's sans eyebrow idiom; numerics use tabular figures.
import { h, type ReactNodeLike } from "./runtime";

export function Eyebrow(props: {
  children?: unknown;
  tone?: "gold" | "muted";
  className?: string;
}): ReactNodeLike {
  const tone = props.tone ? ` jsm-eyebrow--${props.tone}` : "";
  return (
    <p className={`jds-eyebrow jsm-eyebrow${tone}${props.className ? ` ${props.className}` : ""}`}>
      {props.children}
    </p>
  );
}

export function Strap(): ReactNodeLike {
  return <span className="jsm-strap" aria-hidden="true" />;
}

export function SectionHead(props: {
  children?: unknown;
  trailing?: ReactNodeLike;
}): ReactNodeLike {
  return (
    <div className="jsm-section-head">
      <span className="jds-eyebrow">{props.children}</span>
      <span className="jsm-section-head__line" aria-hidden="true" />
      {props.trailing ?? null}
    </div>
  );
}

const FIT_LABELS = {
  strong: "Strong fit",
  good: "Good fit",
  fair: "Fair fit",
  weak: "Weak fit"
} as const;

export type FitBand = keyof typeof FIT_LABELS;

export function FitBadge(props: { band?: string }): ReactNodeLike {
  const band: FitBand = props.band && props.band in FIT_LABELS ? (props.band as FitBand) : "fair";
  return <span className={`jsm-fit jsm-fit--${band}`}>{FIT_LABELS[band]}</span>;
}

export function Meta(props: { children?: unknown; tone?: "gold" }): ReactNodeLike {
  return (
    <span className={`jsm-meta-pill${props.tone === "gold" ? " jsm-meta-pill--gold" : ""}`}>
      {props.children}
    </span>
  );
}

export function Confidence(props: { level?: string }): ReactNodeLike {
  const level = props.level === "high" || props.level === "medium" ? props.level : "low";
  const active = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const dot = (index: number) => `jsm-confidence__dot${index <= active ? " is-active" : ""}`;
  return (
    <span
      className="jsm-confidence"
      aria-label={`Confidence: ${level}`}
      title={`Confidence: ${level}`}
    >
      <span className="jds-eyebrow">Conf</span>
      <span className={dot(1)} aria-hidden="true" />
      <span className={dot(2)} aria-hidden="true" />
      <span className={dot(3)} aria-hidden="true" />
    </span>
  );
}
