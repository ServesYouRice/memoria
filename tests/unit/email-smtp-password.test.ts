import { afterEach, describe, expect, it, vi } from "vitest";
import * as email from "@/lib/email";

afterEach(() => vi.unstubAllEnvs());

function smtpPass(pass: string | undefined, password: string | undefined) {
  vi.stubEnv("EMAIL_PROVIDER", "smtp");
  vi.stubEnv("SMTP_USER", "mailer");
  vi.stubEnv("SMTP_PASS", pass);
  vi.stubEnv("SMTP_PASSWORD", password);
  const getEmailConfig = (
    email as unknown as {
      getEmailConfig?: () => { smtp?: { auth: { pass: string } } };
    }
  ).getEmailConfig;
  expect(typeof getEmailConfig).toBe("function");
  return getEmailConfig!().smtp?.auth.pass;
}

describe("SMTP password resolution", () => {
  it("uses SMTP_PASSWORD when SMTP_PASS is not set", () => {
    expect(smtpPass(undefined, "alias-secret")).toBe("alias-secret");
  });
  it("uses SMTP_PASS when only it is set", () => {
    expect(smtpPass("primary-secret", undefined)).toBe("primary-secret");
  });
  it("prefers SMTP_PASS when both are set, as env.ts does", () => {
    expect(smtpPass("primary-secret", "alias-secret")).toBe("primary-secret");
  });
  it("falls back to an empty password when neither is set", () => {
    expect(smtpPass(undefined, undefined)).toBe("");
  });
});
