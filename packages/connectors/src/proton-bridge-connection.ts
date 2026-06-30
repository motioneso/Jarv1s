import { connect as tlsConnect, type TLSSocket } from "node:tls";

import type { DataContextDb } from "@jarv1s/db";

import type { ConnectorSecretCipher, EncryptedConnectorSecret } from "./crypto.js";
import {
  PROTON_PROVIDER_ID,
  type ConnectorAccountSafeRow,
  type ConnectorsRepository
} from "./repository.js";

export type ProtonBridgeTlsMode = "strict" | "insecure";
export type ProtonBridgeConnectionHealth = "bridge_unreachable" | "auth_failed" | "ok";

export class ProtonBridgeConnectError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ProtonBridgeConnectError";
  }
}

export interface ProtonBridgeConnectionSecret extends Record<string, unknown> {
  readonly kind: "proton-bridge";
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly appPassword: string;
  readonly tlsMode: ProtonBridgeTlsMode;
}

/**
 * Probes a Proton Mail Bridge instance's local IMAP endpoint. Injectable so tests never
 * perform real network I/O — the production implementation (ImapBridgeProbeClient) speaks
 * a minimal IMAP4 LOGIN handshake over TLS.
 */
export interface BridgeProbeClient {
  probe(credentials: {
    host: string;
    port: number;
    username: string;
    appPassword: string;
    tlsMode: ProtonBridgeTlsMode;
  }): Promise<ProtonBridgeConnectionHealth>;
}

export interface ProtonBridgeConnectionServiceDeps {
  readonly repository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly probeClient: BridgeProbeClient;
  readonly now?: () => Date;
}

export class ProtonBridgeConnectionService {
  private readonly now: () => Date;

  constructor(private readonly deps: ProtonBridgeConnectionServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async connect(
    scopedDb: DataContextDb,
    input: {
      host: string;
      port: number;
      username: string;
      appPassword: string;
      tlsMode: ProtonBridgeTlsMode;
    }
  ): Promise<ConnectorAccountSafeRow> {
    const health = await this.deps.probeClient.probe(input);
    if (health !== "ok") {
      throw new ProtonBridgeConnectError(
        health === "auth_failed"
          ? "Bridge rejected the supplied username/password"
          : "Could not reach Proton Bridge at the supplied host/port"
      );
    }

    const bundle: ProtonBridgeConnectionSecret = {
      kind: "proton-bridge",
      host: input.host,
      port: input.port,
      username: input.username,
      appPassword: input.appPassword,
      tlsMode: input.tlsMode
    };
    const account = await this.deps.repository.upsertProtonAccount(scopedDb, {
      encryptedSecret: this.deps.cipher.encryptJson(bundle)
    });
    return this.deps.repository.recordConnectionHealth(scopedDb, account.id, {
      status: health,
      checkedAt: this.now()
    });
  }

  async testConnection(scopedDb: DataContextDb): Promise<ConnectorAccountSafeRow> {
    const stored = await this.deps.repository.getActiveProtonAccountSecret(scopedDb);
    if (!stored) {
      throw new ProtonBridgeConnectError(`No active ${PROTON_PROVIDER_ID} connection`);
    }
    const bundle = decryptProtonBridgeSecret(this.deps.cipher, stored.encryptedSecret);
    const health = await this.deps.probeClient.probe(bundle);
    return this.deps.repository.recordConnectionHealth(scopedDb, stored.id, {
      status: health,
      checkedAt: this.now()
    });
  }
}

export function decryptProtonBridgeSecret(
  cipher: ConnectorSecretCipher,
  encryptedSecret: EncryptedConnectorSecret
): ProtonBridgeConnectionSecret {
  const value = cipher.decryptJson(encryptedSecret);

  if (
    value.kind !== "proton-bridge" ||
    typeof value.host !== "string" ||
    typeof value.port !== "number" ||
    typeof value.username !== "string" ||
    typeof value.appPassword !== "string" ||
    (value.tlsMode !== "strict" && value.tlsMode !== "insecure")
  ) {
    throw new ProtonBridgeConnectError("Stored Proton Bridge connection credentials are invalid");
  }

  return {
    kind: "proton-bridge",
    host: value.host,
    port: value.port,
    username: value.username,
    appPassword: value.appPassword,
    tlsMode: value.tlsMode
  };
}

const IMAP_PROBE_TIMEOUT_MS = 10_000;

/**
 * Best-effort minimal IMAP4 LOGIN handshake over TLS against a local Bridge instance.
 * Connection-level failures/timeouts before a parseable tagged response map to
 * "bridge_unreachable"; an explicit NO/BAD response maps to "auth_failed". This is the
 * production default — tests inject a fake BridgeProbeClient and never exercise this code.
 */
export class ImapBridgeProbeClient implements BridgeProbeClient {
  async probe(credentials: {
    host: string;
    port: number;
    username: string;
    appPassword: string;
    tlsMode: ProtonBridgeTlsMode;
  }): Promise<ProtonBridgeConnectionHealth> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: ProtonBridgeConnectionHealth) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };

      let socket: TLSSocket;
      const timer = setTimeout(() => finish("bridge_unreachable"), IMAP_PROBE_TIMEOUT_MS);

      let stage: "greeting" | "login" = "greeting";
      let buffer = "";

      try {
        socket = tlsConnect({
          host: credentials.host,
          port: credentials.port,
          rejectUnauthorized: credentials.tlsMode === "strict"
        });
      } catch {
        clearTimeout(timer);
        resolve("bridge_unreachable");
        return;
      }

      socket.on("error", () => finish("bridge_unreachable"));
      socket.on("timeout", () => finish("bridge_unreachable"));
      socket.setTimeout(IMAP_PROBE_TIMEOUT_MS);

      socket.on("secureConnect", () => {
        // Wait for the server greeting before sending LOGIN.
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (!buffer.includes("\r\n")) return;

        if (stage === "greeting") {
          buffer = "";
          stage = "login";
          const escapedUser = credentials.username.replace(/["\\]/g, "\\$&");
          const escapedPass = credentials.appPassword.replace(/["\\]/g, "\\$&");
          socket.write(`a1 LOGIN "${escapedUser}" "${escapedPass}"\r\n`);
          return;
        }

        if (!/^a1\s+(OK|NO|BAD)/im.test(buffer)) {
          return;
        }

        if (/^a1\s+OK/im.test(buffer)) {
          socket.write("a1 LOGOUT\r\n");
          finish("ok");
        } else {
          finish("auth_failed");
        }
      });
    });
  }
}
