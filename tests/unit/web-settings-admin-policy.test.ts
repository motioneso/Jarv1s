import { describe, expect, it } from "vitest";

import {
  adminUserActions,
  canRemoveAdminUser,
  createAdminUserPolicyContext,
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

    expect(adminUserActions(owner, current, [current, owner])).toEqual(["revokeSessions"]);
    expect(canRemoveAdminUser(owner, current, [current, owner])).toBe(false);
  });

  it("does not allow removing or disabling the last active admin", () => {
    const current = member({ id: "current", isInstanceAdmin: true, status: "deactivated" });
    const onlyActiveAdmin = member({ id: "admin", isInstanceAdmin: true });

    expect(adminUserActions(onlyActiveAdmin, current, [current, onlyActiveAdmin])).toEqual([
      "revokeSessions"
    ]);
    expect(canRemoveAdminUser(onlyActiveAdmin, current, [current, onlyActiveAdmin])).toBe(false);
  });

  it("allows safe lifecycle and role actions for ordinary members", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const target = member({ id: "target" });

    expect(adminUserActions(target, current, [current, target])).toEqual([
      "admin",
      "deactivate",
      "revokeSessions",
      "remove"
    ]);
  });

  it("allows reactivation and removal for deactivated users", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const target = member({ id: "target", status: "deactivated" });

    expect(adminUserActions(target, current, [current, target])).toEqual([
      "admin",
      "reactivate",
      "revokeSessions",
      "remove"
    ]);
  });

  it("reuses a precomputed active-admin count for row action checks", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const target = member({ id: "target", isInstanceAdmin: true });
    const policy = createAdminUserPolicyContext([current, target]);

    expect(policy.activeAdminCount).toBe(2);
    expect(adminUserActions(target, current, policy)).toEqual([
      "admin",
      "deactivate",
      "revokeSessions",
      "remove"
    ]);
  });

  it("offers session revoke for active and deactivated non-current members", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const active = member({ id: "active" });
    const deactivated = member({ id: "deactivated", status: "deactivated" });

    expect(adminUserActions(active, current, [current, active])).toContain("revokeSessions");
    expect(adminUserActions(deactivated, current, [current, deactivated])).toContain(
      "revokeSessions"
    );
  });

  it("does not offer session revoke for current or pending users", () => {
    const current = member({ id: "current", isInstanceAdmin: true });
    const pending = member({ id: "pending", status: "pending" });

    expect(adminUserActions(current, current, [current, pending])).not.toContain(
      "revokeSessions"
    );
    expect(adminUserActions(pending, current, [current, pending])).not.toContain(
      "revokeSessions"
    );
  });
});
