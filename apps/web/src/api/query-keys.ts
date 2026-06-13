export const queryKeys = {
  auth: {
    bootstrap: ["auth", "bootstrap"] as const,
    me: ["auth", "me"] as const
  },
  onboarding: {
    status: ["onboarding", "status"] as const
  },
  modules: ["modules"] as const,
  settings: {
    providers: ["settings", "providers"] as const,
    adminConnectorAccounts: ["settings", "admin", "connector-accounts"] as const,
    adminUsers: ["settings", "admin", "users"] as const,
    registrationSettings: ["settings", "admin", "registration"] as const,
    chatMultiplexer: ["settings", "chat-multiplexer"] as const
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
    activity: (id: string) => ["tasks", "activity", id] as const,
    subtasks: (id: string) => ["tasks", "subtasks", id] as const,
    lists: ["tasks", "lists"] as const,
    tags: (listId: string) => ["tasks", "tags", listId] as const,
    preferences: ["tasks", "preferences"] as const
  },
  wellness: {
    checkins: ["wellness", "checkins"] as const,
    medications: ["wellness", "medications"] as const,
    schedule: (date: string) => ["wellness", "schedule", date] as const
  }
};
