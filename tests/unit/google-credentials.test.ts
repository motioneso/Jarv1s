import { describe, expect, it } from "vitest";

import {
  extractGoogleClientCredentials,
  importCredentialsJson
} from "../../apps/web/src/connectors/google-credentials.js";

function fileEvent(payload: string) {
  const file = new File([payload], "client_secret.json", { type: "application/json" });
  const target = { files: [file], value: "client_secret.json" };
  return { target } as unknown as Parameters<typeof importCredentialsJson>[0];
}

describe("extractGoogleClientCredentials", () => {
  it("extracts installed-app Google OAuth credentials", () => {
    expect(
      extractGoogleClientCredentials({
        installed: {
          client_id: " cid.apps.googleusercontent.com ",
          client_secret: " GOCSPX-fake-secret "
        }
      })
    ).toEqual({
      clientId: "cid.apps.googleusercontent.com",
      clientSecret: "GOCSPX-fake-secret"
    });
  });

  it("extracts web-app Google OAuth credentials", () => {
    expect(
      extractGoogleClientCredentials({
        web: {
          client_id: "web.apps.googleusercontent.com",
          client_secret: "GOCSPX-web-secret"
        }
      })
    ).toEqual({
      clientId: "web.apps.googleusercontent.com",
      clientSecret: "GOCSPX-web-secret"
    });
  });

  it("rejects non-Google credential shapes", () => {
    expect(extractGoogleClientCredentials({ installed: { client_id: "only-id" } })).toBeNull();
  });
});

describe("importCredentialsJson", () => {
  it("returns credentials and clears the file input after valid JSON import", async () => {
    const event = fileEvent(
      JSON.stringify({
        installed: {
          client_id: "cid.apps.googleusercontent.com",
          client_secret: "GOCSPX-fake-secret"
        }
      })
    );

    await expect(importCredentialsJson(event)).resolves.toEqual({
      clientId: "cid.apps.googleusercontent.com",
      clientSecret: "GOCSPX-fake-secret"
    });
    expect(event.target.value).toBe("");
  });

  it("returns a clear shape error for valid JSON with wrong fields", async () => {
    await expect(importCredentialsJson(fileEvent(JSON.stringify({ nope: true })))).resolves.toEqual(
      {
        error: "That file does not look like a Google OAuth client JSON file."
      }
    );
  });

  it("returns a clear read error for invalid JSON", async () => {
    await expect(importCredentialsJson(fileEvent("{not-json"))).resolves.toEqual({
      error: "Could not read that JSON file."
    });
  });
});
