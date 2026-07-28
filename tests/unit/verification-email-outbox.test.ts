import { describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/agents/crypto";
import { createVerificationEmailHandler } from "@/lib/email/outbox-handler";
import { requireExternalWebhookExecution } from "@/lib/agents/external-delivery-policy";

const verificationId = "clverification123456789012345";

function job() {
  return {
    id: "cldelivery12345678901234567",
    type: "email.verification",
    payload: { verificationId },
  } as never;
}

describe("durable verification delivery", () => {
  it("delivers an active token with a stable delivery id", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      emailVerificationToken: {
        findUnique: vi.fn().mockResolvedValue({
          email: "user@example.com",
          expiresAt: new Date(Date.now() + 60_000),
          usedAt: null,
          deliverySecret: encryptSecret("raw-verification-value"),
        }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ name: "User" }) },
    } as never;
    await createVerificationEmailHandler(prisma, send)(job());
    expect(send).toHaveBeenCalledWith(
      { email: "user@example.com", name: "User" },
      expect.objectContaining({
        verificationUrl: expect.stringContaining("raw-verification-value"),
      }),
      "cldelivery12345678901234567",
    );
  });

  it("treats expired delivery intents as terminal success", async () => {
    const send = vi.fn();
    const prisma = {
      emailVerificationToken: {
        findUnique: vi.fn().mockResolvedValue({
          email: "user@example.com",
          expiresAt: new Date(0),
          usedAt: null,
          deliverySecret: "unused",
        }),
      },
    } as never;
    await createVerificationEmailHandler(prisma, send)(job());
    expect(send).not.toHaveBeenCalled();
  });

  it("gates external webhook execution for v1", () => {
    expect(() => requireExternalWebhookExecution()).toThrowError(
      expect.objectContaining({
        status: 403,
        detail: "External webhook execution is disabled for v1.",
      }),
    );
  });
});
