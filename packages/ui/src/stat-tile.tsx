import { ArrowUpRight } from "lucide-react";
import { type ReactNode } from "react";

export interface StatTileProps {
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly icon?: ReactNode;
  readonly warn?: boolean;
  readonly onClick: () => void;
}

export function StatTile(props: StatTileProps) {
  const classes = ["jds-stat-tile", props.warn ? "jds-stat-tile--warn" : null]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={classes} onClick={props.onClick}>
      <div className="jds-stat-tile__label">
        {props.icon}
        {props.label}
        <span className="jds-stat-tile__go">
          <ArrowUpRight size={13} aria-hidden="true" />
        </span>
      </div>
      <div className="jds-stat-tile__value">{props.value}</div>
    </button>
  );
}
