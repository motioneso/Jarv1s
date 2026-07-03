import { Component, type ErrorInfo, type ReactNode } from "react";

import { reportClientError } from "./global-error-handler.js";

/**
 * Top-level React error boundary (#413). Wraps <App /> so a render-time crash in
 * any component is caught: the fallback UI renders ("Something went wrong. Reload
 * the page." + a reload button), and the error is reported to /api/errors for
 * observability.
 *
 * This is functional default UI — no visual redesign (per spec). The fallback is
 * deliberately minimal so it cannot itself depend on any subsystem that might
 * have caused the crash.
 *
 * Reporting uses reportClientError, which is fire-and-forget and never throws, so
 * a failure during error reporting cannot crash the fallback.
 */
interface ErrorBoundaryProps {
  readonly children: ReactNode;
}
interface ErrorBoundaryState {
  readonly hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    void reportClientError({
      type: "react_error",
      message: error.message || "react render error",
      stack: error.stack
    });
  }

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="jds-crash" role="alert">
          <h1 className="jds-crash__title">Something went wrong.</h1>
          <p className="jds-crash__copy">Reload the page to continue.</p>
          <button className="jds-btn jds-btn--primary" type="button" onClick={this.handleReload}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
