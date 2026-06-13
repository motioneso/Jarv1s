import { type CSSProperties, type ReactNode } from "react";

/**
 * Presentational layout primitives for the Ritual design language. These consume
 * ONLY semantic tokens from styles/tokens.css (via inline var() references) — no
 * API client imports, no @jarv1s/shared DTOs, no data hooks. They are pure
 * presentation so the design gate (mockups -> sign-off) maps 1:1 onto code.
 */

export interface CardProps {
  readonly children: ReactNode;
  /** Subtle background variant for nested/secondary cards. */
  readonly tone?: "raised" | "subtle";
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly "aria-labelledby"?: string;
}

export function Card(props: CardProps): ReactNode {
  const tone = props.tone ?? "raised";
  const background = tone === "subtle" ? "var(--surface-subtle)" : "var(--surface-raised)";
  return (
    <div
      className={["ui-card", props.className].filter(Boolean).join(" ")}
      aria-labelledby={props["aria-labelledby"]}
      style={{
        background,
        border: "1px solid var(--border-default)",
        borderRadius: "12px",
        padding: "1rem 1.25rem",
        boxShadow: "var(--shadow-control)",
        ...props.style
      }}
    >
      {props.children}
    </div>
  );
}

export interface StackProps {
  readonly children: ReactNode;
  /** Flow direction; defaults to a vertical column. */
  readonly direction?: "column" | "row";
  /** Gap between children in rem. */
  readonly gap?: number;
  /** Cross-axis alignment. */
  readonly align?: CSSProperties["alignItems"];
  /** Main-axis distribution. */
  readonly justify?: CSSProperties["justifyContent"];
  readonly wrap?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function Stack(props: StackProps): ReactNode {
  return (
    <div
      className={["ui-stack", props.className].filter(Boolean).join(" ")}
      style={{
        display: "flex",
        flexDirection: props.direction ?? "column",
        gap: `${props.gap ?? 0.75}rem`,
        alignItems: props.align,
        justifyContent: props.justify,
        flexWrap: props.wrap ? "wrap" : undefined,
        ...props.style
      }}
    >
      {props.children}
    </div>
  );
}

export interface SectionHeaderProps {
  readonly title: ReactNode;
  /** Small uppercase eyebrow above the title. */
  readonly eyebrow?: ReactNode;
  /** Supporting copy below the title. */
  readonly description?: ReactNode;
  /** Trailing slot (actions, counts) aligned to the end of the header row. */
  readonly trailing?: ReactNode;
  readonly id?: string;
  readonly className?: string;
}

export function SectionHeader(props: SectionHeaderProps): ReactNode {
  return (
    <header
      className={["ui-section-header", props.className].filter(Boolean).join(" ")}
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: "1rem"
      }}
    >
      <div>
        {props.eyebrow != null && (
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-muted)"
            }}
          >
            {props.eyebrow}
          </p>
        )}
        <h2 id={props.id} style={{ margin: "0.15rem 0 0", color: "var(--text)" }}>
          {props.title}
        </h2>
        {props.description != null && (
          <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)" }}>{props.description}</p>
        )}
      </div>
      {props.trailing != null && <div style={{ flexShrink: 0 }}>{props.trailing}</div>}
    </header>
  );
}
