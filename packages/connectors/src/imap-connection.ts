import type { DataContextDb } from "@jarv1s/db";
import type { ImapTestResult } from "@jarv1s/shared";

import type { ConnectorSecretCipher } from "./crypto.js";
import { getImapPreset, type ImapPreset } from "./imap-presets.js";
import type { ImapProbeClient } from "./imap-probe-client.js";
import type { ImapConnectionSecret } from "./imap-secret.js";
import type { ConnectorAccountSafeRow, ConnectorsRepository } from "./repository.js";

export class ImapConnectError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "ImapConnectError";
  }
}

export interface ImapCredentialsInput {
  readonly providerId: string;
  readonly username: string;
  readonly password: string;
}

export interface ImapConnectionServiceDeps {
  readonly repository: ConnectorsRepository;
  readonly cipher: ConnectorSecretCipher;
  readonly probeClient: ImapProbeClient;
}

/**
 * Probes and persists generic-IMAP credentials. Connection params (host/port/TLS) come
 * from the in-code preset registry, never the request body. testConnection() is a pure
 * probe — it never reads or writes app.connector_accounts; connect() probes, then on
 * "ok" persists the credential bundle. Neither method writes any health column (#641
 * Slice B: health is transient HTTP-response-only, not persisted).
 */
export class ImapConnectionService {
  constructor(private readonly deps: ImapConnectionServiceDeps) {}

  async testConnection(input: ImapCredentialsInput): Promise<ImapTestResult> {
    const preset = this.requirePreset(input.providerId);
    const result = await this.deps.probeClient.probe(this.toProbeInput(preset, input));
    return { result };
  }

  async connect(
    scopedDb: DataContextDb,
    input: ImapCredentialsInput
  ): Promise<ConnectorAccountSafeRow> {
    const preset = this.requirePreset(input.providerId);
    const result = await this.deps.probeClient.probe(this.toProbeInput(preset, input));
    if (result !== "ok") {
      throw new ImapConnectError(
        result === "auth_failed"
          ? "The mail server rejected the supplied username/password"
          : result === "tls_failed"
            ? "Could not establish a secure connection to the mail server"
            : "Could not reach the mail server"
      );
    }

    const bundle: ImapConnectionSecret = {
      kind: "imap-password",
      providerId: input.providerId,
      username: input.username,
      password: input.password,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapTls: preset.imapTls,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpSecurity: preset.smtpSecurity
    };
    return this.deps.repository.upsertImapAccount(scopedDb, {
      providerId: input.providerId,
      encryptedSecret: this.deps.cipher.encryptJson(bundle)
    });
  }

  private requirePreset(providerId: string): ImapPreset {
    const preset = getImapPreset(providerId);
    if (!preset) {
      throw new ImapConnectError(`Unknown imap provider: ${providerId}`);
    }
    return preset;
  }

  private toProbeInput(preset: ImapPreset, input: ImapCredentialsInput) {
    return {
      username: input.username,
      password: input.password,
      imapHost: preset.imapHost,
      imapPort: preset.imapPort,
      imapTls: preset.imapTls,
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpSecurity: preset.smtpSecurity
    };
  }
}
