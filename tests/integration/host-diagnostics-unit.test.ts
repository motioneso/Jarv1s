import { describe, expect, it } from "vitest";

import type { HostDiagnosticsDto, HostDiagnosticsInfo } from "@jarv1s/shared";

import {
  assertDiagnosticsSafe,
  buildHostDiagnostics
} from "../../packages/settings/src/host-diagnostics.js";

// Pure (no DB / no I/O) — lives under tests/integration only because the foundation
// gate runs `vitest run tests/integration`. It exercises the serializer + secret guard
// that are the structured-output safety boundary for #255 host diagnostics.

const baseInfo: HostDiagnosticsInfo = {
  uptimeSeconds: 12,
  environment: "test",
  version: null,
  commit: null,
  host: "0.0.0.0",
  port: 3000,
  logLevel: "info",
  deployMode: "dev",
  restartCommand: "restart the dev process (Ctrl-C, re-run)",
  moduleCount: 5,
  routeCount: 20
};

const EXPECTED_KEYS = [
  "uptimeSeconds",
  "environment",
  "version",
  "commit",
  "host",
  "port",
  "logLevel",
  "deployMode",
  "restartCommand",
  "moduleCount",
  "routeCount",
  "multiplexer",
  "available",
  "checks"
].sort();

describe("buildHostDiagnostics", () => {
  it("builds database/pgboss/multiplexer checks with mapped statuses", () => {
    const dto = buildHostDiagnostics({
      info: baseInfo,
      multiplexer: "auto",
      available: { tmux: true, herdr: false },
      dbOk: false,
      pgBossOk: true
    });
    const byId = Object.fromEntries(dto.checks.map((c) => [c.id, c.status]));
    expect(byId.database).toBe("fail");
    expect(byId.pgboss).toBe("pass");
    // At least one multiplexer is available → pass.
    expect(byId.multiplexer).toBe("pass");
  });

  it("warns when neither multiplexer is available", () => {
    const dto = buildHostDiagnostics({
      info: baseInfo,
      multiplexer: "auto",
      available: { tmux: false, herdr: false },
      dbOk: true,
      pgBossOk: true
    });
    const mux = dto.checks.find((c) => c.id === "multiplexer");
    expect(mux?.status).toBe("warn");
    expect(dto.checks.find((c) => c.id === "database")?.status).toBe("pass");
  });

  it("emits exactly the allowlisted DTO keys — no extra/unknown fields", () => {
    const dto = buildHostDiagnostics({
      info: baseInfo,
      multiplexer: "herdr",
      available: { tmux: false, herdr: true },
      dbOk: true,
      pgBossOk: true
    });
    expect(Object.keys(dto).sort()).toEqual(EXPECTED_KEYS);
    expect(dto.multiplexer).toBe("herdr");
    expect(dto.available).toEqual({ tmux: false, herdr: true });
  });
});

describe("assertDiagnosticsSafe", () => {
  function safeDto(): HostDiagnosticsDto {
    return buildHostDiagnostics({
      info: baseInfo,
      multiplexer: "auto",
      available: { tmux: true, herdr: true },
      dbOk: true,
      pgBossOk: true
    });
  }

  it("does not throw for a normal happy-path DTO", () => {
    expect(() => assertDiagnosticsSafe(safeDto())).not.toThrow();
  });

  it("throws when a check detail contains a connection URL", () => {
    const poisoned: HostDiagnosticsDto = {
      ...safeDto(),
      checks: [{ id: "database", label: "Database", status: "fail", detail: "postgres://u:p@h/db" }]
    };
    expect(() => assertDiagnosticsSafe(poisoned)).toThrow();
  });

  it("throws when a string field contains creds-in-URL", () => {
    const poisoned: HostDiagnosticsDto = {
      ...safeDto(),
      restartCommand: "https://user:secret@example.com/restart"
    };
    expect(() => assertDiagnosticsSafe(poisoned)).toThrow();
  });

  it("throws when a string field names a known secret env key", () => {
    for (const key of [
      "JARVIS_CONNECTOR_SECRET_KEY",
      "JARVIS_AI_SECRET_KEY",
      "BETTER_AUTH_SECRET",
      "DATABASE_URL"
    ]) {
      const poisoned: HostDiagnosticsDto = {
        ...safeDto(),
        checks: [{ id: "x", label: "x", status: "warn", detail: `leaked ${key}` }]
      };
      expect(() => assertDiagnosticsSafe(poisoned)).toThrow();
    }
  });
});
