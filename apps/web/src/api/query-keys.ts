export const queryKeys = {
  auth: {
    bootstrap: ["auth", "bootstrap"] as const,
    me: ["auth", "me"] as const
  },
  modules: ["modules"] as const,
  settings: {
    providers: ["settings", "providers"] as const,
    workspaces: ["settings", "workspaces"] as const,
    adminConnectorAccounts: ["settings", "admin", "connector-accounts"] as const
  },
  connectors: {
    providers: ["connectors", "providers"] as const,
    accounts: ["connectors", "accounts"] as const
  },
  ai: {
    providers: ["ai", "providers"] as const,
    models: ["ai", "models"] as const,
    capability: (capability: string) => ["ai", "capability", capability] as const,
    assistantTools: ["ai", "assistant-tools"] as const
  },
  briefings: {
    definitions: ["briefings", "definitions"] as const,
    runs: (definitionId: string | null) => ["briefings", "runs", definitionId] as const
  },
  calendar: {
    list: ["calendar", "list"] as const,
    detail: (id: string) => ["calendar", "detail", id] as const
  },
  chat: {
    threads: ["chat", "threads"] as const,
    memorySettings: ["chat", "memory-settings"] as const,
    memoryFacts: ["chat", "memory-facts"] as const
  },
  email: {
    list: ["email", "list"] as const,
    detail: (id: string) => ["email", "detail", id] as const
  },
  notifications: {
    list: ["notifications", "list"] as const
  },
  tasks: {
    list: ["tasks", "list"] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
    activity: (id: string) => ["tasks", "activity", id] as const
  }
};
