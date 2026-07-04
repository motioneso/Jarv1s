import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

import { getEmailTaskMode, putEmailTaskMode } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Row, Select } from "./settings-ui";
import { DEFAULT_EMAIL_TASK_MODE, type EmailTaskCreationMode } from "@jarv1s/shared";

const EMAIL_TASK_MODE_OPTIONS: ReadonlyArray<{
  readonly value: EmailTaskCreationMode;
  readonly label: string;
  readonly desc: string;
}> = [
  { value: "off", label: "Off", desc: "Never create tasks from email." },
  { value: "suggest", label: "Suggest", desc: "Stage suggestions for your review (default)." },
  {
    value: "auto_safe",
    label: "Auto for safe items",
    desc: "Auto-add bills and hard deadlines; stage the rest."
  },
  { value: "auto", label: "Auto", desc: "Auto-add anything Jarvis is confident about." }
];

/** Email → task creation mode (#729), rendered inside the email source card. */
export function EmailTaskCreationRow() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const modeQuery = useQuery({
    queryKey: queryKeys.email.taskMode,
    queryFn: getEmailTaskMode,
    retry: false
  });
  const mode = modeQuery.data?.mode ?? DEFAULT_EMAIL_TASK_MODE;
  const modeMutation = useMutation({
    mutationFn: (next: EmailTaskCreationMode) => putEmailTaskMode({ mode: next }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.email.taskMode, data);
      toast("Task creation mode saved", { icon: <ShieldCheck size={17} /> });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const current = EMAIL_TASK_MODE_OPTIONS.find((option) => option.value === mode);
  return (
    <Row
      name="Task creation"
      desc={current?.desc ?? "How email becomes tasks."}
      control={
        <Select
          value={mode}
          aria-label="Email task creation mode"
          disabled={modeQuery.isLoading || modeMutation.isPending}
          onChange={(event) =>
            modeMutation.mutate(event.currentTarget.value as EmailTaskCreationMode)
          }
        >
          {EMAIL_TASK_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      }
    />
  );
}
