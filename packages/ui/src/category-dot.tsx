export interface CategoryDotProps {
  readonly color: string;
}

export function CategoryDot({ color }: CategoryDotProps) {
  return <span className="cal-peek__catdot" style={{ background: color }} />;
}
