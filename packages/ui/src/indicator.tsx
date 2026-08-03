import { type ReactNode } from "react";

export type IndicatorStatus = "ready" | "drift" | "error" | "idle";

export interface IndicatorProps {
  readonly status: IndicatorStatus;
  readonly live?: boolean;
  readonly label?: ReactNode;
}

export function Indicator(props: IndicatorProps) {
  const classes = [
    "jds-indicator",
    `jds-indicator--${props.status}`,
    props.live ? "jds-indicator--live" : null
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes}>
      <span className="jds-indicator__dot" />
      {props.label ? <span>{props.label}</span> : null}
    </span>
  );
}
