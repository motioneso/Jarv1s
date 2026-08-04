import { type ReactNode } from "react";

export type TodayPillVariant = "month" | "grid";

export interface TodayPillProps {
  readonly variant: TodayPillVariant;
  readonly children: ReactNode;
}

/**
 * The number element that CSS highlights when its `.is-today` ancestor (day cell / day header)
 * is present — callers still own the ancestor's `is-today` class; this only unifies the shared
 * child element name (`.n` for month cells, `.cal-tg__dnum` for the time-grid header).
 */
export function TodayPill({ variant, children }: TodayPillProps) {
  return <span className={variant === "month" ? "n" : "cal-tg__dnum"}>{children}</span>;
}
