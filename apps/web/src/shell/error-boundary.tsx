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
        <div role="alert" style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something went wrong.</h1>
          <p style={{ marginBottom: "1rem", color: "#555" }}>Reload the page to continue.</p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "1rem",
              cursor: "pointer",
              border: "1px solid #ccc",
              borderRadius: "4px",
              background: "#fff"
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
