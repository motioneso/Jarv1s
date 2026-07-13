import { describe, expect, it, vi } from "vitest";

import {
  purgeAgyBrainDir,
  purgePrivateTranscripts
} from "../../packages/chat/src/live/private-transcript-cleanup.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    readFile: vi.fn().mockResolvedValue("")
  };
}

describe("purgePrivateTranscripts", () => {
  it("removes derived private transcripts without an engine object", async () => {
    const io = makeIo();
    io.run.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "find" && args[0]?.includes(".codex")) {
        return {
          code: 0,
          stdout:
            "/host-home/.codex/sessions/2026/07/08/rollout-mine.jsonl\n/host-home/.codex/sessions/2026/07/08/rollout-other.jsonl\n",
          stderr: ""
        };
      }
      if (cmd === "find" && args[0]?.includes(".gemini")) {
        return { code: 0, stdout: "", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    io.readFile.mockImplementation(async (path: string) => {
      if (path.endsWith("rollout-mine.jsonl")) {
        return JSON.stringify({
          type: "session_meta",
          payload: { cwd: "/data/cli-auth/chat/user-1", timestamp: new Date().toISOString() }
        });
      }
      return JSON.stringify({
        type: "session_meta",
        payload: { cwd: "/data/cli-auth/chat/other", timestamp: new Date().toISOString() }
      });
    });

    await purgePrivateTranscripts(io, "/data/cli-auth/chat", "user-1", "/host-home");

    expect(io.run).toHaveBeenCalledWith("rm", [
      "-rf",
      "/host-home/.claude/projects/-data-cli-auth-chat-user-1"
    ]);
    const rmCalls = io.run.mock.calls.filter((call: unknown[]) => call[0] === "rm");
    expect(rmCalls).toContainEqual(["rm", ["-f", expect.stringContaining("rollout-mine.jsonl")]]);
    expect(JSON.stringify(rmCalls)).not.toContain("rollout-other.jsonl");
    expect(JSON.stringify(io.run.mock.calls)).not.toContain(".gemini");
  });
});

describe("purgeAgyBrainDir", () => {
  it("removes only the captured conversation UUID subdirectory", async () => {
    const io = makeIo();
    const uuid = "e099f770-a55c-432f-a9be-8cf254fd2d54";

    await purgeAgyBrainDir(io, uuid, "/host-home");

    expect(io.run).toHaveBeenCalledOnce();
    expect(io.run).toHaveBeenCalledWith("rm", [
      "-rf",
      `/host-home/.gemini/antigravity-cli/brain/${uuid}`
    ]);
    expect(JSON.stringify(io.run.mock.calls)).not.toContain(
      '"/host-home/.gemini/antigravity-cli/brain"'
    );
  });

  it.each([null, undefined, "", "../brain", "not-a-uuid"])(
    "retains transcripts when no validated UUID was captured (%s)",
    async (capturedUuid) => {
      const io = makeIo();

      await purgeAgyBrainDir(io, capturedUuid, "/host-home");

      expect(io.run).not.toHaveBeenCalled();
    }
  );
});
