import type { DataContextDb } from "@jarv1s/db";

import {
  getRuntimeConfigEntry,
  type RuntimeConfigKeyEntry,
  type RuntimeConfigType
} from "./runtime-config-keys.js";

export type RuntimeConfigSource = "instance" | "env" | "default";

export interface RuntimeConfigStatus {
  readonly value: string | null;
  readonly source: RuntimeConfigSource;
}

interface ResolvedRuntimeConfig {
  readonly entry: RuntimeConfigKeyEntry;
  readonly value: string;
  readonly source: RuntimeConfigSource;
}

export class RuntimeConfigResolver {
  constructor(
    private readonly scopedDb: DataContextDb,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  async getStatus(key: string): Promise<RuntimeConfigStatus> {
    const resolved = await this.resolve(key);
    return {
      value: resolved.entry.secret ? null : resolved.value,
      source: resolved.source
    };
  }

  async resolveString(key: string): Promise<string> {
    const resolved = await this.resolve(key);
    this.assertType(resolved.entry, key, ["string", "secret"]);
    return resolved.value;
  }

  async resolveEnum<T extends string = string>(key: string): Promise<T> {
    const resolved = await this.resolve(key);
    this.assertType(resolved.entry, key, ["enum"]);
    if (!resolved.entry.enumValues?.includes(resolved.value)) {
      throw new Error(
        `Invalid runtime config "${key}" value "${resolved.value}" (expected one of: ${resolved.entry.enumValues?.join(", ") ?? ""})`
      );
    }
    return resolved.value as T;
  }

  async resolveInt(key: string): Promise<number> {
    const resolved = await this.resolve(key);
    this.assertType(resolved.entry, key, ["int"]);
    const parsed = Number(resolved.value);
    if (!Number.isInteger(parsed)) {
      throw new Error(`Invalid runtime config "${key}" value "${resolved.value}" (expected int)`);
    }
    return parsed;
  }

  private async resolve(key: string): Promise<ResolvedRuntimeConfig> {
    const entry = getRuntimeConfigEntry(key);
    if (!entry) {
      throw new Error(`Unknown runtime config key "${key}"`);
    }

    const instanceValue = await this.readInstanceValue(key);
    if (typeof instanceValue === "string") {
      return { entry, value: instanceValue, source: "instance" };
    }

    const envValue = this.env[entry.envVar];
    if (envValue && envValue.length > 0) {
      return { entry, value: envValue, source: "env" };
    }

    return { entry, value: entry.defaultValue, source: "default" };
  }

  private async readInstanceValue(key: string): Promise<unknown> {
    const row = await this.scopedDb.db
      .selectFrom("app.instance_settings")
      .select(["value"])
      .where("key", "=", key)
      .executeTakeFirst();
    return (row?.value as { value?: unknown } | null | undefined)?.value;
  }

  private assertType(
    entry: RuntimeConfigKeyEntry,
    key: string,
    expected: readonly RuntimeConfigType[]
  ): void {
    if (!expected.includes(entry.type)) {
      throw new Error(`Runtime config "${key}" is ${entry.type}, not ${expected.join("/")}`);
    }
  }
}
