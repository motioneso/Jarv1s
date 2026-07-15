import type { HostDiagnosticsInfo } from "@jarv1s/shared";

// #993/#9.5: factored out of server.ts to restore the file-size cap. Pure env/mode
// mappers used only by the host diagnostics info() handler.

export function mapEnvMode(nodeEnv: string | undefined): HostDiagnosticsInfo["environment"] {
  switch (nodeEnv) {
    case "production":
      return "production";
    case "development":
      return "development";
    case "test":
      return "test";
    default:
      return "unknown";
  }
}

export function resolveDeployMode(raw: string | undefined): HostDiagnosticsInfo["deployMode"] {
  switch (raw) {
    case "compose":
    case "systemd":
    case "dev":
      return raw;
    default:
      return "unknown";
  }
}

export function restartCommandFor(mode: HostDiagnosticsInfo["deployMode"]): string | null {
  switch (mode) {
    case "compose":
      return "docker compose restart api";
    case "systemd":
      return "systemctl restart jarvis-api";
    case "dev":
      return "restart the dev process (Ctrl-C, then re-run)";
    default:
      return null;
  }
}
