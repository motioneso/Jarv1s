import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_MODEL_SENTINEL,
  parseTranscript,
  transcriptGlobDir,
  type Multiplexer,
  type TmuxIo
} from "@jarv1s/ai";

import type { ChatRecordKind, CliChatEngine, EngineLaunchOpts, TranscriptRecord } from "./types.js";
import { writeClaudeOneShotPermissionHook } from "./claude-permission-hook.js";
import { vaultReadOnlyToolPatterns } from "./vault-allowlist.js";

const PROMPT_FILENAME = ".jarvis-claude-print-prompt.txt";
const PERSONA_FILENAME = "persona.md";
const CLAUDE_MCP_FILENAME = ".jarvis-claude-mcp.json";

export interface ClaudePrintChatEngineOpts {
  readonly mux?: Multiplexer;
  readonly homeBase?: string;
  readonly sessionId?: string;
  readonly credentialFile?: string;
}

export class ClaudePrintChatEngine implements CliChatEngine {
  readonly provider = "anthropic" as const;

  private readonly homeBase?: string;
  private readonly credentialFile?: string;
  private readonly sessionId: string;

  private launchOpts: EngineLaunchOpts | null = null;
  private personaPath: string | null = null;
  private transcriptPathValue: string | null = null;
  private currentProcess: ChildProcess | null = null;
  private hasSubmitted = false;

  constructor(
    _threadKey: string,
    private readonly io: TmuxIo,
    opts: ClaudePrintChatEngineOpts = {}
  ) {
    this.homeBase = opts.homeBase;
    this.credentialFile = opts.credentialFile;
    this.sessionId = opts.sessionId ?? randomUUID();
  }

  async launch(opts: EngineLaunchOpts): Promise<{ offset: number }> {
    this.launchOpts = opts;
    this.personaPath = await this.resolvePersonaPath(opts);
    const transcriptDir = transcriptGlobDir("anthropic", opts.neutralDir, this.homeBase);
    this.transcriptPathValue = join(transcriptDir, `${this.sessionId}.jsonl`);
    return { offset: 0 };
  }

  async submit(text: string): Promise<void> {
    if (this.launchOpts === null || this.personaPath === null) {
      throw new Error("ClaudePrintChatEngine.submit called before launch()");
    }

    const promptPath = join(this.launchOpts.neutralDir, PROMPT_FILENAME);
    await this.io.writeFile(promptPath, sanitizeInput(text));
    const launchLine = await this.buildCommand(this.launchOpts, promptPath);

    this.currentProcess = spawn("bash", ["-lc", launchLine], {
      cwd: this.launchOpts.neutralDir,
      detached: true,
      stdio: "ignore"
    });
    this.currentProcess.on("error", () => undefined);
    this.currentProcess.unref();
    this.hasSubmitted = true;
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    if (this.transcriptPathValue === null) {
      return { records: [], offset: afterOffset, complete: false };
    }

    let jsonl: string;
    try {
      jsonl = await this.io.readFile(this.transcriptPathValue);
    } catch {
      return { records: [], offset: afterOffset, complete: false };
    }

    const parsed = parseTranscript("anthropic", jsonl, afterOffset);
    const records: TranscriptRecord[] = parsed.events.map((event) => ({
      kind: event.kind as ChatRecordKind,
      text: event.text
    }));
    if (parsed.complete && parsed.reply !== null) {
      records.push({ kind: "reply", text: parsed.reply });
    }
    return { records, offset: jsonl.length, complete: parsed.complete };
  }

  async isAlive(): Promise<boolean> {
    return (
      this.currentProcess !== null &&
      this.currentProcess.exitCode === null &&
      this.currentProcess.signalCode === null
    );
  }

  async interrupt(): Promise<void> {
    if (this.currentProcess !== null) this.currentProcess.kill("SIGINT");
  }

  async kill(): Promise<void> {
    if (this.currentProcess !== null) this.currentProcess.kill();
    this.currentProcess = null;
  }

  private async resolvePersonaPath(opts: EngineLaunchOpts): Promise<string> {
    if (opts.personaText === undefined) return opts.personaPath;
    await this.io.run("mkdir", ["-p", opts.neutralDir]);
    const path = join(opts.neutralDir, PERSONA_FILENAME);
    await this.io.writeFile(path, opts.personaText);
    await this.io.run("chmod", ["600", path]);
    return path;
  }

  private async buildCommand(opts: EngineLaunchOpts, promptPath: string): Promise<string> {
    const claudeCmd =
      this.credentialFile && existsSync(this.credentialFile)
        ? `CLAUDE_CODE_OAUTH_TOKEN="$(cat ${shellQuote(this.credentialFile)})" claude`
        : "claude";
    const sessionFlag = this.hasSubmitted
      ? `--resume ${this.sessionId}`
      : `--session-id ${this.sessionId}`;
    const parts = [
      `cd ${shellQuote(opts.neutralDir)} &&`,
      claudeCmd,
      "-p",
      sessionFlag,
      "--permission-mode dontAsk"
    ];

    if (opts.mcpToken && opts.mcpServerUrl) {
      const mcpConfigPath = await this.writeClaudeMcpConfig(opts);
      const settingsPath = await writeClaudeOneShotPermissionHook(this.io, {
        neutralDir: opts.neutralDir
      });
      parts.push(`--mcp-config ${shellQuote(mcpConfigPath)}`);
      parts.push(`--settings ${shellQuote(settingsPath)}`);
      const allowedTools = ["mcp__jarvis__*", ...vaultReadOnlyToolPatterns()].join(" ");
      parts.push(`--allowedTools ${shellQuote(allowedTools)}`);
    } else {
      parts.push('--tools ""');
    }

    parts.push(
      `--append-system-prompt-file ${shellQuote(this.personaPath ?? opts.personaPath)}`,
      "--strict-mcp-config"
    );
    const modelFlag = modelOverrideFlag(opts);
    if (modelFlag) parts.push(modelFlag);
    parts.push(`"$(cat ${shellQuote(promptPath)})"`);

    return parts.join(" ");
  }

  private async writeClaudeMcpConfig(opts: EngineLaunchOpts): Promise<string> {
    const path = join(opts.neutralDir, CLAUDE_MCP_FILENAME);
    const mcpConfig = JSON.stringify({
      mcpServers: {
        jarvis: {
          type: "http",
          url: opts.mcpServerUrl,
          headers: { Authorization: `Bearer ${opts.mcpToken}` },
          timeout: 180000
        }
      }
    });
    await this.io.writeFile(path, mcpConfig);
    const chmod = await this.io.run("chmod", ["600", path]);
    if (chmod.code !== 0) {
      await this.io.run("rm", ["-f", path]);
      throw new Error(`Could not lock down Claude MCP config file: ${chmod.stderr ?? ""}`.trim());
    }
    return path;
  }
}

function sanitizeInput(text: string): string {
  return text.replace(/^(\s*)!+/, "$1");
}

function modelOverrideFlag(opts: EngineLaunchOpts): string | null {
  if (!opts.model || opts.model === DEFAULT_MODEL_SENTINEL) return null;
  return `--model ${shellQuote(opts.model)}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
