import type { ReactNode } from "react";
import { Check, Info } from "lucide-react";

export function StepHeader(props: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lede?: ReactNode;
}) {
  return (
    <div>
      <div className="onb-eyebrow">{props.eyebrow}</div>
      <h1 className="onb-title">{props.title}</h1>
      {props.lede ? <p className="onb-lede">{props.lede}</p> : null}
    </div>
  );
}

export function OptionCard(props: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly name: string;
  readonly mono?: string;
  readonly desc?: ReactNode;
  readonly disabled?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`onb-opt${props.selected ? " is-sel" : ""}`}
      disabled={props.disabled}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span className="onb-opt__radio">
        {props.selected ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : null}
      </span>
      <span className="onb-opt__main">
        <span className="onb-opt__top">
          <span className="onb-opt__name">{props.name}</span>
          {props.mono ? <span className="onb-opt__mono">{props.mono}</span> : null}
        </span>
        {props.desc ? <span className="onb-opt__desc">{props.desc}</span> : null}
        {props.children ? <span className="onb-opt__status">{props.children}</span> : null}
      </span>
    </button>
  );
}

export function FootNote(props: { readonly icon?: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="onb-foot-note">
      <span className="ic">{props.icon ?? <Info size={15} aria-hidden="true" />}</span>
      <span>{props.children}</span>
    </div>
  );
}

export function StatusChip(props: {
  readonly tone: "pine" | "steel" | "amber";
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <span className={`onb-stat onb-stat--${props.tone}`}>
      <span className="ic">{props.icon}</span>
      {props.children}
    </span>
  );
}

export function StatusHint(props: { readonly children?: ReactNode }) {
  if (!props.children) return null;
  return (
    <div className="onb-stat__hint">
      <span className="ic">
        <Info size={14} aria-hidden="true" />
      </span>
      <span>{props.children}</span>
    </div>
  );
}
