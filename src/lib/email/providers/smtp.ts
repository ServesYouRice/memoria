/**
 * SMTP Email Provider
 * Sends emails via SMTP (requires nodemailer in production)
 *
 * Note: This is a template implementation. To use in production:
 * 1. Install nodemailer: pnpm add nodemailer @types/nodemailer
 * 2. Uncomment the implementation below
 * 3. Configure SMTP settings in environment variables
 */

import { logger } from "@/lib/logger";
import type {
  EmailService,
  SendEmailOptions,
  EmailServiceConfig,
} from "../types";

export class SMTPEmailProvider implements EmailService {
  private config: NonNullable<EmailServiceConfig["smtp"]>;
  // private transporter: any; // nodemailer.Transporter

  constructor(config: NonNullable<EmailServiceConfig["smtp"]>) {
    this.config = config;

    // Uncomment when nodemailer is installed:
    // const nodemailer = require('nodemailer');
    // this.transporter = nodemailer.createTransport({
    //   host: config.host,
    //   port: config.port,
    //   secure: config.secure,
    //   auth: {
    //     user: config.auth.user,
    //     pass: config.auth.pass,
    //   },
    // });
  }

  async send(options: SendEmailOptions): Promise<void> {
    logger.info(
      { to: options.to, subject: options.subject },
      "Sending email via SMTP",
    );

    // Uncomment when nodemailer is installed:
    // const mailOptions = {
    //   from: options.from ? this.formatAddress(options.from) : undefined,
    //   to: this.formatAddresses(options.to),
    //   cc: options.cc ? this.formatAddresses(options.cc) : undefined,
    //   bcc: options.bcc ? this.formatAddresses(options.bcc) : undefined,
    //   replyTo: options.replyTo ? this.formatAddress(options.replyTo) : undefined,
    //   subject: options.subject,
    //   text: options.text,
    //   html: options.html,
    //   attachments: options.attachments,
    // };
    //
    // await this.transporter.sendMail(mailOptions);
    // logger.info({ to: options.to, subject: options.subject }, 'Email sent successfully');

    // Temporary fallback to console for development
    throw new Error(
      "SMTP provider requires nodemailer. Install with: pnpm add nodemailer @types/nodemailer",
    );
  }

  async verify(): Promise<boolean> {
    try {
      // Uncomment when nodemailer is installed:
      // await this.transporter.verify();
      // logger.info('SMTP connection verified');
      // return true;

      logger.warn("SMTP provider not configured (nodemailer not installed)");
      return false;
    } catch (error) {
      logger.error({ error }, "SMTP verification failed");
      return false;
    }
  }

  private formatAddress(address: { email: string; name?: string }): string {
    return address.name
      ? `"${address.name}" <${address.email}>`
      : address.email;
  }

  private formatAddresses(
    addresses:
      { email: string; name?: string } | { email: string; name?: string }[],
  ): string {
    if (Array.isArray(addresses)) {
      return addresses.map((a) => this.formatAddress(a)).join(", ");
    }
    return this.formatAddress(addresses);
  }
}
