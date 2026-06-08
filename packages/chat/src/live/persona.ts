/**
 * Per-user neutral-directory + persona context-file renderer.
 *
 * The chat CLI runs in a neutral working directory OUTSIDE the repo (so it can't
 * see the codebase). This module resolves that per-user directory and writes the
 * Jarvis persona into the provider-specific context filename so the CLI
 * auto-loads it on launch — and reloads it after `/clear`.
 *
 * Filesystem I/O is injected via the small `PersonaFs` seam so this is
 * unit-testable without touching the real disk.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ProviderKind } from "@jarv1s/ai";

/** Minimal filesystem seam — injected so tests can avoid real disk writes. */
export interface PersonaFs {
  /** Create a directory and any missing parents (recursive). */
  mkdir(path: string): Promise<void>;
  /** Write file content, overwriting if it exists. */
  writeFile(path: string, content: string): Promise<void>;
}

export interface RenderPersonaInput {
  readonly userId: string;
  readonly userName: string;
  readonly provider: ProviderKind;
  /** Override the base dir; else JARVIS_CHAT_HOME or <homedir>/.jarvis/chat. */
  readonly baseDir?: string;
  /** Persona text; any `{{userName}}` token is replaced with input.userName. */
  readonly persona: string;
}

/** Provider → CLI context filename auto-loaded from the working directory. */
const CONTEXT_FILENAME: Record<ProviderKind, string> = {
  anthropic: "CLAUDE.md",
  "openai-compatible": "AGENTS.md",
  google: "GEMINI.md"
};

/** Resolve the base directory for per-user neutral chat dirs. */
function resolveBaseDir(override?: string): string {
  if (override !== undefined) return override;
  return process.env.JARVIS_CHAT_HOME ?? join(homedir(), ".jarvis", "chat");
}

/**
 * Ensure the user's neutral dir exists and write the persona into the
 * provider's context filename. Returns the resolved dir and file path.
 */
export async function renderPersona(
  fs: PersonaFs,
  input: RenderPersonaInput
): Promise<{ neutralDir: string; personaPath: string }> {
  const neutralDir = join(resolveBaseDir(input.baseDir), input.userId);
  const personaPath = join(neutralDir, CONTEXT_FILENAME[input.provider]);
  const content = input.persona.replaceAll("{{userName}}", input.userName);

  await fs.mkdir(neutralDir);
  await fs.writeFile(personaPath, content);

  return { neutralDir, personaPath };
}

/** Real filesystem implementation backed by node:fs/promises. */
export function createRealPersonaFs(): PersonaFs {
  return {
    mkdir: async (path: string) => {
      await mkdir(path, { recursive: true });
    },
    writeFile: async (path: string, content: string) => {
      await writeFile(path, content, "utf8");
    }
  };
}
