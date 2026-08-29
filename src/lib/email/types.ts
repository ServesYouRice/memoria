/**
 * Email Service Type Definitions
 * Defines interfaces for pluggable email service providers
 */

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailOptions {
  to: EmailAddress | EmailAddress[];
  from?: EmailAddress;
  subject: string;
  text: string;
  html?: string;
  cc?: EmailAddress | EmailAddress[];
  bcc?: EmailAddress | EmailAddress[];
  replyTo?: EmailAddress;
  attachments?: EmailAttachment[];
  deliveryId?: string;
  signal?: AbortSignal;
}

export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export interface EmailServiceConfig {
  provider: "console" | "smtp" | "sendgrid" | "resend";
  from: EmailAddress;
  // Provider-specific configuration
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  sendgrid?: {
    apiKey: string;
    apiUrl?: string;
  };
  resend?: {
    apiKey: string;
  };
}

export interface EmailTemplate {
  subject: string;
  text: string;
  html?: string;
}

export interface EmailService {
  /**
   * Send an email
   */
  send(options: SendEmailOptions): Promise<void>;

  /**
   * Verify email service configuration is valid
   */
  verify(): Promise<boolean>;
}

/**
 * Template data for password reset emails
 */
export interface PasswordResetEmailData {
  userName: string;
  resetUrl: string;
  expiresIn: string;
}

/**
 * Template data for email verification emails
 */
export interface EmailVerificationData {
  userName: string;
  verificationUrl: string;
  expiresIn: string;
}

/**
 * Template data for welcome emails
 */
export interface WelcomeEmailData {
  userName: string;
  loginUrl: string;
}
