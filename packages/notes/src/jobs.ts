import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import type { Job, PgBoss } from "pg-boss";

import type { DataContextDb, DataContextRunner } from "@jarv1s/db";
import {
  type ActorScopedJobPayload,
  type QueueDefinition,
  registerDataContextWorker
} from "@jarv1s/jobs";
import type { EmbeddingProvider } from "@jarv1s/memory";
import { MemoryRepository, parseDocument, type NewChunkData } from "@jarv1s/memory";

import { resolveNotesRoots } from "@jarv1s/settings";
import { assertWithinRoot, NotesPathError } from "./path-guard.js";
import { NOTES_SYNC_QUEUE } from "./manifest.js";

const NOTES_SOURCE_KIND = "notes";

export interface NotesSyncJobPayload extends ActorScopedJobPayload {
  readonly sourcePath: string;
}

export interface NotesSyncJobResult {
  readonly ingested: number;
  readonly skipped: number;
  readonly errors: number;
}

export const NOTES_QUEUE_DEFINITIONS: readonly QueueDefinition[] = [
  {
    name: NOTES_SYNC_QUEUE,
    options: {
      policy: "exclusive",
      retryLimit: 0,
      deleteAfterSeconds: 300,
      retentionSeconds: 300
    }
  }
];

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectMarkdownFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push(entryPath);
    }
  }
  return result;
}

export async function handleNotesSyncJob(
  job: Job<NotesSyncJobPayload>,
  scopedDb: DataContextDb,
  embeddingProvider: EmbeddingProvider
): Promise<NotesSyncJobResult> {
  const { actorUserId, sourcePath } = job.data;

  const allowedRoots = resolveNotesRoots();
  if (allowedRoots.length === 0) {
    throw new Error("JARVIS_NOTES_ROOTS not configured — notes sync aborted");
  }

  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(sourcePath);
  } catch {
    throw new Error(`Notes source path does not exist: ${sourcePath}`);
  }

  const isWithinAllowed = allowedRoots.some(
    (root) => resolvedRoot === root || resolvedRoot.startsWith(root + "/")
  );
  if (!isWithinAllowed) {
    throw new Error(`Notes source path "${resolvedRoot}" is not within any allowed root`);
  }

  const repository = new MemoryRepository();
  const mdFiles = await collectMarkdownFiles(resolvedRoot);

  let ingested = 0;
  let skipped = 0;
  let errors = 0;

  for (const absolutePath of mdFiles) {
    try {
      let resolvedFile: string;
      try {
        resolvedFile = await realpath(absolutePath);
      } catch {
        errors += 1;
        continue;
      }

      try {
        assertWithinRoot(resolvedRoot, resolvedFile);
      } catch (e) {
        if (e instanceof NotesPathError) {
          errors += 1;
          continue;
        }
        throw e;
      }

      const content = await readFile(resolvedFile, "utf-8");
      const fileHash = createHash("sha256").update(content).digest("hex");

      const existing = await repository.getFileIndex(
        scopedDb,
        actorUserId,
        NOTES_SOURCE_KIND,
        resolvedFile
      );

      if (
        existing &&
        existing.fileHash === fileHash &&
        existing.embedModelName === embeddingProvider.modelName
      ) {
        skipped += 1;
        continue;
      }

      const { chunks, wikilinks } = parseDocument(content);

      const newChunks: NewChunkData[] = await Promise.all(
        chunks.map(async (chunk) => ({
          sourcePath: resolvedFile,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          contentHash: createHash("sha256").update(chunk.text).digest("hex"),
          text: chunk.text,
          embedding: await embeddingProvider.embedDocument(chunk.text)
        }))
      );

      await repository.upsertFileChunks(
        scopedDb,
        actorUserId,
        resolvedFile,
        newChunks,
        embeddingProvider.modelName,
        embeddingProvider.modelVersion,
        NOTES_SOURCE_KIND
      );

      await repository.replaceFileLinks(scopedDb, actorUserId, resolvedFile, wikilinks);

      await repository.upsertFileIndex(
        scopedDb,
        actorUserId,
        NOTES_SOURCE_KIND,
        resolvedFile,
        fileHash,
        newChunks.length,
        embeddingProvider.modelName,
        embeddingProvider.modelVersion
      );

      ingested += 1;
    } catch {
      errors += 1;
    }
  }

  return { ingested, skipped, errors };
}

export interface RegisterNotesJobWorkersOptions {
  readonly embeddingProvider: EmbeddingProvider;
}

export async function registerNotesJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterNotesJobWorkersOptions
): Promise<readonly string[]> {
  const workId = await registerDataContextWorker<NotesSyncJobPayload, NotesSyncJobResult>(
    boss,
    NOTES_SYNC_QUEUE,
    dataContext,
    (job, scopedDb) => handleNotesSyncJob(job, scopedDb, options.embeddingProvider)
  );
  return [workId];
}
