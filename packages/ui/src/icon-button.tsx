import { type ButtonHTMLAttributes, type ReactNode } from "react";

export type IconButtonVariant = "default" | "secondary";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: IconButtonVariant;
  readonly size?: IconButtonSize;
  readonly active?: boolean;
  readonly "aria-label": string;
  readonly children: ReactNode;
}

export function IconButton(props: IconButtonProps) {
  const { variant = "default", size = "md", active, children, type, ...rest } = props;
  const classes = [
    "jds-iconbtn",
    variant === "secondary" ? "jds-iconbtn--secondary" : null,
    size !== "md" ? `jds-iconbtn--${size}` : null,
    active ? "jds-iconbtn--active" : null
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type ?? "button"} className={classes} {...rest}>
      {children}
    </button>
  );
}
