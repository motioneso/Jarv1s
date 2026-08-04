import { type ReactNode } from "react";

export interface HeldBannerProps {
  readonly icon: ReactNode;
  readonly children: ReactNode;
}

export function HeldBanner({ icon, children }: HeldBannerProps) {
  return (
    <div className="cal-peek__held">
      {icon}
      <span>{children}</span>
    </div>
  );
}
