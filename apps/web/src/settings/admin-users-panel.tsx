import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, TerminalSquare, Users } from "lucide-react";

import {
  approveUser,
  deactivateUser,
  deleteAdminUser,
  demoteUser,
  getChatMultiplexerSettings,
  getRegistrationSettings,
  listAdminUsers,
  promoteUser,
  putRegistrationSettings,
  reactivateUser,
  rejectUser,
  setChatMultiplexerSettings
} from "../api/client";
import { queryKeys } from "../api/query-keys";
import type { ChatMultiplexerChoice, RegistrationSettingsDto, UserDto } from "@jarv1s/shared";

interface AdminUsersPanelProps {
  readonly currentUserId: string;
}

export function AdminUsersPanel(props: AdminUsersPanelProps) {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: queryKeys.settings.adminUsers,
    queryFn: listAdminUsers,
    retry: false
  });
  const regQuery = useQuery({
    queryKey: queryKeys.settings.registrationSettings,
    queryFn: getRegistrationSettings,
    retry: false
  });
  const muxQuery = useQuery({
    queryKey: queryKeys.settings.chatMultiplexer,
    queryFn: getChatMultiplexerSettings,
    retry: false
  });

  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.settings.adminUsers });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveUser(id),
    onSuccess: invalidateUsers
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectUser(id),
    onSuccess: invalidateUsers
  });
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: invalidateUsers
  });
  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: invalidateUsers
  });
  const promoteMutation = useMutation({
    mutationFn: (id: string) => promoteUser(id),
    onSuccess: invalidateUsers
  });
  const demoteMutation = useMutation({
    mutationFn: (id: string) => demoteUser(id),
    onSuccess: invalidateUsers
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAdminUser(id),
    onSuccess: invalidateUsers
  });
  const regMutation = useMutation({
    mutationFn: (settings: RegistrationSettingsDto) => putRegistrationSettings(settings),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.registrationSettings, data);
    }
  });
  const muxMutation = useMutation({
    mutationFn: (choice: ChatMultiplexerChoice) => setChatMultiplexerSettings(choice),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.chatMultiplexer, data);
    }
  });

  const users = usersQuery.data?.users ?? [];
  const pending = users.filter((u) => u.status === "pending");
  const allUsers = users.filter((u) => u.status !== "pending");
  const anyBusy =
    approveMutation.isPending ||
    rejectMutation.isPending ||
    deactivateMutation.isPending ||
    reactivateMutation.isPending ||
    promoteMutation.isPending ||
    demoteMutation.isPending ||
    deleteMutation.isPending;

  const regSettings = regQuery.data;

  return (
    <>
      {pending.length > 0 ? (
        <section className="panel" aria-labelledby="pending-approvals-title">
          <div className="panel-heading">
            <Users size={20} aria-hidden="true" />
            <h2 id="pending-approvals-title">Pending Approvals</h2>
          </div>
          <div className="compact-list">
            {pending.map((user) => (
              <div className="compact-row" key={user.id}>
                <span>
                  {user.name} <span className="muted-text">({user.email})</span>
                </span>
                <span className="row-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={anyBusy}
                    onClick={() => approveMutation.mutate(user.id)}
                  >
                    Approve
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={anyBusy}
                    onClick={() => rejectMutation.mutate(user.id)}
                  >
                    Reject
                  </button>
                </span>
              </div>
            ))}
          </div>
          {approveMutation.error ? (
            <p className="form-error">{approveMutation.error.message}</p>
          ) : null}
          {rejectMutation.error ? (
            <p className="form-error">{rejectMutation.error.message}</p>
          ) : null}
        </section>
      ) : null}

      <section className="panel" aria-labelledby="admin-users-title">
        <div className="panel-heading">
          <Users size={20} aria-hidden="true" />
          <h2 id="admin-users-title">Users</h2>
        </div>
        <div className="compact-list">
          {allUsers.map((user) => (
            <UserRow
              key={user.id}
              user={user}
              currentUserId={props.currentUserId}
              allUsers={allUsers}
              busy={anyBusy}
              onDeactivate={() => deactivateMutation.mutate(user.id)}
              onReactivate={() => reactivateMutation.mutate(user.id)}
              onPromote={() => promoteMutation.mutate(user.id)}
              onDemote={() => demoteMutation.mutate(user.id)}
              onDelete={() => deleteMutation.mutate(user.id)}
            />
          ))}
          {usersQuery.isLoading ? <p className="muted-text">Loading users…</p> : null}
          {usersQuery.error ? <p className="form-error">{usersQuery.error.message}</p> : null}
        </div>
        {deactivateMutation.error ? (
          <p className="form-error">{deactivateMutation.error.message}</p>
        ) : null}
        {deleteMutation.error ? <p className="form-error">{deleteMutation.error.message}</p> : null}
      </section>

      <section className="panel" aria-labelledby="registration-title">
        <div className="panel-heading">
          <ShieldCheck size={20} aria-hidden="true" />
          <h2 id="registration-title">Registration</h2>
        </div>
        {regSettings ? (
          <dl className="definition-list">
            <div>
              <dt>Allow new registrations</dt>
              <dd>
                <ToggleSwitch
                  checked={regSettings.registrationEnabled}
                  disabled={regMutation.isPending}
                  onChange={(checked) =>
                    regMutation.mutate({
                      registrationEnabled: checked,
                      requiresApproval: regSettings.requiresApproval
                    })
                  }
                />
              </dd>
            </div>
            <div>
              <dt>Require admin approval</dt>
              <dd>
                <ToggleSwitch
                  checked={regSettings.requiresApproval}
                  disabled={regMutation.isPending}
                  onChange={(checked) =>
                    regMutation.mutate({
                      registrationEnabled: regSettings.registrationEnabled,
                      requiresApproval: checked
                    })
                  }
                />
              </dd>
            </div>
          </dl>
        ) : regQuery.isLoading ? (
          <p className="muted-text">Loading…</p>
        ) : null}
        {regMutation.error ? <p className="form-error">{regMutation.error.message}</p> : null}
      </section>

      {muxQuery.data ? (
        <section className="panel" aria-labelledby="multiplexer-title">
          <div className="panel-heading">
            <TerminalSquare size={20} aria-hidden="true" />
            <h2 id="multiplexer-title">Live chat multiplexer</h2>
          </div>
          <p className="muted-text">
            Which terminal multiplexer hosts live CLI chat sessions. Changes apply on server
            restart.
          </p>
          <dl className="definition-list">
            <div>
              <dt>Backend</dt>
              <dd>
                <select
                  value={muxQuery.data.multiplexer}
                  disabled={muxMutation.isPending}
                  onChange={(e) => muxMutation.mutate(e.target.value as ChatMultiplexerChoice)}
                >
                  <option value="auto">Auto-detect</option>
                  <option value="tmux">tmux</option>
                  <option value="herdr">herdr</option>
                </select>
              </dd>
            </div>
            <div>
              <dt>Detected on this host</dt>
              <dd>
                <span>{`tmux: ${muxQuery.data.available.tmux ? "installed" : "not detected"}`}</span>
                {" · "}
                <span>{`herdr: ${
                  muxQuery.data.available.herdr ? "installed" : "not detected"
                }`}</span>
              </dd>
            </div>
          </dl>
          <p className="muted-text">
            Auto picks herdr when the server runs inside herdr, otherwise tmux. If the selected
            backend isn’t installed, live chat is disabled until you install it and restart.
          </p>
          {muxMutation.error ? <p className="form-error">{muxMutation.error.message}</p> : null}
        </section>
      ) : null}
    </>
  );
}

