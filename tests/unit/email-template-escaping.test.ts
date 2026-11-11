import { describe, expect, it } from "vitest";
import {
  emailVerificationTemplate,
  passwordResetTemplate,
  welcomeEmailTemplate,
} from "@/lib/email/templates";

const hostile = '</p><a href="https://evil.example">Verify Email</a><p hidden>';
const url = "https://memoria.example/x?a=1&b=2";

const templates = {
  passwordResetTemplate: (userName: string) =>
    passwordResetTemplate({ userName, resetUrl: url, expiresIn: "1 hour" }),
  emailVerificationTemplate: (userName: string) =>
    emailVerificationTemplate({
      userName,
      verificationUrl: url,
      expiresIn: "24 hours",
    }),
  welcomeEmailTemplate: (userName: string) =>
    welcomeEmailTemplate({ userName, loginUrl: url }),
};

describe.each(Object.entries(templates))("%s", (_name, render) => {
  it("escapes a hostile user name in HTML and keeps it raw in text", () => {
    const email = render(hostile);
    expect(email.html).not.toContain('<a href="https://evil.example">');
    expect(email.html).toContain(
      "&lt;/p&gt;&lt;a href=&quot;https://evil.example&quot;&gt;",
    );
    expect(email.text).toContain(hostile);
  });

  it("renders an ordinary name and escapes the link attribute", () => {
    const email = render("Ada Lovelace");
    expect(email.html).toContain("<p>Hi Ada Lovelace,</p>");
    expect(email.html).toContain(
      'href="https://memoria.example/x?a=1&amp;b=2"',
    );
    expect(email.text).toContain(url);
  });
});
