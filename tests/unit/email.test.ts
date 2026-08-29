/**
 * Email Service Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Email Templates", () => {
  it("should generate password reset template", async () => {
    const { passwordResetTemplate } = await import("@/lib/email/templates");

    const template = passwordResetTemplate({
      userName: "John Doe",
      resetUrl: "https://example.com/reset?token=abc123",
      expiresIn: "1 hour",
    });

    expect(template.subject).toContain("Reset Your Password");
    expect(template.text).toContain("John Doe");
    expect(template.text).toContain("https://example.com/reset?token=abc123");
    expect(template.text).toContain("1 hour");
    expect(template.html).toContain("John Doe");
    expect(template.html).toContain("https://example.com/reset?token=abc123");
  });

  it("should generate email verification template", async () => {
    const { emailVerificationTemplate } = await import("@/lib/email/templates");

    const template = emailVerificationTemplate({
      userName: "Jane Smith",
      verificationUrl: "https://example.com/verify?token=xyz789",
      expiresIn: "24 hours",
    });

    expect(template.subject).toContain("Verify Your Email");
    expect(template.text).toContain("Jane Smith");
    expect(template.text).toContain("https://example.com/verify?token=xyz789");
    expect(template.text).toContain("24 hours");
  });

  it("should generate welcome email template", async () => {
    const { welcomeEmailTemplate } = await import("@/lib/email/templates");

    const template = welcomeEmailTemplate({
      userName: "Alice Johnson",
      loginUrl: "https://example.com/login",
    });

    expect(template.subject).toContain("Welcome");
    expect(template.text).toContain("Alice Johnson");
    expect(template.text).toContain("https://example.com/login");
  });
});

describe("Console Email Provider", () => {
  it("should log email to console", async () => {
    const { ConsoleEmailProvider } =
      await import("@/lib/email/providers/console");

    const provider = new ConsoleEmailProvider();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await provider.send({
      to: { email: "test@example.com", name: "Test User" },
      subject: "Test Email",
      text: "This is a test email",
      html: "<p>This is a test email</p>",
    });

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("Test Email");

    consoleSpy.mockRestore();
  });

  it("should verify successfully", async () => {
    const { ConsoleEmailProvider } =
      await import("@/lib/email/providers/console");

    const provider = new ConsoleEmailProvider();
    const result = await provider.verify();

    expect(result).toBe(true);
  });

  it("should format email addresses correctly", async () => {
    const { ConsoleEmailProvider } =
      await import("@/lib/email/providers/console");

    const provider = new ConsoleEmailProvider();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await provider.send({
      to: [
        { email: "test1@example.com", name: "User One" },
        { email: "test2@example.com" },
      ],
      subject: "Test",
      text: "Test",
    });

    const output = consoleSpy.mock.calls.join("\n");
    expect(output).toContain("User One <test1@example.com>");
    expect(output).toContain("test2@example.com");

    consoleSpy.mockRestore();
  });
});

describe("Email Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.EMAIL_PROVIDER;
    vi.resetModules();
  });

  it("should use console provider by default", async () => {
    // Re-import to get fresh instance
    const emailModule = await import("@/lib/email/index");
    const service = emailModule.getEmailService();

    expect(service).toBeDefined();
  });

  it("should send password reset email", async () => {
    const { sendPasswordResetEmail } = await import("@/lib/email/index");

    // Should not throw with console provider
    await expect(
      sendPasswordResetEmail(
        { email: "user@example.com", name: "Test User" },
        {
          userName: "Test User",
          resetUrl: "https://example.com/reset?token=test",
          expiresIn: "1 hour",
        },
      ),
    ).resolves.not.toThrow();
  });

  it("should send email verification", async () => {
    const { sendEmailVerification } = await import("@/lib/email/index");

    await expect(
      sendEmailVerification(
        { email: "user@example.com", name: "Test User" },
        {
          userName: "Test User",
          verificationUrl: "https://example.com/verify?token=test",
          expiresIn: "24 hours",
        },
      ),
    ).resolves.not.toThrow();
  });

  it("should send welcome email", async () => {
    const { sendWelcomeEmail } = await import("@/lib/email/index");

    await expect(
      sendWelcomeEmail(
        { email: "user@example.com", name: "Test User" },
        {
          userName: "Test User",
          loginUrl: "https://example.com/login",
        },
      ),
    ).resolves.not.toThrow();
  });

  it("should verify email service", async () => {
    const { verifyEmailService } = await import("@/lib/email/index");

    const result = await verifyEmailService();

    // Console provider should always verify successfully
    expect(result).toBe(true);
  });

  it("should handle email send errors gracefully", async () => {
    // Mock provider to throw error
    vi.resetModules();
    vi.doMock("@/lib/email/providers/console", () => ({
      ConsoleEmailProvider: class {
        async send() {
          throw new Error("Test error");
        }
        async verify() {
          return true;
        }
      },
    }));

    const { sendEmail } = await import("@/lib/email/index");

    await expect(
      sendEmail({
        to: { email: "test@example.com" },
        subject: "Test",
        text: "Test",
      }),
    ).rejects.toThrow();
  });
});
