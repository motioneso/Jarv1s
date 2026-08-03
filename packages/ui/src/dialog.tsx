import { type ReactNode } from "react";

export interface DialogProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly onClose: () => void;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly "aria-labelledby"?: string;
}

export function Dialog(props: DialogProps) {
  return (
    <div
      className="jds-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="jds-dialog" role="dialog" aria-modal="true" aria-labelledby={props["aria-labelledby"]}>
        <div className="jds-dialog__head">
          <div className="jds-dialog__title">{props.title}</div>
          {props.description ? <div className="jds-dialog__desc">{props.description}</div> : null}
        </div>
        <div className="jds-dialog__body">{props.children}</div>
        {props.footer ? <div className="jds-dialog__foot">{props.footer}</div> : null}
      </div>
    </div>
  );
}
