// #1059 — a real PTY (node-pty) running a login shell for the owner terminal.
// Deliberately NOT tmux: a genuine PTY emits the raw escape-sequence byte stream
// xterm.js expects, sidestepping the pane-scraping that broke under claude 2.1.183.
import * as pty from "node-pty";

export interface TerminalSessionOptions {
  readonly id: string;
  readonly cols: number;
  readonly rows: number;
  readonly homeBase: string; // cwd + $HOME (cli-auth home) — landing dir, not a jail
  readonly toolsBinDir: string; // prepended to PATH so claude/codex/gemini resolve
}

export class TerminalSession {
  readonly id: string;
  private readonly term: pty.IPty;

  constructor(opts: TerminalSessionOptions) {
    this.id = opts.id;
    this.term = pty.spawn("/bin/bash", ["-l"], {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.homeBase,
      env: {
        ...process.env,
        HOME: opts.homeBase,
        TERM: "xterm-256color",
        PATH: `${opts.toolsBinDir}:${process.env.PATH ?? "/usr/bin"}`
      },
      // #1059: without this, node-pty uses its default 'utf8' encoding and lossily
      // decodes the PTY's raw byte stream (invalid sequences become U+FFFD) before we
      // ever see it. That defeats the reason we chose a real PTY over tmux — xterm.js
      // needs the exact escape-sequence bytes, not a decoded-then-reencoded copy.
      encoding: null
    });
  }

  onData(cb: (chunk: Buffer) => void): void {
    // node-pty's onData is statically typed IEvent<string>, but with `encoding: null`
    // above it delivers a raw Buffer at runtime (#1059). Guard for both so we never
    // silently re-encode through a JS string and corrupt the byte stream.
    this.term.onData((d) => cb(Buffer.isBuffer(d) ? d : Buffer.from(d, "utf8")));
  }
  onExit(cb: (code: number) => void): void {
    this.term.onExit(({ exitCode }) => cb(exitCode));
  }
  write(data: Buffer): void {
    // IPty.write accepts a Buffer directly — passing it through avoids a lossy
    // utf8 round-trip of bytes the shell/terminal may not treat as text (#1059).
    this.term.write(data);
  }
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows);
  }
  kill(): void {
    try {
      this.term.kill();
    } catch {
      /* already gone */
    }
  }
}
