import { type ReactNode } from "react";

export interface PeekPanelProps {
  readonly children: ReactNode;
  readonly "aria-label"?: string;
}

export function PeekPanel({ children, ...rest }: PeekPanelProps) {
  return (
    <aside className="cal-peek" role="dialog" {...rest}>
      {children}
    </aside>
  );
}
