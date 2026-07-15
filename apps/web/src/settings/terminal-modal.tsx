import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

// #xterm.js ships a stylesheet, not JS — a static CSS import is side-effect-only and safe
// at module scope (unlike `new Terminal()`, which touches `document` and must never run
// outside a browser-side effect; see the guard on the mount effect below).
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import type { AiProviderConfigDto } from "@jarv1s/shared";

import {
  ApiError,
  getTerminalStatus,
  requestTerminalTicket,
  setTerminalPassword,
  terminalWsUrl
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";

/**
 * #1059 owner-gated CLI-provider terminal. A CLI-auth provider has no API key to
 * credential-test, so the settings pane's Test action opens this modal instead: a
 * password step-up (set once, then required every session) gates a live PTY session
 * to the provider's CLI, streamed over a WebSocket ticket (Task 7 server, Task 8
 * client helpers). Structured after `delete-account.tsx` — a self-contained modal
 * using the shared `jds-dialog*` CSS classes directly (no reusable <Modal>
 * component exists in this codebase).
 */

/** The three reachable phases, plus the ticket the "unlocked" phase carries. */
export type TerminalModalPhase =
  | { readonly kind: "set-password" }
  | { readonly kind: "locked" }
  | { readonly kind: "unlocked"; readonly ticket: string };

export type TerminalModalEvent =
  | { readonly type: "status"; readonly passwordSet: boolean }
  | { readonly type: "password-set" }
  | { readonly type: "ticket"; readonly ticket: string };

/**
 * Pure phase transition, exported so the no-DOM/no-effect state machine is directly
 * unit-testable (corrections §6.2): status -> set-password | locked; set-password ->
 * locked once a password is created; locked -> unlocked once a ticket is issued.
 */
export function nextTerminalModalPhase(
  _current: TerminalModalPhase | null,
  event: TerminalModalEvent
): TerminalModalPhase {
  switch (event.type) {
    case "status":
      return event.passwordSet ? { kind: "locked" } : { kind: "set-password" };
    case "password-set":
      return { kind: "locked" };
    case "ticket":
      return { kind: "unlocked", ticket: event.ticket };
  }
}

/**
 * The exact wire text-frame the server's resize handler expects (terminal-routes.ts
 * detects a resize instruction by JSON-parsing a non-binary frame — see corrections
 * §5). Exported so the shape is locked by a direct unit assertion, no DOM required.
 */
export function buildResizeMessage(cols: number, rows: number): string {
  return JSON.stringify({ type: "resize", cols, rows });
}

export function TerminalModal(props: {
  readonly provider: AiProviderConfigDto;
  readonly onClose: () => void;
}) {
  const { provider, onClose } = props;
  const { toast } = useFeedback();
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: queryKeys.ai.terminalStatus(provider.id),
    queryFn: getTerminalStatus,
    retry: false
  });

  // Local override advances the phase past whatever the status query resolved, once the
  // user completes the set-password or unlock step. `null` defers entirely to the query.
  const [override, setOverride] = useState<TerminalModalPhase | null>(null);
  const phase: TerminalModalPhase | null =
    override ??
    (statusQuery.data
      ? nextTerminalModalPhase(null, { type: "status", passwordSet: statusQuery.data.passwordSet })
      : null);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const setPasswordMutation = useMutation({
    mutationFn: (pw: string) => setTerminalPassword(pw),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.ai.terminalStatus(provider.id), { passwordSet: true });
      setPassword("");
      setConfirmPassword("");
      setOverride(nextTerminalModalPhase(phase, { type: "password-set" }));
    },
    onError: (error) =>
      toast(readError(error), { tone: "drift", icon: <TriangleAlert size={17} /> })
  });

  const ticketMutation = useMutation({
    mutationFn: (pw: string) => requestTerminalTicket(pw),
    onSuccess: ({ ticket }) => {
      setPassword("");
      setOverride(nextTerminalModalPhase(phase, { type: "ticket", ticket }));
    },
    onError: (error) => {
      const message =
        error instanceof ApiError && error.status === 401 ? "Incorrect password" : readError(error);
      toast(message, { tone: "drift", icon: <TriangleAlert size={17} /> });
    }
  });

  // Terminal is currently connecting or streaming — the click-outside-to-close scrim
  // guard mirrors delete-account.tsx's `!deleteMutation.isPending` guard: don't drop a
  // live PTY session because of a stray click on the backdrop.
  const isLive = phase?.kind === "unlocked";

  const termHostRef = useRef<HTMLDivElement | null>(null);
  const ticket = phase?.kind === "unlocked" ? phase.ticket : null;

  useEffect(() => {
    // Guarded on the unlocked phase AND a mounted ref: `new Terminal()` / `term.open()`
    // touch `document` immediately and must never run during a react-dom/server render
    // pass (this file's sibling components are rendered via renderToString in
    // tests/unit/) — only a browser-side effect after mount reaches this branch.
    if (!ticket || !termHostRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 13
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termHostRef.current);
    fitAddon.fit();

    const ws = new WebSocket(terminalWsUrl(ticket));
    ws.binaryType = "arraybuffer";

    // Server -> client: raw binary PTY bytes (terminal-routes.ts ~L225). Verified
    // matching the Task 7 server exactly — see corrections §5.
    ws.onmessage = (event) => {
      term.write(new Uint8Array(event.data as ArrayBuffer));
    };

    // Client -> server keystrokes: a binary frame per input chunk (server's isBinary
    // fallthrough writes it straight to the PTY).
    const dataDisposable = term.onData((chunk) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(chunk));
      }
    });

    // Client -> server resize: a native TEXT frame (NOT TextEncoder-wrapped) — the
    // server distinguishes a resize instruction from a raw keystroke by checking
    // `isBinary === false` before attempting JSON.parse. Sending this as a binary
    // frame would defeat that check.
    const sendResize = () => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buildResizeMessage(term.cols, term.rows));
      }
    };
    ws.onopen = sendResize;
    window.addEventListener("resize", sendResize);

    ws.onerror = () => {
      toast("Terminal connection failed", { tone: "drift", icon: <TriangleAlert size={17} /> });
    };

    return () => {
      window.removeEventListener("resize", sendResize);
      dataDisposable.dispose();
      ws.close();
      term.dispose();
    };
    // `toast` comes from useFeedback()'s stable context value; only the ticket identity
    // should re-run this effect (a new ticket means a fresh WS connection to open).
  }, [ticket]);

  const onSubmitSetPassword = (event: FormEvent) => {
    event.preventDefault();
    if (setPasswordMutation.isPending) return;
    if (!password || password !== confirmPassword) return;
    setPasswordMutation.mutate(password);
  };

  const onSubmitUnlock = (event: FormEvent) => {
    event.preventDefault();
    if (ticketMutation.isPending || !password) return;
    ticketMutation.mutate(password);
  };

  return (
    <div
      className="jds-dialog-scrim"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isLive) onClose();
      }}
    >
      <div
        className="jds-dialog terminal-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${provider.displayName} terminal`}
      >
        <div className="jds-dialog__head">
          <div className="jds-dialog__title">{provider.displayName} terminal</div>
          <div className="jds-dialog__desc">
            {phase?.kind === "unlocked"
              ? "Live session — this streams directly to the provider's CLI."
              : "A terminal password gates this live session (separate from your account password)."}
          </div>
        </div>

        {phase === null ? (
          <div className="jds-dialog__body">
            <LoaderCircle size={16} className="dexp__spin" aria-hidden="true" />
          </div>
        ) : null}

        {phase?.kind === "set-password" ? (
          <form onSubmit={onSubmitSetPassword}>
            <div className="jds-dialog__body">
              <div className="term-modal__prompt">Set a terminal password</div>
              <label className="deldlg__field">
                <span className="deldlg__label">New terminal password</span>
                <input
                  className="jds-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={setPasswordMutation.isPending}
                  aria-label="New terminal password"
                />
              </label>
              <label className="deldlg__field">
                <span className="deldlg__label">Confirm password</span>
                <input
                  className="jds-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  disabled={setPasswordMutation.isPending}
                  aria-label="Confirm terminal password"
                />
              </label>
            </div>
            <div className="jds-dialog__foot">
              <button
                type="button"
                className="jds-btn jds-btn--quiet"
                onClick={onClose}
                disabled={setPasswordMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="jds-btn jds-btn--primary"
                disabled={
                  setPasswordMutation.isPending || !password || password !== confirmPassword
                }
              >
                {setPasswordMutation.isPending ? (
                  <>
                    <LoaderCircle size={15} className="dexp__spin" aria-hidden="true" />
                    Setting…
                  </>
                ) : (
                  "Set password"
                )}
              </button>
            </div>
          </form>
        ) : null}

        {phase?.kind === "locked" ? (
          <form onSubmit={onSubmitUnlock}>
            <div className="jds-dialog__body">
              <div className="term-modal__prompt">Enter your terminal password</div>
              <label className="deldlg__field">
                <span className="deldlg__label">Terminal password</span>
                <input
                  className="jds-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={ticketMutation.isPending}
                  aria-label="Terminal password"
                />
              </label>
            </div>
            <div className="jds-dialog__foot">
              <button
                type="button"
                className="jds-btn jds-btn--quiet"
                onClick={onClose}
                disabled={ticketMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="jds-btn jds-btn--primary"
                disabled={ticketMutation.isPending || !password}
              >
                {ticketMutation.isPending ? (
                  <>
                    <LoaderCircle size={15} className="dexp__spin" aria-hidden="true" />
                    Unlocking…
                  </>
                ) : (
                  <>
                    <KeyRound size={15} aria-hidden="true" />
                    Unlock
                  </>
                )}
              </button>
            </div>
          </form>
        ) : null}

        {phase?.kind === "unlocked" ? (
          <>
            <div className="jds-dialog__body">
              <div className="term-modal__host" ref={termHostRef} />
            </div>
            <div className="jds-dialog__foot">
              <button type="button" className="jds-btn jds-btn--quiet" onClick={onClose}>
                <span className="jds-btn__icon">
                  <X size={14} aria-hidden="true" />
                </span>
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
