import type { UserDto } from "@jarv1s/shared";

export type AdminUserActionPolicyUser = UserDto;
export type AdminUserAction = "admin" | "deactivate" | "reactivate" | "remove";

export interface AdminUserPolicyContext {
  readonly activeAdminCount: number;
}

export type AdminUserPolicySource =
  | readonly AdminUserActionPolicyUser[]
  | AdminUserPolicyContext;

export function createAdminUserPolicyContext(
  users: readonly AdminUserActionPolicyUser[]
): AdminUserPolicyContext {
  return { activeAdminCount: countActiveAdmins(users) };
}

function countActiveAdmins(users: readonly AdminUserActionPolicyUser[]): number {
  return users.filter((user) => user.isInstanceAdmin && user.status === "active").length;
}

function isAdminUserPolicyContext(source: AdminUserPolicySource): source is AdminUserPolicyContext {
  return !Array.isArray(source);
}

function activeAdminCount(source: AdminUserPolicySource): number {
  return isAdminUserPolicyContext(source) ? source.activeAdminCount : countActiveAdmins(source);
}

function isCurrentUser(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser
): boolean {
  return user.id === currentUser.id;
}

function protectsOnlyActiveAdmin(
  user: AdminUserActionPolicyUser,
  policy: AdminUserPolicySource
): boolean {
  return user.isInstanceAdmin && user.status === "active" && activeAdminCount(policy) <= 1;
}

export function canToggleAdminRole(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  policy: AdminUserPolicySource
): boolean {
  if (isCurrentUser(user, currentUser) || user.isBootstrapOwner) return false;
  if (!user.isInstanceAdmin) return true;
  return !protectsOnlyActiveAdmin(user, policy);
}

export function canChangeAdminUserStatus(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  policy: AdminUserPolicySource
): boolean {
  if (isCurrentUser(user, currentUser) || user.isBootstrapOwner) return false;
  if (user.status === "deactivated") return true;
  if (user.status !== "active") return false;
  return !protectsOnlyActiveAdmin(user, policy);
}

export function canRemoveAdminUser(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  policy: AdminUserPolicySource
): boolean {
  if (isCurrentUser(user, currentUser) || user.isBootstrapOwner) return false;
  return !protectsOnlyActiveAdmin(user, policy);
}

export function adminUserActions(
  user: AdminUserActionPolicyUser,
  currentUser: AdminUserActionPolicyUser,
  policy: AdminUserPolicySource
): readonly AdminUserAction[] {
  const actions: AdminUserAction[] = [];
  if (canToggleAdminRole(user, currentUser, policy)) actions.push("admin");
  if (canChangeAdminUserStatus(user, currentUser, policy)) {
    actions.push(user.status === "deactivated" ? "reactivate" : "deactivate");
  }
  if (canRemoveAdminUser(user, currentUser, policy)) actions.push("remove");
  return actions;
}
