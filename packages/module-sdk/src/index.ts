export type ModuleLifecycle = "required" | "optional" | "user-toggleable" | "workspace-toggleable";
export type ModuleScope = "user" | "workspace" | "admin" | "system";
export type ModulePermissionAction = "view" | "create" | "update" | "delete" | "manage" | "execute";
export type ModuleAssistantToolRisk = "read" | "write" | "destructive";

export interface JsonSchema {
  readonly [key: string]: unknown;
}

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
