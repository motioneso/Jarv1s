import type { Page, Route } from "@playwright/test";
import type {
  ConnectorAccountDto,
  ConnectorProviderDto,
  ConnectorProviderType,
  CreateConnectorAccountRequest,
  UpdateConnectorAccountRequest
} from "@jarv1s/shared";

export interface MockConnectorsApiState {
  connectorAccounts: ConnectorAccountDto[];
  connectorProviders: ConnectorProviderDto[];
}

export async function registerMockConnectorRoutes(
  page: Page,
  state: MockConnectorsApiState
): Promise<void> {
  await page.route("**/api/admin/connectors/accounts", (route) =>
    fulfillJson(route, 200, { accounts: state.connectorAccounts })
  );
  await page.route("**/api/connectors/providers", (route) =>
    fulfillJson(route, 200, { providers: state.connectorProviders })
  );
  await page.route(/\/api\/connectors\/accounts\/[^/]+\/revoke$/, (route) =>
    handleConnectorRevokeRoute(route, state)
  );
  await page.route(/\/api\/connectors\/accounts\/[^/]+$/, (route) =>
    handleConnectorDetailRoute(route, state)
  );
  await page.route("**/api/connectors/accounts", (route) =>
    handleConnectorAccountsRoute(route, state)
  );
  await page.route("**/api/connectors/google/authorize", (route) =>
    handleGoogleAuthorizeRoute(route, state)
  );
  await page.route("**/api/connectors/google/complete", (route) =>
    handleGoogleCompleteRoute(route, state)
  );
  await page.route("**/api/connectors/imap/test-connection", (route) =>
    fulfillJson(route, 200, { result: "ok" })
  );
  await page.route("**/api/connectors/imap/connect", (route) =>
    handleImapConnectRoute(route, state)
  );
}

async function handleConnectorAccountsRoute(
  route: Route,
  state: MockConnectorsApiState
): Promise<void> {
  const request = route.request();

  if (request.method() === "GET") {
    return fulfillJson(route, 200, { accounts: state.connectorAccounts });
  }

  if (request.method() === "POST") {
    const input = request.postDataJSON() as CreateConnectorAccountRequest;
    const provider = state.connectorProviders.find((item) => item.id === input.providerId);
    const account = createMockConnectorAccount(`connector-${state.connectorAccounts.length + 1}`, {
      providerId: input.providerId,
      providerType: provider?.providerType ?? "calendar",
      providerDisplayName: provider?.displayName ?? input.providerId,
      providerStatus: provider?.status ?? "available",
      scopes: input.scopes ?? [],
      status: input.status ?? "active"
    });

    state.connectorAccounts = [...state.connectorAccounts, account];
    return fulfillJson(route, 201, { account });
  }

  return fulfillJson(route, 405, { error: "Method not allowed" });
}

async function handleConnectorDetailRoute(
  route: Route,
  state: MockConnectorsApiState
): Promise<void> {
  const request = route.request();
  const accountId = decodeURIComponent(new URL(request.url()).pathname.split("/").pop() ?? "");
  const account = state.connectorAccounts.find((item) => item.id === accountId);

  if (!account) {
    return fulfillJson(route, 404, { error: "Connector account not found" });
  }

  if (request.method() !== "PATCH") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const input = request.postDataJSON() as UpdateConnectorAccountRequest;
  const updatedAccount = {
    ...account,
    scopes: input.scopes ?? account.scopes,
    status: input.status ?? account.status,
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.connectorAccounts = state.connectorAccounts.map((item) =>
    item.id === accountId ? updatedAccount : item
  );
  return fulfillJson(route, 200, { account: updatedAccount });
}

async function handleConnectorRevokeRoute(
  route: Route,
  state: MockConnectorsApiState
): Promise<void> {
  const request = route.request();
  const segments = new URL(request.url()).pathname.split("/");
  const accountId = decodeURIComponent(segments.at(-2) ?? "");
  const account = state.connectorAccounts.find((item) => item.id === accountId);

  if (!account) {
    return fulfillJson(route, 404, { error: "Connector account not found" });
  }

  if (request.method() !== "POST") {
    return fulfillJson(route, 405, { error: "Method not allowed" });
  }

  const revokedAccount = {
    ...account,
    status: "revoked" as const,
    revokedAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z"
  };

  state.connectorAccounts = state.connectorAccounts.map((item) =>
    item.id === accountId ? revokedAccount : item
  );
  return fulfillJson(route, 200, { account: revokedAccount });
}

async function handleGoogleAuthorizeRoute(
  route: Route,
  _state: MockConnectorsApiState
): Promise<void> {
  return fulfillJson(route, 200, {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=test-state&client_id=mock"
  });
}

async function handleGoogleCompleteRoute(
  route: Route,
  state: MockConnectorsApiState
): Promise<void> {
  const googleAccount = createMockConnectorAccount("google-account-1", {
    providerId: "google",
    providerType: "google" as ConnectorProviderType,
    providerDisplayName: "Google",
    status: "active"
  });
  state.connectorAccounts = [...state.connectorAccounts, googleAccount];
  return fulfillJson(route, 201, { account: googleAccount });
}

async function handleImapConnectRoute(
  route: Route,
  state: MockConnectorsApiState
): Promise<void> {
  const imapAccount = createMockConnectorAccount("imap-account-1", {
    providerId: "imap-fastmail",
    providerType: "imap" as ConnectorProviderType,
    providerDisplayName: "Fastmail",
    status: "active"
  });
  state.connectorAccounts = [...state.connectorAccounts, imapAccount];
  return fulfillJson(route, 201, { account: imapAccount });
}

export function createMockConnectorProviders(): ConnectorProviderDto[] {
  return [
    {
      id: "google-calendar",
      providerType: "calendar",
      displayName: "Google Calendar",
      status: "available",
      defaultScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z"
    },
    {
      id: "google-email",
      providerType: "email",
      displayName: "Google Email",
      status: "available",
      defaultScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      createdAt: "2026-06-06T12:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z"
    }
  ];
}

export function createMockConnectorAccount(
  id: string,
  overrides: Partial<ConnectorAccountDto> = {}
): ConnectorAccountDto {
  return {
    id,
    providerId: "google-calendar",
    providerType: "calendar",
    providerDisplayName: "Google Calendar",
    providerStatus: "available",
    ownerUserId: "user-1",
    scopes: [],
    status: "active",
    hasSecret: true,
    revokedAt: null,
    createdAt: "2026-06-06T12:00:00.000Z",
    updatedAt: "2026-06-06T12:00:00.000Z",
    lastSyncStartedAt: null,
    lastSyncFinishedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncCounts: null,
    ...overrides
  };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
