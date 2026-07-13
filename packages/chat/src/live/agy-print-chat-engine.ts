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
import {
  AGY_SESSION_LOG_FILENAME,
  captureAgyConversationIdentity,
  purgeAgyBrainDir,
  readAgyConversationIdentity
} from "./private-transcript-cleanup.js";

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
  private conversationUuid: string | null = null;
  private currentHandle: MuxHandle | null = null;
  private hasSubmitted = false;

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
    this.conversationUuid = null;
    this.hasSubmitted = false;
    if (opts.personaText !== undefined) {
      await this.io.writeFile(join(opts.neutralDir, "persona.md"), opts.personaText);
    }
    return { offset: 0 };
  }

  async submit(text: string): Promise<void> {
    if (this.neutralDir === null)
      throw new Error("AgyPrintChatEngine.submit called before launch()");
    const promptPath = join(this.neutralDir, PROMPT_FILENAME);
    await this.io.writeFile(promptPath, text.replace(/^(\s*)!+/, "$1"));
    if (this.hasSubmitted && this.conversationUuid === null) {
      throw new Error("AGY conversation identity unavailable for continuation");
    }
    const conversationFlag = this.conversationUuid
      ? `--conversation ${this.conversationUuid} `
      : "";
    this.hasSubmitted = true;
    const logPath = join(this.neutralDir, AGY_SESSION_LOG_FILENAME);
    this.currentHandle = await this.mux.open({
      name: `jarv1s-live-${this.threadKey}`,
      cols: 220,
      rows: 50,
      launchLine:
        `cd ${shellQuote(this.neutralDir)} && ` +
        `agy --dangerously-skip-permissions ${conversationFlag}--print ` +
        `--log-file ${shellQuote(logPath)} "$(cat ${shellQuote(promptPath)})"`
    });
  }

  async readNew(
    afterOffset: number
  ): Promise<{ records: TranscriptRecord[]; offset: number; complete: boolean }> {
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
    if (parsed.complete && parsed.reply !== null)
      records.push({ kind: "reply", text: parsed.reply });
    return { records, offset: jsonl.length, complete: parsed.complete };
  }

  async isAlive(): Promise<boolean> {
    return this.currentHandle !== null ? this.mux.isAlive(this.currentHandle) : false;
  }

  async interrupt(): Promise<void> {
    if (this.currentHandle !== null) await this.mux.interrupt(this.currentHandle);
  }

  async kill(): Promise<void> {
    if (this.currentHandle !== null) await this.mux.kill(this.currentHandle);
    this.currentHandle = null;
  }

  async purgeTranscripts(): Promise<void> {
    const uuid =
      this.conversationUuid ??
      (this.neutralDir ? await readAgyConversationIdentity(this.io, this.neutralDir) : null);
    if (uuid === null) {
      if (this.hasSubmitted) throw new Error("AGY conversation identity unavailable for purge");
      return;
    }
    if (!(await purgeAgyBrainDir(this.io, uuid, this.homeBase))) {
      throw new Error("Could not purge AGY conversation transcript");
    }
  }

  private async resolveTranscriptPath(): Promise<string | null> {
    if (this.neutralDir === null) return null;
    this.conversationUuid ??= await captureAgyConversationIdentity(this.io, this.neutralDir);
    return this.conversationUuid
      ? join(
          agyPrintTranscriptRoot(this.homeBase),
          this.conversationUuid,
          ".system_generated",
          "logs",
          "transcript_full.jsonl"
        )
      : null;
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
