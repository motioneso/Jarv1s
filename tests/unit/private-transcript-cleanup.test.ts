import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createRealTmuxIo } from "@jarv1s/ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGY_IDENTITY_FILENAME,
  AGY_SESSION_LOG_FILENAME,
  CODEX_IDENTITY_FILENAME,
  captureAgyConversationIdentity,
  codexTranscriptPath,
  parseCodexSessionUuid,
  parseAgyConversationUuid,
  persistCodexSessionIdentity,
  purgeAgyBrainDir,
  purgePrivateTranscripts,
  readCodexSessionIdentity,
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
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "jarvis-private-purge-"));
    roots.push(root);
    const neutralBase = join(root, "neutral");
    const neutralDir = join(neutralBase, "user-1");
    const homeBase = join(root, "home");
    await mkdir(neutralDir, { recursive: true });
    return { io: createRealTmuxIo(), neutralBase, neutralDir, homeBase };
  }

  it("deletes only the exact marker-named Codex rollout", async () => {
    const { io, neutralBase, neutralDir, homeBase } = await fixture();
    const mine = "019f5af9-3c61-7f72-af47-09514db9892c";
    const sibling = "019f5af9-3c61-7f72-af47-09514db9892d";
    const minePath = codexTranscriptPath(mine, homeBase);
    const siblingPath = codexTranscriptPath(sibling, homeBase);
    await mkdir(dirname(minePath), { recursive: true });
    await writeFile(
      minePath,
      `${JSON.stringify({ type: "session_meta", payload: { id: mine, cwd: neutralDir } })}\n`
    );
    await writeFile(
      siblingPath,
      `${JSON.stringify({ type: "session_meta", payload: { id: sibling, cwd: neutralDir } })}\n`
    );
    await persistCodexSessionIdentity(io, neutralDir, mine);

    await purgePrivateTranscripts(io, neutralBase, "user-1", homeBase);

    await expect(access(minePath)).rejects.toThrow();
    await expect(readFile(siblingPath, "utf8")).resolves.toContain(sibling);
    await expect(stat(join(neutralDir, CODEX_IDENTITY_FILENAME))).rejects.toThrow();
  });

  it.each(["missing", "corrupt"])("retains every Codex rollout with a %s marker", async (kind) => {
    const { io, neutralBase, neutralDir, homeBase } = await fixture();
    const uuid = "019f5af9-3c61-7f72-af47-09514db9892c";
    const path = codexTranscriptPath(uuid, homeBase);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ type: "session_meta", payload: { id: uuid, cwd: neutralDir } })}\n`
    );
    if (kind === "corrupt")
      await writeFile(join(neutralDir, CODEX_IDENTITY_FILENAME), "../../shared-root\n");

    await purgePrivateTranscripts(io, neutralBase, "user-1", homeBase);

    await expect(readFile(path, "utf8")).resolves.toContain(uuid);
  });

  it("rejects same-id/different-cwd and deletes codex-exec only inside the exact neutral dir", async () => {
    const { io, neutralBase, neutralDir, homeBase } = await fixture();
    const uuid = "019f5af9-3c61-7f72-af47-09514db9892c";
    const path = codexTranscriptPath(uuid, homeBase);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ type: "session_meta", payload: { id: uuid, cwd: `${neutralDir}-other` } })}\n`
    );
    await persistCodexSessionIdentity(io, neutralDir, uuid);
    await writeFile(join(neutralDir, "codex-exec-transcript.jsonl"), "private\n");
    const otherNeutral = `${neutralDir}-other`;
    await mkdir(otherNeutral, { recursive: true });
    await writeFile(join(otherNeutral, "codex-exec-transcript.jsonl"), "sibling\n");

    await expect(purgePrivateTranscripts(io, neutralBase, "user-1", homeBase)).rejects.toThrow(
      "identity mismatch"
    );

    await expect(readFile(path, "utf8")).resolves.toContain(uuid);
    await expect(access(join(neutralDir, "codex-exec-transcript.jsonl"))).rejects.toThrow();
    await expect(readFile(join(otherNeutral, "codex-exec-transcript.jsonl"), "utf8")).resolves.toBe(
      "sibling\n"
    );
  });

  it("purges only the exact AGY marker directory engine-less", async () => {
    const { io, neutralBase, neutralDir, homeBase } = await fixture();
    const mine = "e099f770-a55c-432f-a9be-8cf254fd2d54";
    const sibling = "922f315d-bff5-4d42-86a5-a96a8620350c";
    const brain = join(homeBase, ".gemini", "antigravity-cli", "brain");
    await mkdir(join(brain, mine), { recursive: true });
    await mkdir(join(brain, sibling), { recursive: true });
    await writeFile(join(brain, mine, "private"), "mine");
    await writeFile(join(brain, sibling, "private"), "sibling");
    await writeFile(join(neutralDir, AGY_IDENTITY_FILENAME), `${mine}\n`);

    await purgePrivateTranscripts(io, neutralBase, "user-1", homeBase);

    await expect(access(join(brain, mine))).rejects.toThrow();
    await expect(readFile(join(brain, sibling, "private"), "utf8")).resolves.toBe("sibling");
  });
});

describe("Codex session identity", () => {
  const uuid = "019f5af9-3c61-7f72-af47-09514db9892c";

  it("accepts one exact /status Session UUID and rejects missing or ambiguous panes", () => {
    expect(parseCodexSessionUuid(`│  Session:  ${uuid}  │`)).toBe(uuid);
    expect(parseCodexSessionUuid("Session: unavailable")).toBeNull();
    expect(
      parseCodexSessionUuid(`Session: ${uuid}\nSession: 019f5acf-ba87-7553-872c-41572e6d0c49`)
    ).toBeNull();
  });

  it("accepts the ANSI SGR sequence emitted by codex v0.141.0 /status", () => {
    expect(
      parseCodexSessionUuid(
        "│  Session:                            \x1b[0m\x1b[39m\x1b[49m019f68f4-3ee4-75b2-8318-ac97fd9717f0\x1b[2m                      │"
      )
    ).toBe("019f68f4-3ee4-75b2-8318-ac97fd9717f0");
  });

  it("atomically persists and validates a 0600 marker", async () => {
    const io = makeIo();
    const neutralDir = "/data/cli-auth/chat/user-1";

    await persistCodexSessionIdentity(io, neutralDir, uuid);

    const marker = `${neutralDir}/${CODEX_IDENTITY_FILENAME}`;
    expect(io.writeFile).toHaveBeenCalledWith(`${marker}.tmp`, `${uuid}\n`);
    expect(io.run.mock.calls).toContainEqual(["chmod", ["600", `${marker}.tmp`]]);
    expect(io.run.mock.calls).toContainEqual(["mv", ["-f", `${marker}.tmp`, marker]]);

    io.readFile.mockResolvedValue(`${uuid}\n`);
    await expect(readCodexSessionIdentity(io, neutralDir)).resolves.toBe(uuid);
    io.readFile.mockResolvedValue("../../shared-root\n");
    await expect(readCodexSessionIdentity(io, neutralDir)).resolves.toBeNull();
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
