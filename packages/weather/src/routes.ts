import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccessContext, DataContextRunner, PreferencesPort } from "@jarv1s/db";
import { handleRouteError } from "@jarv1s/module-sdk";
import { getWeatherTodayRouteSchema } from "@jarv1s/shared";
import { WeatherService } from "./weather-service.js";

interface WeatherRoutesDependencies {
  readonly dataContext: DataContextRunner;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly preferencesRepo: PreferencesPort;
  readonly fetchFn?: typeof fetch;
}

export function registerWeatherRoutes(
  server: FastifyInstance,
  dependencies: WeatherRoutesDependencies
): void {
  const service = new WeatherService({
    preferencesRepo: dependencies.preferencesRepo,
    dataContext: dependencies.dataContext,
    fetchFn: dependencies.fetchFn
  });

  server.get(
    "/api/weather/today",
    { schema: getWeatherTodayRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const data = await service.getWeatherForUser(accessContext, request.ip);
        return { data };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );
}
