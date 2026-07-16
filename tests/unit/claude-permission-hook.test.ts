import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import {
  CLAUDE_PERMISSION_HOOK_SOURCE,
  CLAUDE_PERMISSION_SETTINGS_FILENAME,
  CLAUDE_PERMISSION_TOKEN_FILENAME,
  deriveClaudePermissionUrl,
  writeClaudePermissionHook
} from "../../packages/chat/src/live/claude-permission-hook.js";
import type { TmuxIo } from "@jarv1s/ai";

function fakeIo(): TmuxIo & {
  writes: Map<string, string>;
  runs: Array<[string, readonly string[]]>;
} {
  return {
    writes: new Map(),
    runs: [],
    async run(cmd, args) {
      this.runs.push([cmd, args]);
      return { code: 0, stdout: "", stderr: "" };
    },
    async readFile(path) {
      const value = this.writes.get(path);
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    },
    async writeFile(path, content) {
      this.writes.set(path, content);
    },
    async sleep() {}
  };
}

async function runHook(
  input: unknown,
  env: Record<string, string | undefined>
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "jarvis-hook-"));
  const hookPath = join(dir, "hook.mjs");
  await writeFile(hookPath, CLAUDE_PERMISSION_HOOK_SOURCE);
  try {
    const child = spawn(process.execPath, [hookPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"]
    });
    child.stdin.end(JSON.stringify(input));
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
    return { code, stdout, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Claude PreToolUse permission hook", () => {
  const originalRoots = process.env.JARVIS_NOTES_ROOTS;

  afterEach(() => {
    if (originalRoots === undefined) delete process.env.JARVIS_NOTES_ROOTS;
    else process.env.JARVIS_NOTES_ROOTS = originalRoots;
  });

  it("derives the internal permission endpoint from the MCP URL host", () => {
    expect(deriveClaudePermissionUrl("http://api:3000/api/mcp")).toBe(
      "http://api:3000/internal/permission"
    );
  });

  it("writes settings, hook, and a separate 0600 bearer token file without putting the bearer in command text", async () => {
    const io = fakeIo();

    const settingsPath = await writeClaudePermissionHook(io, {
      neutralDir: "/tmp/session",
      mcpToken: "jst_secret",
      mcpServerUrl: "http://api:3000/api/mcp"
    });

    expect(settingsPath).toBe(`/tmp/session/${CLAUDE_PERMISSION_SETTINGS_FILENAME}`);
    expect(io.writes.get(`/tmp/session/${CLAUDE_PERMISSION_TOKEN_FILENAME}`)).toBe("jst_secret\n");
    expect(io.writes.get("/tmp/session/.jarvis-claude-permission-hook.mjs")).toContain(
      "PreToolUse"
    );
    const settings = io.writes.get(settingsPath) ?? "";
    expect(settings).toContain("PreToolUse");
    expect(settings).toContain("JARVIS_PERM_TOKEN_FILE=");
    expect(settings).toContain("http://api:3000/internal/permission");
    expect(settings).not.toContain("jst_secret");
    expect(io.runs).toContainEqual([
      "chmod",
      ["600", `/tmp/session/${CLAUDE_PERMISSION_TOKEN_FILENAME}`]
    ]);
  });

  it("allows configured vault reads without calling the gateway", async () => {
    const result = await runHook(
      { tool_name: "Read", tool_input: { file_path: "/vault/a.md" } },
      { JARVIS_NOTES_ROOTS: "/vault" }
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("denies with exit 0 when token file is missing", async () => {
    const result = await runHook(
      { tool_name: "Bash", tool_input: { command: "echo hi" } },
      {
        JARVIS_PERM_URL: "http://127.0.0.1:1/internal/permission",
        JARVIS_PERM_TOKEN_FILE: "/no/such/token"
      }
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.stderr).toBe("");
  });

  it("obeys gateway approve and deny decisions through the bearer header", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jarvis-token-"));
    const tokenFile = join(dir, "token");
    await writeFile(tokenFile, "jst_ok\n");
    const seenHeaders: string[] = [];
    const seenBodies: unknown[] = [];
    const server = createServer((req, res) => {
      seenHeaders.push(String(req.headers.authorization ?? ""));
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        seenBodies.push(JSON.parse(body));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ decision: "allow", reason: "approved" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    try {
      const result = await runHook(
        { tool_name: "Bash", tool_input: { command: "echo hi" }, cwd: "/real/workspace" },
        {
          JARVIS_PERM_URL: `http://127.0.0.1:${address.port}/internal/permission`,
          JARVIS_PERM_TOKEN_FILE: tokenFile
        }
      );

      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe("allow");
      expect(seenHeaders).toEqual(["Bearer jst_ok"]);
      // #1085 F1: assert the generated hook forwards Claude's actual event cwd, not a test-only
      // gateway request field that can drift from production again.
      expect(seenBodies).toEqual([
        { tool_name: "Bash", tool_input: { command: "echo hi" }, cwd: "/real/workspace" }
      ]);
    } finally {
      server.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
