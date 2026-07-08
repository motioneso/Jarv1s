export const queryKeys = {
  auth: {
    bootstrap: ["auth", "bootstrap"] as const,
    me: ["auth", "me"] as const
  },
  onboarding: {
    status: ["onboarding", "status"] as const
  },
  modules: ["modules"] as const,
  myModules: ["me", "modules"] as const,
  settings: {
    providers: ["settings", "providers"] as const,
    adminConnectorAccounts: ["settings", "admin", "connector-accounts"] as const,
    adminAuditEvents: ["settings", "admin", "audit-events"] as const,
    adminUsers: ["settings", "admin", "users"] as const,
    adminModules: ["settings", "admin", "modules"] as const,
    locale: ["settings", "locale"] as const,
    sessions: ["settings", "sessions"] as const,
    persona: ["settings", "persona"] as const,
    themes: ["settings", "themes"] as const,
    sourceBehaviors: ["settings", "source-behaviors"] as const,
    registrationSettings: ["settings", "admin", "registration"] as const,
    chatMultiplexer: ["settings", "chat-multiplexer"] as const,
    yolo: ["settings", "yolo"] as const,
    adminYolo: ["settings", "admin", "yolo"] as const,
    hostDiagnostics: ["settings", "host-diagnostics"] as const,
    notesSource: ["settings", "notes-source"] as const,
    quietHours: ["settings", "quiet-hours"] as const,
    notificationPreferences: ["settings", "notification-preferences"] as const,
    notificationDigest: ["settings", "notification-digest"] as const,
    notesSourceDirectories: (path: string | null) =>
      ["settings", "notes-source", "directories", path] as const,
    notesLastSync: ["settings", "notes-last-sync"] as const
  },
  connectors: {
    providers: ["connectors", "providers"] as const,
    accounts: ["connectors", "accounts"] as const,
    featureGrants: (id: string) => ["connectors", "feature-grants", id] as const
  },
  ai: {
    summary: ["ai", "summary"] as const,
    providers: ["ai", "providers"] as const,
    models: ["ai", "models"] as const,
    chatModelOverride: ["ai", "chat-model-override"] as const,
    adminUserAiPin: (userId: string) => ["ai", "admin", "users", userId, "pin"] as const,
    capabilityRoutes: ["ai", "capability-routes"] as const,
    capabilities: ["ai", "capability"] as const,
    capability: (capability: string) => ["ai", "capability", capability] as const,
    tierPreferences: ["ai", "tier-preferences"] as const,
    assistantTools: ["ai", "assistant-tools"] as const,
    webSearchKey: ["ai", "web-search-key"] as const,
    runtimeConfig: (key: string) => ["ai", "runtime-config", key] as const,
    actionAuditLog: (params?: { since?: string; family?: string; limit?: number }) =>
      ["ai", "action-audit-log", params] as const
  },
  briefings: {
    definitions: ["briefings", "definitions"] as const,
    runs: (definitionId: string | null) => ["briefings", "runs", definitionId] as const
  },
  usefulnessFeedback: {
    list: ["usefulness-feedback"] as const
  },
  calendar: {
    list: ["calendar", "list"] as const,
    detail: (id: string) => ["calendar", "detail", id] as const
  },
  chat: {
    settings: ["chat", "settings"] as const,
    threads: ["chat", "threads"] as const,
    messages: (threadId: string) => ["chat", "threads", threadId, "messages"] as const,
    memorySettings: ["chat", "memory-settings"] as const,
    memoryFacts: ["chat", "memory-facts"] as const,
    memoryCorrections: ["chat", "memory-corrections"] as const
  },
  email: {
    list: ["email", "list"] as const,
    detail: (id: string) => ["email", "detail", id] as const,
    taskMode: ["email", "task-mode"] as const
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
  proactiveMonitoring: {
    cards: ["proactive-monitoring", "cards"] as const,
    settings: ["proactive-monitoring", "settings"] as const
  },
  weather: {
    today: ["weather", "today"] as const,
    location: ["weather", "location"] as const
  },
  wellness: {
    checkins: ["wellness", "checkins"] as const,
    medications: ["wellness", "medications"] as const,
    schedule: (date: string) => ["wellness", "schedule", date] as const,
    insights: ["wellness", "insights"] as const,
    therapyNotes: ["wellness", "therapy-notes"] as const,
    adherenceSummary: (sinceDays: number) => ["wellness", "adherence-summary", sinceDays] as const
  },
  memory: {
    dashboard: (query?: object) => ["memory", "dashboard", query] as const,
    dashboardItem: (id: string) => ["memory", "dashboard", "item", id] as const
  },
  goals: {
    list: ["goals", "list"] as const
  },
  people: {
    list: ["people", "list"] as const,
    notesSettings: ["people", "notes-settings"] as const,
    matchCandidates: ["people", "match-candidates"] as const
  }
};
