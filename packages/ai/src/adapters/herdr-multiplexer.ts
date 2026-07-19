/**
 * HerdrMultiplexer — Multiplexer backend over the herdr terminal workspace
 * manager (`herdr pane …` socket API, v0.6.8). herdr emits JSON by default
 * (no --json flag): envelope { id, result, type }. Unlike tmux, herdr has no
 * "new detached session" verb: a pane is split from a root pane and the server
 * assigns an OPAQUE pane id. open() therefore returns that id as the handle; the
 * engine stores it and never reconstructs it (the Multiplexer asymmetry).
 * cols/rows and the `name` hint are tmux-specific and intentionally unused here —
 * herdr auto-sizes and assigns its own id.
 *
 * Root resolution (NO "first pane in `pane list`" default — that could split
 * from an unrelated operator/agent pane on a shared herdr server, Codex #4):
 *   opts.rootPane → opts.rootTab/env.JARVIS_HERDR_ROOT_TAB → env.JARVIS_HERDR_ROOT_PANE
 *   → env.HERDR_PANE_ID (the server's own pane) → hard error.
 *
 * The tab path resolves a root by TAB LABEL, creating the tab if absent, then splits a
 * live pane inside it. Unlike a static pane id, this self-heals: if the tab is closed
 * (or the herdr server restarts and all pane ids change), the next open() re-finds or
 * re-creates the named tab — chats keep landing in their dedicated tab without a manual
 * re-point. Pinning to a pane id stays available for tests/explicit control.
 *
 * Every herdr command's exit code is checked; a non-zero exit throws (so a missing
 * binary via the JARVIS_MULTIPLEXER override, or a transient socket failure, fails
 * loudly instead of returning a dead handle — Codex #3/#5). kill() is the sole
 * exception: it ignores the exit code (idempotent per the Multiplexer contract).
 */
import type { TmuxIo } from "./tmux-bridge.js";
import type { Multiplexer, MuxHandle, MuxOpenOpts } from "./multiplexer.js";
import { redactSecrets } from "./redact.js";

export interface HerdrMultiplexerOpts {
  /** Parent pane to split from; highest precedence (tests/explicit control). */
  readonly rootPane?: string;
  /** Tab label to resolve-or-create and split inside; else JARVIS_HERDR_ROOT_TAB. */
  readonly rootTab?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export class HerdrMultiplexer implements Multiplexer {
  readonly kind = "herdr" as const;
  private readonly rootPaneOverride?: string;
  private readonly rootTabOverride?: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly io: TmuxIo,
    opts: HerdrMultiplexerOpts = {}
  ) {
    this.rootPaneOverride = opts.rootPane;
    this.rootTabOverride = opts.rootTab;
    this.env = opts.env ?? process.env;
  }

  async open(opts: MuxOpenOpts): Promise<MuxHandle> {
    const root = await this.resolveRoot();
    const split = await this.io.run("herdr", [
      "pane",
      "split",
      root,
      "--direction",
      "down",
      "--no-focus"
    ]);
    if (split.code !== 0) {
      throw new Error(
        `HerdrMultiplexer.open: herdr pane split failed (code ${split.code}): ${redactSecrets(split.stderr)}`
      );
    }
    const paneId = paneIdFromInfo(split.stdout);
    if (!paneId) {
      throw new Error(
        "HerdrMultiplexer.open: could not parse pane_id from `herdr pane split` JSON"
      );
    }
    // The pane now exists; any failure typing the launch line must close it so a
    // half-launched pane is never orphaned (the caller only stores the handle on
    // success, so it could never close it otherwise).
    try {
      // Launch symmetrically with tmux: type the launch line, then submit Enter.
      await this.runChecked(["pane", "send-text", paneId, opts.launchLine], "send-text");
      await this.runChecked(["pane", "send-keys", paneId, "Enter"], "send-keys");
    } catch (err) {
      await this.kill(paneId).catch(() => {
        // ignore — the launch error is the one worth surfacing.
      });
      throw err;
    }
    return paneId;
  }

  async clearComposer(handle: MuxHandle): Promise<void> {
    await this.runChecked(["pane", "send-keys", handle, "C-u"], "send-keys");
  }

  async clearComposerHard(handle: MuxHandle): Promise<void> {
    // #1170: see TmuxMultiplexer.clearComposerHard — C-u cannot empty a multiline
    // composer; a single Ctrl+C can. Only sent when the composer is known non-empty.
    await this.runChecked(["pane", "send-keys", handle, "C-c"], "send-keys");
  }

  async capturePane(handle: MuxHandle): Promise<string> {
    const { code, stdout, stderr } = await this.io.run("herdr", [
      "pane",
      "read",
      handle,
      "--source",
      "visible",
      "--lines",
      "200"
    ]);
    if (code !== 0) {
      throw new Error(
        `HerdrMultiplexer: herdr pane read failed (code ${code}): ${redactSecrets(stderr)}`
      );
    }
    return stdout;
  }

  async paste(handle: MuxHandle, text: string): Promise<void> {
    await this.runChecked(["pane", "send-text", handle, text], "send-text");
  }

  async pressEnter(handle: MuxHandle): Promise<void> {
    await this.runChecked(["pane", "send-keys", handle, "Enter"], "send-keys");
  }

  async submit(handle: MuxHandle, text: string): Promise<void> {
    await this.paste(handle, text);
    await this.pressEnter(handle);
  }

  async interrupt(handle: MuxHandle): Promise<void> {
    await this.runChecked(["pane", "send-keys", handle, "Escape"], "send-keys");
  }

