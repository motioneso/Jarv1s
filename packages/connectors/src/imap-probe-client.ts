import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

export type ImapProbeResult = "ok" | "auth_failed" | "tls_failed" | "unreachable";

export interface ImapProbeInput {
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapTls: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpTls: boolean;
  readonly username: string;
  readonly password: string;
}

export interface ImapProbeClient {
  probe(input: ImapProbeInput): Promise<ImapProbeResult>;
}

/**
 * Map any IMAP/SMTP error to a bounded label. The raw error is intentionally discarded
 * so credentials / server transcripts never reach a caller or a log.
 */
export function mapProbeError(err: unknown): Exclude<ImapProbeResult, "ok"> {
  const e = (err ?? {}) as { code?: string; authenticationFailed?: boolean; responseText?: string };
  const text = typeof e.responseText === "string" ? e.responseText.toUpperCase() : "";
  if (
    e.authenticationFailed ||
    text.includes("AUTHENTICATIONFAILED") ||
    text.includes("INVALID CREDENTIALS")
  ) {
    return "auth_failed";
  }
  if (typeof e.code === "string" && e.code.startsWith("ERR_TLS")) {
    return "tls_failed";
  }
  if (
    e.code === "ECONNREFUSED" ||
    e.code === "ENOTFOUND" ||
    e.code === "ETIMEDOUT" ||
    e.code === "EHOSTUNREACH"
  ) {
    return "unreachable";
  }
  return "unreachable";
}

export class LiveImapProbeClient implements ImapProbeClient {
  async probe(input: ImapProbeInput): Promise<ImapProbeResult> {
    const imap = new ImapFlow({
      host: input.imapHost,
      port: input.imapPort,
      secure: input.imapTls,
      auth: { user: input.username, pass: input.password },
      logger: false
    });
    try {
      await imap.connect();
      await imap.logout();
    } catch (err) {
      try {
        await imap.close();
      } catch {
        /* already closed */
      }
      return mapProbeError(err);
    }

    const transport = nodemailer.createTransport({
      host: input.smtpHost,
      port: input.smtpPort,
      secure: input.smtpTls,
      auth: { user: input.username, pass: input.password }
    });
    try {
      await transport.verify();
    } catch (err) {
      return mapProbeError(err);
    } finally {
      transport.close();
    }
    return "ok";
  }
}
