import type {
  CreateUsefulnessFeedbackRequest,
  CreateUsefulnessFeedbackResponse
} from "@jarv1s/shared";

import { requestJson } from "./client";

export async function createUsefulnessFeedback(
  input: CreateUsefulnessFeedbackRequest
): Promise<CreateUsefulnessFeedbackResponse> {
  return requestJson<CreateUsefulnessFeedbackResponse>("/api/me/usefulness-feedback", {
    method: "POST",
    body: input
  });
}

export async function undoUsefulnessFeedback(
  id: string
): Promise<CreateUsefulnessFeedbackResponse> {
  return requestJson<CreateUsefulnessFeedbackResponse>(
    `/api/me/usefulness-feedback/${encodeURIComponent(id)}/undo`,
    { method: "POST" }
  );
}
