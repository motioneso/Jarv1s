export const queryKeys = {
  auth: {
    bootstrap: ["auth", "bootstrap"] as const,
    me: (workspaceId: string | null) => ["auth", "me", workspaceId] as const
  },
  modules: (workspaceId: string | null) => ["modules", workspaceId] as const,
  settings: {
    providers: ["settings", "providers"] as const,
    workspaces: ["settings", "workspaces"] as const,
    adminConnectorAccounts: ["settings", "admin", "connector-accounts"] as const
  },
  connectors: {
    providers: (workspaceId: string | null) => ["connectors", "providers", workspaceId] as const,
    accounts: (workspaceId: string | null) => ["connectors", "accounts", workspaceId] as const
  },
  ai: {
    providers: (workspaceId: string | null) => ["ai", "providers", workspaceId] as const,
    models: (workspaceId: string | null) => ["ai", "models", workspaceId] as const,
    capability: (capability: string, workspaceId: string | null) =>
      ["ai", "capability", capability, workspaceId] as const,
    assistantTools: (workspaceId: string | null) => ["ai", "assistant-tools", workspaceId] as const
  },
  briefings: {
    definitions: (workspaceId: string | null) => ["briefings", "definitions", workspaceId] as const,
    runs: (definitionId: string | null, workspaceId: string | null) =>
      ["briefings", "runs", definitionId, workspaceId] as const
  },
  calendar: {
    list: (workspaceId: string | null) => ["calendar", "list", workspaceId] as const,
    detail: (id: string, workspaceId: string | null) =>
      ["calendar", "detail", id, workspaceId] as const
  },
  chat: {
    threads: (workspaceId: string | null) => ["chat", "threads", workspaceId] as const,
    messages: (threadId: string | null, workspaceId: string | null) =>
      ["chat", "messages", threadId, workspaceId] as const
  },
  email: {
    list: (workspaceId: string | null) => ["email", "list", workspaceId] as const,
    detail: (id: string, workspaceId: string | null) =>
      ["email", "detail", id, workspaceId] as const
  },
  notes: {
    list: (workspaceId: string | null) => ["notes", "list", workspaceId] as const,
    detail: (id: string, workspaceId: string | null) =>
      ["notes", "detail", id, workspaceId] as const
  },
  notifications: {
    list: (workspaceId: string | null) => ["notifications", "list", workspaceId] as const
  },
  tasks: {
    list: (workspaceId: string | null) => ["tasks", "list", workspaceId] as const,
    detail: (id: string, workspaceId: string | null) =>
      ["tasks", "detail", id, workspaceId] as const
  }
};
