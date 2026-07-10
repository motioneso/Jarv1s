// Shared primitives for the /sports page. Kept token-only (no raw colors); all
// result semantics follow the desk rule: win = pine, draw = steel, loss = neutral,
// NEVER red.
import { useState, type ReactNode } from "react";

import type { FollowedFormEntry } from "@jarv1s/shared";

import { formatDate, useUserLocale } from "./locale.js";

export function initials(name: string, shortName?: string | null): string {
  if (shortName && shortName.trim().length > 0) return shortName.slice(0, 3).toUpperCase();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? name;
  const last = parts[parts.length - 1] ?? name;
  const letters = parts.length >= 2 ? (first[0] ?? "") + (last[0] ?? "") : name.slice(0, 2);
  return letters.toUpperCase();
}

export function Crest(props: {
  name: string;
  shortName?: string | null;
  crestUrl?: string | null;
  size?: "sm" | "md" | "lg";
}): ReactNode {
  const size = props.size ?? "sm";
  const cls = `sp-crest sp-crest--${size}`;
  // Fall back to the initials swatch if the logo fails to load (Ben 2026-07-09: league logos come
  // from an ESPN CDN path that can 404 for a competition — a broken-image icon would look worse than
  // "FC"). Tracking the *URL* that failed (not a bare boolean) auto-resets when the same <Crest>
  // instance is handed a new crestUrl, so a good logo after a bad one still renders.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (props.crestUrl && props.crestUrl !== failedUrl) {
    return (
      <span className={cls}>
        <img
          className="sp-crest__img"
          src={props.crestUrl}
          alt=""
          width={44}
          height={44}
          onError={() => setFailedUrl(props.crestUrl ?? null)}
        />
      </span>
    );
  }
  return <span className={`${cls} sp-crest--swatch`}>{initials(props.name, props.shortName)}</span>;
}

export function LiveDot(): ReactNode {
  return <span className="sp-livedot" aria-hidden="true" />;
}

/** W/D/L form pips — never-red semantics. */
export function FormPips(props: {
  form: readonly ("W" | "D" | "L")[];
  // Per-pip result detail (Ben 2026-07-09). Same order/length as `form`; when present, each pip
  // becomes a focusable trigger for a stylized hover/focus popup showing that match's result.
  // Omitted on surfaces/payloads without it → plain, non-interactive pips (unchanged behaviour).
  detail?: readonly FollowedFormEntry[] | null;
}): ReactNode {
  if (props.form.length === 0) return null;
  return (
    <span className="sp-formrow" aria-label="recent form">
      {props.form.map((result, index) => (
        <FormPip key={index} result={result} detail={props.detail?.[index]} />
      ))}
    </span>
  );
}

// A single form pip. Without `detail` it is the original inert swatch; with it, the pip gains a
// text popup (CSS-driven on :hover/:focus-within) and an aria-label carrying the same result so
// keyboard and screen-reader users get the detail without the hover (Ben 2026-07-09 /today).
function FormPip(props: { result: "W" | "D" | "L"; detail?: FollowedFormEntry }): ReactNode {
  const locale = useUserLocale();
  const { result, detail } = props;
  const cls = `sp-formpip sp-formpip--${result.toLowerCase()}`;
  if (!detail) return <span className={cls}>{result}</span>;

  const verb = result === "W" ? "Won" : result === "D" ? "Drew" : "Lost";
  const prep = detail.homeAway === "home" ? "vs" : "at";
  const played = formatDate(detail.playedAt, locale, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  // The aria-label replaces the pip subtree for assistive tech, so the visual popup below is
  // marked aria-hidden to avoid a double read.
  const label = `${verb} ${detail.score} ${prep} ${detail.opponentName}, ${played}`;
  return (
    <span className={`${cls} sp-formpip--pop`} tabIndex={0} role="note" aria-label={label}>
      {result}
      <span className="sp-formpop" aria-hidden="true">
        <span className="sp-formpop__top">
          <span className="sp-formpop__verb">{verb}</span>
          <span className="sp-formpop__score">{detail.score}</span>
        </span>
        <span className="sp-formpop__opp">
          {prep} {detail.opponentName}
        </span>
        <span className="sp-formpop__date">{played}</span>
      </span>
    </span>
  );
}

export function TrophyIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 4H4v2a3 3 0 0 0 3 3M17 4h3v2a3 3 0 0 1-3 3" />
    </svg>
  );
}
