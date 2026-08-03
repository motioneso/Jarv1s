export type DividerOrientation = "horizontal" | "vertical";
export type DividerWeight = "default" | "strong" | "ink";

export interface DividerProps {
  readonly orientation?: DividerOrientation;
  readonly weight?: DividerWeight;
}

export function Divider(props: DividerProps) {
  const orientation = props.orientation ?? "horizontal";
  const weight = props.weight ?? "default";
  const classes = [
    "jds-divider",
    orientation === "vertical" ? "jds-divider--vertical" : null,
    weight !== "default" ? `jds-divider--${weight}` : null
  ]
    .filter(Boolean)
    .join(" ");
  return <hr className={classes} aria-orientation={orientation === "vertical" ? "vertical" : undefined} />;
}
