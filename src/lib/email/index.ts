/**
 * Email Service Module
 *
 * Provides a pluggable email service abstraction with multiple provider support.
 * Follows service abstraction ADR pattern for easy provider switching.
 *
 * @module lib/email
 *
 * @example
 * ```typescript
 * // Send password reset email
 * await sendPasswordResetEmail(
 *   { email: 'user@example.com', name: 'John Doe' },
 *   {
 *     userName: 'John Doe',
 *     resetUrl: 'https://app.com/reset?token=abc123',
 *     expiresIn: '1 hour'
 *   }
 * );
 * ```
 *
 * @example
 * ```typescript
 * // Send custom email
 * await sendEmail({
 *   to: { email: 'user@example.com', name: 'User' },
 *   subject: 'Welcome!',
 *   text: 'Welcome to our app',
 *   html: '<h1>Welcome!</h1>'
 * });
 * ```
 *
 * ## Configuration
 *
 * Set environment variables to configure the email provider:
 * - `EMAIL_PROVIDER`: 'console' | 'smtp' | 'sendgrid' | 'resend' (default: 'console')
 * - `EMAIL_FROM`: From email address (default: 'noreply@memoria.com')
 * - `EMAIL_FROM_NAME`: From name (default: 'Memoria')
 *
 * ### SMTP Configuration
 * - `SMTP_HOST`: SMTP server host
 * - `SMTP_PORT`: SMTP server port
 * - `SMTP_SECURE`: Use TLS ('true' | 'false')
 * - `SMTP_USER`: SMTP username
 * - `SMTP_PASS`: SMTP password
 *
 * @see {@link EmailService} for provider interface
 * @see {@link SendEmailOptions} for email options
 */

import { logger } from "@/lib/logger";
import type {
  EmailService,
  EmailServiceConfig,
  SendEmailOptions,
  EmailAddress,
  PasswordResetEmailData,
  EmailVerificationData,
  WelcomeEmailData,
} from "./types";
import { ConsoleEmailProvider } from "./providers/console";
import { SendGridEmailProvider } from "./providers/sendgrid";
import { ResendEmailProvider } from "./providers/resend";
import { incrementOperationalCounter } from "@/lib/operations/runtime-metrics";
import {
  passwordResetTemplate,
  emailVerificationTemplate,
  welcomeEmailTemplate,
} from "./templates";

const SUPPORTED_EMAIL_PROVIDERS = new Set<EmailServiceConfig["provider"]>([
  "console",
  "sendgrid",
  "resend",
]);

// ... (skipping getEmailConfig, it is fine) -> No, I need to put it back.

/**
 * Email service configuration from environment
 */
function getEmailConfig(): EmailServiceConfig {
  const provider = (process.env["EMAIL_PROVIDER"] ||
    "console") as EmailServiceConfig["provider"];

  const config: EmailServiceConfig = {
    provider,
    from: {
      email: process.env["EMAIL_FROM"] || "noreply@memoria.com",
      name: process.env["EMAIL_FROM_NAME"] || "Memoria",
    },
  };

  // Provider-specific configuration
  if (provider === "smtp") {
    config.smtp = {
      host: process.env["SMTP_HOST"] || "localhost",
      port: parseInt(process.env["SMTP_PORT"] || "587", 10),
      secure: process.env["SMTP_SECURE"] === "true",
      auth: {
        user: process.env["SMTP_USER"] || "",
        pass: process.env["SMTP_PASS"] || "",
      },
    };
  } else if (provider === "sendgrid") {
    config.sendgrid = {
      apiKey: process.env["SENDGRID_API_KEY"] || "",
      apiUrl: process.env["SENDGRID_API_URL"],
    };
  } else if (provider === "resend") {
    config.resend = {
      apiKey: process.env["RESEND_API_KEY"] || "",
    };
  }

  return config;
}

/**
 * Create email provider based on configuration
 */
