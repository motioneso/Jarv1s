import type { UserDto } from "@jarv1s/shared";

export type AdminUserActionPolicyUser = UserDto;
export type AdminUserAction = "admin" | "deactivate" | "reactivate" | "remove";

function activeAdminCount(users: readonly AdminUserActionPolicyUser[]): number {
  return users.filter((user) => user.isInstanceAdmin && user.status === "active").length;
}

function isCurrentUser(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser
): boolean {
  return user.id === currentUser.id;
}

function protectsOnlyActiveAdmin(
  user: AdminUserActionPolicyUser,
  users: readonly AdminUserActionPolicyUser[]
): boolean {
  return user.isInstanceAdmin && user.status === "active" && activeAdminCount(users) <= 1;
}

export function canToggleAdminRole(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  users: readonly AdminUserActionPolicyUser[]
): boolean {
  if (isCurrentUser(user, currentUser) || user.isBootstrapOwner) return false;
  if (!user.isInstanceAdmin) return true;
  return !protectsOnlyActiveAdmin(user, users);
}

export function canChangeAdminUserStatus(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  users: readonly AdminUserActionPolicyUser[]
): boolean {
  if (isCurrentUser(user, currentUser) || user.isBootstrapOwner) return false;
  if (user.status === "deactivated") return true;
  if (user.status !== "active") return false;
  return !protectsOnlyActiveAdmin(user, users);
}

export function canRemoveAdminUser(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  users: readonly AdminUserActionPolicyUser[]
): boolean {
  if (isCurrentUser(user, currentUser) || user.isBootstrapOwner) return false;
  return !protectsOnlyActiveAdmin(user, users);
}

export function adminUserActions(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  users: readonly AdminUserActionPolicyUser[]
): readonly AdminUserAction[] {
  const actions: AdminUserAction[] = [];
  if (canToggleAdminRole(user, currentUser, users)) actions.push("admin");
  if (canChangeAdminUserStatus(user, currentUser, users)) {
    actions.push(user.status === "deactivated" ? "reactivate" : "deactivate");
  }
  if (canRemoveAdminUser(user, currentUser, users)) actions.push("remove");
  return actions;
}
