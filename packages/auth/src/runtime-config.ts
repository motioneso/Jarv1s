import { resolveMossEnv } from "@moss/db";

export interface AuthOriginConfig {
  readonly baseURL: string;
  readonly trustedOrigins: string[];
}

export function resolveAuthOriginConfig(env: NodeJS.ProcessEnv): AuthOriginConfig {
  const configuredBaseURL = resolveMossEnv(env, "JARVIS_AUTH_BASE_URL") ?? env.BETTER_AUTH_URL;
  const port = env.PORT || "3000";
  const baseURL = configuredBaseURL ?? `http://localhost:${port}`;
  const configuredOrigins = resolveMossEnv(env, "JARVIS_AUTH_TRUSTED_ORIGINS");

  if (configuredOrigins !== undefined) {
    return {
      baseURL,
      trustedOrigins: configuredOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    };
  }

  return {
    baseURL,
    trustedOrigins: configuredBaseURL
      ? [baseURL]
      : [`http://localhost:${port}`, `http://127.0.0.1:${port}`]
  };
}
