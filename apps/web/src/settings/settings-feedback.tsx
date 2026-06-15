import { Check } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

/* Settings feedback layer — a quiet ambient toast for simple actions and a
   confirm dialog for consequential/destructive ones. Mirrors the design kit's
   toast + confirm pattern (ui_kits/jarvis-app/settings-ui.jsx), built on the
   app's .jds-toast / .jds-dialog primitives. Mounted once by the settings shell. */

export interface ToastOptions {
  readonly tone?: "ready" | "drift";
  readonly icon?: ReactNode;
  readonly title?: string;
  readonly duration?: number;
}

export interface ConfirmOptions {
  readonly title: string;
  readonly description?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly danger?: boolean;
  readonly onConfirm: () => void;
}

interface FeedbackApi {
  readonly toast: (message: string, options?: ToastOptions) => void;
  readonly confirm: (options: ConfirmOptions) => void;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error("useFeedback must be used within <FeedbackProvider>");
  return api;
}

interface ToastEntry extends ToastOptions {
  readonly id: number;
  readonly message: string;
}

export function FeedbackProvider(props: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastEntry[]>([]);
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((message: string, options?: ToastOptions) => {
    const id = nextId.current++;
    const entry: ToastEntry = { id, message, ...options };
    setToasts((current) => [...current, entry]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, options?.duration ?? 2900);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setDialog(options);
  }, []);

  const api = useMemo<FeedbackApi>(() => ({ toast, confirm }), [toast, confirm]);

  const closeDialog = useCallback(() => setDialog(null), []);
  // Run onConfirm OUTSIDE the state updater: a setState updater must be pure, and
  // React StrictMode double-invokes it in dev — which previously fired the action
  // (and its toast) twice. `dialog` is in scope where the confirm button renders.
  const runConfirm = useCallback(() => {
    dialog?.onConfirm();
    setDialog(null);
  }, [dialog]);

  return (
    <FeedbackContext.Provider value={api}>
      {props.children}

      <div className="set-toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`jds-toast jds-toast--${item.tone ?? "ready"}`}>
            <span className="jds-toast__icon">
              {item.icon ?? <Check size={17} aria-hidden="true" />}
            </span>
            <div className="jds-toast__body">
              {item.title ? <div className="jds-toast__title">{item.title}</div> : null}
              <div className="jds-toast__msg">{item.message}</div>
            </div>
          </div>
        ))}
      </div>

      {dialog ? (
        <div
          className="jds-dialog-scrim"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div className="jds-dialog" role="dialog" aria-modal="true" aria-label={dialog.title}>
            <div className="jds-dialog__head">
              <div className="jds-dialog__title">{dialog.title}</div>
              {dialog.description ? (
                <div className="jds-dialog__desc">{dialog.description}</div>
              ) : null}
            </div>
            <div className="jds-dialog__foot">
              <button type="button" className="jds-btn jds-btn--quiet" onClick={closeDialog}>
                {dialog.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                className={`jds-btn ${dialog.danger ? "jds-btn--danger" : "jds-btn--primary"}`}
                onClick={runConfirm}
              >
                {dialog.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </FeedbackContext.Provider>
  );
}
