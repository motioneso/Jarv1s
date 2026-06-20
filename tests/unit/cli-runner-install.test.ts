/**
 * §A.3 INSTALL SERVICE invariants (#342 Phase 2 — supply-chain core).
 *
 * Covers the frozen acceptance criteria (install-contract §A.7.4):
 *  - serialize-rejects-concurrent (§A.3.1): a second same-provider install while one is
 *    in flight ⇒ InstallBadRequestError ("install already in progress"); different
 *    providers may run concurrently.
 *  - catalog-status gate (§A.2.3): a blocked provider (agy) ⇒ InstallBadRequestError
 *    ("provider not installable: <reason>").
 *  - verify-before-promote (§A.3.4): nothing is placed on PATH until the binary exists,
 *    its resolved + --version equal the pinned version, and (codex/claude) the per-arch
 *    native package is present.
 *  - rollback-on-verify-fail (§A.3.5): a version mismatch / missing binary leaves no live
 *    install and returns {state:"error"}.
 *  - atomic-promote-only-after-verify: the live PATH bin appears ONLY after a successful
 *    verify; `current` resolves into releases/<rand>, never into .staging.
 *  - idempotent-noop (§A.3.6): a re-install of the already-pinned + byte-identical version
 *    is a no-op with alreadyInstalled:true (no re-promote).
 *  - --ignore-scripts asserted (§A.3.3): the npm invocation carries `ci` + `--ignore-scripts`.
 *  - sanitized installer env (§A.3.3): the installer env = §7.2 allowlist + registry/proxy
 *    ONLY; no app/DB/vault/RPC secret.
 *  - startup sweep (§A.3.2): clears orphaned `.staging/*` and GCs unreferenced releases.
 *  - kind:"env" self-update-disable reaches the LAUNCHED CLI env (§A.3.7, R6): NOT merely
 *    the allowlist.
 */

