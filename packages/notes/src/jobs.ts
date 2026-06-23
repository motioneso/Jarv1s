import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import type { Job, PgBoss } from "pg-boss";

import type { AccessContext, DataContextDb, DataContextRunner } from "@jarv1s/db";
import { type ActorScopedJobPayload, type QueueDefinition, toAccessContext } from "@jarv1s/jobs";
import type { EmbeddingProvider } from "@jarv1s/memory";
import { MemoryRepository, parseDocument, type NewChunkData } from "@jarv1s/memory";
import { NOTES_SOURCE_PREFERENCE_KEY, resolveNotesRoots } from "@jarv1s/settings";
import type { PreferencesRepository } from "@jarv1s/structured-state";

import { assertWithinRoot, NotesPathError } from "./path-guard.js";
import { NOTES_SYNC_QUEUE } from "./manifest.js";

const NOTES_SOURCE_KIND = "notes";
const NOTES_LAST_SYNC_PREFERENCE_KEY = "notes-last-sync";

export interface NotesSyncJobPayload extends ActorScopedJobPayload {
  /**
   * Optional. The manual POST route passes it explicitly; the 15-min scheduled
   * fire omits it and the handler resolves from the `notes-source-path`
   * preference (the single source of truth — a re-point via PUT is picked up on
   * the next tick without rewriting the schedule row).
   */
  readonly sourcePath?: string;
}

export interface NotesSyncJobResult {
  readonly ingested: number;
  readonly skipped: number;
  readonly errors: number;
}

export interface NotesLastSync {
  readonly at: string;
  readonly ingested: number;
  readonly skipped: number;
  readonly errors: number;
  readonly lastError?: string;
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

/**
 * Resolve the notes source path for this run. If the payload carries one (the
 * manual POST route), use it. Otherwise (the 15-min scheduled fire) look it up
 * from the `notes-source-path` preference — the preference stays the single
 * source of truth and a re-point via PUT reconciles on the next tick.
 */
async function resolveSourcePath(
  scopedDb: DataContextDb,
  payloadPath: string | undefined,
  preferencesRepository: PreferencesRepository
): Promise<string> {
  if (payloadPath && payloadPath.length > 0) return payloadPath;
  const stored = await preferencesRepository.get(scopedDb, NOTES_SOURCE_PREFERENCE_KEY);
  if (typeof stored !== "string" || stored.length === 0) {
    throw new Error("No notes source configured. Set a path via PUT /api/me/notes-source first.");
  }
  return stored;
}

export async function handleNotesSyncJob(
  job: Job<NotesSyncJobPayload>,
  scopedDb: DataContextDb,
  embeddingProvider: EmbeddingProvider,
  preferencesRepository: PreferencesRepository
): Promise<NotesSyncJobResult> {
  const { actorUserId, sourcePath } = job.data;

  const sourcePathToUse = await resolveSourcePath(scopedDb, sourcePath, preferencesRepository);

  const allowedRoots = resolveNotesRoots();
  if (allowedRoots.length === 0) {
    throw new Error("JARVIS_NOTES_ROOTS not configured — notes sync aborted");
  }

  let resolvedRoot: string;
  try {
    resolvedRoot = await realpath(sourcePathToUse);
  } catch {
    throw new Error(`Notes source path does not exist: ${sourcePathToUse}`);
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

/**
 * Write the last-sync outcome to the `notes-last-sync` preference. Runs in its
 * OWN withDataContext (separate transaction) AFTER the ingest transaction has
 * committed or rolled back — a same-transaction write would be lost on failure
 * (the case we most need to surface) and would deadlock on the row lock.
 *
 * With retryLimit:0 + deleteAfterSeconds:300, a heartbeat failure self-deletes
 * in 5 min with no trace; this write is the only surface that distinguishes
 * "never synced" from "failing every 15 min". Best-effort: a write failure is
 * logged and swallowed so it never masks the real result.
 */
export async function writeNotesLastSync(
  dataContextRunner: DataContextRunner,
  accessContext: AccessContext,
  preferencesRepository: PreferencesRepository,
  outcome: NotesLastSync
): Promise<void> {
  try {
    await dataContextRunner.withDataContext(accessContext, (freshDb) =>
      preferencesRepository.upsert(freshDb, NOTES_LAST_SYNC_PREFERENCE_KEY, outcome)
    );
  } catch (error) {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        event: "notes_last_sync_write_failed",
        actorUserId: accessContext.actorUserId,
        error: e.name,
        message: e.message.slice(0, 200)
      })
    );
  }
}

export interface RegisterNotesJobWorkersOptions {
  readonly embeddingProvider: EmbeddingProvider;
  readonly preferencesRepository: PreferencesRepository;
}

export async function registerNotesJobWorkers(
  boss: PgBoss,
  dataContext: DataContextRunner,
  options: RegisterNotesJobWorkersOptions
): Promise<readonly string[]> {
  // Notes uses boss.work directly (not registerDataContextWorker) so the last-sync
  // preference write can run in its OWN withDataContext AFTER the ingest transaction
  // commits/rolls back. A same-transaction write would be lost on failure (the case
  // we most need to surface) and nesting a fresh withDataContext inside the handler
  // deadlocks on the preferences row lock. The pattern: run ingest in one
  // withDataContext, then run the outcome write in a second, non-overlapping one.
  const workId = await boss.work<NotesSyncJobPayload, NotesSyncJobResult>(
    NOTES_SYNC_QUEUE,
    { pollingIntervalSeconds: 2 },
    async ([job]) => {
      if (!job) throw new Error(`pg-boss invoked ${NOTES_SYNC_QUEUE} without a job`);
      const accessContext = toAccessContext(job);
      try {
        const result = await dataContext.withDataContext(accessContext, (scopedDb) =>
          handleNotesSyncJob(
            job,
            scopedDb,
            options.embeddingProvider,
            options.preferencesRepository
          )
        );
        await writeNotesLastSync(dataContext, accessContext, options.preferencesRepository, {
          at: new Date().toISOString(),
          ...result
        });
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeNotesLastSync(dataContext, accessContext, options.preferencesRepository, {
          at: new Date().toISOString(),
          ingested: 0,
          skipped: 0,
          errors: 0,
          lastError: message
        });
        throw error;
      }
    }
  );
  return [workId];
}
