import type { DeleteMyAccountRequest, DeleteMyAccountResponse } from "@jarv1s/shared";

import { requestJson } from "./client.js";

/**
 * Self-service account deletion (#239). Sends the typed confirmation factors
 * (email + phrase + current password when the account owns one). On a 200 the
 * caller's own session was cascade-destroyed server-side, so the client MUST
 * clear `queryKeys.auth.me` and route to the signed-out root — no follow-up
 * request from the dead session will authenticate.
 */
export async function deleteMyAccount(
  body: DeleteMyAccountRequest
): Promise<DeleteMyAccountResponse> {
  return requestJson<DeleteMyAccountResponse>("/api/me/account", {
    method: "DELETE",
    body
  });
}
