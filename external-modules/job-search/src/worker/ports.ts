import type { ModuleFetchRequest, ModuleFetchResponse } from "@jarv1s/module-sdk";

import type { JobSearchKv } from "../domain/kv-port.js";

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

export interface WorkerPorts {
  readonly kv: JobSearchKv;
  readonly fetch: JobSearchFetch | null;
  readonly ai: JobSearchAi | null;
  now(): Date;
}

export interface JobSearchFetch {
  request(input: ModuleFetchRequest): Promise<ModuleFetchResponse>;
}

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

export function fetchFromWorkerContext(
  fetch: (input: ModuleFetchRequest) => Promise<ModuleFetchResponse>
): JobSearchFetch {
  return { request: fetch };
}
