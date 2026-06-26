import { join } from "node:path";

import {
  agyPrintTranscriptRoot,
  parseTranscript,
  TmuxMultiplexer,
  type Multiplexer,
  type MuxHandle,
  type TmuxIo
} from "@jarv1s/ai";

import type { ChatRecordKind, CliChatEngine, EngineLaunchOpts, TranscriptRecord } from "./types.js";

const PROMPT_FILENAME = ".jarvis-agy-print-prompt.txt";

export interface AgyPrintChatEngineOpts {
  readonly mux?: Multiplexer;
  readonly homeBase?: string;
}

export class AgyPrintChatEngine implements CliChatEngine {
  readonly provider = "google" as const;
  private readonly mux: Multiplexer;
  private readonly homeBase?: string;
  private neutralDir: string | null = null;
  private transcriptPath: string | null = null;
  private currentHandle: MuxHandle | null = null;
  private hasSubmitted = false;
  private launchEpoch = 0;

  constructor(
    private readonly threadKey: string,
    private readonly io: TmuxIo,
    opts: AgyPrintChatEngineOpts = {}
  ) {
    this.mux = opts.mux ?? new TmuxMultiplexer(io);
    this.homeBase = opts.homeBase;
  }

  async launch(opts: EngineLaunchOpts): Promise<{ offset: number }> {
    this.neutralDir = opts.neutralDir;
    this.launchEpoch = Date.now();
    if (opts.personaText !== undefined) {
      await this.io.writeFile(join(opts.neutralDir, "persona.md"), opts.personaText);
    }
    return { offset: 0 };
  }

  async submit(text: string): Promise<void> {
    if (this.neutralDir === null) throw new Error("AgyPrintChatEngine.submit called before launch()");
    const promptPath = join(this.neutralDir, PROMPT_FILENAME);
    await this.io.writeFile(promptPath, text.replace(/^(\s*)!+/, "$1"));
    const continueFlag = this.hasSubmitted ? "--continue " : "";
    this.hasSubmitted = true;
    this.currentHandle = await this.mux.open({
      name: `jarv1s-live-${this.threadKey}`,
      cols: 220,
      rows: 50,
      launchLine:
        `cd ${shellQuote(this.neutralDir)} && ` +
        `agy --dangerously-skip-permissions ${continueFlag}--print "$(cat ${shellQuote(promptPath)})"`
    });
  }

  async readNew(afterOffset: number): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
    const path = await this.resolveTranscriptPath();
    if (path === null) return { records: [], offset: afterOffset, complete: false };
    let jsonl: string;
    try {
      jsonl = await this.io.readFile(path);
    } catch {
      return { records: [], offset: afterOffset, complete: false };
    }
    const parsed = parseTranscript("google", jsonl, afterOffset);
    const records: TranscriptRecord[] = parsed.events.map((event) => ({
      kind: event.kind as ChatRecordKind,
      text: event.text
    }));
    if (parsed.complete && parsed.reply !== null) records.push({ kind: "reply", text: parsed.reply });
    return { records, offset: jsonl.length, complete: parsed.complete };
  }

  async isAlive(): Promise<boolean> {
    return this.currentHandle !== null ? this.mux.isAlive(this.currentHandle) : false;
  }

  async kill(): Promise<void> {
    if (this.currentHandle !== null) await this.mux.kill(this.currentHandle);
    this.currentHandle = null;
  }

  private async resolveTranscriptPath(): Promise<string | null> {
    if (this.transcriptPath !== null) return this.transcriptPath;
    const root = agyPrintTranscriptRoot(this.homeBase);
    const found = await this.io.run("find", [
      root,
      "-name",
      "transcript_full.jsonl",
      "-type",
      "f",
      "-newermt",
      new Date(this.launchEpoch - 5000).toISOString(),
      "-print"
    ]);
    if (found.code !== 0) return null;
    const newest = found.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    this.transcriptPath = newest ?? null;
    return this.transcriptPath;
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
