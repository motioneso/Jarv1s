import { type ReactNode } from "react";

/**
 * 1:1 with apps/web/src/styles/components-core.css .jds-badge--* — there is no bare "pine"
 * tone (that class doesn't exist; see #1388 D6 change list for the compat mapping). "solid-pine"
 * and "solid-amber" are their own solid-fill treatments, not a `solid` variant of every tone.
 */
export type BadgeTone =
  | "neutral"
  | "forest"
  | "amber"
  | "red"
  | "steel"
  | "solid-pine"
  | "solid-amber";

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly outline?: boolean;
  readonly pill?: boolean;
  readonly dot?: boolean;
  readonly children: ReactNode;
}

export function Badge(props: BadgeProps) {
  const tone = props.tone ?? "neutral";
  const classes = [
    "jds-badge",
    props.outline ? "jds-badge--outline" : `jds-badge--${tone}`,
    props.pill ? "jds-badge--pill" : null
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      {props.dot ? <span className="jds-badge__dot" /> : null}
      {props.children}
    </span>
  );
}

export function ComingSoon(props: { readonly issue: number }) {
  return (
    <Badge tone="steel" dot>
      Coming soon · #{props.issue}
    </Badge>
  );
}
