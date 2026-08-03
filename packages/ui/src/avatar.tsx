export type AvatarSize = "xs" | "sm" | "md" | "lg";

export interface AvatarProps {
  readonly name: string;
  readonly size?: AvatarSize;
  readonly square?: boolean;
}

export function Avatar(props: AvatarProps) {
  const initials = props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const classes = [
    "jds-avatar",
    props.size && props.size !== "md" ? `jds-avatar--${props.size}` : null,
    props.square ? "jds-avatar--square" : null
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}
