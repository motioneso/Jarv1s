import type { PgBoss } from "pg-boss";
import { HttpApiAdapter, parseAiApiKeyCredential } from "@jarv1s/ai";
import type { AiRepository, AiSecretCipher, ProviderKind, GenerateChatInput } from "@jarv1s/ai";
import type { DataContextRunner } from "@jarv1s/db";
import { registerDataContextWorker, assertMetadataOnlyPayload } from "@jarv1s/jobs";
import type { CommitmentExtractionProvider } from "@jarv1s/module-sdk";
import { COMMITMENT_EXTRACTION_QUEUE } from "./manifest.js";
import type { CommitmentsRepository } from "./repository.js";
import { extractCommitmentsFromText } from "./extractor.js";
import { buildCandidateSignature } from "./signature.js";
import type { CommitmentExtractionJobPayload } from "./jobs.js";

const EXTRACTION_MAX_OUTPUT_TOKENS = 1024;

export interface CommitmentExtractionWorkerDeps {
  readonly aiRepository: AiRepository;
  readonly cipher: AiSecretCipher;
  readonly repository: CommitmentsRepository;
  readonly providers: readonly CommitmentExtractionProvider[];
}

export async function registerCommitmentExtractionWorker(
  boss: PgBoss,
  dataContext: DataContextRunner,
  deps: CommitmentExtractionWorkerDeps
): Promise<string[]> {
  const workerId = await registerDataContextWorker<CommitmentExtractionJobPayload, void>(
    boss,
    COMMITMENT_EXTRACTION_QUEUE,
    dataContext,
    async (job, scopedDb) => {
      assertMetadataOnlyPayload(job.data);
      const { actorUserId, sourceKind } = job.data;

      const provider = deps.providers.find((p) => p.sourceKind === sourceKind);
      if (!provider) return;

      // Resolve AI model (economy tier)
      const model = await deps.aiRepository.selectModelForCapability(
        scopedDb,
        "summarization",
        "economy"
      );
      if (!model) return;

      const aiProvider = await deps.aiRepository.selectProviderWithCredential(
        scopedDb,
        model.provider_config_id
      );
      if (!aiProvider?.encrypted_credential) return;

      const credential = parseAiApiKeyCredential(
        deps.cipher.decryptJson(aiProvider.encrypted_credential)
      );
      if (!credential) return;

      const adapter = new HttpApiAdapter(
        model.provider_kind as ProviderKind,
        credential.apiKey,
        aiProvider.base_url ? { baseUrl: aiProvider.base_url } : {}
      );

      // Closed-over generate fn for the extractor
      const generate = (
        messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[]
      ) =>
        adapter.generateChat({
          model: {
            provider_kind: model.provider_kind,
            provider_model_id: model.provider_model_id
          },
          messages: messages as GenerateChatInput["messages"],
          maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS
        });

      const state = await deps.repository.getExtractionState(scopedDb, actorUserId, sourceKind);
      const since = state?.lastExtractedAt ?? null;
      const now = new Date();

      const boundaries = await provider.getTextBoundaries(scopedDb, actorUserId, since);

      for (const boundary of boundaries) {
        const candidates = await extractCommitmentsFromText(
          generate,
          boundary.text,
          sourceKind,
          boundary.occurredAt
        );

        for (const extracted of candidates) {
          const sig = buildCandidateSignature({
            kind: extracted.kind,
            counterpartyLabel: extracted.counterpartyLabel,
            title: extracted.title,
            dueLocalDate: extracted.dueLocalDate,
            sourceKind,
            sourceRef: boundary.sourceRef
          });

          const candidate = await deps.repository.upsertCandidate(scopedDb, {
            ownerUserId: actorUserId,
            candidateSignature: sig,
            kind: extracted.kind,
            title: extracted.title,
            dueLocalDate: extracted.dueLocalDate,
            counterpartyLabel: extracted.counterpartyLabel,
            confidence: extracted.confidence,
            suggestedHandling: null,
            occurredAt: boundary.occurredAt
          });

          await deps.repository.addEvidenceRow(scopedDb, {
            candidateId: candidate.id,
            ownerUserId: actorUserId,
            sourceKind,
            sourceRef: boundary.sourceRef,
            sourceVersion: boundary.sourceVersion,
            evidenceExcerpt: extracted.evidenceExcerpt,
            occurredAt: boundary.occurredAt
          });
        }
      }

      await deps.repository.upsertExtractionState(scopedDb, actorUserId, sourceKind, now);
    }
  );

  return [workerId];
}
