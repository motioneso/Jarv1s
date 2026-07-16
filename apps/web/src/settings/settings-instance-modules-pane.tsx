// #996/#860: extracted from settings-admin-panes.tsx (Task 14 file-size gate — that
// file hit 1016 lines, over the 1000-line cap). Mirrors the existing
// settings-module-registry-section.tsx split: one pane, its own file.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import type { ExternalModuleDto, ModuleRegistryRowDto } from "@jarv1s/shared";

import {
  getModuleRegistry,
  listAdminModules,
  listExternalModules,
  setAdminModuleDisabled,
  setExternalModuleEnabled
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import { useFeedback } from "./settings-feedback";
import { ModuleCredentialsSection } from "./module-credentials-section";
import { ModuleRegistrySection } from "./settings-module-registry-section";
import { moduleDescription, readError } from "./settings-types";
import { Group, Note, PaneHead, Row, Switch } from "./settings-ui";

export function filterUndeclaredExternalModules(
  externalModules: readonly ExternalModuleDto[],
  registryIds: ReadonlySet<string>
): readonly ExternalModuleDto[] {
  return externalModules.filter((module) => !registryIds.has(module.id));
}

// #1084: `GET /api/admin/module-registry` rows are a UNION of registry-index entries,
// boot discoveries, rejected loads, admin states, on-disk ids, and JARVIS_MODULES_ENSURE
// ids (deriveModuleRegistryRows, packages/settings/src/module-registry-rows.ts:55-62) —
// most rows are NOT in the registry index. `latestVersion` is set only from the index
// entry's version and is null for every local-only row (module-registry-rows.ts:107-111),
// so it's the one field that correctly tests index membership. Using every row's id
// (the previous behavior) made the "known to the registry" set a superset of every
// discovered external module's id, so filterUndeclaredExternalModules always dropped
// them — the External-modules group (trust warning + #918 admin credentials section)
// was permanently empty for any module actually on disk.
export function registryIndexIds(rows: readonly ModuleRegistryRowDto[]): ReadonlySet<string> {
  return new Set(rows.filter((row) => row.latestVersion != null).map((row) => row.id));
}

export function InstanceModulesPane() {
  const queryClient = useQueryClient();
  const { toast } = useFeedback();
  const modulesQuery = useQuery({
    queryKey: queryKeys.settings.adminModules,
    queryFn: listAdminModules,
    retry: false
  });
  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; disabled: boolean }) =>
      setAdminModuleDisabled(input.id, input.disabled),
    // Also refresh myModules/modules so the side-nav (driven by `active`) updates
    // live for the admin — disabling instance-wide drops the nav entry immediately.
    onSuccess: () =>
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminModules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.myModules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.modules })
      ]),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  // #917: external (user-authored) modules discovered on the box.
  const externalModulesQuery = useQuery({
    queryKey: queryKeys.settings.adminExternalModules,
    queryFn: listExternalModules,
    retry: false
  });
  // #996/#860: subscribe to the SAME registry query ModuleRegistrySection uses
  // (identical queryKey+queryFn -> React Query serves one cached fetch to both) so this
  // pane can filter registry-known modules out of the "External modules" group below.
  const registryQuery = useQuery({
    queryKey: queryKeys.settings.adminModuleRegistry,
    queryFn: () => getModuleRegistry(false),
    retry: false
  });
  const registryIds = registryIndexIds(registryQuery.data?.modules ?? []);
  const setExternalEnabled = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      setExternalModuleEnabled(input.id, input.enabled),
    // Enabling an external module changes what /api/modules reconciles as active, so
    // refresh both the admin list AND the shell module list (#917 corrections).
    onSuccess: () =>
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminExternalModules }),
        queryClient.invalidateQueries({ queryKey: queryKeys.modules })
      ]),
    onError: (error) => toast(readError(error), { tone: "drift" })
  });
  const external = externalModulesQuery.data;
  // Only optional modules are shown — required ones are always on and can't be
  // toggled, so there's nothing for the admin to do with them.
  const modules = (modulesQuery.data?.modules ?? []).filter((module) => !module.required);

  return (
    <>
      <PaneHead
        title="Instance modules"
        desc="Turn optional modules on or off for everyone. Core modules are always on and aren't listed."
      />
      <Group title="Optional modules">
        {modules.length ? (
          modules.map((module) => (
            <Row
              key={module.id}
              name={module.name}
              desc={moduleDescription(module.id)}
              control={
                <Switch
                  ariaLabel={module.name}
                  checked={!module.instanceDisabled}
                  onChange={(value) => toggleMutation.mutate({ id: module.id, disabled: !value })}
                />
              }
            />
          ))
        ) : (
          <Row
            name={modulesQuery.isLoading ? "Loading modules…" : "No optional modules"}
            desc={modulesQuery.isLoading ? undefined : "Every module on this instance is core."}
          />
        )}
      </Group>
      <Note>
        Disabling a module hides it for everyone and stops it collecting new data. Existing data is
        kept.
      </Note>
      {/* #917/#996: external modules are always-on now (no JARVIS_ENABLE_EXTERNAL_MODULES
          gate); `external` is only undefined while the query is loading. */}
      {external?.enabled ? (
        <Group
          title="External modules"
          desc="User-authored modules discovered in this instance's modules directory. Off by default."
        >
          {/* #917: trusted-operator warning — enabling runs third-party code on the box with
              the same access as built-in features. Uses the authored <Note> primitive (no `tone`
              prop exists) with a warning icon. */}
          <Note icon={<AlertTriangle size={13} aria-hidden="true" />}>
            External modules are not reviewed by Jarvis. Only enable modules you authored or fully
            trust — an enabled module runs with the same access as built-in features.
          </Note>
          {/* #996/#860: a module downloaded via the registry is also a discovered external
              module — filter those out here so it doesn't render twice (once below, once in
              "Available modules"). */}
          {filterUndeclaredExternalModules(external.modules, registryIds).length ? (
            filterUndeclaredExternalModules(external.modules, registryIds).map((module) => {
              // #917: surface WHY a module is inactive. Drift auto-disable (package changed
              // after it was enabled) wins; otherwise any server-provided disabledReason.
              const reason = module.drifted
                ? "disabled: package changed since it was enabled"
                : (module.disabledReason ?? null);
              return (
                <div key={module.id}>
                  <Row
                    name={module.name}
                    desc={`${module.publisher} · v${module.version}${reason ? ` · ${reason}` : ""}`}
                    control={
                      <Switch
                        ariaLabel={`Enable ${module.name}`}
                        checked={module.status === "enabled"}
                        disabled={setExternalEnabled.isPending}
                        onChange={(value) =>
                          setExternalEnabled.mutate({ id: module.id, enabled: value })
                        }
                      />
                    }
                  />
                  {/* #918: instance-scope credential slots declared by this module's
                      manifest, if any — renders nothing when the module has none. */}
                  <ModuleCredentialsSection moduleId={module.id} surface="admin" />
                </div>
              );
            })
          ) : (
            // The section is gated on `enabled` (data already loaded), so this is the
            // genuinely-empty case, not a loading placeholder.
            <Row
              name="No external modules"
              desc="No external modules are present in the modules directory."
            />
          )}
        </Group>
      ) : null}
      <ModuleRegistrySection
        externalModules={external?.modules}
        onSetEnabled={(id, enabled) => setExternalEnabled.mutate({ id, enabled })}
        settingEnabledPending={setExternalEnabled.isPending}
      />
    </>
  );
}
