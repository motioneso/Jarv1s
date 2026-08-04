import { type CSSProperties, type ReactNode } from "react";

export interface MonthChipProps {
  readonly block?: boolean;
  readonly color: string;
  readonly time?: ReactNode;
  readonly title: ReactNode;
  readonly onClick?: () => void;
}

export function MonthChip(props: MonthChipProps) {
  const classes = ["cal-mchip", props.block ? "is-block" : null].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      style={{ "--ev": props.color } as CSSProperties}
      onClick={props.onClick}
    >
      <span className="cal-mchip__dot" />
      {props.time ? <span className="cal-mchip__t">{props.time}</span> : null}
      <span className="cal-mchip__title">{props.title}</span>
    </button>
  );
}