function createEmailProvider(config: EmailServiceConfig): EmailService {
  switch (config.provider) {
    case "console":
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "The console email provider is forbidden in production because recovery links contain secrets.",
        );
      }
      logger.info("Using console email provider (development mode)");
      return new ConsoleEmailProvider();

    case "smtp":
      if (!config.smtp) {
        throw new Error("SMTP configuration is required for SMTP provider");
      }
      throw new Error(
        "SMTP provider is not supported in this build. Use console, sendgrid, or resend instead.",
      );

    case "sendgrid":
      if (!config.sendgrid) {
        throw new Error("SendGrid configuration is required");
      }
      logger.info("Using SendGrid email provider");
      return new SendGridEmailProvider(config.sendgrid);

    case "resend":
      if (!config.resend) {
        throw new Error("Resend configuration is required");
      }
      logger.info("Using Resend email provider");
      return new ResendEmailProvider(config.resend);

    default:
      logger.warn(
        { provider: config.provider },
        "Unknown email provider, falling back to console",
      );
      return new ConsoleEmailProvider();
  }
}

export function isEmailProviderSupported(
  provider: EmailServiceConfig["provider"],
): boolean {
  return SUPPORTED_EMAIL_PROVIDERS.has(provider);
}

// Singleton instance
let emailServiceInstance: EmailService | null = null;

/**
 * Get email service instance
 */
export function getEmailService(): EmailService {
  if (!emailServiceInstance) {
    const config = getEmailConfig();
    emailServiceInstance = createEmailProvider(config);
  }
  return emailServiceInstance;
}

/**
 * Send a generic email
 *
 * Sends an email using the configured email service provider.
 * The 'from' address is automatically set from configuration.
 *
 * @param options - Email options (to, subject, text, html, etc.)
 * @throws {Error} If email service fails to send
 *
 * @example
 * ```typescript
 * await sendEmail({
 *   to: { email: 'user@example.com', name: 'John Doe' },
 *   subject: 'Account Update',
 *   text: 'Your account has been updated',
 *   html: '<p>Your account has been updated</p>'
 * });
 * ```
 */
export async function sendEmail(
  options: Omit<SendEmailOptions, "from">,
): Promise<void> {
  const service = getEmailService();
  const config = getEmailConfig();

  try {
    await service.send({
      ...options,
      from: config.from,
    });
    logger.info(
      { to: options.to, subject: options.subject },
      "Email sent successfully",
    );
  } catch (error) {
    incrementOperationalCounter("email_delivery_failures_total");
    logger.error(
      { error, to: options.to, subject: options.subject },
      "Failed to send email",
    );
    throw error;
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  to: EmailAddress,
  data: PasswordResetEmailData,
): Promise<void> {
  const template = passwordResetTemplate(data);

  await sendEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });

  logger.info({ email: to.email }, "Password reset email sent");
}

/**
 * Send email verification email
 */
export async function sendEmailVerification(
  to: EmailAddress,
  data: EmailVerificationData,
  deliveryId?: string,
  signal?: AbortSignal,
): Promise<void> {
  const template = emailVerificationTemplate(data);

  await sendEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
    deliveryId,
    signal,
  });

  logger.info({ email: to.email }, "Email verification sent");
}

/**
 * Send welcome email
 */
export async function sendWelcomeEmail(
  to: EmailAddress,
  data: WelcomeEmailData,
): Promise<void> {
  const template = welcomeEmailTemplate(data);

  await sendEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });

  logger.info({ email: to.email }, "Welcome email sent");
}

/**
 * Verify email service configuration
 */
export async function verifyEmailService(): Promise<boolean> {
  try {
    const service = getEmailService();
    const isValid = await service.verify();

    if (isValid) {
      logger.info("Email service verified successfully");
    } else {
      logger.warn("Email service verification failed");
    }

    return isValid;
  } catch (error) {
    logger.error({ error }, "Email service verification error");
    return false;
  }
}

// Export types
export type {
  EmailService,
  EmailServiceConfig,
  SendEmailOptions,
  EmailAddress,
  PasswordResetEmailData,
  EmailVerificationData,
  WelcomeEmailData,
};
