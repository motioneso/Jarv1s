import { type HTMLAttributes, type LabelHTMLAttributes, type ReactNode } from "react";

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  readonly children: ReactNode;
}

export function Field({ children, ...rest }: FieldProps) {
  return (
    <div className="jds-field" {...rest}>
      {children}
    </div>
  );
}

export interface FormLabelProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, "className"> {
  readonly children: ReactNode;
}

export function FormLabel({ children, ...rest }: FormLabelProps) {
  return (
    <label className="jds-label" {...rest}>
      {children}
    </label>
  );
}
