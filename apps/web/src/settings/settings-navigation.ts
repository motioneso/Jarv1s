export interface SettingsSectionLike<Id extends string = string> {
  readonly id: Id;
}

export function coerceSettingsSectionId<const Section extends SettingsSectionLike>(
  sections: readonly Section[],
  value: string | null
): Section["id"] {
  return sections.find((section) => section.id === value)?.id ?? sections[0]!.id;
}
