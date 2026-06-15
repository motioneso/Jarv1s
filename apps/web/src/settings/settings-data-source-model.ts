export type SourceBehaviorTone = "neutral" | "pine" | "steel";
export type DataSourceBehaviorStatus = "default-on" | "default-off" | "coming-soon";

export interface DataSourceBehavior {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly status: DataSourceBehaviorStatus;
}

export interface DataSource {
  readonly id: string;
  readonly name: string;
  readonly powered: string;
  readonly behaviors: readonly DataSourceBehavior[];
}

export function sourceBehaviorStatus(behavior: DataSourceBehavior): {
  readonly tone: SourceBehaviorTone;
  readonly label: string;
} {
  if (behavior.status === "default-on") return { tone: "pine", label: "Default on" };
  if (behavior.status === "default-off") return { tone: "neutral", label: "Default off" };
  return { tone: "steel", label: "Coming soon" };
}
