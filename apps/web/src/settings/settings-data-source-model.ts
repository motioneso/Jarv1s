import type { SourceBehaviorDto, SourceBehaviorSourceDto } from "@jarv1s/shared";

export type SourceBehaviorTone = "neutral" | "pine" | "steel";

export type DataSourceBehavior = SourceBehaviorDto;

export type DataSource = SourceBehaviorSourceDto;

export function sourceBehaviorStatus(behavior: DataSourceBehavior): {
  readonly tone: SourceBehaviorTone;
  readonly label: string;
} {
  if (behavior.toggleable && behavior.enabled) return { tone: "pine", label: "On" };
  if (behavior.toggleable) return { tone: "neutral", label: "Off" };
  return { tone: "steel", label: "Coming soon" };
}
