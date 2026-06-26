import type {
  GetRuntimeConfigResponse,
  PutRuntimeConfigRequest,
  PutRuntimeConfigResponse
} from "@jarv1s/shared";

import { requestJson } from "./client.js";

export async function getRuntimeConfig(key: string): Promise<GetRuntimeConfigResponse> {
  return requestJson<GetRuntimeConfigResponse>(
    `/api/admin/runtime-config/${encodeURIComponent(key)}`
  );
}

export async function putRuntimeConfig(
  key: string,
  input: PutRuntimeConfigRequest
): Promise<PutRuntimeConfigResponse> {
  return requestJson<PutRuntimeConfigResponse>(
    `/api/admin/runtime-config/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      body: input
    }
  );
}
