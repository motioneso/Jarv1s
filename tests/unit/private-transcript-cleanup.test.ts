import { describe, expect, it, vi } from "vitest";

import {
  AGY_IDENTITY_FILENAME,
  AGY_SESSION_LOG_FILENAME,
  captureAgyConversationIdentity,
  parseAgyConversationUuid,
  purgeAgyBrainDir,
  purgePrivateTranscripts,
  readAgyConversationIdentity
} from "../../packages/chat/src/live/private-transcript-cleanup.js";

function makeIo() {
  return {
    run: vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" }),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined)
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

describe("AGY conversation identity", () => {
  const uuid = "e099f770-a55c-432f-a9be-8cf254fd2d54";
  const otherUuid = "922f315d-bff5-4d42-86a5-a96a8620350c";
  const neutralDir = "/data/cli-auth/chat/user-1";

  it("accepts one unique Created conversation UUID and rejects missing or ambiguous logs", () => {
    expect(parseAgyConversationUuid(`Created conversation ${uuid}\nSending user message`)).toBe(
      uuid
    );
    expect(
      parseAgyConversationUuid(`Created conversation ${uuid}\nCreated conversation ${uuid}`)
    ).toBe(uuid);
    expect(parseAgyConversationUuid("Sending user message")).toBeNull();
    expect(
      parseAgyConversationUuid(`Created conversation ${uuid}\nCreated conversation ${otherUuid}`)
    ).toBeNull();
  });

  it("atomically persists a session-owned log identity with mode 0600", async () => {
    const io = makeIo();
    io.readFile.mockResolvedValue(`Created conversation ${uuid}\nSending user message`);

    await expect(captureAgyConversationIdentity(io, neutralDir)).resolves.toBe(uuid);

    const marker = `${neutralDir}/${AGY_IDENTITY_FILENAME}`;
    const temp = `${marker}.tmp`;
    expect(io.readFile).toHaveBeenCalledWith(`${neutralDir}/${AGY_SESSION_LOG_FILENAME}`);
    expect(io.writeFile).toHaveBeenCalledWith(temp, `${uuid}\n`);
    expect(io.run.mock.calls).toContainEqual(["chmod", ["600", temp]]);
    expect(io.run.mock.calls).toContainEqual(["mv", ["-f", temp, marker]]);
  });

  it("does not create a marker when capture is missing or ambiguous", async () => {
    const io = makeIo();
    io.readFile.mockResolvedValue(
      `Created conversation ${uuid}\nCreated conversation ${otherUuid}`
    );

    await expect(captureAgyConversationIdentity(io, neutralDir)).resolves.toBeNull();

    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.run).not.toHaveBeenCalled();
  });

  it.each(["chmod", "mv"])("removes the temporary marker when %s fails", async (failedCmd) => {
    const io = makeIo();
    io.readFile.mockResolvedValue(`Created conversation ${uuid}\n`);
    io.run.mockImplementation(async (cmd: string) => ({
      code: cmd === failedCmd ? 1 : 0,
      stdout: "",
      stderr: ""
    }));

    await expect(captureAgyConversationIdentity(io, neutralDir)).rejects.toThrow();

    expect(io.run.mock.calls).toContainEqual([
      "rm",
      ["-f", `${neutralDir}/${AGY_IDENTITY_FILENAME}.tmp`]
    ]);
  });

  it("reads only a validated exact marker", async () => {
    const io = makeIo();
    io.readFile.mockResolvedValue(`${uuid}\n`);
    await expect(readAgyConversationIdentity(io, neutralDir)).resolves.toBe(uuid);

    io.readFile.mockResolvedValue("../../shared-root\n");
    await expect(readAgyConversationIdentity(io, neutralDir)).resolves.toBeNull();
  });
});
