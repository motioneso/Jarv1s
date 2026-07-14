import type { DataContextRunner } from "@jarv1s/db";
import { VaultContextRunner, getVaultBaseDir, writeVaultFile } from "@jarv1s/vault";

/**
 * #1025 spec §4.4 / "No Note Viewer" project invariant: notes have no
 * app.* content repository — they live as real Markdown files under the
 * per-user VaultContext directory (packages/vault/src/vault-context.ts), the
 * same path production notes-ingestion (packages/memory/src/ingestion-service.ts)
 * reads. A DB-backed proxy was considered and rejected — the "VaultContext for
 * all vault I/O" hard invariant applies to seed code same as production code.
 * Content/dates are fixed strings, never wall-clock, so re-seeds are byte-identical.
 */
const UAT_NOTES: ReadonlyArray<{ path: string; content: string }> = [
  {
    path: "welcome.md",
    content: "# Welcome\n\nThis is a seeded UAT note for the lived-in demo account.\n"
  },
  {
    path: "reading-list.md",
    content: "# Reading list\n\n- Project Hail Mary\n- Designing Data-Intensive Applications\n"
  },
  {
    path: "meeting-notes/2026-01-10-kickoff.md",
    content: "# Kickoff notes\n\nAgreed on scope for the Q1 planning doc.\n"
  },
  {
    path: "meeting-notes/2026-01-12-followup.md",
    content: "# Follow-up notes\n\nReviewed the PR backlog, no blockers.\n"
  },
  {
    path: "ideas.md",
    content: "# Ideas\n\n- Try a weekend trip in spring\n- Look into car maintenance plans\n"
  }
];

// #1025: `runner` unused — notes have no app.* rows — but Task 6 composes every chunk
// uniformly as `(runner, actorUserId) => Promise<void>`, so the signature is kept aligned.
export async function seedNotesChunk(
  runner: DataContextRunner,
  actorUserId: string
): Promise<void> {
  const vaultRunner = new VaultContextRunner(getVaultBaseDir());
  await vaultRunner.withVaultContext({ actorUserId }, async (vaultCtx) => {
    for (const note of UAT_NOTES) {
      await writeVaultFile(vaultCtx, note.path, note.content);
    }
  });
}
