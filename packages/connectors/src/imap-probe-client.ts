import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import type { SmtpSecurityMode } from "./imap-presets.js";

export type ImapProbeResult = "ok" | "auth_failed" | "tls_failed" | "unreachable";

export interface ImapProbeInput {
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapTls: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecurity: SmtpSecurityMode;
  readonly username: string;
  readonly password: string;
}

export interface SmtpTransportSecurityOptions {
  readonly secure: boolean;
  readonly requireTLS: boolean;
}

/**
 * Maps a preset's SMTP security mode to Nodemailer's transport options. implicit_tls
 * wraps the socket in TLS from connect (secure: true); starttls connects plaintext and
 * requires the STARTTLS upgrade to succeed (secure: false, requireTLS: true) rather than
 * silently falling back to plaintext; none leaves both off for loopback-only servers.
 */
export function smtpTransportOptions(mode: SmtpSecurityMode): SmtpTransportSecurityOptions {
  switch (mode) {
    case "implicit_tls":
      return { secure: true, requireTLS: false };
    case "starttls":
      return { secure: false, requireTLS: true };
    case "none":
      return { secure: false, requireTLS: false };
  }
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
      ...smtpTransportOptions(input.smtpSecurity),
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
