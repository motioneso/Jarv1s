import { describe, expect, it } from "vitest";
import type { Insertable, Updateable } from "kysely";

import type { InstanceSettingsTable } from "@jarv1s/db";

function acceptInstanceSettingInsert(
  row: Insertable<InstanceSettingsTable>
): Insertable<InstanceSettingsTable> {
  return row;
}

function acceptInstanceSettingUpdate(
  row: Updateable<InstanceSettingsTable>
): Updateable<InstanceSettingsTable> {
  return row;
}

describe("database JSON column types", () => {
  it("accepts JSON objects for insert and update writes", () => {
    const insert = acceptInstanceSettingInsert({
      key: "feature.flag",
      value: { enabled: true },
      updated_by_user_id: null
    });
    const update = acceptInstanceSettingUpdate({
      value: { enabled: false }
    });

    expect(insert.value).toEqual({ enabled: true });
    expect(update.value).toEqual({ enabled: false });
  });
});

void acceptInstanceSettingInsert({
  key: "feature.flag",
  // @ts-expect-error JsonColumn insert values must be objects, not serialized JSON strings.
  value: '{"enabled":true}',
  updated_by_user_id: null
});

void acceptInstanceSettingUpdate({
  // @ts-expect-error JsonColumn update values must be objects, not serialized JSON strings.
  value: '{"enabled":false}'
});
