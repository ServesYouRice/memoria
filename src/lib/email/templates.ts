/**
 * Email Templates
 * Pre-defined email templates for common scenarios
 */

import type {
  EmailTemplate,
  PasswordResetEmailData,
  EmailVerificationData,
  WelcomeEmailData,
} from "./types";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

/**
 * Password reset email template
 */
export function passwordResetTemplate(
  data: PasswordResetEmailData,
): EmailTemplate {
  const { userName, resetUrl, expiresIn } = data;

  return {
    subject: "Reset Your Password - Memoria",
    text: `
Hi ${userName},

We received a request to reset your password for your Memoria account.

Click the link below to reset your password:
${resetUrl}

This link will expire in ${expiresIn}.

If you didn't request this password reset, you can safely ignore this email.

Best regards,
The Memoria Team
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
    <h1 style="color: #1976d2; margin-top: 0;">Reset Your Password</h1>

    <p>Hi ${userName},</p>

    <p>We received a request to reset your password for your Memoria account.</p>

    <div style="margin: 30px 0;">
      <a href="${resetUrl}" style="display: inline-block; background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 500;">Reset Password</a>
    </div>

    <p style="font-size: 14px; color: #666;">This link will expire in ${expiresIn}.</p>

    <p style="font-size: 14px; color: #666;">If you didn't request this password reset, you can safely ignore this email.</p>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <p style="font-size: 12px; color: #999;">
      Best regards,<br>
      The Memoria Team
    </p>
  </div>
</body>
</html>
    `.trim(),
  };
}

/**
 * Email verification template
 */
export function emailVerificationTemplate(
  data: EmailVerificationData,
): EmailTemplate {
  const { userName, verificationUrl, expiresIn } = data;

  return {
    subject: "Verify Your Email - Memoria",
    text: `
Hi ${userName},

Welcome to Memoria! Please verify your email address to complete your account setup.

Click the link below to verify your email:
${verificationUrl}

This link will expire in ${expiresIn}.

If you didn't create a Memoria account, you can safely ignore this email.

Best regards,
The Memoria Team
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
    <h1 style="color: #1976d2; margin-top: 0;">Verify Your Email</h1>

    <p>Hi ${userName},</p>

    <p>Welcome to Memoria! Please verify your email address to complete your account setup.</p>

    <div style="margin: 30px 0;">
      <a href="${verificationUrl}" style="display: inline-block; background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 500;">Verify Email</a>
    </div>

    <p style="font-size: 14px; color: #666;">This link will expire in ${expiresIn}.</p>

    <p style="font-size: 14px; color: #666;">If you didn't create a Memoria account, you can safely ignore this email.</p>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <p style="font-size: 12px; color: #999;">
      Best regards,<br>
      The Memoria Team
    </p>
  </div>
</body>
</html>
    `.trim(),
  };
}

/**
 * Welcome email template
 */
export function welcomeEmailTemplate(data: WelcomeEmailData): EmailTemplate {
  const { userName, loginUrl } = data;

  return {
    subject: "Welcome to Memoria!",
    text: `
Hi ${userName},

Welcome to Memoria! We're excited to have you on board.

Memoria helps you organize your thoughts, bookmarks, and ideas on an infinite canvas. Here are some things you can do:

- Create canvases to organize different projects
- Add notes and bookmarks to your canvases
- Share canvases with team members
- Use templates to get started quickly

Get started by logging in:
${loginUrl}

If you have any questions, feel free to reach out to our support team.

Happy organizing!
The Memoria Team
    `.trim(),
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px;">
    <h1 style="color: #1976d2; margin-top: 0;">Welcome to Memoria!</h1>

    <p>Hi ${userName},</p>

    <p>Welcome to Memoria! We're excited to have you on board.</p>

    <p>Memoria helps you organize your thoughts, bookmarks, and ideas on an infinite canvas. Here are some things you can do:</p>

    <ul style="padding-left: 20px;">
      <li>Create canvases to organize different projects</li>
      <li>Add notes and bookmarks to your canvases</li>
      <li>Share canvases with team members</li>
      <li>Use templates to get started quickly</li>
    </ul>

    <div style="margin: 30px 0;">
      <a href="${loginUrl}" style="display: inline-block; background-color: #1976d2; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: 500;">Get Started</a>
    </div>

    <p style="font-size: 14px; color: #666;">If you have any questions, feel free to reach out to our support team.</p>

    <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">

    <p style="font-size: 12px; color: #999;">
      Happy organizing!<br>
      The Memoria Team
    </p>
  </div>
</body>
</html>
    `.trim(),
  };
}

export function shareInvitationTemplate(data: {
  inviterName: string;
  canvasName: string;
  invitationUrl: string;
  expiresIn: string;
}): EmailTemplate {
  const text = `${data.inviterName} invited you to "${data.canvasName}" in Memoria.\n\nReview the invitation: ${data.invitationUrl}\n\nThis single-use link expires in ${data.expiresIn}.`;
  const inviterName = escapeHtml(data.inviterName);
  const canvasName = escapeHtml(data.canvasName);
  const invitationUrl = escapeHtml(data.invitationUrl);
  return {
    subject: `${data.inviterName} invited you to a Memoria canvas`,
    text,
    html: `<p>${inviterName} invited you to <strong>${canvasName}</strong> in Memoria.</p><p><a href="${invitationUrl}">Review invitation</a></p><p>This single-use link expires in ${escapeHtml(data.expiresIn)}.</p>`,
  };
}

export function shareDecisionTemplate(data: {
  recipientEmail: string;
  canvasName: string;
  decision: "accepted" | "declined";
}): EmailTemplate {
  const text = `${data.recipientEmail} ${data.decision} your invitation to "${data.canvasName}".`;
  return {
    subject: `Canvas invitation ${data.decision}`,
    text,
    html: `<p>${escapeHtml(data.recipientEmail)} ${data.decision} your invitation to <strong>${escapeHtml(data.canvasName)}</strong>.</p>`,
  };
}
