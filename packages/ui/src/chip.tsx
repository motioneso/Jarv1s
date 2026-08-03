import { X } from "lucide-react";
import { type ReactNode } from "react";

export interface ChipProps {
  readonly children: ReactNode;
  /** Renders as a toggle button with aria-pressed instead of a static chip. */
  readonly toggle?: boolean;
  readonly selected?: boolean;
  readonly onToggle?: () => void;
  /** Renders a trailing remove button; ignored when `toggle` is set. */
  readonly onRemove?: () => void;
  readonly removeLabel?: string;
}

export function Chip(props: ChipProps) {
  if (props.toggle) {
    return (
      <button
        type="button"
        className="jds-chip jds-chip--toggle"
        aria-pressed={props.selected ?? false}
        onClick={props.onToggle}
      >
        {props.children}
      </button>
    );
  }
  return (
    <span className="jds-chip">
      {props.children}
      {props.onRemove ? (
        <button
          type="button"
          className="jds-chip__x"
          aria-label={props.removeLabel ?? "Remove"}
          onClick={props.onRemove}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
