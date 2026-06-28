import type { PgBoss } from "pg-boss";
import { toAccessContext } from "@jarv1s/jobs";
import type { DataContextRunner } from "@jarv1s/db";
import type { PersonContextProvider } from "@jarv1s/module-sdk";
import { matchResult, normalizeIdentity } from "./matching.js";
import {
  assertMetadataOnlyPersonPayload,
  enqueueSyncPersonMemory,
  PERSON_INDEX_QUEUE,
  SYNC_PERSON_MEMORY_QUEUE
} from "./jobs.js";
import type { PersonIndexPayload, SyncPersonMemoryPayload } from "./jobs.js";
import { PeopleRepository } from "./repository.js";

export interface PersonIndexWorkerDeps {
  readonly providers: PersonContextProvider[];
  readonly repo?: PeopleRepository;
}

export async function registerPersonIndexWorker(
  boss: PgBoss,
  dataContext: DataContextRunner,
  deps: PersonIndexWorkerDeps
): Promise<string> {
  const repo = deps.repo ?? new PeopleRepository();

  return boss.work<PersonIndexPayload>(
    PERSON_INDEX_QUEUE,
    { pollingIntervalSeconds: 2 },
    async ([job]) => {
      if (!job) throw new Error(`pg-boss invoked ${PERSON_INDEX_QUEUE} without a job`);

      assertMetadataOnlyPersonPayload(job.data);
      const { actorUserId, source, sourceRefHash, sourceVersion } = job.data;

      const provider = deps.providers.find((p) => p.sourceKind === source);
      if (!provider) return;

      // Collect signals outside the DB transaction — avoids holding a connection open during I/O
      const signalBatch = await provider.collectPersonSignals({
        actorUserId,
        sourceRefHash,
        sourceVersion,
        cursor: undefined
      });

      const resultMap = matchResult(signalBatch.signals);
      const personIdsToSync = new Set<string>();

      // Person-context writes — single transaction
      await dataContext.withDataContext(toAccessContext(job), async (scopedDb) => {
        for (const [, entry] of resultMap) {
          const normalized = normalizeIdentity(entry.identityKind, entry.normalizedValue);
          const firstSignal = entry.signals[0];

          const person = await repo.findOrCreatePerson(scopedDb, actorUserId, entry.displayValue);
          personIdsToSync.add(person.id);

          await repo.upsertIdentity(scopedDb, {
            ownerUserId: actorUserId,
            personId: person.id,
            identityKind: entry.identityKind,
            sourceKind: source,
            normalizedValue: normalized,
            displayValue: entry.displayValue,
            sourceRef: firstSignal?.sourceRef ?? null,
            sourceRefHash,
            status: "active",
            confidence: entry.confidence,
            provenance: "source"
          });

          for (const signal of entry.signals) {
            const link = await repo.upsertLink(scopedDb, {
              ownerUserId: actorUserId,
              personId: person.id,
              sourceKind: source,
              sourceRef: signal.sourceRef,
              sourceRefHash: signal.sourceRefHash,
              sourceLabel: signal.sourceLabel ?? null,
              linkKind: signal.linkKind,
              summary: signal.summary ?? null,
              occurredAt: signal.occurredAt ?? null,
              confidence: signal.confidence,
              provenance: signal.provenance
            });

            await repo.upsertLinkSource(scopedDb, {
              ownerUserId: actorUserId,
              linkId: link.id,
              identityId: null,
              sourceRefHash: signal.sourceRefHash,
              linkKind: signal.linkKind,
              confidence: signal.confidence
            });
          }

          await repo.insertEvent(scopedDb, {
            ownerUserId: actorUserId,
            eventKind: "identity_linked",
            personId: person.id,
            sourceRefHash
          });
        }

        const firstSourceRef = signalBatch.signals[0]?.sourceRef ?? sourceRefHash;
        await repo.upsertIndexingState(scopedDb, {
          ownerUserId: actorUserId,
          source,
          sourceRefHash,
          sourceRef: firstSourceRef,
          lastIndexedAt: new Date(),
          lastSourceVersion: sourceVersion,
          failureCount: 0
        });
      });

      // Memory sync in a SEPARATE transaction — pg-boss manages its own connection/pool
      for (const personId of personIdsToSync) {
        const payload: SyncPersonMemoryPayload = {
          actorUserId,
          personId,
          personUpdatedAt: new Date().toISOString(),
          reason: "index_complete",
          idempotencyKey: `sync-person-memory:${actorUserId}:${personId}`
        };
        await enqueueSyncPersonMemory(boss, payload);
      }
    }
  );
}

export async function registerSyncPersonMemoryWorker(
  boss: PgBoss,
  dataContext: DataContextRunner
): Promise<string> {
  return boss.work<SyncPersonMemoryPayload>(
    SYNC_PERSON_MEMORY_QUEUE,
    { pollingIntervalSeconds: 2 },
    async ([job]) => {
      if (!job) throw new Error(`pg-boss invoked ${SYNC_PERSON_MEMORY_QUEUE} without a job`);
      assertMetadataOnlyPersonPayload(job.data);
      // Memory entity sync is a stub — the people module ships the schema and indexing path;
      // the actual memory write is wired by the composition layer when it gains a memory provider.
      void dataContext;
    }
  );
}
