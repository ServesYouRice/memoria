/**
 * SMTP Email Provider
 *
 * Sends mail through an SMTP submission server with nodemailer.
 *
 * Transport policy:
 * - `secure: true` uses implicit TLS (port 465). Otherwise the client
 *   upgrades with STARTTLS (port 587).
 * - `requireTLS` (production) refuses to send when the server cannot
 *   complete a TLS upgrade, so credentials and message content never leave
 *   the socket in cleartext. Certificates are always verified.
 * - Connection, greeting and socket timeouts bound how long a silent server
 *   can hold an outbox job.
 */

import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { logger } from "@/lib/logger";
import {
  EmailDeliveryError,
  type EmailAddress,
  type EmailService,
  type EmailServiceConfig,
  type SendEmailOptions,
} from "../types";

type SmtpConfig = NonNullable<EmailServiceConfig["smtp"]>;

const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} satisfies Partial<SMTPTransport.Options>;

// Failures that will not change on retry: bad credentials, rejected TLS,
// refused STARTTLS, and malformed envelopes or messages.
const PERMANENT_ERROR_CODES = new Set([
  "EAUTH",
  "ETLS",
  "EREQUIRETLS",
  "ECONFIG",
  "EENVELOPE",
  "EMESSAGE",
]);

// nodemailer reports a rejected certificate as ESOCKET and keeps the Node TLS
// reason (DEPTH_ZERO_SELF_SIGNED_CERT, CERT_HAS_EXPIRED, ...) in originalCode.
const CERTIFICATE_ERROR_CODE = /CERT|SELF_SIGNED|UNABLE_TO_(GET_ISSUER|VERIFY)/;

export class SMTPEmailProvider implements EmailService {
  private readonly transporter: Transporter;

  /**
   * @param transportOverrides Merged over the production transport options.
   *   Production code passes nothing; tests use it to trust a private CA and
   *   shorten timeouts.
   */
  constructor(
    config: SmtpConfig,
    transportOverrides: Partial<SMTPTransport.Options> = {},
  ) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      auth: config.auth.user
        ? { user: config.auth.user, pass: config.auth.pass }
        : undefined,
      tls: { minVersion: "TLSv1.2" },
      ...SMTP_TIMEOUTS,
      ...transportOverrides,
    });
  }

  async send(options: SendEmailOptions): Promise<void> {
    logger.info(
      { to: options.to, subject: options.subject },
      "Sending email via SMTP",
    );

    try {
      await sendWithAbort(
        this.transporter,
        {
          from: options.from ? toMailbox(options.from) : undefined,
          to: toMailboxes(options.to),
          cc: options.cc ? toMailboxes(options.cc) : undefined,
          bcc: options.bcc ? toMailboxes(options.bcc) : undefined,
          replyTo: options.replyTo ? toMailbox(options.replyTo) : undefined,
          subject: options.subject,
          text: options.text,
          html: options.html,
          attachments: options.attachments,
        },
        options.signal,
      );
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
      throw toDeliveryError(error);
    }
  }

  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      logger.error({ error }, "SMTP verification failed");
      return false;
    }
  }
}

function toMailbox(address: EmailAddress): { name?: string; address: string } {
  return address.name
    ? { name: address.name, address: address.email }
    : { address: address.email };
}

function toMailboxes(
  addresses: EmailAddress | EmailAddress[],
): { name?: string; address: string }[] {
  return (Array.isArray(addresses) ? addresses : [addresses]).map(toMailbox);
}

/**
 * nodemailer does not accept an AbortSignal, so an abort rejects the send
 * promptly. The socket itself is still bounded by the timeouts above.
 */
function sendWithAbort(
  transporter: Transporter,
  message: SendMailOptions,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!signal) {
    return transporter.sendMail(message);
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([transporter.sendMail(message), aborted]).finally(() =>
    signal.removeEventListener("abort", onAbort),
  );
}

function toDeliveryError(error: unknown): unknown {
  if (error instanceof EmailDeliveryError) {
    return error;
  }

  const details = error as {
    code?: unknown;
    originalCode?: unknown;
    responseCode?: unknown;
  };
  const code = typeof details.code === "string" ? details.code : undefined;
  const originalCode =
    typeof details.originalCode === "string" ? details.originalCode : undefined;
  const responseCode =
    typeof details.responseCode === "number" ? details.responseCode : undefined;
  const message = error instanceof Error ? error.message : String(error);
  const label = [code, originalCode].filter(Boolean).join("/");

  return new EmailDeliveryError(
    `SMTP delivery failed${label ? ` (${label})` : ""}: ${message}`,
    responseCode ?? 0,
    isRetryableSmtpFailure(code, originalCode, responseCode),
  );
}

/**
 * 4xx replies are temporary and 5xx replies are permanent. Without a reply,
 * certificate and protocol failures are permanent and anything else (timeouts,
 * resets, refused connections) is retryable.
 */
function isRetryableSmtpFailure(
  code: string | undefined,
  originalCode: string | undefined,
  responseCode: number | undefined,
): boolean {
  if (responseCode !== undefined) {
    return responseCode >= 400 && responseCode < 500;
  }
  if (originalCode && CERTIFICATE_ERROR_CODE.test(originalCode)) {
    return false;
  }
  return !(code && PERMANENT_ERROR_CODES.has(code));
}
