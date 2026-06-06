import type { NoteDto } from "@jarv1s/shared";

export const visibilityLabels = {
  private: "Private",
  workspace: "Workspace"
} as const;

export function sortNotes(notes: readonly NoteDto[]): NoteDto[] {
  return [...notes].sort((left, right) => {
    const leftDate = Date.parse(left.updatedAt ?? left.createdAt ?? "");
    const rightDate = Date.parse(right.updatedAt ?? right.createdAt ?? "");

    return rightDate - leftDate || left.title.localeCompare(right.title);
  });
}

export function formatNoteDate(value: string | null): string {
  if (!value) {
    return "No date";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}
