/**
 * Resend Email Provider
 */

import { logger } from "@/lib/logger";
import {
  EmailDeliveryError,
  type EmailService,
  type SendEmailOptions,
} from "../types";

interface ResendConfig {
  apiKey: string;
}

export class ResendEmailProvider implements EmailService {
  private apiKey: string;

  constructor(config: ResendConfig) {
    this.apiKey = config.apiKey;
  }

  async send(options: SendEmailOptions): Promise<void> {
    if (!this.apiKey) {
      throw new Error("Resend API key is missing");
    }

    const to = Array.isArray(options.to)
      ? options.to.map((a) => a.email)
      : [options.to.email];

    const body = {
      from: options.from
        ? `${options.from.name} <${options.from.email}>`
        : undefined,
      to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      cc: options.cc,
      bcc: options.bcc,
      attachments: options.attachments?.map((att) => ({
        content: att.content.toString("base64"),
        filename: att.filename,
      })),
    };

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(options.deliveryId
          ? { "Idempotency-Key": options.deliveryId }
          : {}),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error({ status: response.status, errorData }, "Resend API error");
      throw new EmailDeliveryError(
        `Resend delivery failed with HTTP ${response.status}`,
        response.status,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }

    logger.info("Email sent via Resend");
  }

  async verify(): Promise<boolean> {
    return !!this.apiKey;
  }
}
