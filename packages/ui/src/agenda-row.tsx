import { type ReactNode } from "react";

export type AgendaRowStatus = "default" | "now" | "done";

export interface AgendaRowProps {
  readonly time: ReactNode;
  readonly title: ReactNode;
  readonly location?: ReactNode;
  readonly status?: AgendaRowStatus;
  readonly nowLabel?: ReactNode;
}

export function AgendaRow(props: AgendaRowProps) {
  const status = props.status ?? "default";
  const classes = ["jds-agenda-row", status !== "default" ? `jds-agenda-row--${status}` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes}>
      <div className="jds-agenda-row__time">{props.time}</div>
      <div className="jds-agenda-row__body">
        <div className="jds-agenda-row__title">{props.title}</div>
        {props.location ? <div className="jds-agenda-row__sub">{props.location}</div> : null}
        {status === "now" ? (
          <span className="jds-agenda-row__now">
            <span className="jds-agenda-row__now-dot" />
            {props.nowLabel ?? "Next up"}
          </span>
        ) : null}
      </div>
    </div>
  );
}
