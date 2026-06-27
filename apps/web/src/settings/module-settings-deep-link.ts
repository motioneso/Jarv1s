export type ModuleSettingsDeepLink =
  | "briefings"
  | "chat"
  | "notifications"
  | { readonly moduleId: string }
  | null;

export function resolveModuleSettingsDeepLink(
  requested: string | null,
  hasContributedSurface: (moduleId: string) => boolean
): ModuleSettingsDeepLink {
  if (!requested) return null;
  if (requested === "briefings" || requested === "chat" || requested === "notifications") {
    return requested;
  }
  if (hasContributedSurface(requested)) {
    return { moduleId: requested };
  }
  return null;
}
