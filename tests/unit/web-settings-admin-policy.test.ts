import { describe, expect, it } from "vitest";

import {
  adminUserActions,
  canRemoveAdminUser,
  type AdminUserActionPolicyUser
} from "../../apps/web/src/settings/settings-admin-policy.js";

const member = (input: Partial<AdminUserActionPolicyUser> = {}): AdminUserActionPolicyUser => ({
  id: "user-1",
  email: "user@example.test",
  name: "User",
  isInstanceAdmin: false,
  status: "active",
  isBootstrapOwner: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...input
});

describe("settings admin user action policy", () => {
  it("does not offer menu actions for the current user", () => {
    const current = member({ id: "current", isInstanceAdmin: true });

    expect(adminUserActions(current, current, [current, member({ id: "other" })])).toEqual([]);
  });

  it("protects the bootstrap owner from delegated admin actions", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const owner = member({ id: "owner", isInstanceAdmin: true, isBootstrapOwner: true });

    expect(adminUserActions(owner, current, [current, owner])).toEqual([]);
    expect(canRemoveAdminUser(owner, current, [current, owner])).toBe(false);
  });

  it("does not allow removing or disabling the last active admin", () => {
    const current = member({ id: "current", isInstanceAdmin: true, status: "deactivated" });
    const onlyActiveAdmin = member({ id: "admin", isInstanceAdmin: true });

    expect(adminUserActions(onlyActiveAdmin, current, [current, onlyActiveAdmin])).toEqual([]);
    expect(canRemoveAdminUser(onlyActiveAdmin, current, [current, onlyActiveAdmin])).toBe(false);
  });

  it("allows safe lifecycle and role actions for ordinary members", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const target = member({ id: "target" });

    expect(adminUserActions(target, current, [current, target])).toEqual([
      "admin",
      "deactivate",
      "remove"
    ]);
  });

  it("allows reactivation and removal for deactivated users", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const target = member({ id: "target", status: "deactivated" });

    expect(adminUserActions(target, current, [current, target])).toEqual([
      "admin",
      "reactivate",
      "remove"
    ]);
  });
});
