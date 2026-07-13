export interface SettingsSectionLike<Id extends string = string> {
  readonly id: Id;
}

export function coerceSettingsSectionId<const Section extends SettingsSectionLike>(
  sections: readonly Section[],
  value: string | null
): Section["id"] {
  return sections.find((section) => section.id === value)?.id ?? sections[0]!.id;
}

export interface SettingsSectionGroup<Section extends SettingsSectionLike> {
  readonly label: string;
  readonly sections: readonly Section[];
}

export function flattenSettingsGroups<Section extends SettingsSectionLike>(
  groups: readonly SettingsSectionGroup<Section>[]
): readonly Section[] {
  return groups.flatMap((group) => group.sections);
}
