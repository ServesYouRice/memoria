/**
 * Console Email Provider
 * Logs emails to console - useful for development and testing
 */

/* eslint-disable no-console -- console provider intentionally logs emails for local development. */

import { logger } from "@/lib/logger";
import type { EmailService, SendEmailOptions } from "../types";

export class ConsoleEmailProvider implements EmailService {
  async send(options: SendEmailOptions): Promise<void> {
    logger.info(
      { to: this.formatAddresses(options.to), subject: options.subject },
      "Email captured by console provider",
    );

    // Pretty print for development
    console.log("\n--- Email (Console Provider) ---");
    console.log("To:", this.formatAddresses(options.to));
    if (options.from) {
      console.log("From:", this.formatAddress(options.from));
    }
    if (options.cc) {
      console.log("CC:", this.formatAddresses(options.cc));
    }
    if (options.bcc) {
      console.log("BCC:", this.formatAddresses(options.bcc));
    }
    console.log("Subject:", options.subject);
    console.log(
      "Content: [redacted — recovery and verification URLs are never logged]",
    );

    if (options.attachments && options.attachments.length > 0) {
      console.log(
        "\n--- Attachments ---",
        options.attachments.map((a) => a.filename).join(", "),
      );
    }
    console.log("--- End Email ---\n");
  }

  async verify(): Promise<boolean> {
    logger.info("Console email provider verified");
    return true;
  }

  private formatAddress(address: { email: string; name?: string }): string {
    return address.name ? `${address.name} <${address.email}>` : address.email;
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
