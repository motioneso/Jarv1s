import { type CSSProperties, type ReactNode } from "react";

/**
 * The "governor" wrapper. AI-generated / unconfirmed content (e.g. an LLM email
 * summary + extracted signals) renders dimmed at --provisional-opacity with an
 * accessible "provisional — not yet confirmed" label, so a draft is visually and
 * semantically distinguished from confirmed, owner-authored data.
 */
export interface ProvisionalRegionProps {
  readonly children: ReactNode;
  /** Override the default "Provisional — not yet confirmed" label. */
  readonly label?: string;
  /** Render the visible label chip (the accessible label is always present). */
  readonly showLabel?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function ProvisionalRegion(props: ProvisionalRegionProps): ReactNode {
  const label = props.label ?? "Provisional — not yet confirmed";
  const showLabel = props.showLabel ?? true;
  return (
    <div
      className={["ui-provisional", props.className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
      data-provisional="true"
      style={{
        opacity: "var(--provisional-opacity)",
        ...props.style
      }}
    >
      {showLabel && (
        <p
          className="ui-provisional__label"
          style={{
            margin: "0 0 0.4rem",
            fontSize: "0.7rem",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--text-muted)"
          }}
        >
          {label}
        </p>
      )}
      {props.children}
    </div>
  );
}
