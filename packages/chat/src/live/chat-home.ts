import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve the base directory for per-user neutral chat dirs. */
export function resolveChatHome(override?: string): string {
  if (override !== undefined) return override;
  return process.env.JARVIS_CHAT_HOME ?? join(homedir(), ".jarvis", "chat");
}