interface UserRowProps {
  readonly user: UserDto;
  readonly currentUserId: string;
  readonly allUsers: readonly UserDto[];
  readonly busy: boolean;
  readonly onDeactivate: () => void;
  readonly onReactivate: () => void;
  readonly onPromote: () => void;
  readonly onDemote: () => void;
  readonly onDelete: () => void;
}

function UserRow(props: UserRowProps) {
  const { user, currentUserId, allUsers, busy } = props;
  const isSelf = user.id === currentUserId;

  const activeAdminCount = allUsers.filter(
    (u) => u.isInstanceAdmin && u.status === "active"
  ).length;
  const canDemote = user.isInstanceAdmin && !user.isBootstrapOwner && activeAdminCount > 1;
  const canDeactivate =
    !isSelf &&
    !user.isBootstrapOwner &&
    user.status === "active" &&
    (!user.isInstanceAdmin || activeAdminCount > 1);

  return (
    <div className="compact-row">
      <span>
        {user.name} <span className="muted-text">({user.email})</span>
        {user.isBootstrapOwner ? <span className="muted-text"> · owner</span> : null}
        {user.isInstanceAdmin ? <span className="muted-text"> · admin</span> : null}
      </span>
      <span className="row-actions">
        <strong
          className={
            user.status === "active"
              ? "status-good"
              : user.status === "deactivated"
                ? "status-muted"
                : "status-muted"
          }
        >
          {user.status}
        </strong>
        {user.status === "active" && canDeactivate ? (
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={props.onDeactivate}
          >
            Deactivate
          </button>
        ) : null}
        {user.status === "deactivated" ? (
          <button
            className="ghost-button"
            type="button"
            disabled={busy}
            onClick={props.onReactivate}
          >
            Reactivate
          </button>
        ) : null}
        {!user.isInstanceAdmin ? (
          <button className="ghost-button" type="button" disabled={busy} onClick={props.onPromote}>
            Promote
          </button>
        ) : canDemote ? (
          <button className="ghost-button" type="button" disabled={busy} onClick={props.onDemote}>
            Demote
          </button>
        ) : null}
        {!isSelf ? (
          <button className="ghost-button" type="button" disabled={busy} onClick={props.onDelete}>
            Delete
          </button>
        ) : null}
      </span>
    </div>
  );
}

interface ToggleSwitchProps {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

function ToggleSwitch(props: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      className={props.checked ? "primary-button" : "ghost-button"}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      {props.checked ? "On" : "Off"}
    </button>
  );
}
