export {
  HttpError,
  handleRouteError,
  type RouteErrorMapper,
  type HandleRouteErrorOptions
} from "./route-errors.js";

export { sessionRateLimitKey } from "./rate-limit-key.js";

export { CORE_VERSION, satisfiesCoreVersion } from "./core-version.js";

export type ModuleLifecycle = "required" | "optional" | "user-toggleable" | "workspace-toggleable";
export type ModuleScope = "user" | "admin" | "system";
export type ModulePermissionAction = "view" | "create" | "update" | "delete" | "manage" | "execute";
export type ModuleAssistantToolRisk = "read" | "write" | "destructive";

export interface JsonSchema {
  readonly [key: string]: unknown;
}

export type ToolInput = Record<string, unknown>;

export interface ToolContext {
  readonly actorUserId: string;
  readonly requestId: string;
  readonly chatSessionId: string;
}

export interface ToolResult {
  readonly data: Record<string, unknown>;
  readonly columnOrder?: readonly string[];
}

/**
 * Execution handler for an assistant tool. `scopedDb` is a DataContextDb supplied
 * by the gateway under withDataContext; it is typed as `unknown` here to avoid a
 * module-sdk -> db dependency. The owning module narrows it via its own repository.
 * Called ONLY when authorized (read allowed, or write/destructive approved); input
 * is already validated against inputSchema.
 */
export type ToolExecute = (
  scopedDb: unknown,
  input: ToolInput,
  ctx: ToolContext
) => Promise<ToolResult>;

/** Optional human-readable description of a proposed write, for the Approve/Deny card. */
export type ToolSummarize = (input: ToolInput, ctx: ToolContext) => string;

export interface ModuleCompatibility {
  readonly jarv1s: string;
}

export interface ModuleAvailabilityManifest {
  readonly defaultEnabled: boolean;
  readonly required?: boolean;
  readonly supportsUserDisable?: boolean;
  readonly supportsWorkspaceDisable?: boolean;
  readonly featureFlagId?: string;
}

export interface ModuleDatabaseManifest {
  readonly migrations: readonly string[];
  readonly migrationDirectories?: readonly string[];
  readonly ownedTables: readonly string[];
}

export interface ModuleRouteManifest {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly requestSchema?: JsonSchema;
  readonly responseSchema?: JsonSchema;
  readonly permissionId?: string;
  readonly featureFlagId?: string;
}

export interface ModuleJobManifest {
  readonly queueName: string;
  readonly payloadSchema?: JsonSchema;
  readonly metadataOnly?: boolean;
  readonly permissionId?: string;
}

export interface ModuleShareableResourceManifest {
  readonly resourceType: string;
  readonly grantLevels: readonly ("view" | "contribute" | "manage")[];
}

export interface ModulePermissionManifest {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scope: ModuleScope;
  readonly actions: readonly ModulePermissionAction[];
}

export interface ModuleFeatureFlagManifest {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly scope: ModuleScope;
  readonly defaultEnabled: boolean;
}

export interface ModuleNavigationEntryManifest {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string;
  readonly order?: number;
  readonly permissionId?: string;
  readonly featureFlagId?: string;
}

export interface ModuleSettingsSurfaceManifest {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly scope: ModuleScope;
  readonly order?: number;
  readonly permissionId?: string;
  readonly featureFlagId?: string;
}

export interface ModuleAssistantToolManifest {
  readonly name: string;
  readonly description: string;
  readonly permissionId: string;
  readonly risk: ModuleAssistantToolRisk;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly featureFlagId?: string;
  readonly execute?: ToolExecute;
  readonly summarize?: ToolSummarize;
}

export interface JarvisModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly lifecycle: ModuleLifecycle;
  readonly compatibility: ModuleCompatibility;
  readonly availability?: ModuleAvailabilityManifest;
  readonly database?: ModuleDatabaseManifest;
  readonly navigation?: readonly ModuleNavigationEntryManifest[];
  readonly settings?: readonly ModuleSettingsSurfaceManifest[];
  readonly permissions?: readonly ModulePermissionManifest[];
  readonly featureFlags?: readonly ModuleFeatureFlagManifest[];
  readonly routes?: readonly ModuleRouteManifest[];
  readonly jobs?: readonly ModuleJobManifest[];
  readonly shareableResources?: readonly ModuleShareableResourceManifest[];
  readonly assistantTools?: readonly ModuleAssistantToolManifest[];
}

export function renderToolResult(result: ToolResult): string {
  const { data, columnOrder } = result;
  const items = data.items;

  if (!isUniformFlatArray(items)) {
    return JSON.stringify(data, null, 2);
  }

  const columns = columnOrder
    ? [...columnOrder, ...Object.keys(items[0]!).filter((k) => !columnOrder.includes(k))]
    : Object.keys(items[0]!).sort();

  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = items.map(
    (row: Record<string, unknown>) => `| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`
  );
  return [header, divider, ...rows].join("\n");
}

function isUniformFlatArray(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const keys = Object.keys(value[0]).sort().join(",");
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      Object.keys(item).sort().join(",") === keys &&
      Object.values(item).every((v) => typeof v !== "object" || v === null)
  );
}
