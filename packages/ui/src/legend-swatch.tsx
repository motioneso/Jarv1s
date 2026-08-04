export type LegendSwatchTone = "hard" | "hold";

export interface LegendSwatchProps {
  readonly tone: LegendSwatchTone;
}

export function LegendSwatch({ tone }: LegendSwatchProps) {
  return <span className={`cal-legend__sw cal-legend__sw--${tone}`} />;
}
