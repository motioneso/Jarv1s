import { type CSSProperties, type ReactNode } from "react";

export interface AllDayChipProps {
  readonly color: string;
  readonly title: ReactNode;
  readonly onClick?: () => void;
}

export function AllDayChip({ color, title, onClick }: AllDayChipProps) {
  return (
    <button
      type="button"
      className="cal-allchip"
      style={{ "--ev": color } as CSSProperties}
      onClick={onClick}
    >
      <span className="cal-allchip__dot" />
      {title}
    </button>
  );
}
