export class NotesPathError extends Error {
  constructor(
    message: string,
    readonly code: "PATH_NOT_IN_ROOT"
  ) {
    super(message);
    this.name = "NotesPathError";
  }
}

/**
 * Asserts that absoluteFilePath is within resolvedRoot (already fs.realpath'd).
 * Throws NotesPathError if the path escapes the root.
 */
export function assertWithinRoot(resolvedRoot: string, absoluteFilePath: string): void {
  const rootPrefix = resolvedRoot.endsWith("/") ? resolvedRoot : resolvedRoot + "/";
  if (absoluteFilePath !== resolvedRoot && !absoluteFilePath.startsWith(rootPrefix)) {
    throw new NotesPathError(
      `Path "${absoluteFilePath}" is not within allowed root "${resolvedRoot}"`,
      "PATH_NOT_IN_ROOT"
    );
  }
}
