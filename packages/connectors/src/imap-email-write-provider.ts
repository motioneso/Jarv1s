import {
  buildNewMessageMime,
  buildReplyMime,
  type EmailWriteProvider,
  type EmailWriteResult,
  type NewEmailInput
} from "@jarv1s/email";
import type { DataContextDb, EmailMessage } from "@jarv1s/db";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { ConnectorSecretCipher } from "./crypto.js";
import type { ConnectorsRepository } from "./repository.js";
import { decryptImapConnectionSecret, type ImapConnectionSecret } from "./imap-secret.js";
import { smtpTransportOptions } from "./imap-probe-client.js";

const MSG_UPSTREAM_FAILED = "Couldn't send your reply right now — try again.";

const DRAFTS_FOLDER = "Drafts";
const SENT_FOLDER = "Sent";

/**
 * IMAP implementation of EmailWriteProvider. Uses nodemailer for SMTP submission
 * and ImapFlow for APPEND to Drafts/Sent. Credentials (app passwords) are passed
 * in but never serialized into responses/logs/payloads/prompts.
 */
export class ImapEmailWriteProvider implements EmailWriteProvider {
  constructor(
    private readonly repository: Pick<ConnectorsRepository, "getActiveImapAccountSecret">,
    private readonly cipher: ConnectorSecretCipher
  ) {}

  async saveDraft(
    scopedDb: DataContextDb,
    message: EmailMessage,
    to: string,
    subject: string,
    _threadId: string | null,
    body: string
  ): Promise<EmailWriteResult> {
    const secret = await this.getSecret(scopedDb, message.connector_account_id);
    if (!secret) {
      return { ok: false, mode: "draft", message: MSG_UPSTREAM_FAILED };
    }

    const raw = buildReplyMime({ to, subject, body });
    const buffer = Buffer.from(raw, "base64url");

    try {
      await this.appendToImapFolder(secret, DRAFTS_FOLDER, buffer);
      return { ok: true, mode: "draft" };
    } catch {
      return { ok: false, mode: "draft", message: MSG_UPSTREAM_FAILED };
    }
  }

  async send(
    scopedDb: DataContextDb,
    message: EmailMessage,
    to: string,
    subject: string,
    _threadId: string | null,
    body: string
  ): Promise<EmailWriteResult> {
    const secret = await this.getSecret(scopedDb, message.connector_account_id);
    if (!secret) {
      return { ok: false, mode: "send", message: MSG_UPSTREAM_FAILED };
    }

    const raw = buildReplyMime({ to, subject, body });
    const buffer = Buffer.from(raw, "base64url");

    try {
      await this.sendViaSmtp(secret, to, buffer);
      await this.appendToImapFolder(secret, SENT_FOLDER, buffer);
      return { ok: true, mode: "send" };
    } catch {
      return { ok: false, mode: "send", message: MSG_UPSTREAM_FAILED };
    }
  }

  async sendNew(scopedDb: DataContextDb, input: NewEmailInput): Promise<EmailWriteResult> {
    if (!input.connectorAccountId) {
      return { ok: false, mode: "send", message: MSG_UPSTREAM_FAILED };
    }
    const secret = await this.getSecret(scopedDb, input.connectorAccountId);
    if (!secret) {
      return { ok: false, mode: "send", message: MSG_UPSTREAM_FAILED };
    }

    const raw = buildNewMessageMime(input);
    const buffer = Buffer.from(raw, "base64url");

    try {
      await this.sendViaSmtp(secret, input.to, buffer);
      await this.appendToImapFolder(secret, SENT_FOLDER, buffer);
      return { ok: true, mode: "send" };
    } catch {
      return { ok: false, mode: "send", message: MSG_UPSTREAM_FAILED };
    }
  }

  private async getSecret(
    scopedDb: DataContextDb,
    connectorAccountId: string
  ): Promise<ImapConnectionSecret | undefined> {
    try {
      const stored = await this.repository.getActiveImapAccountSecret(scopedDb, connectorAccountId);
      if (!stored) return undefined;
      return decryptImapConnectionSecret(this.cipher, stored.encryptedSecret);
    } catch {
      return undefined;
    }
  }

  private async sendViaSmtp(
    secret: ImapConnectionSecret,
    to: string,
    message: Buffer
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: secret.smtpHost,
      port: secret.smtpPort,
      ...smtpTransportOptions(secret.smtpSecurity),
      auth: { user: secret.username, pass: secret.password }
    });

    await transporter.sendMail({
      envelope: { from: secret.username, to },
      raw: message
    });
  }

  private async appendToImapFolder(
    secret: ImapConnectionSecret,
    folder: string,
    message: Buffer
  ): Promise<void> {
    const client = new ImapFlow({
      host: secret.imapHost,
      port: secret.imapPort,
      secure: secret.imapTls,
      auth: { user: secret.username, pass: secret.password },
      logger: false
    });

    await client.connect();
    try {
      try {
        await client.mailboxOpen(folder);
      } catch {
        // Folder might not exist, try to create it
        try {
          await client.mailboxCreate(folder);
          await client.mailboxOpen(folder);
        } catch (createErr) {
          throw new Error(`Failed to create or open folder ${folder}`, { cause: createErr });
        }
      }
      await client.append(folder, message);
    } finally {
      await client.logout();
    }
  }
}
