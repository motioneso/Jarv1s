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
      }
    });
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.term.onData((d) => cb(Buffer.from(d, "utf8")));
  }
  onExit(cb: (code: number) => void): void {
    this.term.onExit(({ exitCode }) => cb(exitCode));
  }
  write(data: Buffer): void {
    this.term.write(data.toString("utf8"));
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
