import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UsersRound } from "lucide-react";

import { listAdminWorkspaces, listAuthProviderStatuses } from "../api/client";
import { queryKeys } from "../api/query-keys";
import { AiSettingsPanel } from "../ai/ai-settings-panel";
import { ConnectGooglePanel } from "../connectors/connect-google-panel";
import { ConnectorsPanel } from "../connectors/connectors-panel";
import type { MeResponse } from "@jarv1s/shared";

interface SettingsPageProps {
  readonly me: MeResponse;
}

export function SettingsPage(props: SettingsPageProps) {
  const providersQuery = useQuery({
    enabled: props.me.user.isInstanceAdmin,
    queryKey: queryKeys.settings.providers,
    queryFn: listAuthProviderStatuses,
    retry: false
  });
  const workspacesQuery = useQuery({
    enabled: props.me.user.isInstanceAdmin,
    queryKey: queryKeys.settings.workspaces,
    queryFn: listAdminWorkspaces,
    retry: false
  });

  return (
    <section className="page-stack" aria-labelledby="settings-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 id="settings-title">Account</h1>
        </div>
      </div>

      <div className="settings-grid">
        <section className="panel" aria-labelledby="profile-title">
          <div className="panel-heading">
            <UsersRound size={20} aria-hidden="true" />
            <h2 id="profile-title">Profile</h2>
          </div>
          <dl className="definition-list">
            <div>
              <dt>Email</dt>
              <dd>{props.me.user.email}</dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>{props.me.user.name || "Unnamed"}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{props.me.user.isInstanceAdmin ? "Instance admin" : "User"}</dd>
            </div>
          </dl>
        </section>

        <section className="panel" aria-labelledby="memberships-title">
          <div className="panel-heading">
            <ShieldCheck size={20} aria-hidden="true" />
            <h2 id="memberships-title">Memberships</h2>
          </div>
          <div className="compact-list">
            {props.me.memberships.map((membership) => {
              const workspace = props.me.workspaces.find(
                (item) => item.id === membership.workspaceId
              );

              return (
                <div className="compact-row" key={membership.workspaceId}>
                  <span>{workspace?.name ?? membership.workspaceId}</span>
                  <strong>{membership.role}</strong>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="settings-grid">
        <ConnectorsPanel isAdmin={props.me.user.isInstanceAdmin} />
        <ConnectGooglePanel />
      </div>

      <div className="settings-grid">
        <AiSettingsPanel />
      </div>

      {props.me.user.isInstanceAdmin ? (
        <div className="settings-grid">
          <section className="panel" aria-labelledby="providers-title">
            <div className="panel-heading">
              <ShieldCheck size={20} aria-hidden="true" />
              <h2 id="providers-title">Auth Providers</h2>
            </div>
            <div className="compact-list">
              {(providersQuery.data?.providers ?? []).map((provider) => (
                <div className="compact-row" key={provider.id}>
                  <span>{provider.displayName}</span>
                  <strong className={provider.enabled ? "status-good" : "status-muted"}>
                    {provider.enabled ? "Enabled" : "Off"}
                  </strong>
                </div>
              ))}
              {providersQuery.isLoading ? <p className="muted-text">Loading providers</p> : null}
              {providersQuery.error ? (
                <p className="form-error">{providersQuery.error.message}</p>
              ) : null}
            </div>
          </section>

          <section className="panel" aria-labelledby="admin-workspaces-title">
            <div className="panel-heading">
              <UsersRound size={20} aria-hidden="true" />
              <h2 id="admin-workspaces-title">Workspaces</h2>
            </div>
            <div className="compact-list">
              {(workspacesQuery.data?.workspaces ?? []).map((workspace) => (
                <div className="compact-row" key={workspace.id}>
                  <span>{workspace.name}</span>
                  <strong>{workspace.createdAt.slice(0, 10)}</strong>
                </div>
              ))}
              {workspacesQuery.isLoading ? <p className="muted-text">Loading workspaces</p> : null}
              {workspacesQuery.error ? (
                <p className="form-error">{workspacesQuery.error.message}</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
