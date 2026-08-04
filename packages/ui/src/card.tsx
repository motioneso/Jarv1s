import { type HTMLAttributes, type ReactNode } from "react";

export type CardPadding = "sm" | "md" | "lg";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  readonly sunken?: boolean;
  readonly flush?: boolean;
  readonly raised?: boolean;
  readonly interactive?: boolean;
  readonly padding?: CardPadding;
  readonly children: ReactNode;
}

export function Card(props: CardProps) {
  const { sunken, flush, raised, interactive, padding, children, ...rest } = props;
  const classes = [
    "jds-card",
    sunken ? "jds-card--sunken" : null,
    flush ? "jds-card--flush" : null,
    raised ? "jds-card--raised" : null,
    interactive ? "jds-card--interactive" : null,
    padding && padding !== "md" ? `jds-card--pad-${padding}` : null
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}
