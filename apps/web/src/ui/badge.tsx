import { type CSSProperties, type ReactNode } from "react";

/**
 * A small status pill. Tones map to SEMANTIC state tokens (styles/tokens.css).
 *
 * ANTI-SHAME INVARIANT: there is intentionally NO error-red tone. Normal human
 * drift (a slipped task, a missed time bucket, an at-risk commitment) renders as
 * "attention"/"recovery" amber — never the error-red --danger token, which is
 * reserved for true errors and destructive actions elsewhere in the app.
 */
export type BadgeTone = "neutral" | "accent" | "attention" | "recovery";

export interface BadgeProps {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
  readonly className?: string;
  readonly style?: CSSProperties;
}

const TONE_COLORS: Record<BadgeTone, { fg: string; border: string }> = {
  neutral: { fg: "var(--text-muted)", border: "var(--border-default)" },
  accent: { fg: "var(--accent-strong)", border: "var(--accent-soft-border)" },
  attention: { fg: "var(--state-attention)", border: "var(--state-attention)" },
  recovery: { fg: "var(--state-recovery)", border: "var(--state-recovery)" }
};

export function Badge(props: BadgeProps): ReactNode {
  const tone = props.tone ?? "neutral";
  const colors = TONE_COLORS[tone];
  return (
    <span
      className={["ui-badge", `ui-badge--${tone}`, props.className].filter(Boolean).join(" ")}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.15rem 0.6rem",
        borderRadius: "999px",
        border: `1px solid ${colors.border}`,
        color: colors.fg,
        background: "var(--surface-subtle)",
        fontSize: "0.75rem",
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...props.style
      }}
    >
      {props.children}
    </span>
  );
}
