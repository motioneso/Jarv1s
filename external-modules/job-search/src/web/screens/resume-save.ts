// external-modules/job-search/src/web/screens/resume-save.ts
//
// The one function the résumé editor (resume-editor.tsx) calls to persist a résumé. Every other
// piece of that UI treats this as opaque — swapping the transport later is a one-file change.
//
// TRANSPORT (task #108): the browser cannot call resume.set directly (risk:"write" 403s on the
// tool-invoke lane, packages/ai/src/routes.ts), and CLAUDE.md's metadata-only-job-payload
// invariant forbids putting the résumé's own content in a pg-boss job's params. So this uploads
// the content to the user's vault first (uploadResumeAttachment / uploadResumeAttachmentBytes ->
// POST /api/chat/attachments — bytes go straight to the vault, never the DB or a job payload, see
// packages/chat/src/attachments-routes.ts), then enqueues job-search.resume-set with only
// {profileId, attachmentId}: two small id strings, fully metadata-only. The worker handler
// (resume.set-from-attachment) resolves the actual text via ctx.attachments.readText(attachmentId)
// — for a PDF/DOCX attachment that's where the host extracts real text (packages/chat/src/
// attachments-service.ts), so this file and the worker handler never touch that extraction step.
//
// DRAFT SHAPE (task #112): resume-editor.tsx hands this a ResumeDraft rather than a raw string —
// "text" for a paste or a .txt/.md upload (read client-side, editable), "binary" for a .pdf/.docx
// upload (opaque bytes, mime taken from the file's own extension — see resume-editor.tsx's header
// for why never `file.type`). Which branch ran is invisible past this function: both produce the
// same attachmentId, and the queue payload below is identical either way.
//
// Like every other manual-run queue in this module (ruling I5, settings.tsx's RunNowControl),
// runQueue only ever resolves "queued"/"already-queued"/"disabled"/"error" — never "done". A
// queued save has not necessarily succeeded yet; resume-editor.tsx's success copy says "queued",
// not "saved", and the caller (onSaved) still has to refetch to see the real outcome.
import { runQueue, uploadResumeAttachment, uploadResumeAttachmentBytes } from "../api";

export type ResumeDraft =
  | { kind: "text"; content: string }
  | { kind: "binary"; fileName: string; mimeType: string; bytes: ArrayBuffer };

export type SaveResumeOutcome =
  | { kind: "queued" }
  | { kind: "already-queued" }
  | { kind: "error"; message: string };

const RESUME_SET_QUEUE = "job-search.resume-set";
const RESUME_SET_JOB_KIND = "resume.set-from-attachment";

export async function saveResume(
  profileId: string,
  draft: ResumeDraft
): Promise<SaveResumeOutcome> {
  let attachmentId: string;
  try {
    attachmentId =
      draft.kind === "text"
        ? await uploadResumeAttachment(draft.content)
        : await uploadResumeAttachmentBytes(draft.bytes, draft.mimeType, draft.fileName);
  } catch {
    return { kind: "error", message: "Couldn't upload the résumé. Try again." };
  }

  const outcome = await runQueue(RESUME_SET_QUEUE, RESUME_SET_JOB_KIND, {
    profileId,
    attachmentId
  });
  if (outcome.kind === "queued") return { kind: "queued" };
  if (outcome.kind === "already-queued") return { kind: "already-queued" };
  if (outcome.kind === "disabled") {
    return { kind: "error", message: "Résumé saving isn't available right now." };
  }
  return { kind: "error", message: outcome.message };
}
