import { type AnchorHTMLAttributes, type ReactNode } from "react";

export type ButtonLinkVariant = "primary" | "secondary" | "quiet" | "accentSoft" | "danger";
export type ButtonLinkSize = "sm" | "md" | "lg";

export interface ButtonLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> {
  readonly href: string;
  readonly variant?: ButtonLinkVariant;
  readonly size?: ButtonLinkSize;
  readonly block?: boolean;
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
}

export function ButtonLink(props: ButtonLinkProps) {
  const { variant = "primary", size = "md", block, icon, children, href, ...rest } = props;
  const classes = [
    "jds-btn",
    `jds-btn--${variant}`,
    size !== "md" ? `jds-btn--${size}` : null,
    block ? "jds-btn--block" : null
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <a href={href} className={classes} {...rest}>
      {icon ? <span className="jds-btn__icon">{icon}</span> : null}
      {children}
    </a>
  );
}
