// Pure helper for deriving the Notes Source env lines written into the prod env file.
// Extracted from setup-prod.ts so it is unit-testable WITHOUT triggering that script's
// eager secret generation + file write (importing setup-prod.ts runs it). See #449:
// the operator opts in at install by setting JARVIS_NOTES_VAULT_HOST_PATH; the host
// folder is bind-mounted to a FIXED neutral container path (/data/external-notes) and
// the app reads it via JARVIS_NOTES_ROOTS. Empty/undefined host path = no notes mount
// = the feature is inert (no env lines emitted).

/** The fixed neutral mount target the bind mount lands at (compose override). */
export const NOTES_MOUNT_TARGET = "/data/external-notes";

/**
 * Returns the env-file lines for the Notes Source bind mount, or an empty array when
 * the operator did not opt in. The host path is recorded for operator readability +
 * re-runs; JARVIS_NOTES_ROOTS is the value the app actually reads (fixed neutral path).
 */
export function deriveNotesEnvLines(hostPath: string | undefined): readonly string[] {
  const trimmed = (hostPath ?? "").trim();
  if (trimmed.length === 0) return [];
  return [
    "# Notes Source bind mount (#449) — operator opted in at install.",
    `JARVIS_NOTES_VAULT_HOST_PATH=${trimmed}`,
    "# Fixed neutral mount target — resolveNotesRoots() points here.",
    `JARVIS_NOTES_ROOTS=${NOTES_MOUNT_TARGET}`,
    ""
  ];
}
