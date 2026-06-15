import type { AdminAuditEventDto } from "@jarv1s/shared";

/* Audit phrasing + categorisation, built on the AdminAuditEventDto shape
   (actor / action / targetType / targetId / metadata / timestamp). The action →
   copy map below is intentionally extensible — add a case as new action types
   appear server-side. */

export type AuditCategory = "People" | "Modules" | "Connections" | "Assistant" | "System";

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  "People",
  "Modules",
  "Connections",
  "Assistant",
  "System"
];

export function auditCategory(action: string): AuditCategory {
  const namespace = action.split(".")[0] ?? "";
  switch (namespace) {
    case "user":
      return "People";
    case "module":
      return "Modules";
    case "connector":
    case "connection":
      return "Connections";
    case "ai":
    case "provider":
      return "Assistant";
    default:
      return "System";
  }
}

function metaString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

/** A short, human "what happened" clause — the actor is rendered separately. */
export function auditPhrase(
  event: AdminAuditEventDto,
  nameOf: (id: string | null) => string
): string {
  const target = event.targetId ? nameOf(event.targetId) : null;
  const moduleId = metaString(event.metadata, "moduleId") ?? event.targetId ?? "a module";

  switch (event.action) {
    case "user.approve":
      return `approved ${target ?? "a member"}`;
    case "user.reject":
      return `declined ${target ?? "a sign-up"}`;
    case "user.deactivate":
      return `deactivated ${target ?? "a member"}`;
    case "user.reactivate":
      return `reactivated ${target ?? "a member"}`;
    case "user.promote":
      return `made ${target ?? "a member"} an admin`;
    case "user.demote":
      return `revoked admin from ${target ?? "a member"}`;
    case "user.remove":
    case "user.delete":
      return `removed ${target ?? "a member"} from the instance`;
    case "module.instance_enable":
      return `enabled the ${moduleId} module`;
    case "module.instance_disable":
      return `disabled the ${moduleId} module`;
    case "registration.enabled":
      return "changed who can register";
    case "registration.requires_approval":
      return "changed the approval requirement";
    case "instance_setting.upsert":
      return `updated the ${event.targetId ?? "instance"} setting`;
    default:
      return `${event.action.replace(/[._]/g, " ")}${
        event.targetType ? ` on ${event.targetType}` : ""
      }`;
  }
}

/** Relative "Today · HH:MM" / "Yesterday · HH:MM" / "Mon D · HH:MM" formatting. */
export function auditWhen(ts: string, now: Date): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const day0 = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day0(now) - day0(d)) / 86_400_000);
  if (diff === 0) return `Today · ${hh}:${mm}`;
  if (diff === 1) return `Yesterday · ${hh}:${mm}`;
  return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()} · ${hh}:${mm}`;
}

export interface AuditCsvRow {
  readonly timestamp: string;
  readonly actor: string;
  readonly category: string;
  readonly action: string;
  readonly target: string;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function auditCsv(rows: readonly AuditCsvRow[]): string {
  const header = ["Timestamp", "Actor", "Category", "Action", "Target"];
  const lines = rows.map((row) =>
    [row.timestamp, row.actor, row.category, row.action, row.target].map(csvCell).join(",")
  );
  return [header.join(","), ...lines].join("\n");
}
