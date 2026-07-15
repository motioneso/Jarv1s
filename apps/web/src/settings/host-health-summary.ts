import type { HostDiagnosticCheckDto } from "@jarv1s/shared";

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
