/**
 * SendGrid Email Provider
 */

import { logger } from "@/lib/logger";
import {
  EmailDeliveryError,
  type EmailService,
  type SendEmailOptions,
} from "../types";

interface SendGridConfig {
  apiKey: string;
  apiUrl?: string;
}

export class SendGridEmailProvider implements EmailService {
  private apiKey: string;
  private apiUrl: string;

  constructor(config: SendGridConfig) {
    this.apiKey = config.apiKey;
    this.apiUrl = config.apiUrl || "https://api.sendgrid.com/v3/mail/send";
  }

  async send(options: SendEmailOptions): Promise<void> {
    if (!this.apiKey) {
      throw new Error("SendGrid API key is missing");
    }

    const personalizations = [
      {
        to: Array.isArray(options.to) ? options.to : [options.to],
        cc: options.cc,
        bcc: options.bcc,
        custom_args: options.deliveryId
          ? { memoria_delivery_id: options.deliveryId }
          : undefined,
      },
    ];

    const content = [];
    if (options.text) {
      content.push({ type: "text/plain", value: options.text });
    }
    if (options.html) {
      content.push({ type: "text/html", value: options.html });
    }

    const body = {
      personalizations,
      from: options.from,
      subject: options.subject,
      content,
      attachments: options.attachments?.map((att) => ({
        content: att.content.toString("base64"),
        filename: att.filename,
        type: att.contentType,
      })),
    };

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error(
        { status: response.status, errorData },
        "SendGrid API error",
      );
      throw new EmailDeliveryError(
        `SendGrid delivery failed with HTTP ${response.status}`,
        response.status,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }

    logger.info("Email sent via SendGrid");
  }

  async verify(): Promise<boolean> {
    // SendGrid doesn't have a simple "verify" endpoint for API keys generally available without sending mail,
    // but checking if we can instantiate it with a key is a start.
    // A more robust check might try to hit a read-only endpoint if available.
    return !!this.apiKey;
  }
}
