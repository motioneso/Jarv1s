export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

export * from "./ai-api.js";
export * from "./briefings-api.js";
export * from "./calendar-api.js";
export * from "./chat-api.js";
export * from "./connectors-api.js";
export * from "./email-api.js";
export * from "./notes-api.js";
export * from "./notifications-api.js";
export * from "./tasks-api.js";
export * from "./platform-api.js";
