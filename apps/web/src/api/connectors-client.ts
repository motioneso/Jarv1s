import type { FeatureGrantsResponse, UpdateFeatureGrantsRequest } from "@jarv1s/shared";

import { requestJson } from "./client";

export function getConnectorFeatureGrants(id: string): Promise<FeatureGrantsResponse> {
  return requestJson<FeatureGrantsResponse>(
    `/api/connectors/accounts/${encodeURIComponent(id)}/feature-grants`
  );
}

export function updateConnectorFeatureGrants(
  id: string,
  input: UpdateFeatureGrantsRequest
): Promise<FeatureGrantsResponse> {
  return requestJson<FeatureGrantsResponse>(
    `/api/connectors/accounts/${encodeURIComponent(id)}/feature-grants`,
    { method: "PUT", body: input }
  );
}