  async isAlive(handle: MuxHandle): Promise<boolean> {
    const { code } = await this.io.run("herdr", ["pane", "get", handle]);
    return code === 0;
  }

  async kill(handle: MuxHandle): Promise<void> {
    // Idempotent per the Multiplexer contract: closing an absent pane is not an error.
    await this.io.run("herdr", ["pane", "close", handle]);
  }

  attachCommand(handle: MuxHandle): string {
    return `herdr   # then focus pane ${handle}`;
  }

  private async resolveRoot(): Promise<string> {
    // 1. Explicit pane override (tests / programmatic) wins.
    const explicitPane = this.rootPaneOverride?.trim();
    if (explicitPane) return explicitPane;
    // 2. Tab-by-label: resolve-or-create the named tab, then a live pane within it.
    //    Self-heals across tab-close and herdr-server restarts (ids are not pinned).
    const tabLabel = this.rootTabOverride?.trim() || this.env.JARVIS_HERDR_ROOT_TAB?.trim();
    if (tabLabel) return this.ensureTabPane(tabLabel);
    // 3. Static pane id, then the API's own pane.
    const root = this.env.JARVIS_HERDR_ROOT_PANE?.trim() || this.env.HERDR_PANE_ID?.trim();
    if (!root) {
      throw new Error(
        "HerdrMultiplexer: no root pane or tab (set JARVIS_HERDR_ROOT_TAB or JARVIS_HERDR_ROOT_PANE, or run the API inside a herdr pane so HERDR_PANE_ID is set)"
      );
    }
    return root;
  }

  /** Resolve a live pane inside the tab labelled `label`, creating the tab if absent. */
  private async ensureTabPane(label: string): Promise<string> {
    let tabId = await this.findTabByLabel(label);
    if (!tabId) {
      const created = await this.io.run("herdr", ["tab", "create", "--label", label, "--no-focus"]);
      if (created.code !== 0) {
        throw new Error(
          `HerdrMultiplexer: herdr tab create "${label}" failed (code ${created.code}): ${redactSecrets(created.stderr)}`
        );
      }
      tabId = await this.findTabByLabel(label);
      if (!tabId) {
        throw new Error(
          `HerdrMultiplexer: created tab "${label}" but it did not appear in \`herdr tab list\``
        );
      }
    }
    const paneId = await this.firstPaneInTab(tabId);
    if (!paneId) {
      throw new Error(`HerdrMultiplexer: tab "${label}" (${tabId}) has no pane to split from`);
    }
    return paneId;
  }

  private async findTabByLabel(label: string): Promise<string | null> {
    const { code, stdout, stderr } = await this.io.run("herdr", ["tab", "list"]);
    if (code !== 0) {
      throw new Error(
        `HerdrMultiplexer: herdr tab list failed (code ${code}): ${redactSecrets(stderr)}`
      );
    }
    return tabsFromList(stdout).find((t) => t.label === label)?.tabId ?? null;
  }

  private async firstPaneInTab(tabId: string): Promise<string | null> {
    const { code, stdout, stderr } = await this.io.run("herdr", ["pane", "list"]);
    if (code !== 0) {
      throw new Error(
        `HerdrMultiplexer: herdr pane list failed (code ${code}): ${redactSecrets(stderr)}`
      );
    }
    return panesFromList(stdout).find((p) => p.tabId === tabId)?.paneId ?? null;
  }

  private async runChecked(args: readonly string[], label: string): Promise<void> {
    const { code, stderr } = await this.io.run("herdr", args);
    if (code !== 0) {
      throw new Error(
        `HerdrMultiplexer: herdr ${label} failed (code ${code}): ${redactSecrets(stderr)}`
      );
    }
  }
}

interface HerdrEnvelope {
  result?: { pane?: { pane_id?: unknown } };
}

function parseHerdr(stdout: string): HerdrEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as HerdrEnvelope;
  } catch {
    throw new Error(`HerdrMultiplexer: expected JSON from herdr, got: ${trimmed.slice(0, 120)}`);
  }
}

/** `herdr pane split` → { result: { pane: { pane_id } }, type: "pane_info" }. */
function paneIdFromInfo(stdout: string): string | null {
  const id = parseHerdr(stdout)?.result?.pane?.pane_id;
  return typeof id === "string" && id ? id : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function resultArray(stdout: string, key: string): unknown[] {
  const result = asRecord(asRecord(parseHerdr(stdout) as unknown)?.result);
  const items = result?.[key];
  return Array.isArray(items) ? items : [];
}

/** `herdr tab list` → { result: { tabs: [{ tab_id, label }] } }. */
function tabsFromList(stdout: string): { tabId: string; label: string }[] {
  const out: { tabId: string; label: string }[] = [];
  for (const item of resultArray(stdout, "tabs")) {
    const rec = asRecord(item);
    const tabId = rec?.tab_id;
    const label = rec?.label;
    if (typeof tabId === "string" && typeof label === "string") out.push({ tabId, label });
  }
  return out;
}

/** `herdr pane list` → { result: { panes: [{ pane_id, tab_id }] } }. */
function panesFromList(stdout: string): { paneId: string; tabId: string }[] {
  const out: { paneId: string; tabId: string }[] = [];
  for (const item of resultArray(stdout, "panes")) {
    const rec = asRecord(item);
    const paneId = rec?.pane_id;
    const tabId = rec?.tab_id;
    if (typeof paneId === "string" && typeof tabId === "string") out.push({ paneId, tabId });
  }
  return out;
}
