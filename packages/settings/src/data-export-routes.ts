import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { AccessContext, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import { createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import { handleSettingsRouteError } from "./route-error.js";
import { exportUserData } from "./data-export.js";

export interface DataExportRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
}

export function registerDataExportRoutes(
  server: FastifyInstance,
  dependencies: DataExportRoutesDependencies
): void {
  server.get("/api/settings/me/data-export", async (request, reply) => {
    const authDb = createDatabase({
      connectionString: getJarvisDatabaseUrls().auth,
      maxConnections: 1
    });

    try {
      const accessContext = await dependencies.resolveAccessContext(request);

      const userExport = await dependencies.dataContext.withDataContext(
        accessContext,
        async (scopedDb) => {
          return exportUserData({
            scopedDb,
            authDb,
            userId: accessContext.actorUserId,
            listModuleManifests: dependencies.listModuleManifests
          });
        }
      );

      const timestamp = userExport.exportedAt.replace(/[:.]/g, "-");
      const filename = `jarv1s-archive-${accessContext.actorUserId}-${timestamp}.json`;

      void reply.header("Content-Type", "application/json");
      void reply.header("Content-Disposition", `attachment; filename="${filename}"`);

      return userExport;
    } catch (error) {
      console.error(error);
      return handleSettingsRouteError(error, reply);
    } finally {
      await authDb.destroy();
    }
  });
}
