import { type HTMLAttributes, type ReactNode } from "react";

export type CardPadding = "sm" | "md" | "lg";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "title"> {
  readonly sunken?: boolean;
  readonly flush?: boolean;
  readonly raised?: boolean;
  readonly interactive?: boolean;
  readonly padding?: CardPadding;
  readonly title?: ReactNode;
  readonly meta?: ReactNode;
  readonly children: ReactNode;
}

export function Card(props: CardProps) {
  const { sunken, flush, raised, interactive, padding, title, meta, children, ...rest } = props;
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
      {title ? (
        <div className="jds-card__head">
          <span className="jds-card__title">{title}</span>
          {meta ? <span className="jds-card__meta">{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
