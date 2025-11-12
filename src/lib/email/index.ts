/**
 * Email Service
 * Main entry point for sending emails
 * Following ADR pattern for service abstraction
 */

import { logger } from '@/lib/logger';
import type {
  EmailService,
  EmailServiceConfig,
  SendEmailOptions,
  EmailAddress,
  PasswordResetEmailData,
  EmailVerificationData,
  WelcomeEmailData,
} from './types';
import { ConsoleEmailProvider } from './providers/console';
import { SMTPEmailProvider } from './providers/smtp';
import {
  passwordResetTemplate,
  emailVerificationTemplate,
  welcomeEmailTemplate,
} from './templates';

/**
 * Email service configuration from environment
 */
function getEmailConfig(): EmailServiceConfig {
  const provider = (process.env.EMAIL_PROVIDER || 'console') as EmailServiceConfig['provider'];

  const config: EmailServiceConfig = {
    provider,
    from: {
      email: process.env.EMAIL_FROM || 'noreply@canvascollect.com',
      name: process.env.EMAIL_FROM_NAME || 'CanvasCollect',
    },
  };

  // Provider-specific configuration
  if (provider === 'smtp') {
    config.smtp = {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    };
  } else if (provider === 'sendgrid') {
    config.sendgrid = {
      apiKey: process.env.SENDGRID_API_KEY || '',
    };
  } else if (provider === 'resend') {
    config.resend = {
      apiKey: process.env.RESEND_API_KEY || '',
    };
  }

  return config;
}

/**
 * Create email provider based on configuration
 */
function createEmailProvider(config: EmailServiceConfig): EmailService {
  switch (config.provider) {
    case 'console':
      logger.info('Using console email provider (development mode)');
      return new ConsoleEmailProvider();

    case 'smtp':
      if (!config.smtp) {
        throw new Error('SMTP configuration is required for SMTP provider');
      }
      logger.info({ host: config.smtp.host }, 'Using SMTP email provider');
      return new SMTPEmailProvider(config.smtp);

    case 'sendgrid':
      // Future implementation
      throw new Error('SendGrid provider not yet implemented. Use console or smtp provider.');

    case 'resend':
      // Future implementation
      throw new Error('Resend provider not yet implemented. Use console or smtp provider.');

    default:
      logger.warn({ provider: config.provider }, 'Unknown email provider, falling back to console');
      return new ConsoleEmailProvider();
  }
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
 */
export async function sendEmail(options: Omit<SendEmailOptions, 'from'>): Promise<void> {
  const service = getEmailService();
  const config = getEmailConfig();

  try {
    await service.send({
      ...options,
      from: config.from,
    });
    logger.info({ to: options.to, subject: options.subject }, 'Email sent successfully');
  } catch (error) {
    logger.error({ error, to: options.to, subject: options.subject }, 'Failed to send email');
    throw error;
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  to: EmailAddress,
  data: PasswordResetEmailData
): Promise<void> {
  const template = passwordResetTemplate(data);

  await sendEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });

  logger.info({ email: to.email }, 'Password reset email sent');
}

/**
 * Send email verification email
 */
export async function sendEmailVerification(
  to: EmailAddress,
  data: EmailVerificationData
): Promise<void> {
  const template = emailVerificationTemplate(data);

  await sendEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });

  logger.info({ email: to.email }, 'Email verification sent');
}

/**
 * Send welcome email
 */
export async function sendWelcomeEmail(to: EmailAddress, data: WelcomeEmailData): Promise<void> {
  const template = welcomeEmailTemplate(data);

  await sendEmail({
    to,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });

  logger.info({ email: to.email }, 'Welcome email sent');
}

/**
 * Verify email service configuration
 */
export async function verifyEmailService(): Promise<boolean> {
  try {
    const service = getEmailService();
    const isValid = await service.verify();

    if (isValid) {
      logger.info('Email service verified successfully');
    } else {
      logger.warn('Email service verification failed');
    }

    return isValid;
  } catch (error) {
    logger.error({ error }, 'Email service verification error');
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
