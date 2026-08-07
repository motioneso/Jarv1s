// Shared seed data and actor contexts for the notifications integration suite, split out of
// the original notifications.test.ts (#1328) when that file grew past the 1000-line cap.
// Each sibling file (notifications.test.ts, notifications-hardening.test.ts,
// notifications-keyed-upsert.test.ts) still builds its own independent DB/server harness in
// its own beforeAll/afterAll — the same per-file-isolated pattern already used by
// notifications-unread-by-module.test.ts — and imports only the fixed pieces below, which
// are byte-for-byte identical to what notifications.test.ts declared inline before this split.
import pg from "pg";
import type { AccessContext } from "@moss/db";
import { connectionStrings, ids } from "./test-database.js";

const { Client } = pg;

export const notificationIds = {
  aPrivate: "60000000-0000-4000-8000-000000000001",
  bPrivate: "60000000-0000-4000-8000-000000000002",
  aSeed: "60000000-0000-4000-8000-000000000003",
  forgedForUserA: "60000000-0000-4000-8000-000000000004",
  // A row written directly via the bootstrap connection with deliberately oversized / nested /
  // oddly-keyed raw metadata, to prove the OUTPUT projection (serializeNotification) strips
  // it regardless of what is in the column.
  aProjectionProbe: "60000000-0000-4000-8000-000000000005"
} as const;

export async function seedNotificationData(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE app.users SET is_bootstrap_owner = true WHERE id = $1", [ids.userA]);
    await client.query(
      `
        INSERT INTO app.notifications (
          id,
          actor_user_id,
          recipient_user_id,
          title,
          body,
          metadata
        )
        VALUES
          ($1, $2, $3, 'User A private notification', 'Private for User A', $4::jsonb),
          ($5, $3, $2, 'User B private notification', 'Private for User B', $6::jsonb),
          ($7, $2, $3, 'Seeded notification for User A', 'Seeded recipient-only row for User A', $8::jsonb),
          ($9, $3, $3, 'Projection probe notification', 'Raw metadata in column is deliberately oversized', $10::jsonb)
      `,
      [
        notificationIds.aPrivate,
        ids.userB,
        ids.userA,
        JSON.stringify({ source: "seed", resourceType: "task" }),
        notificationIds.bPrivate,
        JSON.stringify({ source: "seed", resourceType: "note" }),
        notificationIds.aSeed,
        JSON.stringify({ source: "seed" }),
        notificationIds.aProjectionProbe,
        // Deliberately raw, oversized, nested, and oddly-keyed metadata. It fits the DB
        // size CHECK (< 4096 bytes after jsonb::text) but violates every app-layer bound;
        // the OUTPUT projection in serializeNotification MUST strip it down to the bounded
        // shape before this reaches any REST or assistant-tool client.
        //
        // jsonb stores object keys in (length, content) order, NOT insertion order — so the
        // 2-char "good" keys (aa/bb/cc/dd) sort BEFORE the 7-char extraXX keys and survive
        // the 16-key cap, letting us assert the cap behavior deterministically. ee is a
        // 500-char string that the projection must truncate to 256 chars on the way out.
        JSON.stringify({
          aa: "projection-probe",
          bb: 3,
          cc: true,
          dd: null,
          ee: "x".repeat(500),
          // nested object / array → key removed entirely
          nested: { href: "https://example.test", label: "dropped" },
          list: [1, 2, 3],
          // bad key names → dropped
          "has space": "dropped",
          "123numeric": "dropped",
          // 20 extraXX keys → only the first 11 survive (16-key cap after the 5 good keys)
          ...Object.fromEntries(
            Array.from({ length: 20 }, (_, i) => [`extra${i.toString().padStart(2, "0")}`, i])
          )
        })
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

export function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-notifications"
  };
}

export function userBContext(): AccessContext {
  return {
    actorUserId: ids.userB,
    requestId: "request:user-b-notifications"
  };
}
