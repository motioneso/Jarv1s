import { ArrowUpRight } from "lucide-react";

export function Stat(props: {
  readonly k: string;
  readonly v: number;
  readonly icon: React.ReactNode;
  readonly warn?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`cmd-stat ${props.warn ? "cmd-stat--warn" : ""}`}
      onClick={props.onClick}
    >
      <div className="k">
        {props.icon}
        {props.k}
        <span className="cmd-stat__go">
          <ArrowUpRight size={13} aria-hidden="true" />
        </span>
      </div>
      <div className="v">{props.v}</div>
    </button>
  );
}
