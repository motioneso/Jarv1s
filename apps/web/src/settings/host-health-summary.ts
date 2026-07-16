import type { HerdrInstallResultDto, HostDiagnosticCheckDto } from "@jarv1s/shared";

/**
 * #1088 F3 — POST /api/admin/host/install always resolves 200 (the route only ever
 * 503s on an authz/missing-port failure BEFORE calling install(); a failed or timed-out
 * install still returns `state: "failed" | "timeout"` in the body, never an HTTP error —
 * see host-install-routes.ts). That means a mutation's onSuccess firing is NOT proof the
 * install worked — the pane's Install button used to invalidate the query and go quiet
 * on `state !== "installed"`, so the admin saw nothing (the button just stopped
 * spinning) while herdr stayed uninstalled. Map the DTO's `state` to what the pane
 * should actually tell the operator.
 */
export function describeHerdrInstallOutcome(result: HerdrInstallResultDto): {
  tone: "ready" | "drift";
  message: string;
} {
  switch (result.state) {
    case "installed":
      return { tone: "ready", message: "Herdr installed." };
    case "timeout":
      return {
        tone: "drift",
        message: "Herdr install timed out. Check the host's disk space and network, then retry."
      };
    case "failed":
      return { tone: "drift", message: "Herdr install failed. Check the API logs for detail." };
  }
}

export function healthSummary(checks: readonly HostDiagnosticCheckDto[]): {
  tone: "pine" | "amber" | "red";
  label: string;
} {
  if (checks.some((c) => c.status === "fail")) return { tone: "red", label: "Action required" };
  if (checks.some((c) => c.status === "warn")) return { tone: "amber", label: "Needs attention" };
  return { tone: "pine", label: "Healthy" };
}

export function orderChecksBySeverity(
  checks: readonly HostDiagnosticCheckDto[]
): readonly HostDiagnosticCheckDto[] {
  const rank = { fail: 0, warn: 1, pass: 2 } as const;
  return [...checks].sort((a, b) => rank[a.status] - rank[b.status]);
}
