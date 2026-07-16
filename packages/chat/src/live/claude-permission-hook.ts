import { join } from "node:path";

import type { TmuxIo } from "@jarv1s/ai";

export const CLAUDE_PERMISSION_SETTINGS_FILENAME = ".jarvis-claude-settings.json";
export const CLAUDE_PERMISSION_HOOK_FILENAME = ".jarvis-claude-permission-hook.mjs";
export const CLAUDE_PERMISSION_TOKEN_FILENAME = ".jarvis-claude-permission-token";

const HOOK_TIMEOUT_SECONDS = 160;

export interface ClaudePermissionHookOpts {
  readonly neutralDir: string;
  readonly mcpToken: string;
  readonly mcpServerUrl: string;
}

export function deriveClaudePermissionUrl(mcpServerUrl: string): string {
  const url = new URL(mcpServerUrl);
  url.pathname = "/internal/permission";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function writeClaudePermissionHook(
  io: Pick<TmuxIo, "run" | "writeFile">,
  opts: ClaudePermissionHookOpts
): Promise<string> {
  await io.run("mkdir", ["-p", opts.neutralDir]);

  const settingsPath = join(opts.neutralDir, CLAUDE_PERMISSION_SETTINGS_FILENAME);
  const hookPath = join(opts.neutralDir, CLAUDE_PERMISSION_HOOK_FILENAME);
  const tokenPath = join(opts.neutralDir, CLAUDE_PERMISSION_TOKEN_FILENAME);
  const permissionUrl = deriveClaudePermissionUrl(opts.mcpServerUrl);
  const command = [
    `JARVIS_PERM_URL=${shellQuote(permissionUrl)}`,
    `JARVIS_PERM_TOKEN_FILE=${shellQuote(tokenPath)}`,
    "node",
    shellQuote(hookPath)
  ].join(" ");

  const settings = JSON.stringify(
    {
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }]
          }
        ]
      }
    },
    null,
    2
  );

  await io.writeFile(tokenPath, `${opts.mcpToken}\n`);
  await io.writeFile(hookPath, CLAUDE_PERMISSION_HOOK_SOURCE);
  await io.writeFile(settingsPath, settings);

  for (const path of [tokenPath, hookPath, settingsPath]) {
    const chmod = await io.run("chmod", ["600", path]);
    if (chmod.code !== 0) {
      await io.run("rm", ["-f", tokenPath, hookPath, settingsPath]);
      throw new Error(
        `Could not lock down Claude permission hook file: ${chmod.stderr ?? ""}`.trim()
      );
    }
  }

  return settingsPath;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const CLAUDE_PERMISSION_HOOK_SOURCE = `import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const INTERNAL_DEADLINE_MS = Number(process.env.JARVIS_PERM_DEADLINE_S ?? "150") * 1000;
const GATEWAY = process.env.JARVIS_PERM_URL ?? "";
const TOKEN_FILE = process.env.JARVIS_PERM_TOKEN_FILE ?? "";
const ROOT_PATTERN = /^\\/[\\w.-][\\w./-]*$/;

process.on("uncaughtException", () => decide("deny", "hook exception"));
process.on("unhandledRejection", () => decide("deny", "hook exception"));

function decide(permissionDecision, permissionDecisionReason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision,
      permissionDecisionReason
    }
  }));
  process.exit(0);
}

function validRoot(root) {
  if (root === "/" || !ROOT_PATTERN.test(root) || root.includes("..")) return false;
  if (root.length > 1 && root.endsWith("/")) return false;
  return path.posix.normalize(root) === root;
}

function roots() {
  return (process.env.JARVIS_NOTES_ROOTS ?? "")
    .split(",")
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .filter(validRoot);
}

function underRoot(candidate, root) {
  if (typeof candidate !== "string" || !candidate.startsWith("/") || candidate.includes("\\0")) {
    return false;
  }
  const normalized = path.posix.normalize(candidate);
  return normalized === root || normalized.startsWith(root + "/");
}

function readCandidate(tool, input) {
  if (tool === "Read") return input.file_path;
  if (tool === "Glob") return input.path ?? input.pattern;
  if (tool === "Grep") return input.path;
  return undefined;
}

function safeVaultRead(tool, input) {
  if (tool !== "Read" && tool !== "Glob" && tool !== "Grep") return false;
  const candidate = readCandidate(tool, input);
  return roots().some((root) => underRoot(candidate, root));
}

function stdinText() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

function postPermission(payload, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(GATEWAY);
    const body = JSON.stringify(payload);
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          authorization: "Bearer " + token
        }
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          clearTimeout(timer);
          if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
            reject(new Error("http_" + (res.statusCode ?? 0)));
            return;
          }
          try {
            resolve(JSON.parse(responseBody));
          } catch {
            reject(new Error("bad_json"));
          }
        });
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error("timeout"));
    }, INTERNAL_DEADLINE_MS);
    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  let event;
  try {
    event = JSON.parse(await stdinText());
  } catch {
    decide("deny", "unparseable hook input");
  }

  const tool = typeof event?.tool_name === "string" ? event.tool_name : "?";
  const input =
    event?.tool_input && typeof event.tool_input === "object" && !Array.isArray(event.tool_input)
      ? event.tool_input
      : {};

  if (safeVaultRead(tool, input)) {
    decide("allow", "pre-approved read-only vault path");
  }

  let token = "";
  try {
    token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    decide("deny", "missing session token");
  }
  if (!/^jst_[A-Za-z0-9-]+$/.test(token)) {
    decide("deny", "invalid session token");
  }

  let response;
  try {
    // #1085 F1: Claude supplies cwd on the real PreToolUse event. Forward it so the gateway can
    // enforce the F2/F3 workspace and config guards before native YOLO becomes reachable.
    response = await postPermission({ tool_name: tool, tool_input: input, cwd: event?.cwd }, token);
  } catch (error) {
    decide("deny", "gateway unreachable/timeout: " + error.constructor.name);
  }

  const allow = response?.decision === "allow";
  decide(allow ? "allow" : "deny", response?.reason || "user decision via action_request card");
}

void main();
`;
