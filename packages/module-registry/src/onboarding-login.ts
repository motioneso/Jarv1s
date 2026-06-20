/**
 * §L.5 onboarding-login seam wiring (#342 Phase 3, login-contract §L.2/§L.4/§L.5).
 *
 * The composition root assembles the login seam that `packages/settings/src/onboarding-routes.ts`
 * declares as injected PORTS (module isolation — settings never imports @jarv1s/chat or
 * @jarv1s/cli-runner). Mirrors `buildOnboardingInstall` (§A.5):
 *
 *   - loginability ← the cli-runner LOGIN-ADAPTER registry (the auth-flow allowlist, §L.1). A
 *                    provider with no adapter (agy, or codex if its headless smoke failed) is
 *                    `loginable:false` — the route rejects it 400 BEFORE persisting `needs_login`.
 *   - loginClient  ← the ONE shared `RpcConnection` login verbs over the cli-runner socket (§L.2).
 *                    A failed login FLOW is a normal `{ status:"error" }` outcome, not a throw.
 *   - stateStore   ← the settings `SettingsRepository` provider-install-state methods under the
 *                    admin-scoped DataContextDb the route resolves (0103 admin write RLS). The api
 *                    is the SOLE writer; the cli-runner never reaches the DB (§L.4).
 *
 * The whole seam is gated on the boot-time socket fork (there is no in-process login path — the
 * CLIs live in the cli-runner container); absent ⇒ the login routes fail closed (500).
 */

import type { RpcConnection } from "@jarv1s/chat";
import { LOGIN_ADAPTERS } from "@jarv1s/cli-runner";
import type {
  OnboardingLoginDependencies,
  ProviderLoginabilityPort,
  ProviderLoginClient,
  ProviderLoginOutcome,
  ProviderLoginStateStore,
  SettingsRepository
} from "@jarv1s/settings";
import type { OnboardingProviderKind } from "@jarv1s/shared";

/** Map an RPC login result onto the route's outcome shape (omit absent optionals). */
function mapOutcome(r: {
  readonly loginId: string;
  readonly status: ProviderLoginOutcome["status"];
  readonly authorizationUrl?: string;
  readonly userCode?: string;
  readonly message?: string;
}): ProviderLoginOutcome {
  return {
    loginId: r.loginId,
    status: r.status,
    ...(r.authorizationUrl !== undefined ? { authorizationUrl: r.authorizationUrl } : {}),
    ...(r.userCode !== undefined ? { userCode: r.userCode } : {}),
    ...(r.message !== undefined ? { message: r.message } : {})
  };
}

/**
 * Build the §L.5 login seam from the cli-runner socket connection + the settings repository.
 * `enabled` gates the WHOLE seam on the socket fork; the `RpcConnection` is resolved LAZILY at
 * call time (the chat runtime publishes it after routes register).
 */
export function buildOnboardingLogin(deps: {
  readonly enabled: boolean;
  readonly getConnection: () => RpcConnection | undefined;
  readonly repository: SettingsRepository;
}): OnboardingLoginDependencies | undefined {
  if (!deps.enabled) return undefined;
  const repository = deps.repository;

  const loginability: ProviderLoginabilityPort = (provider) => {
    // The LOGIN-ADAPTER registry IS the login allowlist (§L.1). A provider absent (no adapter) is
    // not login-supported — agy always; codex if its headless smoke removed its adapter (§L.9.2).
    if (LOGIN_ADAPTERS[provider]) return { loginable: true };
    return {
      loginable: false,
      blockedReason: "no login adapter — provider is not login-supported on this build"
    };
  };

  const requireConn = (): RpcConnection => {
    const conn = deps.getConnection();
    if (!conn) throw new Error("cli-runner connection unavailable for login");
    return conn;
  };

  const loginClient: ProviderLoginClient = {
    begin: async (provider) => mapOutcome(await requireConn().beginLogin({ provider })),
    poll: async (provider, loginId) =>
      mapOutcome(await requireConn().pollLogin({ provider, loginId })),
    submitToken: async (provider, loginId, token) =>
      mapOutcome(await requireConn().submitLoginToken({ provider, loginId, token })),
    cancel: async (provider, loginId) => {
      await requireConn().cancelLogin({ provider, loginId });
    }
  };

  const stateStore: ProviderLoginStateStore = {
    // `* → needs_login` collapse before the begin RPC (§L.4.1).
    persistNeedsLogin: async (scopedDb, { provider }) => {
      await repository.upsertProviderInstallState(scopedDb, { provider, state: "needs_login" });
    },
    // `needs_login → ready|error` on a SETTLED status; an `awaiting_*` status persists nothing and
    // returns the current lifecycle (begin already set `needs_login`).
    persistLoginTerminal: async (scopedDb, { provider, status, message }) => {
      if (status === "ready") {
        return repository.upsertProviderInstallState(scopedDb, { provider, state: "ready" });
      }
      if (status === "error") {
        return repository.upsertProviderInstallState(scopedDb, {
          provider,
          state: "error",
          ...(message !== undefined ? { message } : {})
        });
      }
      const row = await repository.readProviderInstallState(scopedDb, provider);
      return row?.state ?? "needs_login";
    },
    readState: async (scopedDb, provider: OnboardingProviderKind) => {
      const row = await repository.readProviderInstallState(scopedDb, provider);
      return row?.state ?? "not_installed";
    }
  };

  return { loginability, loginClient, stateStore };
}
