import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  disableInstallerLogin,
  enableInstallerLogin,
  ensureModuleRoles,
  moduleInstallRoleName,
  moduleRuntimeRoleName
} from "../../packages/db/src/module-role-broker.js";
import { getJarvisDatabaseUrls } from "../../packages/db/src/urls.js";

const urls = getJarvisDatabaseUrls();
const moduleId = "role-broker-fixture";

afterAll(async () => {
  const client = new Client({ connectionString: urls.bootstrap });
  await client.connect();
  await client.query(`DROP ROLE IF EXISTS ${moduleInstallRoleName(moduleId)}`);
  await client.query(`DROP ROLE IF EXISTS ${moduleRuntimeRoleName(moduleId)}`);
  await client.end();
});

describe("module role broker", () => {
  it("creates both roles NOLOGIN, then flips and unflips the installer role's login", async () => {
    const roles = await ensureModuleRoles(urls.bootstrap, moduleId);
    expect(roles.runtimeRole).toBe("jarvis_mod_role_broker_fixture_runtime");

    const check = new Client({ connectionString: urls.bootstrap });
    await check.connect();
    const before = await check.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      roles.installRole
    ]);
    expect(before.rows[0].rolcanlogin).toBe(false);

    const password = await enableInstallerLogin(urls.bootstrap, moduleId);
    expect(password).toHaveLength(32);
    const afterEnable = await check.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      roles.installRole
    ]);
    expect(afterEnable.rows[0].rolcanlogin).toBe(true);

    await disableInstallerLogin(urls.bootstrap, moduleId);
    const afterDisable = await check.query("SELECT rolcanlogin FROM pg_roles WHERE rolname = $1", [
      roles.installRole
    ]);
    expect(afterDisable.rows[0].rolcanlogin).toBe(false);
    await check.end();
  });
});
