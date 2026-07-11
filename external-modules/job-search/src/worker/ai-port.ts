// external-modules/job-search/src/worker/ai-port.ts
//
// JS-03 (#932) Task 4: structural AI port, mirroring the kv-port pattern —
// intentionally NOT an SDK import so the module builds against today's SDK
// and picks up the ctx.ai bridge (plan Task 0, worker-capabilities D6) when
// it lands. `ai` is nullable end-to-end: with no bridge the critique path
// degrades to an "AI critique unavailable" question (coordinator-approved
// graceful-degrade seam), never a crash.
import type { JobSearchKv } from "../domain/index.js";

export type JobSearchAiResult =
  | { readonly ok: true; readonly object: unknown }
  | { readonly ok: false; readonly error: string };

export interface JobSearchAiInput {
  readonly schema: Record<string, unknown>;
  readonly prompt: string;
  readonly maxOutputTokens?: number;
  readonly tierHint?: "reasoning" | "interactive" | "economy";
}

export interface JobSearchAi {
  generateStructured(input: JobSearchAiInput): Promise<JobSearchAiResult>;
}

/** The per-invocation dependencies every tool handler is written against. */
export interface WorkerPorts {
  readonly kv: JobSearchKv;
  readonly ai: JobSearchAi | null;
  now(): Date;
}

/**
 * Wrap a raw context AI port so rejections become a plain result. The
 * rejection reason is deliberately dropped: transport errors could carry
 * provider/model names, and module outputs must stay provider-agnostic.
 */
export function aiFromWorkerContext(ai: JobSearchAi): JobSearchAi {
  return {
    async generateStructured(input) {
      try {
        return await ai.generateStructured(input);
      } catch {
        return { ok: false, error: "provider_error" };
      }
    }
  };
}
