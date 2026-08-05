export interface NowLineProps {
  readonly top: number;
}

export function NowLine({ top }: NowLineProps) {
  return (
    <div className="cal-now" style={{ top }}>
      <span className="cal-now__dot" />
      <span className="cal-now__line" />
    </div>
  );
}
