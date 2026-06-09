/* Usage: JARVIS_CONNECTOR_SECRET_KEY=<key> tsx scripts/verify-google-connection.ts <userId>
   Requires an active google connection in the DB.
   Reads today's calendar events (read) and creates+deletes a temp event (reversible write). */
import { DataContextRunner, createDatabase, getJarvisDatabaseUrls } from "@jarv1s/db";
import {
  ConnectorsRepository,
  GoogleConnectionService,
  GoogleOAuthClient,
  createConnectorSecretCipher
} from "@jarv1s/connectors";

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error("Usage: tsx scripts/verify-google-connection.ts <userId>");

  const urls = getJarvisDatabaseUrls();
  const appDb = createDatabase({ connectionString: urls.app, maxConnections: 1 });
  const dc = new DataContextRunner(appDb);
  const service = new GoogleConnectionService({
    repository: new ConnectorsRepository(),
    cipher: createConnectorSecretCipher(),
    oauthClient: new GoogleOAuthClient()
  });

  const accessToken = await dc.withDataContext(
    { actorUserId: userId, requestId: "verify-google" },
    (db) => service.getFreshAccessToken(db)
  );
  const authHeader = { authorization: `Bearer ${accessToken}` };

  // READ: list today's primary-calendar events
  const listRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&singleEvents=true&orderBy=startTime&timeMin=" +
      encodeURIComponent(new Date().toISOString()),
    { headers: authHeader }
  );
  const listJson = await listRes.json();
  console.log(
    "READ events status:",
    listRes.status,
    "— found",
    listJson.items?.length ?? 0,
    "events"
  );

  if (listRes.status !== 200) {
    console.error("Read failed:", JSON.stringify(listJson));
    await appDb.destroy();
    process.exit(1);
  }

  // WRITE (reversible): create a temp event then immediately delete it
  const tomorrow = new Date(Date.now() + 86_400_000);
  const end = new Date(tomorrow.getTime() + 3_600_000);
  const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      summary: "Jarv1s connection test — safe to ignore",
      start: { dateTime: tomorrow.toISOString() },
      end: { dateTime: end.toISOString() }
    })
  });
  const createdEvent = await createRes.json();
  console.log("WRITE create status:", createRes.status, "— event id:", createdEvent.id ?? "(none)");

  if (createRes.status !== 200) {
    console.error("Create failed:", JSON.stringify(createdEvent));
    await appDb.destroy();
    process.exit(1);
  }

  const deleteRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${createdEvent.id}`,
    { method: "DELETE", headers: authHeader }
  );
  console.log("WRITE delete status:", deleteRes.status, deleteRes.status === 204 ? "✓" : "✗");

  await appDb.destroy();
  if (listRes.status === 200 && createRes.status === 200 && deleteRes.status === 204) {
    console.log("✓ Google connection verified: read + write both work.");
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
