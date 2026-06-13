import { type CSSProperties, type ReactNode } from "react";

/**
 * A chronology section header — "This Morning" / "This Afternoon" / "This Evening".
 * Each bucket carries its circadian accent from the --bucket-* semantic tokens
 * (morning -> afternoon -> evening warming spectrum). Pure presentation: a labelled
 * heading with an accent rule; callers slot the bucket's items as children.
 */
export type TimeBucketName = "morning" | "afternoon" | "evening";

const BUCKET_LABEL: Record<TimeBucketName, string> = {
  morning: "This Morning",
  afternoon: "This Afternoon",
  evening: "This Evening"
};

const BUCKET_ACCENT: Record<TimeBucketName, string> = {
  morning: "var(--bucket-morning)",
  afternoon: "var(--bucket-afternoon)",
  evening: "var(--bucket-evening)"
};

export interface TimeBucketProps {
  readonly bucket: TimeBucketName;
  readonly children?: ReactNode;
  /** Override the default bucket label ("This Morning" etc.). */
  readonly label?: ReactNode;
  /** Trailing slot (e.g. an item count) aligned to the end of the header row. */
  readonly trailing?: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function TimeBucket(props: TimeBucketProps): ReactNode {
  const accent = BUCKET_ACCENT[props.bucket];
  const label = props.label ?? BUCKET_LABEL[props.bucket];
  return (
    <section
      className={["ui-time-bucket", `ui-time-bucket--${props.bucket}`, props.className]
        .filter(Boolean)
        .join(" ")}
      style={props.style}
    >
      <header
        className="ui-time-bucket__header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          paddingBottom: "0.4rem",
          borderBottom: `2px solid ${accent}`
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.95rem",
            fontWeight: 700,
            letterSpacing: "0.02em",
            color: accent
          }}
        >
          {label}
        </h3>
        {props.trailing != null && (
          <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{props.trailing}</span>
        )}
      </header>
      {props.children != null && (
        <div className="ui-time-bucket__body" style={{ paddingTop: "0.6rem" }}>
          {props.children}
        </div>
      )}
    </section>
  );
}
