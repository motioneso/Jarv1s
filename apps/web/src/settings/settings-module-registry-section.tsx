// #964: registry-backed module distribution — install/update/remove from the admin
// Instance-modules pane. Functional pass only: reuses jds primitives; visual design
// is a later annotation round. All states come from the server-derived
// ModuleRegistryRowDto.state (spec §8) — no client-side state math beyond labels.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ModuleRegistryRowDto } from "@jarv1s/shared";

import {
  cancelModulePurge,
  downloadRegistryModule,
  getModuleRegistry,
  removeRegistryModule
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { readError } from "./settings-types";
import { Note } from "./settings-ui";

const STATE_LABELS: Record<ModuleRegistryRowDto["state"], string> = {
  "not-installed": "Not installed",
  "pending-restart": "Downloaded — restart to apply",
  "installed-enabled": "Installed",
  "installed-disabled": "Installed (disabled)",
  "update-available": "Update available",
  "update-pending-restart": "Update downloaded — restart to apply",
  "install-failed": "Install failed",
  "declared-not-present": "Declared in compose — will install on restart",
  incompatible: "Incompatible with this Jarvis version"
};

// Spec §8: the pre-download confirm shows the index capabilities block so the admin
// reviews what the module can do BEFORE anything is fetched. Plain-text rendering —
// ConfirmOptions.description is a string; richer layout is a later design pass.
// `capabilities` is null when the row is local-only (not present in the registry
// index, e.g. `declared-not-present`) — those states never route through here since
// `canInstall` still allows a download attempt, so guard rather than assume presence.
function describeCapabilities(row: ModuleRegistryRowDto): string {
  const caps = row.capabilities;
  if (!caps)
    return "No capability information is available yet. The download applies on the next restart.";
  const parts = [
    caps.permissions.length ? `Permissions: ${caps.permissions.join(", ")}.` : "No permissions.",
    caps.fetchHosts.length
      ? `May fetch from: ${caps.fetchHosts.join(", ")}.`
      : "No network access.",
    caps.tools.length
      ? `Tools: ${caps.tools.map((tool) => `${tool.name} (${tool.risk})`).join(", ")}.`
      : "No assistant tools.",
    caps.ownsTables.length
      ? `Owns database tables: ${caps.ownsTables.join(", ")}.`
      : "No database tables."
  ];
  return `${parts.join(" ")} The download applies on the next restart.`;
}

export function ModuleRegistrySection() {
  const queryClient = useQueryClient();
  const { toast, confirm } = useFeedback();

  const registryQuery = useQuery({
    queryKey: queryKeys.settings.adminModuleRegistry,
    queryFn: () => getModuleRegistry(false),
    retry: false
  });

  const invalidate = () =>
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminModuleRegistry }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminExternalModules })
    ]);

  const downloadMutation = useMutation({
    mutationFn: (input: { id: string; version?: string }) =>
      downloadRegistryModule(input.id, input.version),
    onSuccess: (result) => {
      invalidate();
      toast(`${result.module.name} downloaded — restart Jarvis to apply`, { tone: "ready" });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const removeMutation = useMutation({
    mutationFn: (input: { id: string; purgeData: boolean }) =>
      removeRegistryModule(input.id, input.purgeData),
    onSuccess: (result, input) => {
      invalidate();
      toast(
        input.purgeData
          ? `${result.module.id} removed — data purge runs on next restart`
          : `${result.module.id} removed — its data is kept`,
        { tone: "ready" }
      );
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const cancelPurgeMutation = useMutation({
    mutationFn: (id: string) => cancelModulePurge(id),
    onSuccess: () => {
      invalidate();
      toast("Purge cancelled", { tone: "ready" });
    },
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const refreshMutation = useMutation({
    mutationFn: () => getModuleRegistry(true),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.adminModuleRegistry, data),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });

  const onInstall = (row: ModuleRegistryRowDto) => {
    confirm({
      title:
        row.state === "update-available"
          ? `Update ${row.name} to v${row.latestVersion}?`
          : `Install ${row.name}?`,
      description: describeCapabilities(row),
      confirmLabel: row.state === "update-available" ? "Download update" : "Download",
      onConfirm: () => downloadMutation.mutate({ id: row.id })
    });
  };

  const onRemove = (row: ModuleRegistryRowDto) => {
    confirm({
      title: `Remove ${row.name}?`,
      description:
        "The module stops on next restart and its files are deleted. Its data is kept " +
        "and comes back if you reinstall. To also destroy its data, use “Remove + purge”.",
      confirmLabel: "Remove, keep data",
      onConfirm: () => removeMutation.mutate({ id: row.id, purgeData: false })
    });
  };

  const onRemovePurge = (row: ModuleRegistryRowDto) => {
    confirm({
      title: `Remove ${row.name} and destroy its data?`,
      description:
        "This permanently deletes every table and record the module owns on the next " +
        "restart. There is no undo after the restart runs.",
      confirmLabel: "Remove + purge data",
      danger: true,
      requireText: row.id,
      onConfirm: () => removeMutation.mutate({ id: row.id, purgeData: true })
    });
  };

  const data = registryQuery.data;
  if (registryQuery.isPending) return <p className="jds-muted">Loading module registry…</p>;
  if (registryQuery.isError) return <p className="jds-muted">{readError(registryQuery.error)}</p>;
  if (!data || !data.enabled) return null;

  const canInstall = (row: ModuleRegistryRowDto) =>
    (row.state === "not-installed" ||
      row.state === "update-available" ||
      row.state === "declared-not-present" ||
      row.state === "install-failed") &&
    !row.purgePending;
  const canRemove = (row: ModuleRegistryRowDto) =>
    row.state !== "not-installed" && row.state !== "declared-not-present" && !row.purgePending;

  return (
    <section aria-label="Module registry">
      <h3>Available modules</h3>
      {data.registryUnavailable ? (
        <p className="jds-muted">
          The module registry is unreachable — showing installed modules only.
        </p>
      ) : null}
      {data.modules.some(
        (row) => row.state === "pending-restart" || row.state === "update-pending-restart"
      ) ? (
        <Note>
          Downloaded modules apply on the next restart. From your deployment directory:{" "}
          <code>{"docker compose pull && docker compose up -d"}</code> (or restart the container).
        </Note>
      ) : null}
      <button
        type="button"
        className="jds-btn jds-btn--quiet"
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
      >
        {refreshMutation.isPending ? "Refreshing…" : "Refresh from registry"}
      </button>
      <ul>
        {data.modules.map((row) => (
          <li key={row.id}>
            <div>
              <strong>{row.name}</strong> <code>{row.id}</code>
              {row.installedVersion ? <span> v{row.installedVersion}</span> : null}
              {row.latestVersion && row.latestVersion !== row.installedVersion ? (
                <span> (latest v{row.latestVersion})</span>
              ) : null}
            </div>
            {row.description ? <p>{row.description}</p> : null}
            <p>
              {STATE_LABELS[row.state]}
              {row.purgePending ? " · data purge pending — takes effect on restart" : null}
            </p>
            {row.state === "install-failed" && row.lastInstallError ? (
              <p className="jds-muted">{row.lastInstallError}</p>
            ) : null}
            {row.state === "incompatible" ? (
              <p className="jds-muted">Requires Jarvis {row.requiresCore}.</p>
            ) : null}
            <div>
              {canInstall(row) ? (
                <button
                  type="button"
                  className="jds-btn jds-btn--primary"
                  onClick={() => onInstall(row)}
                  disabled={downloadMutation.isPending}
                >
                  {row.state === "update-available"
                    ? "Download update"
                    : row.state === "install-failed"
                      ? "Retry download"
                      : "Install"}
                </button>
              ) : null}
              {canRemove(row) ? (
                <>
                  <button
                    type="button"
                    className="jds-btn jds-btn--quiet"
                    onClick={() => onRemove(row)}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="jds-btn jds-btn--quiet"
                    onClick={() => onRemovePurge(row)}
                  >
                    Remove + purge
                  </button>
                </>
              ) : null}
              {row.purgePending ? (
                <button
                  type="button"
                  className="jds-btn jds-btn--quiet"
                  onClick={() => cancelPurgeMutation.mutate(row.id)}
                  disabled={cancelPurgeMutation.isPending}
                >
                  Cancel purge
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
