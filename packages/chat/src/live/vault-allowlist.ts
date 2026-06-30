import { normalize } from "node:path";

// Restricted charset: no "(", ")", or whitespace — those let a root break out of its own Tool(pattern) slot (smuggling e.g. a Bash(* grant) when space-joined into --allowedTools.
const VAULT_ROOT_CHARSET = /^\/[\w.-][\w./-]*$|^\/$/;

/** Fail-closed: reject a JARVIS_NOTES_ROOTS entry unless it's a clean, normalized absolute path with no "..", "(", ")", or whitespace. */
function isValidVaultRoot(root: string): boolean {
  if (!VAULT_ROOT_CHARSET.test(root)) return false;
  if (root.includes("..")) return false;
  if (root.length > 1 && root.endsWith("/")) return false;
  return normalize(root) === root;
}

/** #578 Part 1: read-only Read/Glob/Grep scoped to JARVIS_NOTES_ROOTS (the vault mount). Never write/exec. */
export function vaultReadOnlyToolPatterns(): string[] {
  const roots = (process.env["JARVIS_NOTES_ROOTS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter(isValidVaultRoot);
  return roots.flatMap((root) => [`Read(${root}/**)`, `Glob(${root}/**)`, `Grep(${root}/**)`]);
}