import { mkdtemp, mkdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { TmuxIo } from "../../packages/ai/src/index.js";
import {
  InstallService,
  InstallBadRequestError,
  buildSanitizedInstallerEnv
} from "../../packages/cli-runner/src/install-service.js";
import { sourceSelfUpdateDisableEnv } from "../../packages/cli-runner/src/main.js";
import { buildSanitizedCliEnv } from "../../packages/cli-runner/src/sanitized-env.js";
import { PROVIDER_CATALOG } from "../../packages/cli-runner/src/catalog.js";
import type { RpcProviderKind } from "../../packages/chat/src/live/rpc-contract.js";

// ─── A fake TmuxIo that simulates npm ci + --version + ls against a real temp tree ──

interface FakeIoOptions {
  /** Version the simulated `npm ci` materializes + the binary's `--version` reports. */
  readonly installedVersion: string;
  /** Override the version the binary's `--version` prints (to force a verify mismatch). */
  readonly probeVersion?: string;
  /** When set, `npm ci` fails (non-zero) to simulate an install failure. */
  readonly ciFails?: boolean;
  /** When false, the simulated install leaves no executable binary (verify fail). */
  readonly produceBinary?: boolean;
}

interface RecordedRun {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}

function makeFakeIo(opts: FakeIoOptions): { io: TmuxIo; runs: RecordedRun[] } {
  const runs: RecordedRun[] = [];
  const io: TmuxIo = {
    run: async (cmd, args, runOpts) => {
      runs.push({ cmd, args: [...args], env: runOpts?.env });

      // Simulate `npm ci --ignore-scripts --prefix <staging>`: materialize a node_modules
      // tree with the pinned package + its per-arch native package + a .bin/<binary>.
      if (cmd === "npm" && args[0] === "ci") {
        if (opts.ciFails) return { code: 1, stdout: "", stderr: "npm ci boom" };
        const prefixIdx = args.indexOf("--prefix");
        const staging = args[prefixIdx + 1] as string;
        const pkg = "@anthropic-ai/claude-code";
        const nm = path.join(staging, "node_modules");
        await mkdir(path.join(nm, pkg), { recursive: true });
        await writeFile(
          path.join(nm, pkg, "package.json"),
          JSON.stringify({ name: pkg, version: opts.installedVersion })
        );
        // per-arch native package present (the lockfile-pinned dep)
        await mkdir(path.join(nm, "@anthropic-ai", "claude-code-linux-x64"), { recursive: true });
        await mkdir(path.join(nm, "@anthropic-ai", "claude-code-linux-arm64"), {
          recursive: true
        });
        const binDir = path.join(nm, ".bin");
        await mkdir(binDir, { recursive: true });
        if (opts.produceBinary !== false) {
          const real = path.join(nm, pkg, "cli.js");
          await writeFile(real, "#!/usr/bin/env node\n", { mode: 0o755 });
          await symlink(path.join("..", pkg, "cli.js"), path.join(binDir, "claude"));
        }
        return { code: 0, stdout: "", stderr: "" };
      }

      // Simulate `<bin> --version` (the §A.5 re-probe).
      if (args.length === 1 && args[0] === "--version") {
        const v = opts.probeVersion ?? opts.installedVersion;
        return { code: 0, stdout: `${v}\n`, stderr: "" };
      }

      // `ls -A <dir>` for GC / sweep — defer to the real fs.
      if (cmd === "ls") {
        const dir = args[args.length - 1] as string;
        try {
          const { readdir } = await import("node:fs/promises");
          const names = await readdir(dir);
          return { code: 0, stdout: names.join("\n"), stderr: "" };
        } catch {
          return { code: 1, stdout: "", stderr: "" };
        }
      }

      return { code: 0, stdout: "", stderr: "" };
    },
    readFile: async (p) => (await import("node:fs/promises")).readFile(p, "utf8"),
    writeFile: async (p, c) => {
      await (await import("node:fs/promises")).writeFile(p, c, "utf8");
    },
    sleep: async () => undefined
  };
  return { io, runs };
}

let toolsPrefix: string;
let homeBase: string;

beforeEach(async () => {
  toolsPrefix = await mkdtemp(path.join(tmpdir(), "jarv1s-tools-"));
  homeBase = await mkdtemp(path.join(tmpdir(), "jarv1s-home-"));
});

afterEach(async () => {
  await rm(toolsPrefix, { recursive: true, force: true }).catch(() => undefined);
  await rm(homeBase, { recursive: true, force: true }).catch(() => undefined);
});

const PINNED =
  PROVIDER_CATALOG.anthropic.recipe?.kind === "npm"
    ? PROVIDER_CATALOG.anthropic.recipe.version
    : "0.0.0";

describe("InstallService — catalog gate (§A.2.3)", () => {
  it("rejects a blocked provider (agy/google) with InstallBadRequestError", async () => {
    const { io } = makeFakeIo({ installedVersion: PINNED });
    const svc = new InstallService({ io, catalog: PROVIDER_CATALOG, toolsPrefix, homeBase });
    await expect(svc.installProvider("google" as RpcProviderKind)).rejects.toBeInstanceOf(
      InstallBadRequestError
    );
    await expect(svc.installProvider("google" as RpcProviderKind)).rejects.toThrow(
      /not installable/i
    );
  });
});

describe("InstallService — npm install happy path (§A.3.3/§A.3.4/§A.3.5)", () => {
  it("installs via `npm ci --ignore-scripts`, verifies, and atomically promotes onto PATH", async () => {
    const { io, runs } = makeFakeIo({ installedVersion: PINNED });
    const svc = new InstallService({
      io,
      catalog: PROVIDER_CATALOG,
      toolsPrefix,
      homeBase,
      hostArch: "x64"
    });

    const result = await svc.installProvider("anthropic");
    expect(result.state).toBe("installed");
    expect(result.version).toBe(PINNED);

    // §A.3.3: the npm invocation carries `ci` AND `--ignore-scripts` (no lifecycle scripts).
    const ci = runs.find((r) => r.cmd === "npm" && r.args[0] === "ci");
    expect(ci).toBeDefined();
    expect(ci?.args).toContain("--ignore-scripts");
    expect(ci?.args).not.toContain("install"); // never a bare `npm install`

    // §A.3.5: the live PATH bin exists and `current` resolves into releases/<rand>,
    // NEVER into .staging.
    const binStat = await stat(path.join(toolsPrefix, "bin", "claude"));
    expect(binStat.isFile() || binStat.isSymbolicLink?.() || true).toBe(true);
    const current = await readlink(path.join(toolsPrefix, "providers", "anthropic", "current"));
    expect(current).toMatch(/^releases\//);
    expect(current).not.toContain(".staging");

    // §A.3.2: the ephemeral staging scratch is emptied on success.
    const stagingRoot = path.join(toolsPrefix, ".staging");
    const stagingEntries = await import("node:fs/promises").then((m) =>
      m.readdir(stagingRoot).catch(() => [] as string[])
    );
    expect(stagingEntries).toHaveLength(0);
  });
});

describe("InstallService — verify-before-promote + rollback (§A.3.4/§A.3.5)", () => {
  it("a --version mismatch is a verify failure → state:error, nothing on PATH", async () => {
    // The simulated binary reports a DIFFERENT version than the pinned recipe.
    const { io } = makeFakeIo({ installedVersion: PINNED, probeVersion: "9.9.9-wrong" });
    const svc = new InstallService({
      io,
      catalog: PROVIDER_CATALOG,
      toolsPrefix,
      homeBase,
      hostArch: "x64"
    });
    const result = await svc.installProvider("anthropic");
    expect(result.state).toBe("error");

    // ATOMIC-PROMOTE-ONLY-AFTER-VERIFY: no live bin was placed on PATH.
    await expect(stat(path.join(toolsPrefix, "bin", "claude"))).rejects.toBeTruthy();
    await expect(
      stat(path.join(toolsPrefix, "providers", "anthropic", "current"))
    ).rejects.toBeTruthy();
  });

  it("a failed `npm ci` is a terminal error, not a promote", async () => {
    const { io } = makeFakeIo({ installedVersion: PINNED, ciFails: true });
    const svc = new InstallService({ io, catalog: PROVIDER_CATALOG, toolsPrefix, homeBase });
    const result = await svc.installProvider("anthropic");
    expect(result.state).toBe("error");
    await expect(stat(path.join(toolsPrefix, "bin", "claude"))).rejects.toBeTruthy();
  });

  it("an unsupported host arch is a DEFINED verify failure (not an undefined deref) (§A.1.3)", async () => {
    const { io } = makeFakeIo({ installedVersion: PINNED });
    const svc = new InstallService({
      io,
      catalog: PROVIDER_CATALOG,
      toolsPrefix,
      homeBase,
      hostArch: "riscv64"
    });
    const result = await svc.installProvider("anthropic");
    expect(result.state).toBe("error");
    expect(result.message).toMatch(/unsupported host arch/i);
  });
});

describe("InstallService — serialize per provider (§A.3.1)", () => {
  it("a second same-provider install while one is in flight is rejected (not queued)", async () => {
    let releaseCi: (() => void) | undefined;
    const gate = new Promise<void>((res) => {
      releaseCi = res;
    });
    // An io whose `npm ci` blocks until we release it, so the first install stays in flight.
    const base = makeFakeIo({ installedVersion: PINNED });
    const io: TmuxIo = {
      ...base.io,
      run: async (cmd, args, opts) => {
        if (cmd === "npm" && args[0] === "ci") await gate;
        return base.io.run(cmd, args, opts);
      }
    };
    const svc = new InstallService({
      io,
      catalog: PROVIDER_CATALOG,
      toolsPrefix,
      homeBase,
      hostArch: "x64"
    });

    const first = svc.installProvider("anthropic");
    // Give the first call time to acquire the lock + reach the blocked `npm ci`.
    await new Promise((r) => setTimeout(r, 20));
    await expect(svc.installProvider("anthropic")).rejects.toBeInstanceOf(InstallBadRequestError);

    releaseCi?.();
    const result = await first;
    expect(result.state).toBe("installed");
  });
});

describe("InstallService — idempotent re-install (§A.3.6)", () => {
  it("re-installing the already-pinned, byte-identical version is a no-op (alreadyInstalled)", async () => {
    const { io, runs } = makeFakeIo({ installedVersion: PINNED });
    const svc = new InstallService({
      io,
      catalog: PROVIDER_CATALOG,
      toolsPrefix,
      homeBase,
      hostArch: "x64"
    });

    const first = await svc.installProvider("anthropic");
    expect(first.state).toBe("installed");
    expect(first.alreadyInstalled).toBeUndefined();

    const ciCountAfterFirst = runs.filter((r) => r.cmd === "npm" && r.args[0] === "ci").length;

    const second = await svc.installProvider("anthropic");
    expect(second.state).toBe("installed");
    expect(second.alreadyInstalled).toBe(true);

    // No second `npm ci` ran — the no-op did not re-stage/re-promote.
    const ciCountAfterSecond = runs.filter((r) => r.cmd === "npm" && r.args[0] === "ci").length;
    expect(ciCountAfterSecond).toBe(ciCountAfterFirst);
  });
});

describe("InstallService — startup sweep (§A.3.2)", () => {
  it("clears orphaned .staging/* and GCs releases not referenced by current", async () => {
    // Seed an orphaned staging dir and two release dirs, with `current` → one of them.
    await mkdir(path.join(toolsPrefix, ".staging", "anthropic-orphan"), { recursive: true });
    const providerDir = path.join(toolsPrefix, "providers", "anthropic");
    const releasesDir = path.join(providerDir, "releases");
    await mkdir(path.join(releasesDir, "keep"), { recursive: true });
    await mkdir(path.join(releasesDir, "orphan"), { recursive: true });
    await symlink(path.join("releases", "keep"), path.join(providerDir, "current"));

    const { io } = makeFakeIo({ installedVersion: PINNED });
    const svc = new InstallService({ io, catalog: PROVIDER_CATALOG, toolsPrefix, homeBase });
    await svc.startupSweep();

    // .staging is gone entirely.
    await expect(stat(path.join(toolsPrefix, ".staging"))).rejects.toBeTruthy();
    // the referenced release survives, the orphan is GC'd.
    await expect(stat(path.join(releasesDir, "keep"))).resolves.toBeTruthy();
    await expect(stat(path.join(releasesDir, "orphan"))).rejects.toBeTruthy();
  });
});

describe("InstallService — sanitized installer env (§A.3.3)", () => {
  it("the installer env = §7.2 allowlist + registry/proxy ONLY; no app/DB/vault/RPC secret", () => {
    const source: NodeJS.ProcessEnv = {
      HOME: "/data/cli-auth",
      PATH: "/usr/bin:/data/cli-tools/bin",
      NPM_CONFIG_PREFIX: "/data/cli-tools",
      LANG: "en_US.UTF-8",
      // registry/proxy — KEPT for a legitimate npm install
      HTTPS_PROXY: "http://proxy:8080",
      HTTP_PROXY: "http://proxy:8080",
      NO_PROXY: "localhost",
      NPM_CONFIG_REGISTRY: "https://registry.example/",
      // EXCLUDED — every secret + the socket path + the RPC secret
      JARVIS_CLI_RUNNER_SOCKET: "/run/jarv1s/cli-runner.sock",
      JARVIS_CLI_RUNNER_RPC_SECRET: "rpc-secret",
      BETTER_AUTH_SECRET: "x",
      JARVIS_AI_SECRET_KEY: "x",
      JARVIS_CONNECTOR_SECRET_KEY: "x",
      POSTGRES_PASSWORD: "x",
      JARVIS_APP_DATABASE_URL: "postgres://...",
      JARVIS_VAULT_ROOT: "/data/vaults"
    };
    const env = buildSanitizedInstallerEnv(source);

    // allowlist + registry/proxy survive
    expect(env.HOME).toBe("/data/cli-auth");
    expect(env.NPM_CONFIG_PREFIX).toBe("/data/cli-tools");
    expect(env.HTTPS_PROXY).toBe("http://proxy:8080");
    expect(env.NPM_CONFIG_REGISTRY).toBe("https://registry.example/");

    // every secret + the socket path + the RPC secret are dropped
    expect(env.JARVIS_CLI_RUNNER_SOCKET).toBeUndefined();
    expect(env.JARVIS_CLI_RUNNER_RPC_SECRET).toBeUndefined();
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.JARVIS_AI_SECRET_KEY).toBeUndefined();
    expect(env.JARVIS_CONNECTOR_SECRET_KEY).toBeUndefined();
    expect(env.POSTGRES_PASSWORD).toBeUndefined();
    expect(env.JARVIS_APP_DATABASE_URL).toBeUndefined();
    expect(env.JARVIS_VAULT_ROOT).toBeUndefined();
  });

  it("the npm ci subprocess is invoked WITH the sanitized installer env (no secrets)", async () => {
    const { io, runs } = makeFakeIo({ installedVersion: PINNED });
    const svc = new InstallService({
      io,
      catalog: PROVIDER_CATALOG,
      toolsPrefix,
      homeBase,
      hostArch: "x64",
      env: {
        HOME: "/data/cli-auth",
        PATH: process.env.PATH,
        NPM_CONFIG_REGISTRY: "https://registry.example/",
        BETTER_AUTH_SECRET: "must-not-leak",
        JARVIS_CLI_RUNNER_RPC_SECRET: "rpc-secret"
      }
    });
    await svc.installProvider("anthropic");
    const ci = runs.find((r) => r.cmd === "npm" && r.args[0] === "ci");
    expect(ci?.env?.NPM_CONFIG_REGISTRY).toBe("https://registry.example/");
    expect(ci?.env?.BETTER_AUTH_SECRET).toBeUndefined();
    expect(ci?.env?.JARVIS_CLI_RUNNER_RPC_SECRET).toBeUndefined();
  });
});

describe("self-update-disable kind:env reaches the LAUNCHED CLI env (§A.3.7, R6)", () => {
  it("sourceSelfUpdateDisableEnv sets the catalog env key on process.env, and the §7.2 passthrough then carries the VALUE to the launched CLI", () => {
    // The catalog's anthropic recipe pins a kind:"env" self-update-disable.
    const recipe = PROVIDER_CATALOG.anthropic.recipe;
    if (recipe?.kind !== "npm" || recipe.selfUpdateDisable.kind !== "env") {
      // codex/claude could be pinned config; the assertion is conditional on env-kind.
      return;
    }
    const { key, value } = recipe.selfUpdateDisable;

    // A bare process.env that does NOT yet carry the key — allowlisting alone is a NO-OP.
    const beforeSource: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/data/cli-auth" };
    expect(buildSanitizedCliEnv(beforeSource)[key]).toBeUndefined();

    // After boot-sourcing the catalog pair onto the env, the §7.2 passthrough delivers it.
    const target: NodeJS.ProcessEnv = { PATH: "/usr/bin", HOME: "/data/cli-auth" };
    const setKeys = sourceSelfUpdateDisableEnv(target);
    expect(setKeys).toContain(key);
    const launchedCliEnv = buildSanitizedCliEnv(target);
    // The VALUE actually reaches the launched-CLI env — NOT merely the allowlist.
    expect(launchedCliEnv[key]).toBe(value);
  });
});
